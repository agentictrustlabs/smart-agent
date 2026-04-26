'use server'

/**
 * Trust-overlap search — thin client over ssi-wallet-mcp.
 *
 * The MCP route `/wallet/match-against-public-set` is the canonical scorer:
 *   - It owns the caller's heldSet (on-chain HAS_MEMBER edges + AnonCreds-held
 *     org credentials in the holder wallet).
 *   - It produces evidenceCommit and persists score-only audit rows in
 *     ssi_proof_audit. No secrets ever leave the wallet process.
 *   - It refuses requests without a signed `MatchAgainstPublicSet` envelope
 *     committing to the candidate set via proofRequestHash.
 *
 * This file does only what the web layer is privileged to do:
 *   1. Enumerate person agents in the on-chain registry.
 *   2. For each candidate, fetch its PUBLIC org set (HAS_MEMBER edges where
 *      the candidate is the object) — public information.
 *   3. Build the MatchAgainstPublicSet body, hash it with the locked-in
 *      canonical encoding, and ask person-mcp for an unsigned WalletAction.
 *   4. Hand `{action, hash, signer, body, agentMeta}` back to the client for
 *      signing.
 *   5. After signing, forward to person-mcp's ssi_match_against_public_set
 *      tool and merge per-id scores back with agentMeta for display.
 *
 * Score-only output: `Bob is never contacted, the candidate is unaware of
 * being scored`. The web app cannot peek inside the heldSet.
 */

import { getAddress } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient, getEdgesByObject, getEdge } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  TYPE_PERSON,
  TYPE_ORGANIZATION,
  HAS_MEMBER,
  ATL_PRIMARY_NAME,
} from '@smart-agent/sdk'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import {
  hashMatchBody,
  TRUST_POLICY_ID,
  type WalletAction,
  type MatchAgainstPublicSetBody,
} from '@smart-agent/privacy-creds'
import { person } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'

const HAS_MEMBER_HEX = (HAS_MEMBER as string).toLowerCase()
const WALLET_CONTEXT = 'default'
const SEARCH_LIMIT = 200

export interface AgentMeta {
  /** Lower-case 0x-address used as the candidate id. */
  id: `0x${string}`
  /** Original checksum-cased address for display. */
  address: `0x${string}`
  displayName: string
  primaryName: string | null
}

export interface TrustSearchHit {
  address: `0x${string}`
  displayName: string
  primaryName: string | null
  score: number
  sharedCount: number
  evidenceCommit: `0x${string}`
}

export interface TrustSearchPrepared {
  /** Lifecycle: 'no-wallet' means provision first; 'ready' means sign and submit. */
  status: 'ready' | 'no-wallet' | 'no-resolver' | 'no-candidates'
  /** Human-readable reason when status !== 'ready'. */
  message?: string
  /** Holder wallet id (when status === 'ready'). */
  holderWalletId?: string
  /** Address that ERC-1271 will resolve to. */
  signerAddress?: `0x${string}`
  signerKind?: 'eoa' | 'siwe' | 'passkey'
  /** Smart account address (passkey/SIWE flows only — null for legacy EOA). */
  smartAccountAddress?: `0x${string}` | null
  walletAddress?: `0x${string}` | null
  chainId?: number
  verifyingContract?: `0x${string}`
  /** Unsigned action with bigint serialised as decimal string. */
  action?: WalletAction & { expiresAt: string }
  /** EIP-712 digest the wallet must sign. */
  hash?: `0x${string}`
  /** Body whose keccak is bound into action.proofRequestHash. */
  body?: MatchAgainstPublicSetBody
  /** Agent metadata keyed by candidate id (lower-case address). */
  agentMeta?: Record<string, AgentMeta>
}

// ─── Public API ─────────────────────────────────────────────────────

