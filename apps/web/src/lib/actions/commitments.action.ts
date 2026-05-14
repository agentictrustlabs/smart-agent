'use server'

/**
 * Spec 006 — Commitment lifecycle actions.
 *
 *   - listCommitmentsForProposal   — read-side index for the proposal page.
 *   - getCommitment                — read one (chain → typed struct).
 *   - releaseTranche               — Rail A: donor.executeBatch([transfer, recordRelease]).
 *   - recordOutcome                — on-chain attestation (validator gate is off-chain).
 *   - cancelCommitment             — donor-owner only; status → Canceled.
 *
 * Auth: every donor-side write (release / cancel / setRecipient / setDonor)
 * goes through `canManageAgent(donor, signer)`. The release path mirrors
 * spec-005 honor — the signer is the donor's owner (pool steward for grant
 * lane, offerer for direct lane), and they sign a single-hop delegation
 * pinned to the exact calldata hash. Direct EOA call is also accepted on
 * test/dev where the steward owner key is loaded server-side.
 */

import { type Address, type Hex, keccak256, toBytes, toHex, encodeFunctionData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  commitmentRegistryAbi,
  ROOT_AUTHORITY,
  hashDelegation,
  delegationManagerAbi,
  encodeReleaseBatch,
  releaseBatchHash,
  buildReleaseDelegationCaveats,
} from '@smart-agent/sdk'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getPublicClient } from '@/lib/contracts'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

// ─── Read helpers ────────────────────────────────────────────────────

export interface CommitmentRow {
  commitmentSubject: Hex
  sourceKind: Hex
  sourceSubject: Hex
  donor: Address
  recipient: Address
  token: Address
  totalAmount: string
  releasedAmount: string
  status: string
  needIntentId: string
  offerIntentId: string
  milestonesJson: string
  round: Hex
}

const STATUS_LABEL: Record<string, string> = {
  [keccak256(toHex('sa:CommitmentPending')).toLowerCase()]:          'pending',
  [keccak256(toHex('sa:CommitmentInFlight')).toLowerCase()]:         'in-flight',
  [keccak256(toHex('sa:CommitmentCompleted')).toLowerCase()]:        'completed',
  [keccak256(toHex('sa:CommitmentCanceled')).toLowerCase()]:         'canceled',
  [keccak256(toHex('sa:CommitmentReleasesBlocked')).toLowerCase()]:  'releases-blocked',
}

const SOURCE_LABEL: Record<string, string> = {
  [keccak256(toHex('sa:CommitmentSourceAward')).toLowerCase()]:        'grant-award',
  [keccak256(toHex('sa:CommitmentSourceDirectMatch')).toLowerCase()]:  'direct-match',
  [keccak256(toHex('sa:CommitmentSourcePoolPledge')).toLowerCase()]:   'pool-pledge',
}

// Internal — Next.js 'use server' requires every export be async, so these
// stay un-exported. If a client needs them, expose via a sibling
// `commitments.labels.ts` non-server module.
function statusLabel(statusHash: string): string {
  return STATUS_LABEL[statusHash.toLowerCase()] ?? 'unknown'
}
function sourceLabel(sourceHash: string): string {
  return SOURCE_LABEL[sourceHash.toLowerCase()] ?? 'unknown'
}
void sourceLabel

function commitmentSubjectFor(sourceKind: Hex, sourceSubject: Hex, donor: Address): Hex {
  return keccak256(
    new Uint8Array([
      ...toBytes('sa:commitment:'),
      ...toBytes(sourceKind),
      ...toBytes(sourceSubject),
      ...toBytes(donor.toLowerCase() as `0x${string}`),
    ]),
  )
}

