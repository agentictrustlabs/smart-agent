'use server'

/**
 * Spec 006 — Commitment lifecycle actions.
 *
 * Phase 4 — Web→MCP rewiring.
 *
 *   - Reads (getCommitmentForProposal / readCommitment / getMilestoneRelease /
 *     listInboxTasks / listFulfillmentsForIntent) stay direct against the
 *     public client. They don't write state.
 *   - Writes (releaseTranche / recordOutcome / cancelCommitment) used to
 *     sign with the viewer's EOA directly. Those calls now route through
 *     org-mcp tools (`commitment:record_release`, `commitment:cancel`),
 *     which forward to a2a-agent's stateless-redeem path.
 *
 * NOTE on releaseTranche: the Rail-A executeBatch path (donor→signer
 * delegation pinned to (USDC.transfer + recordRelease)) is donor-EOA
 * signed and intentionally NOT routed through MCP — it's the user's own
 * wallet redeeming their own delegation. We keep that ceremony as-is
 * (delegation auth = donor's owner key on the user's session). What
 * changes: when the action layer needs to record a release WITHOUT the
 * USDC leg (split path), the `commitment:record_release` MCP tool is
 * used instead. The donor-EOA Rail-A redeem is left in place because
 * it's the user's own ceremony, not a deployer-key write.
 */

import { type Address, type Hex, keccak256, toBytes, toHex } from 'viem'
import {
  commitmentRegistryAbi,
} from '@smart-agent/sdk'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getPublicClient } from '@/lib/contracts'
import { callMcp } from '@/lib/clients/mcp-client'

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
  signerEoa: Address | null
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
  tokenAmount: bigint
  commitmentScaleAmount: bigint
}

export interface ReleaseTrancheResult {
  ok: boolean
  txHash?: Hex
  error?: string
}

/**
 * Spec-006 Rail-A: donor.executeBatch([USDC.transfer, recordRelease]).
 *
 * This is the user's own ceremony — the donor pool's owner-EOA signs a
 * calldata-pinned single-hop delegation against the pool's AgentAccount
 * and redeems through DelegationManager directly. Mirrors `pledgeHonor`
 * (spec-005 Rail A): the only difference is the executeBatch payload
 * (USDC.transfer + CommitmentRegistry.recordRelease) and the delegator
 * (donor pool's AgentAccount).
 *
 * Atomicity: if USDC.transfer reverts (donor short on balance), the
 * entire batch reverts; no recordRelease fires.
 *
 * NO fallback: if the caller's EOA isn't an owner of the donor pool
 * (ERC-1271 fail), we throw a precise error rather than masking it.
 */