/** Step 1: build the candidate list and the unsigned WalletAction envelope. */
export async function prepareTrustSearch(opts: { query?: string; limit?: number } = {}): Promise<TrustSearchPrepared> {
  const me = await getCurrentUser()
  if (!me) return { status: 'no-resolver', message: 'Not signed in' }

  const principal = `person_${me.id}`

  const holderWalletId = await fetchHolderWalletId(principal)
  if (!holderWalletId) {
    return {
      status: 'no-wallet',
      message: 'Provision a holder wallet (via Anonymous registration) before running trust search.',
    }
  }

  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr) return { status: 'no-resolver', message: 'AGENT_ACCOUNT_RESOLVER_ADDRESS not set' }

  const myPersonAgent = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
  if (!myPersonAgent) {
    return {
      status: 'no-resolver',
      message: 'Your on-chain person agent is not set yet — finish onboarding before running trust search.',
    }
  }

  const candidates = await collectCandidates({
    resolverAddr,
    excludeAddr: myPersonAgent,
    query: opts.query?.trim().toLowerCase() ?? '',
    limit: opts.limit ?? SEARCH_LIMIT,
  })

  if (candidates.length === 0) {
    return { status: 'no-candidates', message: 'No person agents found in the registry.', holderWalletId }
  }

  const body: MatchAgainstPublicSetBody = {
    policyId: TRUST_POLICY_ID,
    blockPin: '0',
    callerAddress: myPersonAgent.toLowerCase(),
    candidates: candidates.map(c => ({ id: c.meta.id, publicSet: c.publicSet })),
  }
  const proofRequestHash = hashMatchBody(body)

  const built = await person.callTool<{
    action: WalletAction & { expiresAt: string }
    domain: { chainId: number; verifyingContract: `0x${string}` }
    error?: string
  }>('ssi_create_wallet_action', {
    principal,
    walletContext: WALLET_CONTEXT,
    type: 'MatchAgainstPublicSet',
    counterpartyId: 'discovery:trust-overlap',
    purpose: `match against ${candidates.length} candidates`,
    credentialType: 'TrustOverlap',
    holderWalletId,
    proofRequestHash,
  })
  if (built.error || !built.action) {
    return { status: 'no-resolver', message: built.error ?? 'failed to build action' }
  }

  const signer = await getSignerContext()
  const hash = await hashWalletAction(built.action, signer)

  const agentMeta: Record<string, AgentMeta> = {}
  for (const c of candidates) agentMeta[c.meta.id] = c.meta

  return {
    status: 'ready',
    holderWalletId,
    signerAddress: signer.signerAddress,
    signerKind: signer.kind,
    smartAccountAddress: signer.smartAccountAddress,
    walletAddress: signer.walletAddress,
    chainId: ssiConfig.chainId,
    verifyingContract: ssiConfig.verifierContract,
    action: built.action,
    hash,
    body,
    agentMeta,
  }
}

/** Step 2: forward signed envelope to person-mcp; merge scores with agentMeta. */
export async function completeTrustSearch(input: {
  action: WalletAction & { expiresAt: string }
  signature: `0x${string}`
  body: MatchAgainstPublicSetBody
  agentMeta: Record<string, AgentMeta>
}): Promise<{ hits: TrustSearchHit[]; error?: string }> {
  try {
    const signer = await getSignerContext()
    const res = await person.callTool<{
      hits?: Array<{ id: string; score: number; sharedCount: number; evidenceCommit: `0x${string}` }>
      error?: string
    }>('ssi_match_against_public_set', {
      action: input.action,
      signature: input.signature,
      expectedSigner: signer.signerAddress,
      body: input.body,
    })
    if (res.error || !res.hits) return { hits: [], error: res.error ?? 'match failed' }

    const hits: TrustSearchHit[] = res.hits.map(h => {
      const meta = input.agentMeta[h.id.toLowerCase()]
      const address = meta?.address ?? (getAddress(h.id) as `0x${string}`)
      const fallbackName = `${address.slice(0, 6)}…${address.slice(-4)}`
      return {
        address,
        displayName: meta?.displayName || fallbackName,
        primaryName: meta?.primaryName ?? null,
        score: h.score,
        sharedCount: h.sharedCount,
        evidenceCommit: h.evidenceCommit,
      }
    })
    hits.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
    return { hits }
  } catch (err) {
    return { hits: [], error: (err as Error).message }
  }
}

// ─── Internals ──────────────────────────────────────────────────────

interface SignerContext {
  kind: 'eoa' | 'siwe' | 'passkey'
  signerAddress: `0x${string}`
  smartAccountAddress: `0x${string}` | null
  walletAddress: `0x${string}` | null
}

