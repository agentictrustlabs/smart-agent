/**
 * Spec 007 Phase B § Step 5 — off-chain policy gate.
 *
 * Given a session record (Variant A or Variant B) and an intended
 * action, decide whether the session's variant is strong enough for
 * the action's risk tier BEFORE we build the userOp.
 *
 * This is an EARLY-FAIL UX OPTIMIZATION ONLY. The on-chain caveat
 * enforcer in `DelegationManager.redeemDelegation` is the authoritative
 * gate per spec § D2 Q5 — if this off-chain check is bypassed, the
 * on-chain enforcer still rejects the redemption. We add this gate
 * so the rejection happens in milliseconds with a clean 403, not after
 * a full RPC round-trip with a `userOp reverted` surface.
 *
 * The gate's truth table mirrors the variant-routing rule used at
 * session-init:
 *
 *   action tier    | session variant A | session variant B
 *   ─────────────  ┼─────────────────  ┼─────────────────
 *   low            | OK                | OK
 *   medium         | OK                | OK
 *   high           | REJECT            | OK
 *   critical       | REJECT            | OK
 *
 * The Variant A → high path is the load-bearing case. It must reject
 * BOTH at this off-chain gate AND at the on-chain enforcer (the spec's
 * misclassification-adversarial test asserts the on-chain reject is
 * also exercised).
 */
import {
  variantForTier,
  type ActionRiskTier,
  type SessionVariant,
  type ActionDescriptor,
} from '@smart-agent/sdk'
import { classifyAction } from './risk-tiers'

/**
 * Decision returned by `checkActionAgainstSession`. `ok=true` means the
 * caller may proceed to build the userOp; `ok=false` means the caller
 * SHOULD return 403 with `reason='policy:risk-tier-mismatch'` (or a
 * more specific deny code per the audit-deny vocabulary).
 *
 * The shape carries the classified action tier + the session variant
 * so the caller can write a single audit row with both fields.
 */
export type PolicyGateDecision =
  | { ok: true; actionTier: ActionRiskTier; sessionVariant: SessionVariant }
  | {
      ok: false
      reason: 'risk-tier-mismatch'
      actionTier: ActionRiskTier
      sessionVariant: SessionVariant
      message: string
    }

/**
 * Decide whether `action` is permissible under a session whose chosen
 * variant is `sessionVariant`. The required variant is
 * `variantForTier(actionTier)`; the gate accepts when the session's
 * variant ≥ the required variant (B always ≥ A).
 *
 * Pure — no I/O. Call this from the redeem handler after the session
 * is loaded and before the userOp is built.
 */
export function checkActionAgainstSession(
  action: ActionDescriptor,
  sessionVariant: SessionVariant,
): PolicyGateDecision {
  const actionTier = classifyAction(action)
  const requiredVariant = variantForTier(actionTier)
  // Variant B covers all tiers; Variant A only covers low/medium.
  const ok = sessionVariant === 'B' || requiredVariant === 'A'
  if (ok) {
    return { ok: true, actionTier, sessionVariant }
  }
  return {
    ok: false,
    reason: 'risk-tier-mismatch',
    actionTier,
    sessionVariant,
    message:
      `action '${action.route}' classified as ${actionTier} requires Variant ${requiredVariant} ` +
      `session, but session is Variant ${sessionVariant}. Re-bootstrap a Variant B session.`,
  }
}
