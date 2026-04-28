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
import { getPublicClient, getEdgesByObject, getEdgesBySubject, getEdge } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  geoClaimRegistryAbi,
  geoFeatureRegistryAbi,
  TYPE_PERSON,
  TYPE_ORGANIZATION,
  HAS_MEMBER,
  ORGANIZATION_MEMBERSHIP,
  ORGANIZATION_GOVERNANCE,
  ATL_PRIMARY_NAME,
  ATL_LATITUDE, ATL_LONGITUDE,
  GEO_VISIBILITY,
  GEO_COORD_SCALE,
} from '@smart-agent/sdk'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import {
  hashMatchBody,
  TRUST_POLICY_ID,
  type WalletAction,
  type MatchAgainstPublicSetBody,
} from '@smart-agent/privacy-creds'
import { geoOverlapScore, type CoarseGeoTag, type GeoClaimInput } from '@smart-agent/privacy-creds/geo-overlap'
import { person } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'

/**
 * Relationship-type hashes that link an agent to an Organization for the
 * purpose of trust-overlap scoring. We accept all three because they all
 * represent affiliation with that org from the holder's POV:
 *
 *   • HAS_MEMBER             — explicit "this org has this member" join
 *                              (typical direction: org → person)
 *   • ORGANIZATION_MEMBERSHIP — explicit member relationship
 *                              (typical direction: person → org)
 *   • ORGANIZATION_GOVERNANCE — board / owner / executive
 *                              (typical direction: person → org;
 *                              owners are clearly affiliated)
 *
 * We accept either edge direction (subject ↔ object) so seeds and signups
 * that pick different directions still produce overlap.
 */
const ORG_AFFILIATION_HEXES = new Set([
  (HAS_MEMBER as string).toLowerCase(),
  (ORGANIZATION_MEMBERSHIP as string).toLowerCase(),
  (ORGANIZATION_GOVERNANCE as string).toLowerCase(),
])
const WALLET_CONTEXT = 'default'
const SEARCH_LIMIT = 200

export interface AgentMeta {
  /** Lower-case 0x-address used as the candidate id. */
  id: `0x${string}`
  /** Original checksum-cased address for display. */
  address: `0x${string}`
  displayName: string
  primaryName: string | null
  /** Coarse geo tag — null if untagged. Stays in metadata (not signed over)
   *  because it's read from a public on-chain property. */
  geoTag: CoarseGeoTag | null
  /** Public geo claims whose feature contains the caller's lat/long.
   *  Stage-B input for geoOverlapScore — populated only when both
   *  caller lat/lon and matching public claims exist. */
  geoMatchedClaims?: GeoClaimInput[]
}

export interface TrustSearchHit {
  address: `0x${string}`
  displayName: string
  primaryName: string | null
  /** Combined org-overlap + geo-overlap score. */
  score: number
  /** Org-overlap component (smart-agent.trust-overlap.v1). */
  orgScore: number
  /** Geo-overlap component (smart-agent.geo-overlap.v1). */
  geoScore: number
  /** Number of org memberships shared with the caller. */
  sharedCount: number
  /** Candidate's coarse geo tag (city/region/country) — null if untagged. */
  geoTag: CoarseGeoTag | null
  /** Per-row geo trust explanation: which relations contributed and at
   *  what score. Empty when no public claims matched. */
  geoExplanation: Array<{ relation: string; contribution: number }>
  evidenceCommit: `0x${string}`
}

export interface TrustSearchPrepared {
  /** Lifecycle: 'no-wallet' means provision first; 'ready' means sign and submit. */
  status: 'ready' | 'no-wallet' | 'no-resolver' | 'no-candidates'
  /** Caller's coarse geo tag — combined client-side with agentMeta tags
   *  to add the geo-overlap.v1 score on top of org-overlap. */
  callerGeo?: CoarseGeoTag | null
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

  const callerGeo = await readCoarseGeoTag(resolverAddr, myPersonAgent)
  const callerLatLon = await readLatLon(resolverAddr, myPersonAgent)

