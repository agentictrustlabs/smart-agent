/**
 * Spec 007 Phase B — action-risk-tier registry + classifier (a2a-agent side).
 *
 * Single source of truth for action → `ActionRiskTier` mapping. Used by
 * the hybrid session-init endpoint (`/session/hybrid-init`) to route
 * Variant A (low/medium) vs Variant B (high/critical) at session
 * bootstrap, and by `lib/policy-gate.ts` to early-fail any redemption
 * whose declared scope's variant is too weak for the requested action.
 *
 * The registry is the OFF-CHAIN policy gate. The on-chain caveat
 * enforcer (`AllowedTargetsEnforcer` / `AllowedMethodsEnforcer` /
 * `ValueEnforcer` / `TimestampEnforcer`) is authoritative per spec
 * § D2 Q5 — this file is the early-fail UX layer in front of it.
 *
 * # How to classify a new route
 *
 * A new `mcpTool` or HTTP route MUST be assigned a tier. Three options:
 *
 *   1. Add it to `RISK_TIER_REGISTRY` below as a route → tier entry.
 *   2. Annotate the route handler with `// @sa-risk-tier <tier>` and
 *      let `scripts/gen-risk-tiers.ts` (forthcoming codegen) pick it
 *      up at build time. The codegen target is documented in spec
 *      § B1 — for v1 we hand-maintain the registry; the codegen lands
 *      with Phase G's CI sweep.
 *   3. Leave it unannotated. The classifier returns `medium` (the
 *      fail-safer default) — Variant A applies. If the action turns
 *      out to be high-risk, the on-chain caveat enforcer rejects it
 *      and `audit-deny` records `policy:risk-tier-mismatch`.
 *
 * Default tier rule: a registry miss returns `medium`, NOT `low`. We
 * over-classify, never under-classify; an under-classified action
 * would silently slip past the session-variant gate (the on-chain
 * enforcer still catches it, but the UX cost is a wasted on-chain
 * trip and a 502 vs a clean 403).
 *
 * # Initial high-risk set
 *
 * Per spec § Concrete deliverables:
 *
 *   - Money movement   (pledge honor, commitment release, treasury transfer)
 *   - Treasury admin   (org treasury writes)
 *   - Grant award finalization
 *   - Org ownership    (controller / owner changes)
 *   - Long-lived       sessions whose `validUntil - now > 24h`
 *
 * The `critical` tier is reserved for forward-compat — currently no
 * route is critical; Phase H's KMS budget enforcement may promote
 * paymaster-budget-busting actions.
 *
 * # Coordinates with @smart-agent/sdk
 *
 * The classifier shape (`ActionDescriptor`, `RiskTierLookup`,
 * `classifyRiskTier`) is defined in `@smart-agent/sdk/risk-tier`. This
 * file owns the agent-specific registry and exports a `classifySessionRiskTier`
 * helper bound to it.
 */
import {
  classifyRiskTier as sdkClassifyRiskTier,
  type ActionRiskTier,
  type ActionDescriptor,
} from '@smart-agent/sdk'

/**
 * Canonical action → tier mapping. Keys are `mcpTool` ids (the
 * canonical form used in `TOOL_POLICIES` plus a couple of pseudo-tools
 * for system-scoped operations).
 *
 * The list is intentionally explicit and short — only the high-risk
 * tail is enumerated; medium is the default and low routes are
 * one-offs for read-only ops.
 */
