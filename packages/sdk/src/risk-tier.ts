/**
 * Spec 007 Phase B — session-action risk tier classification.
 *
 * The hybrid session model (Variant A vs Variant B) routes session
 * bootstrap by the maximum risk tier across an action set:
 *
 *   - **Variant A** (`low` / `medium`) — user signs an EIP-712 caveated
 *     delegation off-chain; a2a-agent stores it; the session-key
 *     redeems it via `DelegationManager.redeemDelegation` at action
 *     time. No on-chain footprint at session-init.
 *   - **Variant B** (`high` / `critical`) — user submits a userOp that
 *     calls `AgentAccount.acceptSessionDelegation(hash)`, registering
 *     the session-delegation hash on chain at init time. Actions still
 *     redeem via `DelegationManager` but the on-chain `_acceptedSessionDelegations`
 *     mapping is an additional gate.
 *
 * The decision rule for a session covering N actions: take the MAX of
 * their tiers. Any single high-or-critical action forces the whole
 * session through Variant B. The classifier is total-ordering aware so
 * (high, low) → high, not "mixed".
 *
 * The tier registry is OWNED by `apps/a2a-agent/src/lib/risk-tiers.ts`
 * — the SDK only ships the type system and the pure classifier. This
 * keeps the risk-policy surface inside the a2a-agent module that
 * enforces it, while letting other workspaces (apps/web, person-mcp,
 * tests) import the types without dragging in agent-side state.
 *
 * **DO NOT** confuse this with `RiskTier` in `./policy/tool-policies.ts`
 * — that one is a coarse `'routine' | 'sensitive' | 'stateful'` axis
 * that drives MCP execution-path selection (`mcp-only`, `stateless-redeem`,
 * `sub-delegated`, `session-account`). This module's `ActionRiskTier`
 * is the finer 4-tier axis used to route SESSION variant choice in
 * Phase B. The two scales coexist deliberately — see
 * `specs/007-architecture-hardening/phase-B-a2a-signer-model.md`.
 */
import type { Address, Hex } from 'viem'

/**
 * Four-level action-risk axis. Drives Variant A vs Variant B session
 * routing (Phase B § Concrete deliverables).
 *
 *   - **low**       — read-only / idempotent / no on-chain side.
 *   - **medium**    — default for write actions that don't move money,
 *                     don't change ownership, and don't grant authority.
 *                     This is the FAIL-SAFER default for unannotated
 *                     routes (§ B1 Open question lock-in).
 *   - **high**      — money movement, treasury writes, grant award
 *                     finalization, org ownership changes.
 *   - **critical**  — same as high but with an extra gas budget /
 *                     human-confirmation requirement. Variant B is the
 *                     same path for both `high` and `critical` (the
 *                     contract surface doesn't distinguish); the
 *                     `critical` tier is reserved for forward-compat
 *                     UX gates (Phase H).
 */
export type ActionRiskTier = 'low' | 'medium' | 'high' | 'critical'

/**
 * Total ordering on `ActionRiskTier`. Returns -1/0/+1 so `Array.sort`
 * is the obvious thing. Used by `classifyRiskTier` to find the max
 * across a scope.
 */
export function compareRiskTier(a: ActionRiskTier, b: ActionRiskTier): number {
  const rank: Record<ActionRiskTier, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  }
  return rank[a] - rank[b]
}

/**
 * Variant selection for a session covering one or more actions.
 * `'A'` for low/medium scopes; `'B'` for high/critical scopes.
 */
export type SessionVariant = 'A' | 'B'

/**
 * Map a risk tier to the corresponding session variant.
 *
 *   low      → A
 *   medium   → A
 *   high     → B
 *   critical → B
 */
export function variantForTier(tier: ActionRiskTier): SessionVariant {
  if (tier === 'high' || tier === 'critical') return 'B'
  return 'A'
}