  // Stage-B: per candidate, public claims whose feature contains the
  // caller's lat/long. Skipped if the caller has no lat/long set.
  if (callerLatLon) {
    for (const c of candidates) {
      const matched = await matchedGeoClaimsForCandidate({
        candidate: c.meta.address,
        callerLatLon,
      })
      if (matched.length > 0) c.meta.geoMatchedClaims = matched
    }
  }

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
    callerGeo,
  }
}

/** Step 2: forward signed envelope to person-mcp; merge scores with agentMeta + geo overlay. */
export async function completeTrustSearch(input: {
  action: WalletAction & { expiresAt: string }
  signature: `0x${string}`
  body: MatchAgainstPublicSetBody
  agentMeta: Record<string, AgentMeta>
  callerGeo?: CoarseGeoTag | null
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

    const callerGeo = input.callerGeo ?? null

    const hits: TrustSearchHit[] = res.hits.map(h => {
      const meta = input.agentMeta[h.id.toLowerCase()]
      const address = meta?.address ?? (getAddress(h.id) as `0x${string}`)
      const fallbackName = `${address.slice(0, 6)}…${address.slice(-4)}`

      // Org-overlap score from the MCP. Geo-overlap layered on top
      // here (stage A coarse-tier + stage B public claims; private-zk
      // contributions arrive via the Phase 6 ZK match path).
      const orgScore = h.score
      let geoScore = 0
      const geoExplanation: Array<{ relation: string; contribution: number }> = []
      if (callerGeo && meta?.geoTag) {
        const geo = geoOverlapScore({
          caller: callerGeo,
          candidate: meta.geoTag,
          matchedClaims: meta.geoMatchedClaims,
        })
        geoScore = geo.score
        // Coarse-tier explanation
        if (geo.coarseScore > 0) {
          geoExplanation.push({ relation: 'coarse:city/region/country', contribution: geo.coarseScore })
        }
        // Per-claim explanation (relation hash → label is already stored)
        for (const c of meta.geoMatchedClaims ?? []) {
          // approximate per-claim contribution: same formula as the scorer
          // but used for explanation, not for re-scoring.
          const rough = roughClaimContribution(c)
          if (rough > 0) geoExplanation.push({ relation: c.relation, contribution: rough })
        }
      }
      return {
        address,
        displayName: meta?.displayName || fallbackName,
        primaryName: meta?.primaryName ?? null,
        score: orgScore + geoScore,
        orgScore,
        geoScore,
        sharedCount: h.sharedCount,
        geoTag: meta?.geoTag ?? null,
        geoExplanation,
        evidenceCommit: h.evidenceCommit,
      }
    })
    hits.sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName))
    return { hits }
  } catch (err) {
    return { hits: [], error: (err as Error).message }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Rough per-claim contribution estimate, mirroring scoreSingleClaim
 * for the geo-trust-explanation UI. Not used in actual scoring (the
 * canonical score comes from geoOverlapScore on the same inputs); this
 * function exists only to attribute slices of the geo score to the
 * relations that earned them.
 */
function roughClaimContribution(c: GeoClaimInput): number {
  const baseWeights: Record<string, number> = {
    'geo:residentOf': 1.5, 'geo:operatesIn': 1.0, 'geo:servesWithin': 1.2,
    'geo:licensedIn': 1.0, 'geo:completedTaskIn': 0.8,
    'geo:validatedPresenceIn': 1.0, 'geo:stewardOf': 0.7, 'geo:originIn': 0.6,
  }
  const w = baseWeights[c.relation] ?? 0
  if (w === 0 || c.disputed) return 0
  const conf = Math.max(0, Math.min(1, c.confidence / 100))
  const issuer = Math.max(0, Math.min(1, c.issuerTrust ?? 0.5))
  const visMap: Record<string, number> = { Public: 1, PublicCoarse: 0.8, PrivateZk: 0.9, OffchainOnly: 0.5, PrivateCommitment: 0 }
  const vis = visMap[c.visibility ?? 'Public']
  return Number((w * conf * issuer * vis).toFixed(3))
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
    const geoTag = await readCoarseGeoTag(args.resolverAddr, agentAddr)
    out.push({
      meta: {
        id: agentAddr.toLowerCase() as `0x${string}`,
        address: agentAddr,
        displayName: core.displayName || `${agentAddr.slice(0, 6)}…${agentAddr.slice(-4)}`,
        primaryName: primaryName || null,
        geoTag,
      },
      publicSet,
    })

    if (out.length >= args.limit) break
  }
  return out
}

