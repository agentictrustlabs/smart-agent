/**
 * Audit helpers (Hardening Phase 1D — make it auditable;
 * P0-5 — outcome is hash-bound).
 *
 * Every authority-bearing decision in a2a-agent flows through this file:
 *
 *   `auditAppend(row)`     — insert a `request_received` row (request side).
 *   `auditFinalize(id, …)` — insert a `request_finalized` row (outcome side)
 *                            that hash-binds the outcome to the request via
 *                            the origin row's PK. NO UPDATE.
 *   `auditDeny(c, info)`   — insert a `request_denied` row when a request is
 *                            rejected at the auth edge. NO UPDATE.
 *
 * ─── P0-5 — Outcome binding (two-row model) ──────────────────────────
 *
 * Reviewer finding: prior to P0-5, `auditAppend` bound only the request
 * side of an action into `entry_hash`, and `auditFinalize` flipped the
 * SAME row's outcome columns via UPDATE — leaving `entry_hash`
 * unchanged. An adversary with DB write could therefore rewrite the
 * outcome (`tx_hash`, `status`, `error_reason`, …) and the chain still
 * verified.
 *
 * Fix: outcome is encoded as a NEW row, never as a mutation of an
 * existing row. The new row's `entry_hash` binds the outcome columns
 * + the origin row's PK + the prior chain head, so tampering with
 * either the request row OR the outcome row breaks the chain.
 *
 * Two-row vs dual-hash — we chose two-row because:
 *   - It preserves the existing append-only invariant the bypass guard
 *     already enforces — no UPDATE site exists, period.
 *   - The schema doesn't grow new chained-hash columns; the same
 *     `entry_hash` / `prev_entry_hash` pair covers both row kinds.
 *   - The signed-checkpoint emitter in `lib/audit-checkpoint.ts` is
 *     unchanged: it attests the chain HEAD, and both request and
 *     outcome rows sit on the same chain.
 *
 * Row-kind tag (`event_kind` column):
 *   - `request_received`  — emitted by `auditAppend`
 *   - `request_finalized` — emitted by `auditFinalize`
 *   - `request_denied`    — emitted by `auditDeny`
 *
 * Linkage: every outcome row carries `request_received_row_id` set to
 * the PK of the origin `request_received` row (when one exists; pure
 * auth-edge denials emit a `request_denied` row with NULL origin). The
 * row's hash binding includes that PK so the link is tamper-evident.
 *
 * Append-only invariant: `scripts/check-no-bypass.sh` rejects any
 * `db.update(executionAudit)` / `db.delete(executionAudit)` call site
 * ANYWHERE in the source tree (no exemption for `lib/audit.ts`). The
 * helpers here are pure INSERTs.
 *
 * Correlation IDs (Hardening §1D #1) — every row (request + outcome)
 * carries the `correlationId` that web set at the request edge and that
 * `correlation-id` middleware exposes on `c.var.correlationId`. Combined
 * with `mcpCallId` it gives bidirectional lookup between user-facing
 * actions and chain receipts; combined with `requestReceivedRowId` it
 * lets a verifier join request and outcome rows for a single action.
 */