export const RISK_TIER_REGISTRY: Readonly<Record<string, ActionRiskTier>> = Object.freeze({
  // ─── HIGH — money movement (Spec 005 Pledge Honor + commitments) ───
  'pledge:honor':                  'high',
  'pledge:honor:executeBatch':     'high',
  'commitment:record_release':     'high',
  'commitment:commit':             'high',     // grant award finalization
  'commitment:cancel':             'high',     // cancellation is irreversible authority change

  // ─── HIGH — treasury admin (org treasury writes) ─────────────────
  'treasury:transfer':             'high',
  'treasury:withdraw':             'high',
  'pool_pledge:submit':            'high',     // financial commitment
  'pool_pledge:amend':             'high',
  'pool_pledge:stop':              'high',
  'pool_pledge:auto_stop':         'high',

  // ─── HIGH — grant award finalization (round close + awards root) ──
  'round:close':                   'high',
  'round:cancel':                  'high',
  'round:set_awards_root':         'high',
  'grant_proposal:award':          'high',
  'grant_proposal:revoke_award':   'high',
  'proposal_registry:announce_award': 'high',
  'disbursement:claim':            'high',

  // ─── HIGH — org ownership changes ────────────────────────────────
  'agentResolver:setController':   'high',
  'agentAccount:addOwner':         'high',
  'agentAccount:removeOwner':      'high',
  'agentAccount:setDelegationManager': 'high',
  'agent_resolver:set_address_property': 'high',  // controller is an address attribute

  // ─── HIGH — pool / fund lifecycle (irreversible) ─────────────────
  'pool:close':                    'high',
  'pool:rotate_stewards':          'high',

  // ─── LOW — explicit read-only / idempotent paths ─────────────────
  'fund_registry:get_round_fund_agent': 'low',
  'fund_registry:get_round_status':     'low',
  'fund_registry:list_rounds_by_pool':  'low',
  'pool_registry:get_pool':             'low',
  'pool_registry:list_pools_by_steward': 'low',
  'agent_resolver:read':                'low',
  'agent_resolver:read_address_property': 'low',
  'relationship:list_outgoing':         'low',
  'match_initiation:read':              'low',

  // Default for everything else is 'medium' (see `classifyAction` below).
})

/**
 * Default tier used when an action's route is not in
 * `RISK_TIER_REGISTRY`. Per spec § B1 / § Concrete deliverables, the
 * fail-safer default is `medium`: under-classification at session-init
 * cannot bypass the on-chain caveat enforcer, but it would force the
 * caller into a Variant A session for a `high` action — the
 * on-chain enforcer correctly rejects this, but at the cost of a
 * wasted RPC round-trip. `medium` strikes the balance.
 */
export const DEFAULT_RISK_TIER: ActionRiskTier = 'medium'

/**
 * Classify a single action against the agent's registry. Pure; used
 * by `classifySessionRiskTier` AND by `policy-gate.ts`'s per-action
 * check at redeem time.
 */
export function classifyAction(action: ActionDescriptor): ActionRiskTier {
  // Long-lived automation rule: if the action carries an explicit
  // `validUntilSecondsFromNow` arg > 24h, the action itself is at
  // least high-risk (matches the spec's "long-lived automation"
  // bullet). We accept either shape `args.validUntilSecondsFromNow`
  // or `args.validUntil` (unix seconds).
  const args = action.args as
    | { validUntilSecondsFromNow?: number; validUntil?: number; nowSeconds?: number }
    | undefined
  if (args) {
    const validUntilSecondsFromNow = (() => {
      if (typeof args.validUntilSecondsFromNow === 'number') {
        return args.validUntilSecondsFromNow
      }
      if (typeof args.validUntil === 'number') {
        const now = typeof args.nowSeconds === 'number'
          ? args.nowSeconds
          : Math.floor(Date.now() / 1000)
        return args.validUntil - now
      }
      return 0
    })()
    if (validUntilSecondsFromNow > 24 * 60 * 60) return 'high'
  }
  const tier = RISK_TIER_REGISTRY[action.route]
  return tier ?? DEFAULT_RISK_TIER
}

/**
 * Classify the maximum risk tier across a scope. Used by the hybrid
 * session-init endpoint to decide Variant A vs Variant B.
 *
 * Mirrors the SDK's pure `classifyRiskTier(scope, lookup)` with the
 * a2a-agent registry pre-wired.
 */
export function classifySessionRiskTier(
  scope: readonly ActionDescriptor[],
): ActionRiskTier {
  return sdkClassifyRiskTier(scope, classifyAction)
}

/**
 * Convenience: collapse a 4-tier classification down to the boolean
 * "needs Variant B" decision used by the session-init router.
 *
 * Variant B applies when ANY action is `high` or `critical`.
 */
export function sessionRequiresVariantB(
  scope: readonly ActionDescriptor[],
): boolean {
  const tier = classifySessionRiskTier(scope)
  return tier === 'high' || tier === 'critical'
}
