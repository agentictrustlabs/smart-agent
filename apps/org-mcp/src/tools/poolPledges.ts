/**
 * Spec 002 — Intent Marketplace (Pool Lane). PoolPledge MCP tools.
 *
 * org-mcp side: org donors. Twins person-mcp's poolPledges.ts.
 *
 * Tools registered (each tool name === scope name):
 *   - pool_pledge:submit
 *   - pool_pledge:amend
 *   - pool_pledge:stop
 *   - pool_pledge:auto_stop   (system-delegation from pool steward)
 *   - pool_pledge:read_self
 *   - pool_pledge:read_pool_counters  (derived from pool_pledges sums)
 *
 * Persistence: `pool_pledges` table per IA § 2.2 (org-mcp tenancy column =
 * `principal`, NOT `org_principal`, per the IA classification doc).
 *
 * POST-PHASE-7: pool BODY (acceptedUnits, restrictions, capacityCeiling,
 * visibility, addressedMembers, stewards) lives ON-CHAIN in PoolRegistry.
 * The action layer pre-validates against DiscoveryService.getPoolDetail()
 * BEFORE invoking pool_pledge:submit. The MCP layer no longer body-validates
 * — it persists the pledge as-is and trusts the action-layer gate. Counters
 * (pledgedTotal / allocatedTotal / availableTotal) are DERIVED from
 * `pool_pledges` rows at read time via `pool_pledge:read_pool_counters`.
 */
import { randomUUID } from 'node:crypto'
import { keccak256, encodePacked, getAddress, isAddress } from 'viem'
import { db } from '../db/index.js'
import { orgCrossDelegationGrants } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { PledgeRegistryClient } from '@smart-agent/sdk'
import { callA2aRedeemWithChain, type SignedDelegation } from '../lib/a2a-client.js'
import { requirePledgeRegistryAddress } from '../lib/contracts.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

type Cadence = 'one-time' | 'monthly' | 'annual'
type StoryPermission = 'public' | 'shareWithSupportTeam' | 'anonymous'
type PledgeStatus = 'active' | 'waitlisted' | 'stopped' | 'auto-stopped' | 'fulfilled'
type Visibility = 'public' | 'public-coarse' | 'private'

interface PledgeRestrictions {
  kinds?: string[]
  geoRoots?: string[]
  notForAdmin?: boolean
  notForDiscretionary?: boolean
}

interface PledgeAmendment {
  kind: 'amount' | 'cadence' | 'duration'
  prevValue: number | string
  newValue: number | string
  amendedAt: string
  windowResetAt?: string
}

type SubmitErrorKind =
  | { kind: 'validation'; messages: string[] }

function err(error: SubmitErrorKind) {
  return mcpText({ ok: false as const, error })
}

function nowIso(): string {
  return new Date().toISOString()
}

function safeJson<T>(raw: string | null | undefined, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T } catch { return fb }
}

function cadenceAwareTotal(p: { cadence: Cadence; amount: number; duration?: number | null }): number {
  if (p.cadence === 'one-time') return p.amount
  const dur = p.duration ?? 1
  return p.amount * Math.max(1, dur)
}

/**
 * Derive a pool's counters from `pool_pledges` rows.
 *
 *   pledgedTotal   = SUM(cadence-aware amount * duration)
 *                    over rows WHERE pool_agent_id = ? AND status = 'active'
 *   allocatedTotal = 0   (allocation tracking deferred to a future spec)
 *   availableTotal = pledgedTotal - allocatedTotal
 *
 * No source-of-truth columns exist anymore; this is the only counter read.
 */
/** Spec 004 — `pool_pledges` SQL mirror dropped; pledges live on chain
 *  in `PledgeRegistry`. Counters now require a registry event-scan,
 *  queued behind R8 (on-chain → GraphDB sync). Returns zeros so the
 *  pool detail page renders without crashing while sync ships. */
export function getPoolCounters(poolAgentId: string): {
  pledgedTotal: number
  allocatedTotal: number
  availableTotal: number
} {
  void poolAgentId
  void cadenceAwareTotal  // keep helper available for the post-R8 reader
  return { pledgedTotal: 0, allocatedTotal: 0, availableTotal: 0 }
}

