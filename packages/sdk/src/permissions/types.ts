/**
 * SessionPermissionRequest — ERC-7715-shaped permission descriptor.
 *
 * Internal schema, versioned. The "wire shape" the UI hands to the user
 * BEFORE the wallet signature step. Phase 4 of the delegation refactor.
 *
 * Two complementary types live here:
 *   - SessionPermissionRequest — the machine-readable request (what the
 *     wallet would receive in ERC-7715 form). Stable across releases via
 *     `schemaVersion`.
 *   - PermissionPreview — the projection used by the permission UI. Derived
 *     from a SessionPermissionRequest plus a ToolPolicyRegistry lookup so
 *     opaque addresses + selectors render as human terms.
 *
 * Mapping:
 *   TOOL_POLICIES (packages/sdk/src/policy/tool-policies.ts)
 *      │
 *      │  buildSessionPermissionRequest() — server-side, per user/agent
 *      ▼
 *   SessionPermissionRequest
 *      │
 *      │  previewSessionRequest(req, helpers)
 *      ▼
 *   PermissionPreview  ←  rendered by /sessions/permissions page
 *
 * No ERC-7715 typed-data hashing here — Phase 4 leaves the EIP-712 signature
 * to `bootstrapA2ASessionForUser`. This module is presentational + audit.
 */
import type { Address, Hex } from 'viem'

// ─── Wire shape ──────────────────────────────────────────────────────

export interface SessionPermissionRequest {
  /** Pinned. Bump when caveat shape changes. */
  schemaVersion: '1.0.0'

  /** Human-readable summary, surfaced in the wallet-style prompt. */
  sessionIntent: string

  /** Groups related tasks for audit correlation. Synthesized at request
   *  time; downstream services (a2a-agent, MCPs) carry this in audit rows. */
  taskGroupId: string

  /** ISO 8601 absolute expiry of the session. */
  expiresAtIso: string

  scope: {
    /** Tool names from the ToolPolicyRegistry. */
    mcpTools: string[]
    /** Resolved on-chain target addresses. */
    targets: Address[]
    /** 4-byte function selectors callable on the targets. */
    selectors: Hex[]
    /** Max ETH (wei) per call as a decimal string. '0' for typed-attr writes. */
    maxValueWei: string
  }

  rules: {
    /** Aggregate rate limit across all tools (window + max call count). */
    rateLimit?: { windowSeconds: number; maxCalls: number }
    /** Aggregate spend cap across all tools. Asset is symbol or address. */
    spendCap?: { asset: string; maxAmount: string }
    /** Forward-compat — geo fencing for stateful-session installations. */
    geoFence?: { allowedRegions: string[] }
  }

  /** Always true at v1; a Revoke-now control surfaces in the UI. */
  revocable: true

  chainId: number
}

// ─── UI projection ───────────────────────────────────────────────────

export interface PermissionPreview {
  /** The agent the user is granting a session to (e.g. "Catalyst Network Steward Agent"). */
  agentName: string

  sessionWindow: {
    startsAtIso: string
    endsAtIso: string
    /** Human label, e.g. "24 hours", "7 days". */
    durationLabel: string
  }

  capabilityGroups: Array<{
    /** Group title, e.g. "Pool administration". */
    label: string
    /** One-line description rendered under the title. */
    description: string
    /** Tool IDs surfaced under this group. */
    toolIds: string[]
    /** Human-readable target list, e.g. "FundRegistry, PoolRegistry". */
    onchainTargetsLabel: string
  }>

  /** Limits rendered as label/value rows. */
  limits: Array<{ label: string; value: string }>

  revocable: true

  /** Human chain label, e.g. "Anvil dev (31337)". */
  chainLabel: string
}

// ─── Helpers ─────────────────────────────────────────────────────────

interface PreviewHelpers {
  formatDuration: (seconds: number) => string
  formatTargets: (addrs: Address[]) => string
  formatChain: (chainId: number) => string
}

/**
 * Render a SessionPermissionRequest as a PermissionPreview ready for UI.
 *
 * Pure: takes only the request + a small set of formatting helpers. Caller
 * provides label dictionaries (so the SDK doesn't pin UI copy here).
 *
 * The grouping is naive: we bucket tools by their `mcp:` prefix (`pool:*`,
 * `round:*`, etc.) and render a single capability group per prefix. Tool
 * policies that have on-chain targets contribute to `onchainTargetsLabel`.
 */