export async function releaseTranche(input: ReleaseTrancheInput): Promise<ReleaseTrancheResult> {
  const me = await getCurrentUser()
  if (!me) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }

  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  if (!registry) return { ok: false, error: 'COMMITMENT_REGISTRY_ADDRESS not set' }

  const commitment = await readCommitment(input.commitmentSubject)
  if (!commitment) return { ok: false, error: 'commitment-not-found' }
  if (commitment.status !== 'pending' && commitment.status !== 'in-flight') {
    return { ok: false, error: `commitment is ${commitment.status} — release is not available` }
  }
  if (
    !commitment.recipient
    || commitment.recipient === '0x0000000000000000000000000000000000000000'
  ) {
    return {
      ok: false,
      error:
        `commitment recipient is zero — release would burn funds. ` +
        `Re-finalize the round after the recipient-resolution fix landed.`,
    }
  }

  // Donor-side auth: viewer must be able to manage the donor's AgentAccount.
  let canMng = false
  try { canMng = await canManageAgent(myAgent, commitment.donor) } catch { canMng = false }
  if (!canMng) return { ok: false, error: 'not-donor-owner' }

  // Validator-attested-outcome gate (same as before — checked off-chain
  // ahead of the on-chain redeem).
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

  // ─── Rail A: mint donor → user-EOA delegation, redeem executeBatch. ───
  const usdc = (process.env.MOCK_USDC_ADDRESS ?? process.env.USDC_ADDRESS) as Address | undefined
  const delegationManager = process.env.DELEGATION_MANAGER_ADDRESS as Address | undefined
  const enforcers = {
    allowedTargets: process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address,
    allowedMethods: process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address,
    callDataHash:   process.env.CALLDATA_HASH_ENFORCER_ADDRESS as Address,
    timestamp:      process.env.TIMESTAMP_ENFORCER_ADDRESS as Address,
    value:          process.env.VALUE_ENFORCER_ADDRESS as Address,
  }
  if (!usdc || !delegationManager
      || !enforcers.allowedTargets || !enforcers.allowedMethods
      || !enforcers.callDataHash || !enforcers.timestamp || !enforcers.value) {
    return {
      ok: false,
      error: 'release env incomplete (MOCK_USDC_ADDRESS / DELEGATION_MANAGER_ADDRESS / enforcers)',
    }
  }

  // Resolve the user's EOA + key. Same pattern as pledgeHonor.action.ts —
  // demo users sign with their own private key; passkey/SIWE users hit
  // the deployer-fallback inside loadSignerForCurrentUser (v1 placeholder).
  const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
  let signerCtx: Awaited<ReturnType<typeof loadSignerForCurrentUser>> | null = null
  try { signerCtx = await loadSignerForCurrentUser() } catch { /* */ }
  if (signerCtx?.kind !== 'eoa' || !signerCtx.userRow.privateKey) {
    return { ok: false, error: 'cannot self-sign release delegation — no EOA key available' }
  }
  const signerKey = signerCtx.userRow.privateKey as Hex

  const {
    encodeReleaseBatch,
    releaseBatchHash,
    buildReleaseDelegationCaveats,
    ROOT_AUTHORITY,
    hashDelegation,
    delegationManagerAbi,
  } = await import('@smart-agent/sdk')

  const milestoneIdHash = /^0x[0-9a-fA-F]{64}$/.test(input.milestoneId)
    ? (input.milestoneId as Hex)
    : keccak256(toBytes(input.milestoneId))

  const releaseInput = {
    donor: commitment.donor,
    recipient: commitment.recipient,
    token: usdc,
    commitmentRegistry: registry,
    commitmentSubject: input.commitmentSubject,
    milestoneId: milestoneIdHash,
    tokenAmount: input.tokenAmount,
    commitmentScaleAmount: input.commitmentScaleAmount,
  }
  const callData = encodeReleaseBatch(releaseInput)
  const calldataHash = releaseBatchHash(releaseInput)

  const { privateKeyToAccount } = await import('viem/accounts')
  const signer = privateKeyToAccount(signerKey)
  const caveats = buildReleaseDelegationCaveats({
    donor: commitment.donor,
    calldataHash,
    enforcers,
  })
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
  const salt = BigInt('0x' + crypto.randomUUID().replace(/-/g, ''))
  const dHash = hashDelegation(
    {
      delegator: commitment.donor,
      delegate: signer.address,
      authority: ROOT_AUTHORITY as Hex,
      caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt,
    },
    chainId,
    delegationManager,
  )
  const signature = await signer.sign({ hash: dHash })

  const { createWalletClient, http: httpTransport } = await import('viem')
  const { foundry, sepolia } = await import('viem/chains')
  const chain = chainId === 11155111 ? sepolia : foundry
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
  outcomeId: string
  evidenceHash: Hex
}

/**
 * Validator outcome attestation. Off-chain validator-eligibility check
 * (the round's `sa:roundValidatorRequirements` must list the caller's
 * EOA, OR the caller must own the donor pool as a fallback for v1).
 * Then routes through the `commitment:record_outcome` MCP tool, which
 * redeems via a2a-agent's stateless-redeem path. The contract is
 * permissionless — the validator check is fully off-chain here.
 *
 * Viewer EOA = the caller's smart-account address. We compare against
 * both the EOA-owner of the smart account and the smart-account
 * address itself, since some seeds register validators by either form.
 */