function deriveVisibility(
  poolVisibility: 'public' | 'private',
  story: StoryPermission,
): Visibility {
  if (poolVisibility === 'private') return 'private'
  if (story === 'public') return 'public'
  if (story === 'shareWithSupportTeam') return 'public-coarse'
  return 'private'
}

function issueReadPledgeGrant(opts: {
  donorPrincipal: string
  poolAgentId: string
  pledgeId: string
}): void {
  const scope = `pool:read_pledge:${opts.poolAgentId}:${opts.pledgeId}`
  db.insert(orgCrossDelegationGrants).values({
    id: randomUUID(),
    orgPrincipal: opts.donorPrincipal,
    granteeAgent: opts.poolAgentId.toLowerCase(),
    scope: JSON.stringify({ scope, pledgeId: opts.pledgeId }),
    validFrom: nowIso(),
    validUntil: null,
    caveatTerms: null,
    createdAt: nowIso(),
    revokedAt: null,
  }).run()
}

interface SubmitArgs {
  token: string
  /** Pool's treasury (AgentAccount) address — REQUIRED.
   *  The action layer resolves the pool URN via DiscoveryService.getPoolDetail
   *  before calling this tool. The on-chain `PledgeRegistry.submit` requires
   *  an address (not a URN) so onlyPoolOperator can resolve fund-account owners. */
  poolAgent: string
  /** Optional human-friendly identifier — kept for logging/observability only. */
  poolAgentId?: string
  cadence: Cadence
  unit: string
  amount: number
  duration?: number | null
  restrictions?: PledgeRestrictions
  storyPermissions: StoryPermission
  poolVisibility?: 'public' | 'private'
  _a2aSessionId?: string
  /** Spec 004 (b2) — admin→donor→session chain. Pool admin pre-signs
   *  `admin → donor` at credential-issuance / membership-add time;
   *  donor's web client freshly mints `donor → session` (authority =
   *  hash(admin → donor)) at action time. Leaf delegate = session key. */
  chain: SignedDelegation[]
}

/** Derive the donor's pseudonym nullifier from their authenticated principal.
 *  Spec 004 pledges are NOT AnonCreds-gated (the cred-gated flows are
 *  voting + grant proposals); pledger anonymity is handled via the existing
 *  `story_permissions` cascade. The nullifier is used solely as the
 *  on-chain subject key so the same donor can amend/stop their pledge
 *  without re-publishing identity to the chain. */
function donorNullifier(principal: string): `0x${string}` {
  return keccak256(encodePacked(['string', 'string'], ['sa:pledger:', principal.toLowerCase()]))
}