export function previewSessionRequest(
  req: SessionPermissionRequest,
  helpers: PreviewHelpers,
): PermissionPreview {
  const now = new Date()
  const endsAt = new Date(req.expiresAtIso)
  const durationSeconds = Math.max(0, Math.round((endsAt.getTime() - now.getTime()) / 1000))

  const groups = groupToolsByPrefix(req.scope.mcpTools)
  const capabilityGroups: PermissionPreview['capabilityGroups'] = groups.map((g) => ({
    label: GROUP_LABELS[g.prefix] ?? prefixToLabel(g.prefix),
    description: GROUP_DESCRIPTIONS[g.prefix] ?? `${g.toolIds.length} ${g.toolIds.length === 1 ? 'action' : 'actions'}`,
    toolIds: g.toolIds,
    onchainTargetsLabel: helpers.formatTargets(req.scope.targets),
  }))

  const limits: PermissionPreview['limits'] = []

  // Value cap — always present (typically "no ETH transfer").
  if (req.scope.maxValueWei === '0') {
    limits.push({ label: 'ETH transfers', value: 'Not permitted' })
  } else {
    limits.push({ label: 'Max ETH per call', value: `${req.scope.maxValueWei} wei` })
  }

  // Rate limit.
  if (req.rules.rateLimit) {
    const { windowSeconds, maxCalls } = req.rules.rateLimit
    limits.push({
      label: 'Rate limit',
      value: `${maxCalls} calls per ${helpers.formatDuration(windowSeconds)}`,
    })
  }

  if (req.rules.spendCap) {
    limits.push({
      label: 'Spend cap',
      value: `${req.rules.spendCap.maxAmount} ${req.rules.spendCap.asset}`,
    })
  }

  if (req.rules.geoFence && req.rules.geoFence.allowedRegions.length > 0) {
    limits.push({
      label: 'Geo-fence',
      value: req.rules.geoFence.allowedRegions.join(', '),
    })
  }

  // Auto-expire row — always present.
  limits.push({
    label: 'Auto-expire',
    value: formatExpiry(endsAt),
  })

  return {
    agentName: 'Agent session',  // overridden by caller via a wrapping helper if needed
    sessionWindow: {
      startsAtIso: now.toISOString(),
      endsAtIso: endsAt.toISOString(),
      durationLabel: helpers.formatDuration(durationSeconds),
    },
    capabilityGroups,
    limits,
    revocable: true,
    chainLabel: helpers.formatChain(req.chainId),
  }
}

// ─── Group bucketing ─────────────────────────────────────────────────

interface ToolGroup {
  prefix: string
  toolIds: string[]
}

function groupToolsByPrefix(toolIds: string[]): ToolGroup[] {
  const map = new Map<string, string[]>()
  for (const id of toolIds) {
    const colon = id.indexOf(':')
    const prefix = colon === -1 ? id : id.slice(0, colon)
    if (!map.has(prefix)) map.set(prefix, [])
    map.get(prefix)!.push(id)
  }
  const out: ToolGroup[] = []
  // Stable order keyed by GROUP_ORDER first, then alphabetical.
  const orderedKeys = Array.from(map.keys()).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a)
    const bi = GROUP_ORDER.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })
  for (const k of orderedKeys) {
    out.push({ prefix: k, toolIds: map.get(k)!.sort() })
  }
  return out
}

function prefixToLabel(prefix: string): string {
  return prefix.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatExpiry(endsAt: Date): string {
  // Stable ISO-like rendering — independent of locale. The UI can override
  // by reading `sessionWindow.endsAtIso` directly if it wants locale-aware
  // formatting.
  const y = endsAt.getUTCFullYear()
  const m = String(endsAt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(endsAt.getUTCDate()).padStart(2, '0')
  const hh = String(endsAt.getUTCHours()).padStart(2, '0')
  const mm = String(endsAt.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm} UTC`
}

// Ordered list of prefixes — drives both layout order and label fallback.
const GROUP_ORDER = [
  'pool', 'round', 'grant_proposal', 'proposal', 'pool_pledge',
  'match_initiation', 'intent', 'disbursement', 'attestation', 'vote',
  'org_profile', 'detached_member', 'revenue', 'activity', 'notification',
  'belief', 'work_item', 'engagement',
]

const GROUP_LABELS: Record<string, string> = {
  'pool': 'Pool administration',
  'round': 'Round administration',
  'grant_proposal': 'Grant proposals',
  'proposal': 'Proposal review',
  'pool_pledge': 'Pool pledges',
  'match_initiation': 'Match initiations',
  'intent': 'Intents',
  'disbursement': 'Disbursements',
  'attestation': 'Outcome attestations',
  'vote': 'Voting',
  'org_profile': 'Organization profile',
  'detached_member': 'Detached members',
  'revenue': 'Revenue reporting',
  'activity': 'Activity log',
  'notification': 'Notifications',
  'belief': 'Beliefs',
  'work_item': 'Work items',
  'engagement': 'Engagements',
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  'pool': 'Open, configure, and close funding pools',
  'round': 'Open rounds, set awards roots, manage round lifecycle',
  'grant_proposal': 'Draft, submit, award, and revoke grant proposals',
  'proposal': 'Read proposals for review',
  'pool_pledge': 'Submit, amend, and stop pool pledges',
  'match_initiation': 'Create and manage direct match initiations',
  'intent': 'Create and list community intents',
  'disbursement': 'Record and claim grant disbursements',
  'attestation': 'Cast and list outcome attestations',
  'vote': 'Cast votes and read tallies',
  'org_profile': 'Update organization profile',
  'detached_member': 'Manage members not yet on-chain',
  'revenue': 'Submit and approve revenue reports',
  'activity': 'Log organization activity',
  'notification': 'Receive and acknowledge notifications',
  'belief': 'Manage shared beliefs',
  'work_item': 'Create and list work items',
  'engagement': 'Track engagement state',
}
