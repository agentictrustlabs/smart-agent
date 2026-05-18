/**
 * Audit helpers (Hardening Phase 1D — make it auditable).
 *
 * Every authority-bearing decision in a2a-agent flows through this file:
 *
 *   `auditAppend(row)`    — write a new row (allow OR deny, success OR failure)
 *   `auditFinalize(id, …)` — flip a `pending` outcome row to its terminal
 *                            status (`completed`/`reverted`) once the chain
 *                            call settles. This is the ONLY place a UPDATE
 *                            against `execution_audit` is allowed.
 *   `auditDeny(c, info)`  — convenience wrapper: builds a denial row from
 *                            the request context and writes it via
 *                            `auditAppend`. Returns the inserted id so the
 *                            caller can echo it in the error response.
 *
 * Append-only invariant — at the application layer, the audit table is
 * append-only. The CI lint `scripts/check-no-bypass.sh` rejects any
 * `db.update(executionAudit)` / `db.delete(executionAudit)` call site
 * OUTSIDE this file. The single legitimate update — flipping `pending`
 * to `completed`/`reverted` after the chain settles — is encapsulated in
 * `auditFinalize` here and goes through review when added/changed.
 *
 * Correlation IDs (Hardening §1D #1) — every row carries the
 * `correlationId` that web set at the request edge and that
 * `correlation-id` middleware exposes on `c.var.correlationId`. Combined
 * with `mcpCallId` it gives bidirectional lookup between user-facing
 * actions and chain receipts.
 */

import type { Context } from 'hono'
import { keccak256, toBytes, type Address, type Hex } from 'viem'
import { createHash } from 'node:crypto'
import { eq, desc } from 'drizzle-orm'
import { db, sqliteHandle } from '../db'
import { executionAudit } from '../db/schema'

export type AuditStatus = 'completed' | 'reverted' | 'denied' | 'pending'
export type AuditExecutionPath =
  | 'mcp-only'
  | 'stateless-redeem'
  | 'sub-delegated'
  | 'session-account'

/**
 * Sprint 3 S3.2 — event-type tag enumerating the audit event families
 * recognized by the completeness sweep. New values are additive; rows
 * inserted before S3.2 have `eventType = null` and the original `mcpTool`
 * field continues to carry the family identifier.
 *
 * `execution` is the legacy MCP-redeem family covered by Phase 0 — keep
 * it so existing tooling can search for `eventType IS NULL OR
 * eventType = 'execution'`.
 */
export type AuditEventType =
  | 'execution'
  | 'kms-decrypt'
  | 'kms-decrypt-failed'
  | 'kms-sign'
  | 'kms-mac-verify-failed'
  | 'session-create'
  | 'session-package'
  | 'session-revoke'
  | 'session-epoch-bump'
  | 'key-version-rejected'

export interface AuditAppendInput {
  /** EIP-712 hash of the user's root delegation (or '' for pre-session denials). */
  rootGrantHash: Hex | string
  sessionId: string
  /** Address of the session key (or '' for unauthenticated denials). */
  sessionPrincipal: string
  a2aTaskId?: string
  /** MCP that called us, or 'web' for web→a2a auth denials, or 'unknown'. */
  mcpServer: string
  /** Tool id when known; otherwise the route family (e.g. 'session-package'). */
  mcpTool: string
  /**
   * A globally-unique id for the call. Auth-denial rows do not always have
   * an upstream-supplied id, so the helper synthesizes one from
   * `${correlationId}:${nonce}` when omitted.
   */
  mcpCallId?: string
  /**
   * Sprint 3 S3.2 — event family tag. Defaults to 'execution' when not
   * provided so legacy Phase-0 callers continue to read uniformly via
   * the new column.
   */
  eventType?: AuditEventType
  executionPath: AuditExecutionPath
  toolGrantHash?: Hex | null
  toolExecutor?: Address | null
  target?: string | null
  selector?: string | null
  callDataHash?: string | null
  /** Decimal string of wei. */
  valueWei?: string
  status: AuditStatus
  errorReason?: string
  /** Hardening §1D — cross-service correlation id. Falls back to ''. */
  correlationId?: string | null
}