async function getSignerContext(): Promise<SignerContext> {
  const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
  const { requireSession } = await import('@/lib/auth/session')
  const session = await requireSession()
  const ctx = await loadSignerForCurrentUser()

  if (ctx.kind === 'eoa') {
    return {
      kind: 'eoa',
      signerAddress: ctx.userRow.walletAddress as `0x${string}`,
      smartAccountAddress: null,
      walletAddress: ctx.userRow.walletAddress as `0x${string}`,
    }
  }
  if (session.via === 'siwe') {
    return {
      kind: 'siwe',
      signerAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
      smartAccountAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
      walletAddress: session.walletAddress as `0x${string}`,
    }
  }
  return {
    kind: 'passkey',
    signerAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
    smartAccountAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
    walletAddress: null,
  }
}

async function hashWalletAction(
  action: WalletAction & { expiresAt: string },
  _signer: SignerContext,
): Promise<`0x${string}`> {
  const { walletActionDomain, WalletActionTypes } = await import('@smart-agent/privacy-creds')
  const { hashTypedData } = await import('viem')
  return hashTypedData({
    domain: walletActionDomain(ssiConfig.chainId, ssiConfig.verifierContract),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: { ...action, expiresAt: BigInt(action.expiresAt) },
  })
}

async function fetchHolderWalletId(principal: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${ssiConfig.walletUrl}/wallet/${encodeURIComponent(principal)}/${encodeURIComponent(WALLET_CONTEXT)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const j = (await res.json()) as { holderWalletId?: string }
    return j.holderWalletId ?? null
  } catch { return null }
}

interface Candidate {
  meta: AgentMeta
  publicSet: string[]
}

async function collectCandidates(args: {
  resolverAddr: `0x${string}`
  excludeAddr: `0x${string}` | null
  query: string
  limit: number
}): Promise<Candidate[]> {
  const client = getPublicClient()
  let count = 0n
  try {
    count = await client.readContract({
      address: args.resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount',
    }) as bigint
  } catch { return [] }

  const out: Candidate[] = []
  const excludeLower = args.excludeAddr?.toLowerCase()

  for (let i = 0n; i < count; i++) {
    let agentAddr: `0x${string}`
    try {
      agentAddr = await client.readContract({
        address: args.resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getAgentAt', args: [i],
      }) as `0x${string}`
    } catch { continue }

    if (excludeLower && agentAddr.toLowerCase() === excludeLower) continue

    let core: { agentType: `0x${string}`; displayName: string; description: string; active: boolean }
    try {
      core = await client.readContract({
        address: args.resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getCore', args: [agentAddr],
      }) as typeof core
    } catch { continue }
    if (!core.active) continue
    // Discover person + organization agents. Hubs and AI agents aren't
    // meaningful trust-overlap candidates: hubs sit above the membership
    // graph (they're the namespace, not a peer) and AI agents don't have
    // their own org memberships in this model.
    if (core.agentType !== TYPE_PERSON && core.agentType !== TYPE_ORGANIZATION) continue

    let primaryName = ''
    try {
      primaryName = await client.readContract({
        address: args.resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [agentAddr, ATL_PRIMARY_NAME as `0x${string}`],
      }) as string
    } catch { /* */ }

    if (args.query) {
      const haystack = `${core.displayName} ${primaryName} ${agentAddr}`.toLowerCase()
      if (!haystack.includes(args.query)) continue
    }

    const publicSet = await getPublicOrgsForAgent(args.resolverAddr, agentAddr)
    out.push({
      meta: {
        id: agentAddr.toLowerCase() as `0x${string}`,
        address: agentAddr,
        displayName: core.displayName || `${agentAddr.slice(0, 6)}…${agentAddr.slice(-4)}`,
        primaryName: primaryName || null,
      },
      publicSet,
    })

    if (out.length >= args.limit) break
  }
  return out
}

async function getPublicOrgsForAgent(
  resolverAddr: `0x${string}`,
  agentAddr: `0x${string}`,
): Promise<string[]> {
  const client = getPublicClient()
  const out: string[] = []
  try {
    const edgeIds = await getEdgesByObject(agentAddr)
    for (const id of edgeIds) {
      try {
        const edge = await getEdge(id)
        if (edge.status < 2) continue
        if ((edge.relationshipType ?? '').toLowerCase() !== HAS_MEMBER_HEX) continue
        const core = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getCore', args: [edge.subject as `0x${string}`],
        }) as { agentType: `0x${string}`; active: boolean }
        if (core.agentType === TYPE_ORGANIZATION && core.active) {
          out.push(edge.subject.toLowerCase())
        }
      } catch { /* skip */ }
    }
  } catch { /* */ }
  return out
}