async function readCommitment(subject: Hex): Promise<CommitmentRow | null> {
  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  if (!registry) return null
  const pub = getPublicClient()
  try {
    const [
      sourceKind, sourceSubject, donor, recipient, token,
      totalAmount, releasedAmount, status,
    ] = (await pub.readContract({
      address: registry,
      abi: commitmentRegistryAbi,
      functionName: 'getCommitment',
      args: [subject],
    })) as readonly [Hex, Hex, Address, Address, Address, bigint, bigint, Hex]
    if (donor === '0x0000000000000000000000000000000000000000') return null
    const [needIntentId, offerIntentId, milestonesJson, round] = await Promise.all([
      pub.readContract({ address: registry, abi: commitmentRegistryAbi, functionName: 'getString',  args: [subject, keccak256(toHex('sa:commitmentNeedIntent'))] }).catch(() => '') as Promise<string>,
      pub.readContract({ address: registry, abi: commitmentRegistryAbi, functionName: 'getString',  args: [subject, keccak256(toHex('sa:commitmentOfferIntent'))] }).catch(() => '') as Promise<string>,
      pub.readContract({ address: registry, abi: commitmentRegistryAbi, functionName: 'getString',  args: [subject, keccak256(toHex('sa:commitmentMilestonesJson'))] }).catch(() => '') as Promise<string>,
      pub.readContract({ address: registry, abi: commitmentRegistryAbi, functionName: 'getBytes32', args: [subject, keccak256(toHex('sa:commitmentRound'))] }).catch(() => ('0x' + '0'.repeat(64)) as Hex) as Promise<Hex>,
    ])
    return {
      commitmentSubject: subject,
      sourceKind,
      sourceSubject,
      donor,
      recipient,
      token,
      totalAmount: totalAmount.toString(),
      releasedAmount: releasedAmount.toString(),
      status: statusLabel(status),
      needIntentId,
      offerIntentId,
      milestonesJson,
      round,
    }
  } catch {
    return null
  }
}

/**
 * Read the grant-lane commitment row for a given proposal. Computes the
 * subject via the canonical formula (sourceKind=MATCH_AWARD, sourceSubject
 * = proposalSubject, donor = pool). Returns null when not yet created.
 */
export async function getCommitmentForProposal(
  proposalSubject: Hex,
  poolAgent: Address,
): Promise<CommitmentRow | null> {
  const sourceKind = keccak256(toBytes('sa:CommitmentSourceAward'))
  const subject = commitmentSubjectFor(sourceKind, proposalSubject, poolAgent)
  return readCommitment(subject)
}

export interface MilestoneReleaseInfo {
  milestoneId: Hex
  amount: string
  releasedAt: number
  /** EOA that submitted the recordRelease tx — i.e., the steward who
   *  signed the release delegation. Pulled from the Released event's
   *  tx.from so the UI can attribute the action. */
  signerEoa: Address | null
  /** Display name resolved from `getAgentMetadata`; falls back to the
   *  short hex address. Pre-resolved server-side so the panel can render
   *  without an extra round-trip. */
  signerLabel: string | null
}

export async function getMilestoneRelease(
  commitmentSubject: Hex,
  milestoneId: Hex,
): Promise<MilestoneReleaseInfo | null> {
  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  if (!registry) return null
  const pub = getPublicClient()
  let amount: bigint
  let releasedAt: bigint
  try {
    [amount, releasedAt] = (await pub.readContract({
      address: registry,
      abi: commitmentRegistryAbi,
      functionName: 'getMilestoneRelease',
      args: [commitmentSubject, milestoneId],
    })) as readonly [bigint, bigint]
  } catch {
    return null
  }
  if (releasedAt === 0n) return null

  // Find the Released event for this (commitment, milestone) and pull
  // the signer EOA from the originating tx. Cheaper to filter by both
  // indexed topics than to fetch every event and scan client-side.
  let signerEoa: Address | null = null
  try {
    const logs = await pub.getLogs({
      address: registry,
      event: {
        type: 'event',
        name: 'Released',
        inputs: [
          { name: 'commitmentSubject', type: 'bytes32', indexed: true },
          { name: 'milestoneId', type: 'bytes32', indexed: true },
          { name: 'recipient', type: 'address', indexed: true },
          { name: 'amount', type: 'uint256', indexed: false },
          { name: 'totalReleased', type: 'uint256', indexed: false },
        ],
      },
      args: { commitmentSubject, milestoneId },
      fromBlock: 0n,
    })
    if (logs.length > 0) {
      const tx = await pub.getTransaction({ hash: logs[0].transactionHash! })
      signerEoa = tx.from
    }
  } catch { /* skip; render without signer */ }

  let signerLabel: string | null = null
  if (signerEoa) {
    try {
      const { getAgentMetadata } = await import('@/lib/agent-metadata')
      const meta = await getAgentMetadata(signerEoa)
      signerLabel = meta.displayName ?? null
    } catch {
      signerLabel = `${signerEoa.slice(0, 6)}…${signerEoa.slice(-4)}`
    }
  }

  return {
    milestoneId,
    amount: amount.toString(),
    releasedAt: Number(releasedAt),
    signerEoa,
    signerLabel,
  }
}