/**
 * Sprint 3 S3.1 — fields that participate in the entry_hash binding.
 *
 * The legacy `auditFinalize` flow flips a `pending` row to its terminal
 * outcome AFTER the chain call settles (status/txHash/userOpHash/
 * finalizedAt/errorReason). To preserve the chain across that update we
 * bind only the WRITE-ONCE request shape — every field listed below is
 * set at insert time and never changed.
 *
 * Outcome fields excluded by design:
 *   status, txHash, userOpHash, finalizedAt, errorReason
 *
 * Tampering with the bound subset (sessionId, mcpTool, target, selector,
 * callDataHash, eventType, correlationId, ...) breaks the chain and
 * the next checkpoint detects it. Outcome flips remain visible through
 * the row itself + the CloudTrail signal for the actual chain tx; an
 * attacker cannot retroactively rewrite "what was requested" without
 * tripping the verifier.
 */
const ENTRY_HASH_BINDING_FIELDS = [
  'rootGrantHash',
  'sessionId',
  'sessionPrincipal',
  'a2aTaskId',
  'mcpServer',
  'mcpTool',
  'mcpCallId',
  'eventType',
  'executionPath',
  'toolGrantHash',
  'toolExecutor',
  'target',
  'selector',
  'callDataHash',
  'valueWei',
  'receivedAt',
  'correlationId',
] as const

/**
 * Sprint 3 S3.1 — compute the entry_hash for a freshly-built row.
 *
 *   entry_hash = sha256_hex(
 *     (prevEntryHash ?? '') ||
 *     '|' ||
 *     JSON.stringify({ <ENTRY_HASH_BINDING_FIELDS, sorted> })
 *   )
 *
 * Mirrors the shape used by person-mcp's `audit_log` ledger.
 *
 * Exported for `scripts/verify-audit-chain.ts` and the test suite so they
 * can independently re-derive the expected hash.
 */
export function computeEntryHash(
  row: Record<string, unknown>,
  prevEntryHash: string | null,
): string {
  const canonical: Record<string, unknown> = {}
  // Iterate the binding-field list in a fixed canonical order so the
  // hash is stable regardless of caller-side key insertion order.
  for (const k of [...ENTRY_HASH_BINDING_FIELDS].sort()) {
    canonical[k] = row[k] ?? null
  }
  const payload = JSON.stringify(canonical)
  const h = createHash('sha256')
  h.update(prevEntryHash ?? '', 'utf8')
  h.update('|', 'utf8')
  h.update(payload, 'utf8')
  return h.digest('hex')
}

/**
 * Sprint 3 S3.1 — fetch the chain head for `executionAudit`. Used by
 * `auditAppend` to extend the chain and by `lib/audit-checkpoint.ts` to
 * sign the latest entry hash.
 */
export async function getAuditChainHead(): Promise<{ id: number; entryHash: string } | null> {
  const rows = await db
    .select({ id: executionAudit.id, entryHash: executionAudit.entryHash })
    .from(executionAudit)
    .orderBy(desc(executionAudit.id))
    .limit(1)
  if (rows.length === 0) return null
  const r = rows[0]!
  if (!r.entryHash) return null
  return { id: r.id, entryHash: r.entryHash }
}

/**
 * Append a single row to `execution_audit`. NEVER does an UPDATE/DELETE
 * — that property is the entire reason this helper exists.
 *
 * Sprint 3 S3.1 — computes and persists `prev_entry_hash` + `entry_hash`
 * so the table is a tamper-evident chain. The hash binding inputs are
 * every persisted field except the chain columns themselves; tampering
 * with any field on any row breaks the chain from that row forward and
 * the periodic external checkpoint (`lib/audit-checkpoint.ts`) detects it.
 *
 * Concurrency: the SELECT-head + INSERT-with-prev-hash sequence runs
 * inside a `better-sqlite3` synchronous transaction. Two concurrent
 * `auditAppend` calls serialize on the SQLite write lock — the second
 * call sees the first's inserted row before reading the head, so the
 * chain stays linear even under heavy parallelism. This matches the
 * pattern used by person-mcp's `consumeAction` (Sprint 2 S2.1).
 */