import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { keccak256, toBytes, type Address, type Hex } from 'viem'
import { createHash } from 'node:crypto'
import { desc } from 'drizzle-orm'
import { db, sqliteHandle } from '../db'
import { executionAudit } from '../db/schema'
import { isAuditDenyReason, type AuditDenyReason } from './audit-deny-reasons'

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
  /**
   * P0-5 — two-row outcome model. Defaults to 'request_received' (the
   * normal case where a request arrives and may later be finalized).
   * `auditDeny` passes 'request_denied' for auth-edge denials.
   * `auditFinalize` writes its own 'request_finalized' rows via the
   * dedicated finalize path and does not flow through this field.
   */
  eventKind?: 'request_received' | 'request_denied'
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
 * Sprint 3 S3.1 + P0-5 — fields that participate in the entry_hash binding.
 *
 * The binding set is identical for `request_received`, `request_finalized`,
 * and `request_denied` rows. On `request_received` rows the outcome
 * fields (`status`, `txHash`, `userOpHash`, `finalizedAt`, `errorReason`)
 * carry their request-time placeholders (`pending`, null, null, null, '')
 * and `eventKind` is `'request_received'`. On outcome rows these fields
 * carry the actual terminal outcome and `eventKind` is `'request_finalized'`
 * or `'request_denied'`. The verifier hashes the same field set for every
 * row — outcome binding is naturally tamper-evident because changing any
 * field on any row (request or outcome) breaks `entry_hash`.
 *
 * `requestReceivedRowId` is included so a tampered outcome row cannot
 * be re-pointed at a different origin without breaking the chain.
 *
 * Tampering with ANY bound field on ANY row breaks the chain and
 * the next checkpoint detects it. P0-5 closes the prior gap where
 * outcome flips on the request_received row left `entry_hash` unchanged.
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
  'eventKind',
  'requestReceivedRowId',
  'executionPath',
  'toolGrantHash',
  'toolExecutor',
  'target',
  'selector',
  'callDataHash',
  'valueWei',
  'txHash',
  'userOpHash',
  'status',
  'errorReason',
  'receivedAt',
  'finalizedAt',
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

  // P0-5 — auditAppend now writes the REQUEST side of the action.
  // Terminal outcomes (`completed`/`reverted`/`denied`) called through
  // auditAppend directly are still permitted (e.g., session-revoke
  // passthroughs whose outcome is known synchronously), but in those
  // cases the row IS the terminal row — no separate finalize follows.
  // For chain-redeem paths the standard flow is:
  //   auditAppend(status='pending')      → 'request_received' row
  //   auditFinalize(rowId, terminal)     → 'request_finalized' row
  const rowForHash = {
    rootGrantHash: input.rootGrantHash || '',
    sessionId: input.sessionId,
    sessionPrincipal: input.sessionPrincipal,
    a2aTaskId: input.a2aTaskId ?? '',
    mcpServer: input.mcpServer,
    mcpTool: input.mcpTool,
    mcpCallId,
    eventType: input.eventType ?? 'execution',
    eventKind: (input.eventKind ?? 'request_received') as 'request_received' | 'request_denied',
    requestReceivedRowId: null as number | null,
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
        mcp_server, mcp_tool, mcp_call_id, event_type, event_kind,
        request_received_row_id, execution_path,
        tool_grant_hash, tool_executor, target, selector, call_data_hash,
        value_wei, tx_hash, user_op_hash, status, error_reason,
        received_at, finalized_at, correlation_id, prev_entry_hash, entry_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      rowForHash.eventKind,
      rowForHash.requestReceivedRowId,
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
 * P0-5 — insert a new `request_finalized` row whose `entry_hash` binds
 * the outcome columns (`status`, `txHash`, `userOpHash`, `finalizedAt`,
 * `errorReason`) + the origin row's PK (`requestReceivedRowId`) +
 * the prior chain head. NO UPDATE.
 *
 * The finalize row carries forward the identity fields of the origin
 * row (`sessionId`, `sessionPrincipal`, `mcpServer`, `mcpTool`,
 * `eventType`, `executionPath`, `correlationId`, `target`, `selector`,
 * `callDataHash`, `valueWei`, `toolGrantHash`, `toolExecutor`,
 * `rootGrantHash`, `a2aTaskId`) so a verifier can join the rows on
 * `requestReceivedRowId` AND on `correlationId` AND see consistent
 * identity context on each side.
 *
 * The synthetic `mcpCallId` is `<origin.mcpCallId>:finalized` so the
 * unique constraint never collides with the origin row's id and the
 * pairing is grep-able. If `auditFinalize` is called twice for the same
 * origin (which should not happen, but is defensively considered) the
 * second call hits the UNIQUE constraint and throws — surfacing the
 * bug rather than silently inserting a duplicate outcome.
 */
export async function auditFinalize(rowId: number, input: AuditFinalizeInput): Promise<void> {
  const finalizedAt = new Date().toISOString()

  const tx = sqliteHandle.transaction((): void => {
    // Fetch origin row inside the transaction for a consistent snapshot.
    const origin = sqliteHandle
      .prepare(
        `SELECT id, root_grant_hash, session_id, session_principal, a2a_task_id,
                mcp_server, mcp_tool, mcp_call_id, event_type, execution_path,
                tool_grant_hash, tool_executor, target, selector, call_data_hash,
                value_wei, correlation_id
           FROM execution_audit
          WHERE id = ?`,
      )
      .get(rowId) as
      | {
          id: number
          root_grant_hash: string
          session_id: string
          session_principal: string
          a2a_task_id: string
          mcp_server: string
          mcp_tool: string
          mcp_call_id: string
          event_type: string | null
          execution_path: string
          tool_grant_hash: string | null
          tool_executor: string | null
          target: string | null
          selector: string | null
          call_data_hash: string | null
          value_wei: string
          correlation_id: string | null
        }
      | undefined

    if (!origin) {
      throw new Error(`[auditFinalize] origin row id=${rowId} not found`)
    }

    const headRow = sqliteHandle
      .prepare(`SELECT id, entry_hash FROM execution_audit ORDER BY id DESC LIMIT 1`)
      .get() as { id: number; entry_hash: string | null } | undefined
    const prevEntryHash = headRow?.entry_hash ?? null

    const rowForHash = {
      rootGrantHash: origin.root_grant_hash,
      sessionId: origin.session_id,
      sessionPrincipal: origin.session_principal,
      a2aTaskId: origin.a2a_task_id,
      mcpServer: origin.mcp_server,
      mcpTool: origin.mcp_tool,
      mcpCallId: `${origin.mcp_call_id}:finalized`,
      eventType: origin.event_type ?? 'execution',
      eventKind: 'request_finalized' as const,
      requestReceivedRowId: origin.id,
      executionPath: origin.execution_path,
      toolGrantHash: origin.tool_grant_hash,
      toolExecutor: origin.tool_executor,
      target: origin.target,
      selector: origin.selector,
      callDataHash: origin.call_data_hash,
      valueWei: origin.value_wei,
      txHash: input.txHash ?? null,
      userOpHash: input.userOpHash ?? null,
      status: input.status,
      errorReason: input.errorReason ?? '',
      receivedAt: finalizedAt,
      finalizedAt,
      correlationId: origin.correlation_id,
    }

    const entryHash = computeEntryHash(rowForHash, prevEntryHash)
    const stmt = sqliteHandle.prepare(`
      INSERT INTO execution_audit (
        root_grant_hash, session_id, session_principal, a2a_task_id,
        mcp_server, mcp_tool, mcp_call_id, event_type, event_kind,
        request_received_row_id, execution_path,
        tool_grant_hash, tool_executor, target, selector, call_data_hash,
        value_wei, tx_hash, user_op_hash, status, error_reason,
        received_at, finalized_at, correlation_id, prev_entry_hash, entry_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      rowForHash.rootGrantHash,
      rowForHash.sessionId,
      rowForHash.sessionPrincipal,
      rowForHash.a2aTaskId,
      rowForHash.mcpServer,
      rowForHash.mcpTool,
      rowForHash.mcpCallId,
      rowForHash.eventType,
      rowForHash.eventKind,
      rowForHash.requestReceivedRowId,
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
  })

  await Promise.resolve(tx())
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
      // P0-5 — auth-edge denials emit `request_denied` rows. These are
      // terminal in themselves (no prior `request_received` row exists
      // for an auth-edge rejection) and the outcome is bound into the
      // entry_hash via `status='denied'` + `errorReason`.
      eventKind: 'request_denied',
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

// ────────────────────────────────────────────────────────────────────
// P0-4 — denyAndAudit: single failure exit for high-risk routes.
// ────────────────────────────────────────────────────────────────────
//
// Reviewer finding (Sprint 5 Wave 2 P0-4):
//   Across the four redeem variants and the deploy-agent route, several
//   early-exit deny branches (validation failures, policy rejects,
//   missing-session, missing-fields, unparseable bodies, …) returned
//   4xx/5xx WITHOUT writing a `request_denied` audit row. A senior
//   security firm walking the chain saw `request_received` rows with
//   no terminal — gaps were indistinguishable from open requests.
//
// Fix:
//   Every 4xx/5xx exit from the routes in scope now goes through
//   `denyAndAudit(c, { reason, status, … })`. The helper writes a
//   `request_denied` audit row (hash-chained, binding the reason +
//   status + correlationId) and returns the HTTP response in one
//   call. The bypass guard (`scripts/check-no-bypass.sh`) enforces
//   that no other 4xx/5xx exit pattern survives in these files.
//
// Special case — `skipAudit: true`:
//   The on-chain tx-reverted branches (`502 'tx reverted'`) already
//   wrote a `request_finalized(status=reverted)` row via
//   `auditFinalize`. Calling `denyAndAudit` with `skipAudit: true`
//   produces the HTTP response WITHOUT writing a duplicate audit
//   row, while keeping the route's failure surface uniform behind a
//   single helper. This preserves the static "only denyAndAudit may
//   produce a 4xx/5xx" invariant without double-counting outcomes.
//
//   Important: `skipAudit` is the ONLY way to take a 4xx/5xx exit
//   without writing a deny row. Reaching for it must be paired with
//   a prior outcome-row write (auditFinalize) at the same call site
//   — a reviewer can grep for `skipAudit` to enumerate every
//   exemption.
//
// The reason vocabulary lives in `./audit-deny-reasons.ts`. Adding a
// new reason is a single-file change; the helper validates the
// reason at call time so a typo trips TypeScript in CI.

export interface DenyAndAuditParams {
  /** Stable kebab-cased reason; must be a member of AUDIT_DENY_REASONS. */
  reason: AuditDenyReason
  /** HTTP status for the response (4xx/5xx). */
  status: ContentfulStatusCode
  /** User-safe message returned in the JSON body. Defaults to the reason. */
  publicMessage?: string
  /** Route family / mcpTool tag for the audit row (e.g. '/session/:id/redeem-tx'). */
  route: string
  /** Service that called us, when known (e.g. 'org-mcp'). */
  mcpServer?: string
  /** Session id when known (extracted from the path param). */
  sessionId?: string
  /** Session principal address when known. */
  sessionPrincipal?: string
  /** Target contract when known. */
  target?: string
  /** 4-byte function selector when known. */
  selector?: string
  /** mcpCallId from the body when known. */
  mcpCallId?: string
  /** Optional executionPath classification for the audit row. */
  executionPath?: AuditExecutionPath
  /**
   * When `true`, skip the audit-row write — the caller has already
   * emitted a terminal outcome row (`request_finalized`) via
   * `auditFinalize`, and this call is only the HTTP-status pairing.
   * Used by the on-chain tx-reverted branches; see the file-level
   * note above.
   */
  skipAudit?: true
  /**
   * Extra context to append (under a separate key) into the JSON
   * response body. Useful for surfacing `txHash` / `executionReceiptId`
   * on tx-revert pairings. Not persisted to the audit row.
   */
  extra?: Record<string, unknown>
}

/**
 * Single failure exit for the high-risk redeem + deploy-agent routes.
 * See the long comment above for the contract.
 */
export async function denyAndAudit(
  c: Context,
  params: DenyAndAuditParams,
): Promise<Response> {
  // Defense-in-depth: assert the reason is on the approved list.
  // TypeScript already enforces this at compile time, but a hot patch
  // or `as` cast could slip past — log and proceed so we never block
  // the deny path that the caller is trying to return.
  if (!isAuditDenyReason(params.reason)) {
    console.warn('[denyAndAudit] reason not in AUDIT_DENY_REASONS:', params.reason)
  }

  if (!params.skipAudit) {
    await auditDeny(c, {
      route: params.route,
      reason: params.reason,
      executionPath: params.executionPath ?? 'stateless-redeem',
      mcpServer: params.mcpServer,
      sessionId: params.sessionId,
      sessionPrincipal: params.sessionPrincipal,
      target: params.target,
      selector: params.selector,
      mcpCallId: params.mcpCallId,
    })
  }

  const body: Record<string, unknown> = {
    error: params.publicMessage ?? params.reason,
    reason: params.reason,
  }
  if (params.extra) {
    for (const [k, v] of Object.entries(params.extra)) body[k] = v
  }
  return c.json(body, params.status)
}
