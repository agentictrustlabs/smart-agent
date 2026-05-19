/**
 * Sprint 5 Wave 2 — P0-4 — stable deny-reason vocabulary.
 *
 * Every 4xx/5xx exit from the high-risk redeem + deploy-agent routes
 * (`apps/a2a-agent/src/routes/onchain-redeem.ts`) MUST tag its
 * `request_denied` row with a reason drawn from this list. The vocabulary
 * is intentionally small, kebab-cased, and namespaced — `<bucket>:<detail>`
 * — so a verifier walking the audit chain can group denials by class
 * (validation vs policy vs replay vs signature vs session vs error vs tx)
 * without parsing the long-form message.
 *
 * Adding a new reason:
 *
 *   1. Add the literal here, alphabetised within its namespace bucket.
 *   2. Use it at the call site as `reason: 'bucket:detail'`.
 *   3. The `denyAndAudit` helper validates the literal at call time — a
 *      typo or a reason missing from this list is a TypeScript error.
 *
 * Why a closed vocabulary? Free-form denial messages drift over time
 * (every developer phrases the same condition slightly differently),
 * which makes alerts and dashboards unreliable. Forcing every denial
 * through a typed enum gives operators a stable signal to query on
 * (`SELECT count(*) FROM execution_audit WHERE error_reason LIKE
 * 'policy:%'`) and gives the parity test a fixed surface to iterate.
 *
 * Buckets:
 *   - `validation:*` — request-body shape / required-field failures
 *     that don't depend on the session or any policy decision.
 *   - `fields:*`     — malformed body (unparseable JSON, etc.)
 *   - `policy:*`     — TOOL_POLICIES lookups / target / selector /
 *     value-cap rejects (the off-chain twin of the on-chain caveats).
 *   - `session:*`    — session-row lookup or freshness failures.
 *   - `signature:*`  — inter-service HMAC failures bubbled up by an
 *     upstream middleware (reserved for future use by routes that
 *     compose their own auth).
 *   - `replay:*`     — nonce / clock-skew rejects (reserved for future
 *     use; the inter-service-auth middleware emits its own deny rows).
 *   - `env:*`        — server-side configuration gaps detected at the
 *     route boundary (e.g. AGENT_FACTORY_ADDRESS unset).
 *   - `executor:*`   — tool-executor resolution failures (KMS lookup,
 *     missing signer key).
 *   - `tx:*`         — on-chain transaction reverted (the prior outcome
 *     row was written via `auditFinalize`; the `denyAndAudit` call here
 *     is the HTTP-status pairing only, NOT a duplicate audit row —
 *     callers pass `skipAudit: true`).
 *   - `error:*`      — catch-all for unexpected throws in the route
 *     handler. Includes the surface error class in the reason where
 *     known (`error:unhandled` is the generic bucket).
 */

export const AUDIT_DENY_REASONS = [
  // ─── validation:* — request shape ────────────────────────────────
  'validation:chain-empty',
  'validation:chain-leaf-delegate-mismatch',
  'validation:invalid-call-data',

  // ─── fields:* — malformed body ───────────────────────────────────
  'fields:malformed-json',

  // ─── policy:* — TOOL_POLICIES gates ──────────────────────────────
  'policy:unknown-tool',
  'policy:wrong-execution-path',
  'policy:target-not-allowed',
  'policy:selector-not-allowed',
  'policy:value-exceeds-cap',
  // Sprint 5 P0-8: marketplace tool requested while MARKETPLACE_ENABLED=false.
  // Paired with HTTP 503 so callers can distinguish "deploy hasn't opted into
  // marketplace" from "policy rejected this specific call" (which uses 403).
  'policy:marketplace-disabled',

  // ─── session:* — session row state ───────────────────────────────
  'session:not-found',
  'session:not-active',
  'session:expired',
  'session:missing-package',
  'session:lookup-failed',

  // ─── env:* — server config ───────────────────────────────────────
  'env:agent-factory-not-set',

  // ─── policy:* — Phase B hybrid session risk-tier gate ────────────
  // The session's variant ('A') is too weak for the requested action's
  // risk tier ('high' or 'critical'). Caller should re-bootstrap a
  // Variant B session via /session/hybrid-init.
  'policy:risk-tier-mismatch',

  // ─── session:* — Phase B session-shape gates ─────────────────────
  // The session was minted before Phase B (legacy /session/package),
  // so its delegation delegate is the smart account itself — not the
  // session key. Post-Phase-A this path no longer validates because
  // master is no longer an owner. Caller MUST re-bootstrap a hybrid
  // session.
  'session:legacy-shape-unsupported',
  // Variant B on-chain acceptance did not land (race / RPC issue at
  // session-init time). Re-finalize the session.
  'session:variant-b-not-accepted-onchain',

  // ─── tx:* — on-chain submission outcomes (paired with auditFinalize) ─
  'tx:reverted',
  'tx:handle-ops-reverted',

  // ─── error:* — unhandled throws ──────────────────────────────────
  'error:unhandled',
  'error:deploy-agent-failed',
  'error:redeem-via-account-failed',
] as const

/**
 * String-union over the canonical reason vocabulary above. Imported by
 * `denyAndAudit` so the compiler rejects any reason literal that has
 * not been registered here.
 */
export type AuditDenyReason = (typeof AUDIT_DENY_REASONS)[number]

/**
 * Runtime guard — used by `denyAndAudit` to fail loudly (in tests) if
 * a caller somehow constructs a reason at runtime that isn't on the
 * approved list. In production it logs a warning and proceeds — a
 * mistyped reason MUST NOT block the deny path that the route is
 * trying to return.
 */
export function isAuditDenyReason(reason: string): reason is AuditDenyReason {
  return (AUDIT_DENY_REASONS as readonly string[]).includes(reason)
}