/**
 * Coarse geo tag for an agent — derived purely from on-chain claims in
 * `GeoClaimRegistry`. Walks `claimsBySubject(agent)`, picks the strongest
 * **non-revoked Public** residency-style claim (preferring `residentOf`
 * over `operatesIn`/`stewardOf`/`originIn`), and parses the linked
 * feature's `metadataURI` for `country/region/city` slugs.
 *
 * The legacy `atl:city / atl:region / atl:country` resolver properties
 * are **not** consulted any more — coarse-tier overlap is fully claim-
 * driven so the public on-chain `GeoClaim` is the single source of truth.
 *
 * Returns null if the agent has no qualifying claim.
 */
async function readCoarseGeoTag(
  _resolverAddr: `0x${string}`,
  agentAddr: `0x${string}`,
): Promise<CoarseGeoTag | null> {
  const claimReg = process.env.GEO_CLAIM_REGISTRY_ADDRESS as `0x${string}` | undefined
  const featReg  = process.env.GEO_FEATURE_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!claimReg || !featReg) return null
  const client = getPublicClient()

  let claimIds: `0x${string}`[]
  try {
    claimIds = (await client.readContract({
      address: claimReg, abi: geoClaimRegistryAbi,
      functionName: 'claimsBySubject', args: [agentAddr],
    })) as `0x${string}`[]
  } catch { return null }
  if (claimIds.length === 0) return null

  await ensureRelationLookup()

  // Preference order — `residentOf` is the strongest "this is where the
  // agent is anchored" signal; orgs typically use `operatesIn`. The first
  // non-revoked Public claim of the highest-priority kind wins.
  const PRIORITY: Record<string, number> = {
    'geo:residentOf':   100,
    'geo:operatesIn':    80,
    'geo:stewardOf':     60,
    'geo:originIn':      40,
  }

  let best: { priority: number; featureId: `0x${string}`; featureVersion: bigint } | null = null
  for (const cid of claimIds) {
    try {
      const claim = (await client.readContract({
        address: claimReg, abi: geoClaimRegistryAbi,
        functionName: 'getClaim', args: [cid],
      })) as {
        relation: `0x${string}`; visibility: number; revoked: boolean
        featureId: `0x${string}`; featureVersion: bigint
      }
      if (claim.revoked) continue
      if (claim.visibility !== GEO_VISIBILITY.Public && claim.visibility !== GEO_VISIBILITY.PublicCoarse) continue
      const label = RELATION_HASH_TO_LABEL[claim.relation.toLowerCase()]
      if (!label) continue
      const priority = PRIORITY[label] ?? 0
      if (priority === 0) continue
      if (!best || priority > best.priority) {
        best = { priority, featureId: claim.featureId, featureVersion: claim.featureVersion }
      }
    } catch { /* skip bad row */ }
  }
  if (!best) return null

  // Parse the feature's `metadataURI` (`https://.../geo/<country>/<region>/<city>/v1.json`)
  // for the coarse slugs. The same URI parser is used by the geo-claim
  // action's `labelFromMetadataURI`; we inline it here to avoid a server
  // import cycle.
  try {
    const f = (await client.readContract({
      address: featReg, abi: geoFeatureRegistryAbi,
      functionName: 'getFeature', args: [best.featureId, best.featureVersion],
    })) as { metadataURI: string }
    const m = f.metadataURI.match(/\/geo\/([^/]+)\/([^/]+)\/([^/]+)\//)
    if (!m) return null
    const [, country, region, city] = m
    return {
      city:    city || null,
      region:  region || null,
      country: country || null,
    }
  } catch {
    return null
  }
}