/**
 * One element of a declared session scope. The session-init endpoint
 * accepts an array of these and classifies the maximum tier.
 *
 * `route` is the action identifier used to look the tier up in the
 * a2a-agent's registry. Format depends on the call site — the a2a-agent
 * uses the canonical `<mcpTool>` toolId (e.g. `pool_pledge:submit`) for
 * MCP-routed actions and `route:<path>` for direct routes. The
 * registry is the single source of truth for what `route` strings are
 * recognised.
 *
 * `args` is optional contextual data the classifier may use for fine-
 * grained tiering (e.g. session validity longer than 24h → high). We
 * accept an opaque `unknown` here so the SDK type doesn't constrain
 * future registry shapes.
 */
export interface ActionDescriptor {
  route: string
  args?: unknown
}

/**
 * Function shape exported by the a2a-agent registry. Importers (tests,
 * mcp servers) construct one from `RISK_TIER_REGISTRY` and pass it to
 * `classifyRiskTier`. The default tier when a route is unannotated is
 * `medium` per the spec's fail-safer rule.
 */
export type RiskTierLookup = (action: ActionDescriptor) => ActionRiskTier

/**
 * Pure classifier — takes an array of actions and a lookup function,
 * returns the MAX tier across the scope. An empty scope returns `low`
 * (no actions declared = nothing to authorize; we still cap at the
 * lowest tier in case a caller forgets to declare scope).
 *
 * Spec lock-in: missing annotation defaults to `medium` (fail safer
 * at session init). The on-chain caveat enforcer remains the
 * authoritative gate per § D2 Q5 — this classifier is an early-fail
 * UX optimization at session init.
 */
export function classifyRiskTier(
  scope: readonly ActionDescriptor[],
  lookup: RiskTierLookup,
): ActionRiskTier {
  let max: ActionRiskTier = 'low'
  for (const action of scope) {
    const tier = lookup(action)
    if (compareRiskTier(tier, max) > 0) max = tier
  }
  return max
}

/**
 * Session-init request body type. Phase B § 1.
 *
 * Note: this is the SHAPE only; the actual route handler lives in
 * `apps/a2a-agent/src/routes/session-init.ts`. Exporting from the SDK
 * lets the web-side action layer construct a request without
 * duplicating the typing.
 */
export interface HybridSessionInitRequest {
  /** The user whose authority is being delegated to the session key. */
  accountAddress: Address
  /**
   * Declared action set the session intends to perform. The handler
   * runs `classifyRiskTier(scope, ...)` and routes to Variant A vs B.
   */
  scope: readonly ActionDescriptor[]
  /** Unix timestamp (seconds). Capped by `clampSessionTtl(tier)`. */
  validUntil: number
  /** Optional opaque metadata for audit. */
  metadata?: Record<string, string>
}

/**
 * Phase B session-init handshake response. Shape depends on variant:
 *
 *   - **Variant A**: returns an EIP-712 payload for the client to sign.
 *     The client then POSTs the signed payload to `/session/finalize`.
 *   - **Variant B**: returns a userOp + userOpHash for the client to
 *     sign. The client POSTs the signed userOp to `/session/finalize`.
 */
export interface HybridSessionInitVariantAResponse {
  variant: 'A'
  sessionId: string
  sessionKeyAddress: Address
  /** EIP-712 typed-data payload for the user's wallet to sign. */
  signingPayload: {
    domain: {
      name: string
      version: string
      chainId: number
      verifyingContract: Address
    }
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>
    primaryType: 'Delegation'
    message: {
      delegator: Address
      delegate: Address
      authority: Hex
      caveatsHash: Hex
      salt: string
    }
  }
  /** Hash the wallet should be ready to surface in UI as a fallback. */
  delegationHash: Hex
  riskTier: ActionRiskTier
  validUntil: number
}

export interface HybridSessionInitVariantBResponse {
  variant: 'B'
  sessionId: string
  sessionKeyAddress: Address
  /** Pre-built userOp; user signs `userOpHash` and POSTs back. */
  userOp: {
    sender: Address
    nonce: string
    initCode: Hex
    callData: Hex
    accountGasLimits: Hex
    preVerificationGas: string
    gasFees: Hex
    paymasterAndData: Hex
    signature: Hex
  }
  userOpHash: Hex
  sessionDelegationHash: Hex
  riskTier: ActionRiskTier
  validUntil: number
}

export type HybridSessionInitResponse =
  | HybridSessionInitVariantAResponse
  | HybridSessionInitVariantBResponse