// ─── Release ─────────────────────────────────────────────────────────

export interface ReleaseTrancheInput {
  commitmentSubject: Hex
  milestoneId: string
  /** Token-scaled amount (USDC 6-decimal: $12k → 12000_000000n). */
  tokenAmount: bigint
  /** Commitment-scale amount — usually equal to tokenAmount in v1. */
  commitmentScaleAmount: bigint
}

export interface ReleaseTrancheResult {
  ok: boolean
  txHash?: Hex
  error?: string
}

export async function releaseTranche(input: ReleaseTrancheInput): Promise<ReleaseTrancheResult> {
  const me = await getCurrentUser()
  if (!me) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }

  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  const delegationManager = process.env.DELEGATION_MANAGER_ADDRESS as Address | undefined
  if (!registry || !delegationManager) {
    return { ok: false, error: 'spec-006 env not configured (COMMITMENT_REGISTRY_ADDRESS / DELEGATION_MANAGER_ADDRESS)' }
  }
  const enforcers = {
    allowedTargets: process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address,
    allowedMethods: process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address,
    callDataHash:   process.env.CALLDATA_HASH_ENFORCER_ADDRESS as Address,
    timestamp:      process.env.TIMESTAMP_ENFORCER_ADDRESS as Address,
    value:          process.env.VALUE_ENFORCER_ADDRESS as Address,
  }
  if (!enforcers.allowedTargets || !enforcers.allowedMethods || !enforcers.callDataHash
      || !enforcers.timestamp || !enforcers.value) {
    return { ok: false, error: 'release enforcers not configured' }
  }

  const commitment = await readCommitmentBySubject(input.commitmentSubject)
  if (!commitment) return { ok: false, error: 'commitment-not-found' }
  if (commitment.status !== 'pending' && commitment.status !== 'in-flight') {
    return { ok: false, error: `commitment is ${commitment.status} — release is not available` }
  }

  // Donor-side auth: viewer must be able to manage the donor's AgentAccount.
  let canMng = false
  try { canMng = await canManageAgent(myAgent, commitment.donor) } catch { canMng = false }
  if (!canMng) return { ok: false, error: 'not-donor-owner' }

  // Two-gate release: a validator must have attested milestone delivery
  // before the steward's release signature is honored. CommitmentRegistry
  // stores `recordedBy = msg.sender` on the outcome subject; non-zero
  // means at least one party recorded an outcome for this milestone.
  // Contract-level enforcement (recordRelease checks getOutcome on chain)
  // is the v2 follow-up; this gate matches the same invariant at the
  // action boundary.
  try {
    const milestoneIdHashGate = keccak256(toBytes(input.milestoneId))
    const [, recordedAt, recordedBy] = (await getPublicClient().readContract({
      address: registry, abi: commitmentRegistryAbi,
      functionName: 'getOutcome',
      args: [input.commitmentSubject, milestoneIdHashGate],
    })) as readonly [Hex, bigint, Address]
    if (recordedAt === 0n || recordedBy === '0x0000000000000000000000000000000000000000') {
      return {
        ok: false,
        error: `milestone "${input.milestoneId}" has no validator attestation yet — a validator must call recordOutcome before this tranche can release`,
      }
    }
  } catch {
    return {
      ok: false,
      error: `could not read outcome record for milestone "${input.milestoneId}" — verify CommitmentRegistry address`,
    }
  }

  // Signer = viewer's own EOA (P1 substrate-independence rule). Demo users
  // have a stored privateKey; passkey/SIWE users currently fall back via
  // loadSignerForCurrentUser (placeholder until the passkey ceremony lands).
  const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
  let signerCtx: Awaited<ReturnType<typeof loadSignerForCurrentUser>> | null = null
  try { signerCtx = await loadSignerForCurrentUser() } catch { /* not signed in */ }
  if (signerCtx?.kind !== 'eoa' || !signerCtx.userRow.privateKey) {
    return { ok: false, error: 'cannot self-sign release delegation — no EOA key available' }
  }
  const signerKey = signerCtx.userRow.privateKey as Hex
  const signer = privateKeyToAccount(signerKey)

  // 1. Build calldata + hash.
  const milestoneIdHash = keccak256(toBytes(input.milestoneId))
  const batchInput = {
    donor: commitment.donor,
    recipient: commitment.recipient,
    token: commitment.token,
    commitmentRegistry: registry,
    commitmentSubject: input.commitmentSubject,
    milestoneId: milestoneIdHash,
    tokenAmount: input.tokenAmount,
    commitmentScaleAmount: input.commitmentScaleAmount,
  }
  const callData = encodeReleaseBatch(batchInput)
  const calldataHash = releaseBatchHash(batchInput)

  // 2. Donor → signer-EOA delegation with calldataHash pinned.
  const caveats = buildReleaseDelegationCaveats({
    donor: commitment.donor,
    calldataHash,
    enforcers,
  })
  const salt = BigInt('0x' + crypto.randomUUID().replace(/-/g, ''))
  const dHash = hashDelegation(
    {
      delegator: commitment.donor,
      delegate: signer.address,
      authority: ROOT_AUTHORITY as Hex,
      caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt,
    },
    CHAIN_ID,
    delegationManager,
  )
  const signature = await signer.sign({ hash: dHash })

  // 3. Submit redeem.
  const { createWalletClient, http: httpTransport } = await import('viem')
  const { foundry, sepolia } = await import('viem/chains')
  const chain = CHAIN_ID === 11155111 ? sepolia : foundry
  const wallet = createWalletClient({
    account: signer,
    chain,
    transport: httpTransport(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
  })
  const pub = getPublicClient()
  try {
    const txHash = await wallet.writeContract({
      address: delegationManager,
      abi: delegationManagerAbi,
      functionName: 'redeemDelegation',
      args: [
        [{
          delegator: commitment.donor,
          delegate: signer.address,
          authority: ROOT_AUTHORITY as Hex,
          caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: (c.args ?? '0x') as Hex })),
          salt,
          signature,
        }],
        commitment.donor,
        0n,
        callData,
      ],
    })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') {
      return { ok: false, error: `tx reverted (${txHash})`, txHash }
    }
    // Spec 006 — refresh GraphDB mirror so the timeline UI shows the new
    // released amount immediately. Best-effort; periodic sync recovers.
    try {
      const { syncAllCommitmentsToGraphDB } = await import('@/lib/ontology/graphdb-sync')
      await syncAllCommitmentsToGraphDB()
    } catch { /* non-fatal */ }
    return { ok: true, txHash }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Outcome attestation ─────────────────────────────────────────────