export async function recordOutcome(input: RecordOutcomeInput): Promise<{ ok: boolean; txHash?: Hex; error?: string }> {
  const me = await getCurrentUser()
  if (!me) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }
  if (input.evidenceHash === ('0x' + '0'.repeat(64))) {
    return { ok: false, error: 'evidence-hash-required' }
  }
  const commitment = await readCommitment(input.commitmentSubject)
  if (!commitment) return { ok: false, error: 'commitment-not-found' }

  // Validator gate. Accept either:
  //   - the caller's EOA is listed in round.validatorRequirements.validators
  //   - the caller's person agent / smart account is so listed
  //   - the caller owns the donor pool (steward fallback)
  const validatorAddresses = await readRoundValidators(commitment.commitmentSubject)
  const callerKey = me.walletAddress?.toLowerCase()
  const callerAgent = myAgent.toLowerCase()
  const isListedValidator = validatorAddresses.some((v) => {
    const vl = v.toLowerCase()
    return vl === callerAgent || (callerKey ? vl === callerKey : false)
  })
  let isSteward = false
  try { isSteward = await canManageAgent(myAgent, commitment.donor) } catch { isSteward = false }
  if (!isListedValidator && !isSteward) {
    return {
      ok: false,
      error: 'not-a-validator (caller must be listed in round.validators or own the donor pool)',
    }
  }

  try {
    // Route through the caller's person agent (not commitment.donor) — the
    // donor is the pool, which has no primary name and therefore no
    // resolvable A2A endpoint. The redeem inside org-mcp still uses the
    // donor's delegation; the agentAddress here only routes the A2A call.
    const res = await callMcp<{ ok: true; txHash: Hex }>(
      'org',
      'commitment:record_outcome',
      {
        commitmentSubject: input.commitmentSubject,
        outcomeId: input.outcomeId,
        evidenceHash: input.evidenceHash,
      },
      { agentAddress: myAgent },
    )
    return { ok: true, txHash: res.txHash }
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

  const commitment = await readCommitment(commitmentSubject)
  if (!commitment) return { ok: false, error: 'commitment-not-found' }
  let canMng = false
  try { canMng = await canManageAgent(myAgent, commitment.donor) } catch { canMng = false }
  if (!canMng) return { ok: false, error: 'not-donor-owner' }

  try {
    // Route through caller (not pool donor) — see recordOutcome rationale.
    const res = await callMcp<{ ok: true; txHash: Hex }>(
      'org',
      'commitment:cancel',
      { commitmentSubject, reason },
      { agentAddress: myAgent },
    )
    return { ok: true, txHash: res.txHash }
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

export async function listInboxTasks(
  viewerEoa: Address,
  scopedCommitmentSubject?: `0x${string}`,
): Promise<InboxTask[]> {
  const { hubRawSparql } = await import('@/lib/clients/hub-client')
  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  if (!registry) return []

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
  try { results = await hubRawSparql(sparql) } catch { return [] }

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

    let canSteward = false
    try { canSteward = await canManageAgent(myAgent, donor) } catch { /* */ }
    const validators = await getRoundValidators(roundSubject)
    const isValidator = validators.includes(viewerEoa.toLowerCase() as Address)
      || validators.includes(myAgent.toLowerCase() as Address)

    if (!canSteward && !isValidator) continue

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

export async function listFulfillmentsForIntent(intentUrn: string): Promise<FulfillmentRow[]> {
  const { hubRawSparql } = await import('@/lib/clients/hub-client')
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
    results = await hubRawSparql(sparql)
  } catch {
    return []
  }
  const rows: FulfillmentRow[] = []
  const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'
  for (const b of results.results?.bindings ?? []) {
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