const submitTool = {
  name: 'pool_pledge:submit',
  description:
    "Submit a PoolPledge to the on-chain PledgeRegistry. Pool body validation (acceptedUnits, restrictions, capacityCeiling, visibility) is the action layer's responsibility — it pre-validates against DiscoveryService.getPoolDetail before calling this tool.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgent: { type: 'string' },
      poolAgentId: { type: 'string' },
      cadence: { type: 'string', enum: ['one-time', 'monthly', 'annual'] },
      unit: { type: 'string' },
      amount: { type: 'number' },
      duration: { type: 'number' },
      restrictions: { type: 'object' },
      storyPermissions: { type: 'string', enum: ['public', 'shareWithSupportTeam', 'anonymous'] },
      poolVisibility: { type: 'string', enum: ['public', 'private'] },
      chain: { type: 'array', items: { type: 'object' } },
    },
    required: ['token', 'poolAgent', 'cadence', 'unit', 'amount', 'storyPermissions', 'chain'],
  },
  handler: async (args: SubmitArgs) => {
    const principal = await requireOrgPrincipal(args.token, args, 'pool_pledge:submit')

    if (!args.poolAgent || !isAddress(args.poolAgent)) {
      return err({ kind: 'validation', messages: ['poolAgent must be an EVM address'] })
    }
    if (!args.cadence || !args.unit || typeof args.amount !== 'number' || !args.storyPermissions) {
      return err({ kind: 'validation', messages: ['missing required fields'] })
    }
    if (args.amount <= 0) {
      return err({ kind: 'validation', messages: ['amount must be > 0'] })
    }
    if ((args.cadence === 'monthly' || args.cadence === 'annual') && (!args.duration || args.duration <= 0)) {
      return err({ kind: 'validation', messages: ['recurring pledges require duration > 0'] })
    }

    const sessionId = args._a2aSessionId
    if (!sessionId) {
      return mcpText({ ok: false as const, error: '_a2aSessionId missing — pool_pledge:submit requires the a2a-agent session id' })
    }
    if (!Array.isArray(args.chain) || args.chain.length === 0) {
      return mcpText({ ok: false as const, error: 'chain missing — pool_pledge:submit requires the admin→donor→session delegation chain (spec 004 b2)' })
    }

    const poolAgent = getAddress(args.poolAgent)
    const nullifier = donorNullifier(principal)
    const salt = 0n
    const pledgeSubject = PledgeRegistryClient.pledgeSubject(poolAgent, nullifier, salt)

    const callData = PledgeRegistryClient.encodeSubmit({
      poolAgent,
      nullifier,
      salt,
      amount: BigInt(args.amount),
      unit: args.unit,
      cadence: args.cadence,
      duration: args.duration ? BigInt(args.duration) : 0n,
      restrictionsJson: args.restrictions ? JSON.stringify(args.restrictions) : '',
      storyPermissionsJson: args.storyPermissions,
    })
    const tx = await callA2aRedeemWithChain(sessionId, {
      mcpTool: 'pool_pledge:submit',
      mcpCallId: randomUUID(),
      target: requirePledgeRegistryAddress(),
      value: 0n,
      callData,
      chain: args.chain,
    })

    if (args.storyPermissions !== 'anonymous' && args.poolAgentId) {
      try {
        issueReadPledgeGrant({ donorPrincipal: principal, poolAgentId: args.poolAgentId, pledgeId: pledgeSubject })
      } catch (e) {
        console.warn(
          `[org-mcp/poolPledges] read_pledge grant failed: ${e instanceof Error ? e.message : e}`,
        )
      }
    }

    return mcpText({
      ok: true as const,
      txHash: tx.txHash,
      pledgeSubject,
      poolAgent,
      status: 'active' as PledgeStatus,
    })
  },
}

interface AmendArgs {
  token: string
  /** Pool's treasury (AgentAccount) address — used together with the
   *  donor's nullifier to derive the canonical pledgeSubject. */
  poolAgent: string
  newAmount: number
  newDuration?: number
  _a2aSessionId?: string
  chain: SignedDelegation[]
}

const amendTool = {
  name: 'pool_pledge:amend',
  description:
    "Amend the active pledge for the calling donor on a pool. The on-chain pledgeSubject is re-derived from (poolAgent, donorNullifier, salt=0); only the donor of that pledge can amend it because the gateway is the only writer and binds the principal at the auth boundary.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgent: { type: 'string' },
      newAmount: { type: 'number' },
      newDuration: { type: 'number' },
      chain: { type: 'array', items: { type: 'object' } },
    },
    required: ['token', 'poolAgent', 'newAmount', 'chain'],
  },
  handler: async (args: AmendArgs) => {
    const principal = await requireOrgPrincipal(args.token, args, 'pool_pledge:amend')
    if (!args.poolAgent || !isAddress(args.poolAgent)) {
      throw new Error('poolAgent must be an EVM address')
    }
    if (typeof args.newAmount !== 'number' || args.newAmount <= 0) {
      throw new Error('newAmount must be > 0')
    }
    const sessionId = args._a2aSessionId
    if (!sessionId) {
      throw new Error('_a2aSessionId missing — pool_pledge:amend requires the a2a-agent session id')
    }
    if (!Array.isArray(args.chain) || args.chain.length === 0) {
      throw new Error('chain missing — pool_pledge:amend requires the admin→donor→session delegation chain (spec 004 b2)')
    }

    const poolAgent = getAddress(args.poolAgent)
    const nullifier = donorNullifier(principal)
    const pledgeSubject = PledgeRegistryClient.pledgeSubject(poolAgent, nullifier, 0n)

    const callData = PledgeRegistryClient.encodeAmend({
      pledgeSubject,
      newAmount: BigInt(args.newAmount),
      newDuration: args.newDuration ? BigInt(args.newDuration) : 0n,
    })
    const tx = await callA2aRedeemWithChain(sessionId, {
      mcpTool: 'pool_pledge:amend',
      mcpCallId: randomUUID(),
      target: requirePledgeRegistryAddress(),
      value: 0n,
      callData,
      chain: args.chain,
    })

    return mcpText({ ok: true as const, txHash: tx.txHash, pledgeSubject })
  },
}