/** Read ATL_LATITUDE / ATL_LONGITUDE off an agent. Returns null if either
 *  is unset. Used by stage-B geo matching to bbox-test feature claims. */
async function readLatLon(
  resolverAddr: `0x${string}`,
  agentAddr: `0x${string}`,
): Promise<{ lat: number; lon: number } | null> {
  const client = getPublicClient()
  async function read(predicate: `0x${string}`): Promise<string> {
    try {
      return (await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty', args: [agentAddr, predicate],
      })) as string
    } catch { return '' }
  }
  const [lat, lon] = await Promise.all([
    read(ATL_LATITUDE  as `0x${string}`),
    read(ATL_LONGITUDE as `0x${string}`),
  ])
  if (!lat || !lon) return null
  const flat = parseFloat(lat), flon = parseFloat(lon)
  if (!isFinite(flat) || !isFinite(flon)) return null
  return { lat: flat, lon: flon }
}

/** Hex-keccak → friendly relation label for the geo-overlap weights table. */
const RELATION_HASH_TO_LABEL: Record<string, string> = {
  // populated below from the SDK GEO_REL_* constants
}
async function ensureRelationLookup(): Promise<void> {
  if (Object.keys(RELATION_HASH_TO_LABEL).length > 0) return
  const sdk = await import('@smart-agent/sdk')
  const map: Array<[string, string]> = [
    ['servesWithin',         sdk.GEO_REL_SERVES_WITHIN as string],
    ['operatesIn',           sdk.GEO_REL_OPERATES_IN as string],
    ['licensedIn',           sdk.GEO_REL_LICENSED_IN as string],
    ['completedTaskIn',      sdk.GEO_REL_COMPLETED_TASK_IN as string],
    ['validatedPresenceIn',  sdk.GEO_REL_VALIDATED_PRESENCE_IN as string],
    ['stewardOf',            sdk.GEO_REL_STEWARD_OF as string],
    ['residentOf',           sdk.GEO_REL_RESIDENT_OF as string],
    ['originIn',             sdk.GEO_REL_ORIGIN_IN as string],
  ]
  for (const [label, h] of map) RELATION_HASH_TO_LABEL[h.toLowerCase()] = `geo:${label}`
}

/**
 * For one candidate: fetch their public GeoClaimRegistry rows, look
 * up each claim's feature, and return the relation strings of every
 * claim whose feature's bbox contains the caller's lat/lon.
 * Stage-B input for geoOverlapScore.
 */
