import { randomUUID, createHash } from 'node:crypto'
import { sqlite } from '../db/index.js'
import type { AuthContext } from '../auth/principal-context.js'

/**
 * Append a row to pg_audit_log. Successes AND denials per SEC G9.
 *
 * `args_hash` is principal-salted (ADR-PG-1) to block cross-tenant rainbow
 * correlation — the SAME args from two different sponsors hash to different
 * digests.
 */
export function writeAuditRow(args: {
  ctx: AuthContext
  tool: string
  args: Record<string, unknown>
  result: string
}): void {
  const argsClean = stripSensitive(args.args)
  const argsHash = principalSaltedHash(args.ctx.principal, argsClean)
  sqlite.prepare(`
    INSERT INTO pg_audit_log (
      id, principal, accessing_agent, via, delegation_hash,
      tool, args_hash, result_summary, at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    args.ctx.principal,
    args.ctx.callerPrincipal,
    args.ctx.via,
    args.ctx.delegationHash ?? null,
    args.tool,
    argsHash,
    args.result,
    new Date().toISOString(),
  )
}

function stripSensitive(args: Record<string, unknown>): Record<string, unknown> {
  const { token: _t, crossDelegation: _cd, ...rest } = args as Record<string, unknown>
  return rest
}

function principalSaltedHash(principal: string, payload: Record<string, unknown>): string {
  const h = createHash('sha256')
  h.update(principal.toLowerCase())
  h.update('|')
  h.update(JSON.stringify(payload))
  return `0x${h.digest('hex')}`
}

/**
 * Retention sweep — partitions/archives via='direct' rows older than the
 * configured cutoff. Cross-delegation + curator rows are kept forever.
 * Called by a script in scripts/, not from the request path.
 */
export function archiveDirectAuditRows(cutoffDays: number): number {
  const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000).toISOString()
  const r = sqlite.prepare(`
    UPDATE pg_audit_log SET archived_at = ?
    WHERE via = 'direct' AND archived_at IS NULL AND at < ?
  `).run(new Date().toISOString(), cutoff)
  return r.changes
}
