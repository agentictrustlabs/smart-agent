import {
  verifySessionAndExtractPrincipal,
  verifyCrossDelegation,
  type CrossDelegationInput,
} from './verify-delegation.js'
import { recordJtiUsage } from './revocation.js'
import { config } from '../config.js'
import { writeAuditRow } from '../util/audit.js'

export interface AuthContext {
  /** The data-owner principal — used in WHERE clauses on T1/T2 tables. */
  principal: string
  /** The smart-account address that signed the session. */
  callerPrincipal: string
  /** 'direct' = caller is the data owner; 'cross-delegation' = bridged read. */
  via: 'direct' | 'cross-delegation' | 'curator'
  /** Hex hash of the on-chain cross-delegation, when via='cross-delegation'. */
  delegationHash?: string
}

interface CommonArgs {
  token: string
  toolName: string
  argsForAudit: Record<string, unknown>
}

/**
 * Owner-only auth (T2 writes). Caller's session principal IS the data owner.
 * Sets via='direct'.
 */
export async function requirePrincipal(c: CommonArgs): Promise<AuthContext> {
  if (!c.token) throw new AuthError('Missing delegation token', c)
  const r = await verifySessionAndExtractPrincipal(c.token, c.toolName)
  if ('error' in r) throw new AuthError(r.error, c)
  if (r.jti) {
    const j = recordJtiUsage({
      jti: r.jti, principal: r.principal,
      delegationHash: 'direct',
      expiresAtISO: r.expiresAtISO,
      usageLimit: r.usageLimit ?? 1,
    })
    if (!j.ok) throw new AuthError(`JTI replay: ${j.reason}`, c)
  }
  const ctx: AuthContext = {
    principal: r.principal,
    callerPrincipal: r.principal,
    via: 'direct',
  }
  writeAuditRow({ ctx, tool: c.toolName, args: c.argsForAudit, result: 'ok:auth' })
  return ctx
}

/**
 * Mixed auth (T2 reads): owner OR cross-delegation.
 *
 * If `args.crossDelegation` is present, gates on the per-resource match
 * (SEC-12 / ADR-PG-4). Returns `principal = crossDelegation.delegator`.
 *
 * The caller MUST pass `requiredResource` — this is what the per-resource
 * gate matches against.
 */
export async function requirePrincipalAny(
  c: CommonArgs & { args: { crossDelegation?: CrossDelegationInput } & Record<string, unknown>; requiredResource: string },
): Promise<AuthContext> {
  if (!c.token) throw new AuthError('Missing delegation token', c)
  const r = await verifySessionAndExtractPrincipal(c.token, c.toolName)
  if ('error' in r) throw new AuthError(r.error, c)

  const cross = c.args.crossDelegation
  if (cross && typeof cross === 'object') {
    const v = await verifyCrossDelegation(cross, r.principal, c.requiredResource)
    if ('error' in v) throw new AuthError(v.error, c)
    if (r.jti) {
      const j = recordJtiUsage({
        jti: r.jti,
        principal: r.principal,
        delegationHash: 'cross-delegation',
        expiresAtISO: r.expiresAtISO,
        usageLimit: r.usageLimit ?? 1,
      })
      if (!j.ok) throw new AuthError(`JTI replay: ${j.reason}`, c)
    }
    const ctx: AuthContext = {
      principal: v.dataPrincipal,
      callerPrincipal: r.principal,
      via: 'cross-delegation',
      delegationHash: hashOf(cross),
    }
    writeAuditRow({ ctx, tool: c.toolName, args: c.argsForAudit, result: 'ok:cross-delegated' })
    return ctx
  }

  // No cross-delegation → direct path.
  if (r.jti) {
    const j = recordJtiUsage({
      jti: r.jti, principal: r.principal,
      delegationHash: 'direct',
      expiresAtISO: r.expiresAtISO,
      usageLimit: r.usageLimit ?? 1,
    })
    if (!j.ok) throw new AuthError(`JTI replay: ${j.reason}`, c)
  }
  const ctx: AuthContext = {
    principal: r.principal,
    callerPrincipal: r.principal,
    via: 'direct',
  }
  writeAuditRow({ ctx, tool: c.toolName, args: c.argsForAudit, result: 'ok:auth' })
  return ctx
}

/**
 * Curator-only auth (T0 writes). The caller's smart account must be in
 * config.curatorAllowlist. Sets via='curator'. Audits even though row is T0.
 */
export async function requireCurator(c: CommonArgs): Promise<AuthContext> {
  if (!c.token) throw new AuthError('Missing delegation token', c)
  const r = await verifySessionAndExtractPrincipal(c.token, c.toolName)
  if ('error' in r) throw new AuthError(r.error, c)
  if (!config.curatorAllowlist.has(r.principal.toLowerCase())) {
    throw new AuthError(`Caller ${r.principal} is not in curator allowlist`, c)
  }
  const ctx: AuthContext = {
    principal: r.principal,
    callerPrincipal: r.principal,
    via: 'curator',
  }
  writeAuditRow({ ctx, tool: c.toolName, args: c.argsForAudit, result: 'ok:curator' })
  return ctx
}

// ──────────────────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(message: string, c: CommonArgs) {
    super(message)
    this.name = 'AuthError'
    // Audit denials too (SEC G9).
    writeAuditRow({
      ctx: { principal: 'unknown', callerPrincipal: 'unknown', via: 'direct' },
      tool: c.toolName,
      args: c.argsForAudit,
      result: `denied:${message}`,
    })
  }
}

function hashOf(cross: CrossDelegationInput): string {
  // Best-effort fingerprint — caller usually has the actual delegationHash.
  // Used only for audit trail, not for security checks.
  return `0x${cross.signature.slice(2, 18)}…`
}