async function matchedGeoClaimsForCandidate(args: {
  candidate: `0x${string}`
  callerLatLon: { lat: number; lon: number }
}): Promise<GeoClaimInput[]> {
  const claimReg = process.env.GEO_CLAIM_REGISTRY_ADDRESS as `0x${string}` | undefined
  const featReg  = process.env.GEO_FEATURE_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!claimReg || !featReg) return []
  await ensureRelationLookup()
  const client = getPublicClient()

  let claimIds: `0x${string}`[] = []
  try {
    claimIds = (await client.readContract({
      address: claimReg, abi: geoClaimRegistryAbi,
      functionName: 'claimsBySubject', args: [args.candidate],
    })) as `0x${string}`[]
  } catch { return [] }

  const out: GeoClaimInput[] = []
  for (const cid of claimIds) {
    try {
      const claim = (await client.readContract({
        address: claimReg, abi: geoClaimRegistryAbi,
        functionName: 'getClaim', args: [cid],
      })) as {
        relation: `0x${string}`; visibility: number; revoked: boolean
        confidence: number; featureId: `0x${string}`; featureVersion: bigint
        createdAt: bigint
      }
      if (claim.revoked) continue
      // Stage-B handles Public + PublicCoarse. PrivateZk arrives via the
      // separate ZK match path (Phase 6 verifier).
      if (claim.visibility !== GEO_VISIBILITY.Public && claim.visibility !== GEO_VISIBILITY.PublicCoarse) continue

      const feature = (await client.readContract({
        address: featReg, abi: geoFeatureRegistryAbi,
        functionName: 'getFeature', args: [claim.featureId, claim.featureVersion],
      })) as {
        active: boolean
        bboxMinLat: bigint; bboxMinLon: bigint
        bboxMaxLat: bigint; bboxMaxLon: bigint
      }
      if (!feature.active) continue
      const minLat = Number(feature.bboxMinLat) / Number(GEO_COORD_SCALE)
      const minLon = Number(feature.bboxMinLon) / Number(GEO_COORD_SCALE)
      const maxLat = Number(feature.bboxMaxLat) / Number(GEO_COORD_SCALE)
      const maxLon = Number(feature.bboxMaxLon) / Number(GEO_COORD_SCALE)
      const inside =
        args.callerLatLon.lat >= minLat && args.callerLatLon.lat <= maxLat &&
        args.callerLatLon.lon >= minLon && args.callerLatLon.lon <= maxLon
      if (!inside) continue

      const relLabel = RELATION_HASH_TO_LABEL[claim.relation.toLowerCase()]
      if (!relLabel) continue
      out.push({
        relation: relLabel,
        confidence: claim.confidence,
        issuedAt: new Date(Number(claim.createdAt) * 1000).toISOString(),
        issuerTrust: 0.5, // self-asserted default
        visibility: claim.visibility === GEO_VISIBILITY.PublicCoarse ? 'PublicCoarse' : 'Public',
      })
    } catch { /* skip bad row */ }
  }
  return out
}

async function getPublicOrgsForAgent(
  resolverAddr: `0x${string}`,
  agentAddr: `0x${string}`,
): Promise<string[]> {
  const client = getPublicClient()
  const orgs = new Set<string>()

  // Helper: `counterparty` is the OTHER endpoint (the one that's-supposed-to
  // be the org). Push it if it's an active TYPE_ORGANIZATION.
  async function pushIfOrg(counterparty: `0x${string}`): Promise<void> {
    try {
      const core = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getCore', args: [counterparty],
      }) as { agentType: `0x${string}`; active: boolean }
      if (core.agentType === TYPE_ORGANIZATION && core.active) {
        orgs.add(counterparty.toLowerCase())
      }
    } catch { /* skip */ }
  }

  // Self-inclusion when the candidate IS an Organization: the trust-
  // overlap math intersects "orgs caller is in" ∩ "orgs candidate is in",
  // designed for person↔person scoring. When the candidate is itself an
  // Org, the natural question is "does the caller affiliate with this
  // org?" — answered by including the org's own address in its public
  // set. Caller's heldSet (which contains the org via any GOVERNANCE /
  // MEMBERSHIP / HAS_MEMBER edge) then intersects → score 1.0.
  await pushIfOrg(agentAddr)

  // Incoming: agent is the OBJECT. Subject is the candidate counterparty.
  // Catches the canonical HAS_MEMBER direction (org → person).
  try {
    const incoming = await getEdgesByObject(agentAddr)
    for (const id of incoming) {
      try {
        const edge = await getEdge(id)
        if (edge.status < 2) continue
        if (!ORG_AFFILIATION_HEXES.has((edge.relationshipType ?? '').toLowerCase())) continue
        await pushIfOrg(edge.subject as `0x${string}`)
      } catch { /* skip */ }
    }
  } catch { /* */ }

  // Outgoing: agent is the SUBJECT. Object is the candidate counterparty.
  // Catches person → org governance (owner) and person → org membership.
  try {
    const outgoing = await getEdgesBySubject(agentAddr)
    for (const id of outgoing) {
      try {
        const edge = await getEdge(id) as { object_: `0x${string}`; relationshipType: `0x${string}`; status: number }
        if (edge.status < 2) continue
        if (!ORG_AFFILIATION_HEXES.has((edge.relationshipType ?? '').toLowerCase())) continue
        await pushIfOrg(edge.object_)
      } catch { /* skip */ }
    }
  } catch { /* */ }

  return Array.from(orgs)
}
