/**
 * Session TTL caps, keyed by risk tier.
 *
 * Sessions on `/session/init` accept a client-supplied `durationSeconds`,
 * which on its own is trivially abusable — an attacker could mint a
 * year-long session. We clamp every requested TTL to a cap derived from
 * the session's risk tier (matching the `RiskTier` axis on tool policies).
 *
 * Tiers (longest → shortest):
 *   - low        30 days     (read-only tools, no value movement)
 *   - medium      7 days     (default — most session-bearing flows)
 *   - high        1 day      (write-paths touching org/treasury state)
 *   - sensitive   4 hours    (high-value or admin actions)
 *
 * Callers should always pipe their requested duration through
 * `clampSessionTtl` before persisting or signing the session record.
 */

export const MAX_SESSION_TTL_SEC = {
  low:       30 * 24 * 60 * 60, // 30 days
  medium:     7 * 24 * 60 * 60, // 7 days
  high:       1 * 24 * 60 * 60, // 1 day
  sensitive:  4 * 60 * 60,      // 4 hours
} as const

export type SessionRiskTier = keyof typeof MAX_SESSION_TTL_SEC

/**
 * Clamp a requested session duration (in seconds) to the cap for the
 * given risk tier. Defaults to `medium` when no tier is provided.
 *
 * Returns `min(requested, cap)`. A non-positive or NaN request collapses
 * to the cap so we never persist a zero/negative session.
 */
export function clampSessionTtl(
  requested: number,
  tier: SessionRiskTier = 'medium',
): number {
  const cap = MAX_SESSION_TTL_SEC[tier]
  if (!Number.isFinite(requested) || requested <= 0) return cap
  return Math.min(Math.floor(requested), cap)
}
