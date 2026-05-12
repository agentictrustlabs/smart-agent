'use server'

/**
 * Spec 004 — Add a voter to a round.
 *
 * Server action that lets the round's fund operator grant another agent
 * a RoundVoterCredential + admin→holder delegation for VoteRegistry.castVote
 * scoped to that round. The voter can then cast a ballot from their own
 * session — the AnonCreds presentation + chain redemption succeed because:
 *
 *   1. Their person-mcp now holds a `RoundVoterCredential` bound to the
 *      round (roundSubject + nullifierSecret).
 *   2. The cred row carries an admin→holder delegation signed by the round
 *      operator (deployer-fallback in v1) for VoteRegistry.castVote.
 *
 * Gate: caller must be `canManageAgent(round.fundAgent)` — same check the
 * round-admin UI uses for config edits.
 */

import { getAddress, type Address } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { createPublicClient, http, keccak256, toHex } from 'viem'
import { foundry } from 'viem/chains'
import { fundRegistryAbi } from '@smart-agent/sdk'

export interface AddRoundVoterInput {
  /** Round URN, slug, or bytes32 subject. */
  roundId: string
  /** Voter's smart-account address (the agent who will vote). */
  voterSmartAccount: string
}

export type AddRoundVoterResult =
  | { ok: true; credentialId: string; roundSubject: `0x${string}` }
  | { ok: false; error: string }

function roundSubjectFor(roundId: string): `0x${string}` {
  if (/^0x[0-9a-fA-F]{64}$/.test(roundId)) return roundId as `0x${string}`
  const slug = roundId.startsWith('urn:smart-agent:round:')
    ? roundId.slice('urn:smart-agent:round:'.length)
    : roundId
  // Matches FundRegistry.roundSubject(slug) = keccak256("sa:round:" + slug)
  // (abi.encodePacked of two strings = direct UTF-8 concatenation).
  return keccak256(new TextEncoder().encode(`sa:round:${slug}`)) as `0x${string}`
}

export async function addRoundVoter(input: AddRoundVoterInput): Promise<AddRoundVoterResult> {
  const me = await getCurrentUser()
  if (!me) return { ok: false, error: 'not-authenticated' }
  const myAgent = await getPersonAgentForUser(me.id)
  if (!myAgent) return { ok: false, error: 'no-person-agent' }

  // Accept any 40-hex address regardless of EIP-55 checksum casing
  // (paste-from-anywhere friendly); `getAddress` will re-checksum.
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.voterSmartAccount.trim())) {
    return { ok: false, error: `voterSmartAccount must be 0x + 40 hex chars: ${input.voterSmartAccount}` }
  }
  const voter = getAddress(input.voterSmartAccount.trim() as `0x${string}`)
  const adminAccount = getAddress(myAgent as `0x${string}`)
  const roundSubject = roundSubjectFor(input.roundId)

  // Resolve the round's fund agent + gate the caller.
  const fundRegistry = process.env.FUND_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!fundRegistry) return { ok: false, error: 'FUND_REGISTRY_ADDRESS not set' }
  let fundAgent: Address
  try {
    const client = createPublicClient({
      chain: foundry,
      transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
    })
    fundAgent = (await client.readContract({
      address: fundRegistry,
      abi: fundRegistryAbi,
      functionName: 'getRoundFundAgent',
      args: [roundSubject],
    })) as Address
    if (!fundAgent || fundAgent === '0x0000000000000000000000000000000000000000') {
      return { ok: false, error: 'round not bound to a fund on chain' }
    }
  } catch (e) {
    return { ok: false, error: `fund lookup failed: ${(e as Error).message}` }
  }

  let canManage = false
  try { canManage = await canManageAgent(myAgent, fundAgent) } catch { canManage = false }
  if (!canManage) {
    return { ok: false, error: 'only the round operator can add voters' }
  }

  // Ensure the voter has an on-chain AgentAccount (smoke test).
  try {
    const client = createPublicClient({
      chain: foundry,
      transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
    })
    const code = await client.getCode({ address: voter })
    if (!code || code === '0x') {
      return { ok: false, error: `voter ${voter} has no deployed AgentAccount` }
    }
  } catch {
    /* if we can't reach the chain, the issuance call below will surface a clearer error */
  }

  // Admin signs the admin→holder delegation with their OWN key (P1 rule:
  // no deployer cheating). Demo admins use users.privateKey; passkey/SIWE
  // admins use the loadSignerForCurrentUser placeholder.
  const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
  let adminSignerCtx: Awaited<ReturnType<typeof loadSignerForCurrentUser>> | null = null
  try { adminSignerCtx = await loadSignerForCurrentUser() } catch { /* fall through */ }
  if (adminSignerCtx?.kind !== 'eoa' || !adminSignerCtx.userRow.privateKey) {
    return { ok: false, error: 'admin has no EOA signing key (passkey ceremony not wired)' }
  }
  const adminSigningKey = adminSignerCtx.userRow.privateKey as `0x${string}`

  // Resolve the voter's person-mcp principal + holder signing key. Demo +
  // google users have a `users` row whose .id is the principal suffix
  // (`person_<users.id>`) and a stored privateKey; passkey/SIWE users have
  // no row, only their smart account. The cred MUST be issued under the
  // principal the voter's *active session* will resolve to.
  let holderPrincipalOverride: string | undefined
  let holderSigningKey: `0x${string}` | undefined
  let holderWalletContextOverride: string | undefined
  try {
    const { db, schema } = await import('@/db')
    const { sql } = await import('drizzle-orm')
    const target = voter.toLowerCase()
    const row = await db.select().from(schema.localUserAccounts)
      .where(sql`LOWER(${schema.localUserAccounts.smartAccountAddress}) = ${target}`)
      .limit(1).then(r => r[0])
    if (row?.id) {
      holderPrincipalOverride = `person_${row.id}`
      if (row.privateKey) {
        holderSigningKey = row.privateKey as `0x${string}`
        holderWalletContextOverride = 'default'
      }
    }
  } catch { /* no users row */ }

  if (!holderSigningKey) {
    return {
      ok: false,
      error: 'voter has no stored EOA — issuance to passkey/SIWE voters needs a holder-side accept flow (not yet wired)',
    }
  }

  const { issueMarketplaceCredential } = await import('@/lib/spec004/self-issue')
  const result = await issueMarketplaceCredential({
    adminSmartAccount: adminAccount,
    adminSigningKey,
    holderSmartAccount: voter,
    holderSigningKey,
    credentialType: 'RoundVoterCredential',
    roundSubject,
    holderPrincipalOverride,
    holderWalletContextOverride,
  })
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true, credentialId: result.credentialId, roundSubject }
}