const stopTool = {
  name: 'pool_pledge:stop',
  description:
    "Stop the active pledge for the calling donor on a pool. The on-chain pledgeSubject is re-derived from (poolAgent, donorNullifier, salt=0); only the donor of that pledge can stop it because the gateway is the only writer and binds the principal at the auth boundary.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgent: { type: 'string' },
      chain: { type: 'array', items: { type: 'object' } },
    },
    required: ['token', 'poolAgent', 'chain'],
  },
  handler: async (args: { token: string; poolAgent: string; _a2aSessionId?: string; chain: SignedDelegation[] }) => {
    const principal = await requireOrgPrincipal(args.token, args, 'pool_pledge:stop')
    if (!args.poolAgent || !isAddress(args.poolAgent)) {
      throw new Error('poolAgent must be an EVM address')
    }
    const sessionId = args._a2aSessionId
    if (!sessionId) {
      throw new Error('_a2aSessionId missing — pool_pledge:stop requires the a2a-agent session id')
    }
    if (!Array.isArray(args.chain) || args.chain.length === 0) {
      throw new Error('chain missing — pool_pledge:stop requires the admin→donor→session delegation chain (spec 004 b2)')
    }

    const poolAgent = getAddress(args.poolAgent)
    const nullifier = donorNullifier(principal)
    const pledgeSubject = PledgeRegistryClient.pledgeSubject(poolAgent, nullifier, 0n)

    const callData = PledgeRegistryClient.encodeStop(pledgeSubject)
    const tx = await callA2aRedeemWithChain(sessionId, {
      mcpTool: 'pool_pledge:stop',
      mcpCallId: randomUUID(),
      target: requirePledgeRegistryAddress(),
      value: 0n,
      callData,
      chain: args.chain,
    })

    return mcpText({ ok: true as const, txHash: tx.txHash, pledgeSubject })
  },
}

const autoStopTool = {
  name: 'pool_pledge:auto_stop',
  description:
    "System-delegation: stop a pledge identified by its on-chain subject (used when a pool is closed/withdrawn and downstream code wants to mark a specific donor's pledge as auto-stopped). Currently writes the same `stop` call on chain; a separate auto-stop status is not yet codified at the registry layer.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      pledgeSubject: { type: 'string' },
      chain: { type: 'array', items: { type: 'object' } },
    },
    required: ['token', 'pledgeSubject', 'chain'],
  },
  handler: async (args: { token: string; pledgeSubject: `0x${string}`; _a2aSessionId?: string; chain: SignedDelegation[] }) => {
    await requireOrgPrincipal(args.token, args, 'pool_pledge:auto_stop')
    if (!args.pledgeSubject || !args.pledgeSubject.startsWith('0x')) {
      throw new Error('pledgeSubject must be a bytes32 hex')
    }
    const sessionId = args._a2aSessionId
    if (!sessionId) {
      throw new Error('_a2aSessionId missing — pool_pledge:auto_stop requires the a2a-agent session id')
    }
    if (!Array.isArray(args.chain) || args.chain.length === 0) {
      throw new Error('chain missing — pool_pledge:auto_stop requires the steward→pool→session delegation chain (spec 004 b2)')
    }
    const callData = PledgeRegistryClient.encodeStop(args.pledgeSubject)
    const tx = await callA2aRedeemWithChain(sessionId, {
      mcpTool: 'pool_pledge:auto_stop',
      mcpCallId: randomUUID(),
      target: requirePledgeRegistryAddress(),
      value: 0n,
      callData,
      chain: args.chain,
    })
    return mcpText({ ok: true as const, txHash: tx.txHash, pledgeSubject: args.pledgeSubject })
  },
}