export interface RecordOutcomeInput {
  commitmentSubject: Hex
  /** Slug for the outcome (will be keccak256'd into bytes32). */
  outcomeId: string
  /** sha256 (or any 32-byte hash) of the evidence document. */
  evidenceHash: Hex
}

export async function recordOutcome(input: RecordOutcomeInput): Promise<{ ok: boolean; txHash?: Hex; error?: string }> {
  const me = await getCurrentUser()
  if (!me) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }

  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  if (!registry) return { ok: false, error: 'COMMITMENT_REGISTRY_ADDRESS not set' }
  if (input.evidenceHash === ('0x' + '0'.repeat(64))) {
    return { ok: false, error: 'evidence-hash-required' }
  }

  // Validator gate — verify the caller is in the round's `validators`
  // list (round.validatorRequirements JSON, populated at openRound). The
  // viewer's signing EOA (wallet) OR their person agent must appear.
  // Stewards (pool owners) are NOT automatically validators — the
  // two-gate model requires a distinct validator party from the steward.
  const commitment = await readCommitmentBySubject(input.commitmentSubject)
  if (!commitment) return { ok: false, error: 'commitment-not-found' }
  const viewerWallet = await loadViewerWallet(me.id)
  const validatorAddresses = await readRoundValidators(commitment.commitmentSubject)
  const candidates = new Set<string>([myAgent.toLowerCase()])
  if (viewerWallet) candidates.add(viewerWallet.toLowerCase())
  const isListedValidator = validatorAddresses.some((v) => candidates.has(v.toLowerCase()))
  // Backward compat: also accept pool stewards so the seed's existing
  // releaseTranche-after-attestation flow doesn't regress. The gate is
  // an OR — listed-validator OR pool-steward.
  let isSteward = false
  try { isSteward = await canManageAgent(myAgent, commitment.donor) } catch { isSteward = false }
  if (!isListedValidator && !isSteward) {
    return { ok: false, error: 'not-a-validator (caller must be listed in round.validators or own the donor pool)' }
  }

  const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
  let signerCtx: Awaited<ReturnType<typeof loadSignerForCurrentUser>> | null = null
  try { signerCtx = await loadSignerForCurrentUser() } catch { /* not signed in */ }
  if (signerCtx?.kind !== 'eoa' || !signerCtx.userRow.privateKey) {
    return { ok: false, error: 'cannot self-sign outcome attestation — no EOA key available' }
  }
  const signerKey = signerCtx.userRow.privateKey as Hex
  const signer = privateKeyToAccount(signerKey)

  const outcomeIdHash = keccak256(toBytes(input.outcomeId))
  const data = encodeFunctionData({
    abi: commitmentRegistryAbi,
    functionName: 'recordOutcome',
    args: [input.commitmentSubject, outcomeIdHash, input.evidenceHash],
  })

  const { createWalletClient, http: httpTransport } = await import('viem')
  const { foundry, sepolia } = await import('viem/chains')
  const chain = CHAIN_ID === 11155111 ? sepolia : foundry
  const wallet = createWalletClient({
    account: signer,
    chain,
    transport: httpTransport(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
  })
  const pub = getPublicClient()
  try {
    const txHash = await wallet.sendTransaction({ to: registry, data })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') return { ok: false, error: 'tx reverted', txHash }
    return { ok: true, txHash }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Cancel ──────────────────────────────────────────────────────────

export async function cancelCommitment(commitmentSubject: Hex, reason: string): Promise<{ ok: boolean; txHash?: Hex; error?: string }> {
  const me = await getCurrentUser()
  if (!me) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }

  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  if (!registry) return { ok: false, error: 'COMMITMENT_REGISTRY_ADDRESS not set' }
  const commitment = await readCommitmentBySubject(commitmentSubject)
  if (!commitment) return { ok: false, error: 'commitment-not-found' }
  let canMng = false
  try { canMng = await canManageAgent(myAgent, commitment.donor) } catch { canMng = false }
  if (!canMng) return { ok: false, error: 'not-donor-owner' }

  const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
  let signerCtx: Awaited<ReturnType<typeof loadSignerForCurrentUser>> | null = null
  try { signerCtx = await loadSignerForCurrentUser() } catch { /* not signed in */ }
  if (signerCtx?.kind !== 'eoa' || !signerCtx.userRow.privateKey) {
    return { ok: false, error: 'cannot self-sign cancel — no EOA key available' }
  }
  const signer = privateKeyToAccount(signerCtx.userRow.privateKey as Hex)
  const data = encodeFunctionData({
    abi: commitmentRegistryAbi,
    functionName: 'cancelCommitment',
    args: [commitmentSubject, keccak256(toBytes(reason))],
  })
  const { createWalletClient, http: httpTransport } = await import('viem')
  const { foundry, sepolia } = await import('viem/chains')
  const chain = CHAIN_ID === 11155111 ? sepolia : foundry
  const wallet = createWalletClient({
    account: signer,
    chain,
    transport: httpTransport(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
  })
  const pub = getPublicClient()
  try {
    // Cancel requires msg.sender to be an owner of donor — same pattern as
    // releaseTranche, but the call is direct (no delegation needed) because
    // the EOA is itself an owner.
    const txHash = await wallet.sendTransaction({ to: registry, data })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') return { ok: false, error: 'tx reverted', txHash }
    return { ok: true, txHash }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ─── Tasks inbox (validator attestation + steward approval) ────────

export interface InboxTask {
  kind: 'attestation' | 'release'
  commitmentSubject: Hex
  proposalSubject: Hex
  milestoneId: string
  milestoneLabel: string
  trancheBps: number
  amount: string
  donor: Address
  donorLabel: string | null
  recipient: Address
  recipientLabel: string | null
  needIntentId: string
}

/**
 * Build the viewer's inbox of pending tasks across every commitment:
 *   - 'attestation' rows: viewer is listed as a validator in the round's
 *     `validatorRequirements.validators` AND the milestone's outcome
 *     `recordedBy` is still zero.
 *   - 'release' rows: viewer can `canManageAgent(commitment.donor)` AND
 *     the milestone's outcome HAS been recorded but the per-milestone
 *     release record is still zero.
 */
export async function listInboxTasks(
  viewerEoa: Address,
  scopedCommitmentSubject?: `0x${string}`,
): Promise<InboxTask[]> {
  const { DiscoveryService } = await import('@smart-agent/discovery')
  const discovery = DiscoveryService.fromEnv()
  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  if (!registry) return []

  // Pull every commitment row from GraphDB (small set in dev).
  // Order by sa:committedAt DESC so newest commitments are processed
  // first. Cap at 25 so accumulated demo state from prior seed runs
  // doesn't cause the per-row chain-walk to silently exceed the page
  // render budget — Sarah was seeing an empty inbox because the SPARQL
  // returned ~30+ historical commits and the canManageAgent + outcome
  // reads (~3 chain RPCs × 30 commits × N milestones) exceeded budget.
  //
  // When `scopedCommitmentSubject` is passed (Tasks page accepts
  // `?commitment=0x...`), we replace the broad scan with a single-subject
  // lookup so the page renders fast even on a GraphDB with thousands of
  // historical commits. The customer-demo Playwright test uses this to
  // bypass the Cloudflare 524 timeout that hits the unfiltered query.
  const scopedFilter = scopedCommitmentSubject
    ? `FILTER(?commitment = <urn:smart-agent:commitment:${scopedCommitmentSubject.slice(2).toLowerCase()}>)`
    : ''
  const sparql = `
PREFIX sa: <https://smartagent.io/ontology/core#>
SELECT ?commitment ?sourceSubject ?donor ?recipient ?total ?status ?milestonesJson ?needIntent ?round ?committedAt
WHERE {
  GRAPH <https://smartagent.io/graph/data/onchain> {
    ?commitment a sa:Commitment ;
                sa:sourceSubject ?sourceSubject ;
                sa:donor ?donor ;
                sa:recipient ?recipient ;
                sa:totalAmount ?total ;
                sa:status ?status ;
                sa:milestonesJson ?milestonesJson .
    OPTIONAL { ?commitment sa:needIntent ?needIntent }
    OPTIONAL { ?commitment sa:round ?round }
    OPTIONAL { ?commitment sa:committedAt ?committedAt }
    ${scopedFilter}
  }
}
ORDER BY DESC(?committedAt)
LIMIT 25`
  let results
  try { results = await discovery.getClient().query(sparql) } catch { return [] }

  const pub = getPublicClient()
  const { canManageAgent, getPersonAgentForUser } = await import('@/lib/agent-registry')
  const { getAgentMetadata } = await import('@/lib/agent-metadata')
  const { getCurrentUser } = await import('@/lib/auth/get-current-user')

  const me = await getCurrentUser()
  if (!me) return []
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return []

  const stripIri = (s: string): Address => {
    if (s.startsWith('eth:')) return s.slice(4) as Address
    if (s.startsWith('https://smartagent.io/ontology/core#agent/')) return s.slice('https://smartagent.io/ontology/core#agent/'.length) as Address
    return s as Address
  }
  const stripCommitmentIri = (s: string): Hex =>
    (s.startsWith('urn:smart-agent:commitment:') ? `0x${s.slice('urn:smart-agent:commitment:'.length)}` : s) as Hex

  // Per-round validator lookup (mandate JSON carries validators).
  const fundRegistry = process.env.FUND_REGISTRY_ADDRESS as Address | undefined
  const { fundRegistryAbi } = await import('@smart-agent/sdk')
  async function getRoundValidators(roundSubject: Hex): Promise<Address[]> {
    if (!fundRegistry) return []
    try {
      const json = await pub.readContract({
        address: fundRegistry, abi: fundRegistryAbi,
        functionName: 'getString',
        args: [roundSubject, keccak256(toBytes('sa:roundValidatorRequirements'))],
      }) as string
      const parsed = JSON.parse(json || '{}') as { validators?: string[] }
      return (parsed.validators ?? []).map((v) => v.toLowerCase() as Address)
    } catch {
      return []
    }
  }

  const tasks: InboxTask[] = []
  for (const b of results.results?.bindings ?? []) {
    const commitmentSubject = stripCommitmentIri(b.commitment?.value ?? '')
    const proposalSubject = (b.sourceSubject?.value ?? '0x') as Hex
    const donor = stripIri(b.donor?.value ?? '')
    const recipient = stripIri(b.recipient?.value ?? '')
    const status = (b.status?.value ?? '').toLowerCase()
    if (status.includes('canceled') || status.includes('completed')) continue
    const roundSubject = (b.round?.value ?? '0x' + '0'.repeat(64)) as Hex
    let milestones: Array<{ id?: string; label?: string; trancheBps?: number }> = []
    try { milestones = JSON.parse(b.milestonesJson?.value ?? '[]') } catch { /* skip */ }
    if (milestones.length === 0) continue

    // Cache: is viewer a steward of this donor? Validator of this round?
    let canSteward = false
    try { canSteward = await canManageAgent(myAgent, donor) } catch { /* */ }
    const validators = await getRoundValidators(roundSubject)
    const isValidator = validators.includes(viewerEoa.toLowerCase() as Address)
      || validators.includes(myAgent.toLowerCase() as Address)

    if (!canSteward && !isValidator) continue

    // Per-milestone state — outcome + release records.
    const totalAmount = BigInt(b.total?.value ?? '0')
    for (const m of milestones) {
      const id = m.id ?? 'single'
      const trancheBps = m.trancheBps ?? Math.floor(10000 / milestones.length)
      const milestoneIdHash = keccak256(toBytes(id))
      let outcomeRecorded = false
      try {
        const [, recordedAt] = (await pub.readContract({
          address: registry, abi: commitmentRegistryAbi,
          functionName: 'getOutcome',
          args: [commitmentSubject, milestoneIdHash],
        })) as readonly [Hex, bigint, Address]
        outcomeRecorded = recordedAt > 0n
      } catch { /* skip */ }
      let alreadyReleased = false
      try {
        const [amt] = (await pub.readContract({
          address: registry, abi: commitmentRegistryAbi,
          functionName: 'getMilestoneRelease',
          args: [commitmentSubject, milestoneIdHash],
        })) as readonly [bigint, bigint]
        alreadyReleased = amt > 0n
      } catch { /* skip */ }

      if (alreadyReleased) continue
      const trancheAmount = ((totalAmount * BigInt(trancheBps)) / 10000n).toString()
      const base: Omit<InboxTask, 'kind'> = {
        commitmentSubject,
        proposalSubject,
        milestoneId: id,
        milestoneLabel: m.label ?? id,
        trancheBps,
        amount: trancheAmount,
        donor,
        donorLabel: null,
        recipient,
        recipientLabel: null,
        needIntentId: b.needIntent?.value ?? '',
      }
      try {
        base.donorLabel = (await getAgentMetadata(donor)).displayName ?? null
        base.recipientLabel = (await getAgentMetadata(recipient)).displayName ?? null
      } catch { /* fall back to short hex in UI */ }

      if (!outcomeRecorded && isValidator) {
        tasks.push({ ...base, kind: 'attestation' })
      } else if (outcomeRecorded && canSteward) {
        tasks.push({ ...base, kind: 'release' })
      }
    }
  }
  return tasks
}

// ─── Fulfillment forward-walk (Spec 006 intent page) ────────────────

export interface FulfillmentRow {
  commitmentSubject: Hex
  proposalSubject: Hex
  donor: Address
  donorLabel: string | null
  recipient: Address
  recipientLabel: string | null
  totalAmount: string
  releasedAmount: string
  status: string
  milestonesJson: string
}

/**
 * Find every commitment whose `sa:commitmentNeedIntent` matches the given
 * intent URN. Drives the Fulfillment section on the intent detail page —
 * lets the originator of a need see "this commitment was awarded against
 * my intent, here's the money trail."
 */
export async function listFulfillmentsForIntent(intentUrn: string): Promise<FulfillmentRow[]> {
  const { DiscoveryService } = await import('@smart-agent/discovery')
  const discovery = DiscoveryService.fromEnv()
  // The on-chain → GraphDB emitter uses JS-key short curies (e.g.,
  // `sa:needIntent`, `sa:donor`) rather than the full `sa:commitmentXxx`
  // predicate names stored on chain. See COMMITMENT_PREDICATES + the
  // emitter loop in apps/web/src/lib/ontology/graphdb-sync.ts.
  const sparql = `
PREFIX sa: <https://smartagent.io/ontology/core#>
SELECT ?commitment ?sourceSubject ?donor ?recipient ?total ?released ?status ?milestonesJson
WHERE {
  GRAPH <https://smartagent.io/graph/data/onchain> {
    ?commitment a sa:Commitment ;
                sa:needIntent "${intentUrn.replace(/"/g, '\\"')}" ;
                sa:sourceSubject ?sourceSubject ;
                sa:donor ?donor ;
                sa:recipient ?recipient ;
                sa:totalAmount ?total ;
                sa:status ?status .
    OPTIONAL { ?commitment sa:releasedAmount ?released }
    OPTIONAL { ?commitment sa:milestonesJson ?milestonesJson }
  }
}`
  let results
  try {
    results = await discovery.getClient().query(sparql)
  } catch {
    return []
  }
  const rows: FulfillmentRow[] = []
  const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'
  for (const b of results.results?.bindings ?? []) {
    // Donor/recipient are emitted as `eth:0x...` IRIs (see graphdb-sync's
    // address case). Older sa:Pool sync also writes the
    // `https://smartagent.io/.../agent/` form, so accept either.
    const stripIri = (s: string): Address => {
      if (s.startsWith('eth:')) return s.slice(4) as Address
      if (s.startsWith(AGENT_IRI_PREFIX)) return s.slice(AGENT_IRI_PREFIX.length) as Address
      return s as Address
    }
    const stripCommitment = (s: string): Hex =>
      (s.startsWith('urn:smart-agent:commitment:')
        ? `0x${s.slice('urn:smart-agent:commitment:'.length)}`
        : s) as Hex
    const donor = stripIri(b.donor?.value ?? '')
    const recipient = stripIri(b.recipient?.value ?? '')
    let donorLabel: string | null = null
    let recipientLabel: string | null = null
    try {
      const { getAgentMetadata } = await import('@/lib/agent-metadata')
      donorLabel = (await getAgentMetadata(donor)).displayName ?? null
      recipientLabel = (await getAgentMetadata(recipient)).displayName ?? null
    } catch { /* fall back to short hex below */ }
    rows.push({
      commitmentSubject: stripCommitment(b.commitment?.value ?? ''),
      proposalSubject: (b.sourceSubject?.value ?? '0x') as Hex,
      donor,
      donorLabel,
      recipient,
      recipientLabel,
      totalAmount: b.total?.value ?? '0',
      releasedAmount: b.released?.value ?? '0',
      status: b.status?.value ?? 'unknown',
      milestonesJson: b.milestonesJson?.value ?? '[]',
    })
  }
  return rows
}

// ─── Internal ────────────────────────────────────────────────────────

async function readCommitmentBySubject(subject: Hex): Promise<CommitmentRow | null> {
  return readCommitment(subject)
}

/** Look up the viewer's signing EOA from the demo `localUserAccounts` table. */
async function loadViewerWallet(userId: string): Promise<Address | null> {
  try {
    const { db, schema } = await import('@/db')
    const { eq } = await import('drizzle-orm')
    const rows = await db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, userId)).limit(1)
    return (rows[0]?.walletAddress ?? null) as Address | null
  } catch {
    return null
  }
}

/**
 * Read the `validators` array out of a commitment's round.validatorRequirements
 * JSON. Tries to walk: commitment → round (sa:commitmentRound predicate) →
 * round.validatorRequirements (FundRegistry's `sa:roundValidatorRequirements`).
 * Returns lowercased addresses for case-insensitive membership checks.
 */
async function readRoundValidators(commitmentSubject: Hex): Promise<Address[]> {
  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  const fundRegistry = process.env.FUND_REGISTRY_ADDRESS as Address | undefined
  if (!registry || !fundRegistry) return []
  const pub = getPublicClient()
  try {
    const roundSubject = await pub.readContract({
      address: registry, abi: commitmentRegistryAbi,
      functionName: 'getBytes32',
      args: [commitmentSubject, keccak256(toBytes('sa:commitmentRound'))],
    }) as Hex
    if (!roundSubject || roundSubject === ('0x' + '0'.repeat(64))) return []
    const { fundRegistryAbi } = await import('@smart-agent/sdk')
    const json = await pub.readContract({
      address: fundRegistry, abi: fundRegistryAbi,
      functionName: 'getString',
      args: [roundSubject, keccak256(toBytes('sa:roundValidatorRequirements'))],
    }) as string
    const parsed = JSON.parse(json || '{}') as { validators?: string[] }
    return (parsed.validators ?? []).map((v) => v.toLowerCase() as Address)
  } catch {
    return []
  }
}