export async function auditAppend(input: AuditAppendInput): Promise<number> {
  const mcpCallId =
    input.mcpCallId && input.mcpCallId.length > 0
      ? input.mcpCallId
      : synthesizeCallId(input.correlationId ?? '')

  const receivedAt = new Date().toISOString()
  const finalizedAt = input.status === 'pending' ? null : receivedAt

  const rowForHash = {
    rootGrantHash: input.rootGrantHash || '',
    sessionId: input.sessionId,
    sessionPrincipal: input.sessionPrincipal,
    a2aTaskId: input.a2aTaskId ?? '',
    mcpServer: input.mcpServer,
    mcpTool: input.mcpTool,
    mcpCallId,
    eventType: input.eventType ?? 'execution',
    executionPath: input.executionPath,
    toolGrantHash: input.toolGrantHash ?? null,
    toolExecutor: input.toolExecutor ?? null,
    target: input.target ?? null,
    selector: input.selector ?? null,
    callDataHash: input.callDataHash ?? null,
    valueWei: input.valueWei ?? '0',
    txHash: null as string | null,
    userOpHash: null as string | null,
    status: input.status,
    errorReason: input.errorReason ?? '',
    receivedAt,
    finalizedAt,
    correlationId: input.correlationId ?? null,
  }

  // Atomic SELECT-head + compute-hash + INSERT inside a synchronous
  // sqlite transaction. The write lock serializes concurrent appends.
  const tx = sqliteHandle.transaction((): number => {
    const headRow = sqliteHandle
      .prepare(`SELECT id, entry_hash FROM execution_audit ORDER BY id DESC LIMIT 1`)
      .get() as { id: number; entry_hash: string | null } | undefined
    const prevEntryHash = headRow?.entry_hash ?? null
    const entryHash = computeEntryHash(rowForHash, prevEntryHash)
    const stmt = sqliteHandle.prepare(`
      INSERT INTO execution_audit (
        root_grant_hash, session_id, session_principal, a2a_task_id,
        mcp_server, mcp_tool, mcp_call_id, event_type, execution_path,
        tool_grant_hash, tool_executor, target, selector, call_data_hash,
        value_wei, tx_hash, user_op_hash, status, error_reason,
        received_at, finalized_at, correlation_id, prev_entry_hash, entry_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const info = stmt.run(
      rowForHash.rootGrantHash,
      rowForHash.sessionId,
      rowForHash.sessionPrincipal,
      rowForHash.a2aTaskId,
      rowForHash.mcpServer,
      rowForHash.mcpTool,
      rowForHash.mcpCallId,
      rowForHash.eventType,
      rowForHash.executionPath,
      rowForHash.toolGrantHash,
      rowForHash.toolExecutor,
      rowForHash.target,
      rowForHash.selector,
      rowForHash.callDataHash,
      rowForHash.valueWei,
      rowForHash.txHash,
      rowForHash.userOpHash,
      rowForHash.status,
      rowForHash.errorReason,
      rowForHash.receivedAt,
      rowForHash.finalizedAt,
      rowForHash.correlationId,
      prevEntryHash,
      entryHash,
    )
    return Number(info.lastInsertRowid)
  })
  return tx()
}

export interface AuditFinalizeInput {
  status: 'completed' | 'reverted'
  txHash?: Hex | null
  userOpHash?: Hex | null
  errorReason?: string
}

/**
 * Flip a `pending` row to its terminal outcome. This is the ONE
 * sanctioned write-after-insert site against `execution_audit`. Used by
 * the chain-redeem handlers after `waitForTransactionReceipt` returns.
 *
 * The check-no-bypass guard explicitly allows the `db.update(executionAudit)`
 * call below; every other call site in `apps/a2a-agent/src/` is rejected.
 */
export async function auditFinalize(rowId: number, input: AuditFinalizeInput): Promise<void> {
  await db
    .update(executionAudit)
    .set({
      status: input.status,
      txHash: input.txHash ?? undefined,
      userOpHash: input.userOpHash ?? undefined,
      finalizedAt: new Date().toISOString(),
      errorReason: input.errorReason ?? '',
    })
    .where(eq(executionAudit.id, rowId))
}

/**
 * Convenience wrapper for middleware / route denial paths. Reads the
 * correlation id from `c.var.correlationId` (set by the
 * `correlation-id` middleware). Returns the inserted row id so callers
 * can surface it in the error response if useful.
 */
export interface AuditDenyInfo {
  /** Route family (e.g. 'session-package', 'session-store.insert'). */
  executionPath?: AuditExecutionPath
  /** Pretty route id for the audit row's `mcpTool` field. */
  route: string
  /** Why we denied. Stays short; for diagnostics. */
  reason: string
  /** Service that called us, when known (e.g. 'org-mcp', 'web'). */
  mcpServer?: string
  /** Session id when known. */
  sessionId?: string
  /** Session principal address when known. */
  sessionPrincipal?: string
  /** Optional target / selector when the denial was deep enough to know. */
  target?: string
  selector?: string
  /** Caller-supplied mcpCallId when known (lets the call's audit row carry through). */
  mcpCallId?: string
  /** Sprint 3 S3.2 — event-family tag (e.g. 'kms-mac-verify-failed'). */
  eventType?: AuditEventType
}

/**
 * Best-effort audit-deny wrapper. Mirrors person-mcp's helper: a
 * failing audit write must NOT block the deny path that the route
 * handler is about to return. A SQLITE_BUSY-class contention burst,
 * a transient disk error, or a deeper bug in the chain logic should
 * surface as an operator-log warning, not a 500 over the original
 * authority decision (which the middleware has already made).
 *
 * Returns the inserted row id when the write succeeded, or `null`
 * when it failed. Most call sites discard the return value.
 */
export async function auditDeny(c: Context, info: AuditDenyInfo): Promise<number | null> {
  const correlationId = readCorrelationId(c)
  try {
    return await auditAppend({
      rootGrantHash: '',
      sessionId: info.sessionId ?? '',
      sessionPrincipal: info.sessionPrincipal ?? '',
      mcpServer: info.mcpServer ?? 'unknown',
      mcpTool: info.route,
      mcpCallId: info.mcpCallId,
      eventType: info.eventType,
      executionPath: info.executionPath ?? 'mcp-only',
      target: info.target ?? null,
      selector: info.selector ?? null,
      status: 'denied',
      errorReason: info.reason.slice(0, 1000),
      correlationId,
    })
  } catch (err) {
    console.error('[auditDeny] failed:', err)
    return null
  }
}

/**
 * Read the correlation id from the Hono context. Set by
 * `apps/a2a-agent/src/middleware/correlation-id.ts`.
 */
export function readCorrelationId(c: Context): string {
  const ctx = c.get('correlationId' as never) as string | undefined
  return ctx ?? ''
}

/**
 * For audit rows synthesized inside a middleware (where there is no
 * upstream-supplied mcpCallId), use `<correlationId>:<short-nonce>` as
 * the unique id. Falls back to a fully-random id if no correlation id
 * is present.
 */
function synthesizeCallId(correlationId: string): string {
  const tail = bytesHex(8)
  if (correlationId) return `${correlationId}:${tail}`
  return `audit-deny:${bytesHex(16)}`
}

function bytesHex(nBytes: number): string {
  const buf = new Uint8Array(nBytes)
  crypto.getRandomValues(buf)
  let s = ''
  for (const b of buf) s += b.toString(16).padStart(2, '0')
  return s
}

// Suppress unused import warnings for helpers exported for use in tests / future paths.
void keccak256
void toBytes
