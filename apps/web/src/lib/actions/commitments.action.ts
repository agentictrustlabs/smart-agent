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
  agentAccountAbi,
  mockUsdcAbi,
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

export function statusLabel(statusHash: string): string {
  return STATUS_LABEL[statusHash.toLowerCase()] ?? 'unknown'
}
export function sourceLabel(sourceHash: string): string {
  return SOURCE_LABEL[sourceHash.toLowerCase()] ?? 'unknown'
}

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
}

export async function getMilestoneRelease(
  commitmentSubject: Hex,
  milestoneId: Hex,
): Promise<MilestoneReleaseInfo | null> {
  const registry = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  if (!registry) return null
  const pub = getPublicClient()
  try {
    const [amount, releasedAt] = (await pub.readContract({
      address: registry,
      abi: commitmentRegistryAbi,
      functionName: 'getMilestoneRelease',
      args: [commitmentSubject, milestoneId],
    })) as readonly [bigint, bigint]
    if (releasedAt === 0n) return null
    return {
      milestoneId,
      amount: amount.toString(),
      releasedAt: Number(releasedAt),
    }
  } catch {
    return null
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

  // v1 — validator gate collapses into "any pool steward" via canManageAgent
  // on the commitment's donor. When the validator-set registry ships, this
  // becomes an AnonCreds ValidatorCredential presentation gate (off-chain).
  const commitment = await readCommitmentBySubject(input.commitmentSubject)
  if (!commitment) return { ok: false, error: 'commitment-not-found' }
  let canValidate = false
  try { canValidate = await canManageAgent(myAgent, commitment.donor) } catch { canValidate = false }
  if (!canValidate) return { ok: false, error: 'not-a-validator' }

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

// ─── Internal ────────────────────────────────────────────────────────

async function readCommitmentBySubject(subject: Hex): Promise<CommitmentRow | null> {
  return readCommitment(subject)
}

// Re-export the ERC-20 transfer abi reference so callers don't need to
// import @smart-agent/sdk's mockUsdcAbi directly when wiring forms.
export { mockUsdcAbi, agentAccountAbi }
