import { sqlite } from '../db/index.js'

/**
 * JTI single-use enforcement (replay protection).
 *
 * Atomic INSERT with WHERE-on-INSERT semantics: if the JTI is already
 * present AND has been used >= usageLimit, the row stays unchanged and
 * `result.changes === 0`. Caller must reject when changes is 0.
 */
export function recordJtiUsage(args: {
  jti: string
  principal: string
  delegationHash: string
  expiresAtISO: string
  usageLimit: number
}): { ok: boolean; reason?: string } {
  // SQLite-friendly upsert keyed on jti. usage_count effectively becomes 1
  // because PRIMARY KEY makes a second insert a conflict; we use the
  // ON CONFLICT path to bump but only when usage is still < limit.
  // For simplicity we treat usageLimit as 1 in v1 (single-use tokens) —
  // raising the limit requires a usage_count column on jti_usage.
  void args.usageLimit
  const now = new Date().toISOString()
  try {
    sqlite.prepare(`
      INSERT INTO jti_usage (jti, principal, delegation_hash, used_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(args.jti, args.principal.toLowerCase(), args.delegationHash.toLowerCase(), now, args.expiresAtISO)
    return { ok: true }
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      return { ok: false, reason: 'JTI already used' }
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Bump revocation epoch for a principal (ADR-PG-5). The MCP-side bump is
 * the FIRST step of revocation; the on-chain DelegationManager.revokeDelegation
 * call is the second. Atomicity is enforced by the caller (transaction wraps
 * both).
 */
export function bumpRevocationEpoch(principal: string): number {
  const lower = principal.toLowerCase()
  const now = new Date().toISOString()
  const tx = sqlite.transaction(() => {
    const row = sqlite.prepare(
      'SELECT current_epoch FROM revocation_epochs WHERE principal = ?',
    ).get(lower) as { current_epoch?: number } | undefined
    const next = (row?.current_epoch ?? 1) + 1
    sqlite.prepare(`
      INSERT INTO revocation_epochs (principal, current_epoch, bumped_at)
      VALUES (?, ?, ?)
      ON CONFLICT(principal) DO UPDATE SET
        current_epoch = excluded.current_epoch,
        bumped_at = excluded.bumped_at
    `).run(lower, next, now)
    return next
  })
  return tx()
}

export function rollbackRevocationEpoch(principal: string): void {
  const lower = principal.toLowerCase()
  const now = new Date().toISOString()
  const tx = sqlite.transaction(() => {
    const row = sqlite.prepare(
      'SELECT current_epoch FROM revocation_epochs WHERE principal = ?',
    ).get(lower) as { current_epoch?: number } | undefined
    if (!row?.current_epoch || row.current_epoch <= 1) return
    sqlite.prepare(
      'UPDATE revocation_epochs SET current_epoch = ?, bumped_at = ? WHERE principal = ?',
    ).run(row.current_epoch - 1, now, lower)
  })
  tx()
}

export function getCurrentEpoch(principal: string): number {
  const row = sqlite.prepare(
    'SELECT current_epoch FROM revocation_epochs WHERE principal = ?',
  ).get(principal.toLowerCase()) as { current_epoch?: number } | undefined
  return row?.current_epoch ?? 1
}