const readSelfTool = {
  name: 'pool_pledge:read_self',
  description: "List all PoolPledges owned by the authenticated principal.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      status: { type: 'string' },
      poolAgentId: { type: 'string' },
    },
    required: ['token'],
  },
  // Spec 004 — pool_pledges SQL mirror dropped; pledges are on chain
  // in PledgeRegistry. The reader requires an event scan + nullifier
  // resolution back to the caller's principal (the chain doesn't store
  // principal, only a per-issuance nullifier). Queued behind R8.
  handler: async (args: { token: string; status?: string; poolAgentId?: string }) => {
    await requireOrgPrincipal(args.token, args, 'pool_pledge:read_self')
    void args
    return mcpText({ pledges: [] })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool_pledge:read_pool_counters
// ───────────────────────────────────────────────────────────────────────
//
// Returns the derived pledged/allocated/available totals for a pool, summed
// from `pool_pledges` rows. Replaces the dropped `pool:read_counters` tool.
// `allocatedTotal` is always 0 in v1 (no pledge-side allocation tracking).
const readPoolCountersTool = {
  name: 'pool_pledge:read_pool_counters',
  description:
    "Read the derived pledged/allocated/available totals for a pool. Computed at read time as SUM(cadence-aware amount) over pool_pledges WHERE pool_agent_id = ? AND status = 'active'.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
    },
    required: ['token', 'poolAgentId'],
  },
  handler: async (args: { token: string; poolAgentId: string }) => {
    await requireOrgPrincipal(args.token, args, 'pool_pledge:read_pool_counters')
    const counters = getPoolCounters(args.poolAgentId)
    return mcpText({ poolAgentId: args.poolAgentId, ...counters })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool_pledge:list_for_pool
// ───────────────────────────────────────────────────────────────────────
//
// Public-ish read: returns the visible pledges for a pool so the pool
// detail page can render "Recent pledges". Individual pledger identity
// is gated by each pledge's `story_permissions` — pledges that opted to
// anonymize the donor name expose only the principal-hash prefix instead
// of the raw principal. Amount is always exposed (matches the aggregate
// totals shown elsewhere on the same page).
//
// Auth: any authenticated org-principal. Use the result only to render
// the pool's public surface; don't fan out per-pledge actions from this
// list — for those, the pledger themselves uses `pool_pledge:read_self`.
const listForPoolTool = {
  name: 'pool_pledge:list_for_pool',
  description:
    "Return pledges for a pool with story_permissions applied. Used by the pool detail page to render the Recent pledges section.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgentId: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['token', 'poolAgentId'],
  },
  // Spec 004 — pool_pledges SQL mirror dropped. The pool detail page
  // reads pledges from GraphDB once the R8 sync ships; pledge bodies
  // come from PledgeRegistry, with story_permissions applied at
  // emit time so non-public pledges never reach the public graph.
  handler: async (args: { token: string; poolAgentId: string; limit?: number }) => {
    await requireOrgPrincipal(args.token, args, 'pool_pledge:list_for_pool')
    void args
    void unitHashToLabel
    return mcpText({ pledges: [] })
  },
}

// Reverse-map of common unit concept hashes → labels. Keep in sync with
// the same set in `apps/web/src/lib/ontology/graphdb-sync.ts` CONCEPT_LABEL.
const UNIT_LABELS: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const u of ['USD', 'EUR', 'prayer-minutes', 'loaves', 'hours', 'minutes', 'meals', 'coaching-hours']) {
    m[keccak256(new TextEncoder().encode(u)).toLowerCase()] = u
  }
  return m
})()
function unitHashToLabel(unit: string): string {
  if (!unit) return unit
  const lc = unit.toLowerCase()
  return UNIT_LABELS[lc] ?? unit
}

export const poolPledgesTools = {
  'pool_pledge:submit': submitTool,
  'pool_pledge:list_for_pool': listForPoolTool,
  'pool_pledge:amend': amendTool,
  'pool_pledge:stop': stopTool,
  'pool_pledge:auto_stop': autoStopTool,
  'pool_pledge:read_self': readSelfTool,
  'pool_pledge:read_pool_counters': readPoolCountersTool,
}
