#!/usr/bin/env tsx
/**
 * `pnpm exec tsx scripts/verify-audit-chain.ts` — Sprint 3 S3.1 verifier.
 *
 * Walks the `execution_audit` table from the genesis row forward,
 * recomputes every row's `entry_hash` from the bound fields + the
 * previous row's hash, and asserts every chain link agrees with what
 * SQLite has on disk. Then walks `audit_checkpoint` and verifies each
 * row's signature recovers to the configured master signer's address.
 *
 * Operator-facing outputs:
 *   - Per-mismatch line (broken chain at row id, expected vs got)
 *   - Per-checkpoint line (id, timestamp, signer match Y/N)
 *   - Final summary: total rows verified, total checkpoints verified,
 *     chain status (intact / broken at row N), most-recent checkpoint
 *
 * Exit code:
 *   - 0  if the chain is intact AND every checkpoint signature verifies
 *   - 1  on any tamper detection or signature mismatch
 *
 * Run from the a2a-agent working directory so the SQLite file
 * (`local.db`) resolves correctly, OR pass `--db <path>` to point at a
 * different copy (e.g. a snapshot copied off a production instance).
 *
 *   cd apps/a2a-agent && pnpm exec tsx ../../scripts/verify-audit-chain.ts
 *   pnpm exec tsx scripts/verify-audit-chain.ts --db /tmp/snapshot.db
 *
 * This script is deliberately READ-ONLY against the DB; it never opens
 * the agent's running write handle.
 */

import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { recoverMessageAddress, keccak256, concat, toBytes } from 'viem'

// ─── Re-implementations of the audit hashing primitives ─────────────
//
// We deliberately re-implement `computeEntryHash` + `buildCheckpointDigest`
// here rather than importing them from `apps/a2a-agent/src/lib/audit{,
// -checkpoint}.ts`. Importing those modules drags in the agent's
// `config.ts`, which throws if env is unset — the verifier MUST be
// able to run against a copied DB snapshot without the agent's env.
//
// Both functions MUST stay byte-identical with their canonical
// implementations in `apps/a2a-agent/src/lib/audit.ts` +
// `apps/a2a-agent/src/lib/audit-checkpoint.ts`. The unit tests
// (`apps/a2a-agent/test/audit-completeness.test.ts` +
// `audit-checkpoint.test.ts`) drive both call sites end-to-end so any
// drift trips a test.

// Mirrors `apps/a2a-agent/src/lib/audit.ts::ENTRY_HASH_BINDING_FIELDS`.
// P0-5 — extended to bind outcome columns (status, txHash, userOpHash,
// errorReason, finalizedAt), the row-kind tag (eventKind), and the
// origin-row link (requestReceivedRowId). Pre-P0-5 rows are skipped at
// the chain walk (they have NULL prev/entry hash).
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

function computeEntryHash(
  row: Record<string, unknown>,
  prevEntryHash: string | null,
): string {
  const canonical: Record<string, unknown> = {}
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

const CHECKPOINT_DOMAIN_TAG = 'sa:audit-checkpoint:v1'

function buildCheckpointDigest(input: {
  latestEntryHash: string
  timestamp: string
  chainId: number
}): `0x${string}` {
  const tag = toBytes(CHECKPOINT_DOMAIN_TAG)
  const hash = toBytes(input.latestEntryHash)
  const ts = toBytes(input.timestamp)
  const cid = toBytes(String(input.chainId))
  return keccak256(concat([tag, hash, ts, cid]))
}

type ServiceTag = 'a2a-agent' | 'person-mcp'

interface CliArgs {
  service: ServiceTag
  dbPath: string
  expectedSigner?: string
}

/**
 * Default DB path per service. The CLI is happy with either:
 *   --service a2a-agent   → apps/a2a-agent/local.db (executionAudit + audit_checkpoint)
 *   --service person-mcp  → apps/person-mcp/person-mcp.db (audit_log + audit_checkpoint)
 *
 * Operator can always override with `--db <path>` when running against a
 * snapshot copy of the production DB.
 */
function defaultDbPath(service: ServiceTag): string {
  if (service === 'person-mcp') {
    return resolve(process.cwd(), 'apps/person-mcp/person-mcp.db')
  }
  return resolve(process.cwd(), 'apps/a2a-agent/local.db')
}

function parseArgs(): CliArgs {
  let service: ServiceTag = 'a2a-agent'
  let dbPath: string | undefined
  let expectedSigner: string | undefined
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === '--db' && i + 1 < process.argv.length) {
      dbPath = resolve(process.argv[++i]!)
    } else if (a === '--signer' && i + 1 < process.argv.length) {
      expectedSigner = process.argv[++i]!.toLowerCase()
    } else if (a === '--service' && i + 1 < process.argv.length) {
      const raw = process.argv[++i]!
      if (raw !== 'a2a-agent' && raw !== 'person-mcp') {
        console.error(`[verify-audit-chain] unknown --service value: ${raw}`)
        process.exit(2)
      }
      service = raw
    } else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: verify-audit-chain.ts [--service a2a-agent|person-mcp] [--db <path>] [--signer <0x-address>]\n' +
          '\n' +
          'Defaults:\n' +
          '  --service a2a-agent\n' +
          '  --db      apps/a2a-agent/local.db   (a2a-agent)\n' +
          '            apps/person-mcp/person-mcp.db (person-mcp)\n',
      )
      process.exit(0)
    }
  }
  return { service, dbPath: dbPath ?? defaultDbPath(service), expectedSigner }
}

interface AuditRow {
  id: number
  root_grant_hash: string
  session_id: string
  session_principal: string
  a2a_task_id: string
  mcp_server: string
  mcp_tool: string
  mcp_call_id: string
  event_type: string | null
  event_kind: string | null
  request_received_row_id: number | null
  execution_path: string
  tool_grant_hash: string | null
  tool_executor: string | null
  target: string | null
  selector: string | null
  call_data_hash: string | null
  value_wei: string
  tx_hash: string | null
  user_op_hash: string | null
  status: string
  error_reason: string
  received_at: string
  finalized_at: string | null
  correlation_id: string | null
  prev_entry_hash: string | null
  entry_hash: string | null
}

function rowToHashFields(r: AuditRow): Record<string, unknown> {
  return {
    rootGrantHash: r.root_grant_hash,
    sessionId: r.session_id,
    sessionPrincipal: r.session_principal,
    a2aTaskId: r.a2a_task_id,
    mcpServer: r.mcp_server,
    mcpTool: r.mcp_tool,
    mcpCallId: r.mcp_call_id,
    eventType: r.event_type ?? 'execution',
    eventKind: r.event_kind,
    requestReceivedRowId: r.request_received_row_id,
    executionPath: r.execution_path,
    toolGrantHash: r.tool_grant_hash,
    toolExecutor: r.tool_executor,
    target: r.target,
    selector: r.selector,
    callDataHash: r.call_data_hash,
    valueWei: r.value_wei,
    txHash: r.tx_hash,
    userOpHash: r.user_op_hash,
    status: r.status,
    errorReason: r.error_reason,
    receivedAt: r.received_at,
    finalizedAt: r.finalized_at,
    correlationId: r.correlation_id,
  }
}

interface CheckpointRow {
  id: number
  latest_entry_id: number
  latest_entry_hash: string
  timestamp: string
  chain_id: number
  signature: string
  signer_address: string
  sink_status: string
  sink_attempts: number
}

/**
 * Walk `execution_audit` from the oldest hash-chained row forward.
 * Returns a human-readable description of the break point on failure,
 * `null` on intact.
 */
function verifyA2aChain(sqlite: Database.Database): string | null {
  const auditRows = sqlite
    .prepare(`SELECT * FROM execution_audit ORDER BY id ASC`)
    .all() as AuditRow[]
  console.log(`[verify-audit-chain] scanning ${auditRows.length} a2a-agent audit rows`)

  let brokenAt: number | null = null
  let prevEntryHash: string | null = null
  let chainStartId: number | null = null
  let rowsVerified = 0

  for (const r of auditRows) {
    if (r.prev_entry_hash === null && r.entry_hash === null) {
      // pre-S3 row; skip
      continue
    }
    if (chainStartId === null) chainStartId = r.id

    if (r.prev_entry_hash !== prevEntryHash) {
      console.error(
        `[verify-audit-chain] row ${r.id}: prev_entry_hash mismatch — stored=${r.prev_entry_hash} expected=${prevEntryHash}`,
      )
      brokenAt = r.id
      break
    }

    const expected = computeEntryHash(rowToHashFields(r), prevEntryHash)
    if (r.entry_hash !== expected) {
      console.error(
        `[verify-audit-chain] row ${r.id}: entry_hash mismatch — stored=${r.entry_hash} expected=${expected}`,
      )
      brokenAt = r.id
      break
    }

    prevEntryHash = r.entry_hash
    rowsVerified++
  }

  if (brokenAt === null) {
    console.log(
      `[verify-audit-chain] a2a-agent chain INTACT — ${rowsVerified} rows verified (starting at id=${chainStartId ?? 'n/a'})`,
    )
    return null
  }
  console.error(`[verify-audit-chain] a2a-agent chain BROKEN at row id=${brokenAt}`)
  return `row id=${brokenAt}`
}

// ─── person-mcp audit_log chain re-implementation ───────────────────
//
// Person-mcp's `audit_log` ledger is keyed per `smart_account_address`
// (each account has its own chain). Hash format (see
// `apps/person-mcp/src/session-store/index.ts::computeEntryHash`):
//
//   sha256(
//     String(ts.getTime()) || '|' || account || '|' || sessionId || '|' ||
//     grantHash || '|' || actionId || '|' || actionType || '|' ||
//     actionHash || '|' || decision || '|' || (reason ?? '') || '|' ||
//     (audience ?? '') || '|' || (verifier ?? '') || '|' ||
//     (prevEntryHash ?? '')
//   )

interface PersonAuditRow {
  seq: number
  ts_ms: number
  smart_account_address: string
  session_id: string
  grant_hash: string
  action_id: string
  action_type: string
  action_hash: string
  decision: string
  reason: string | null
  audience: string | null
  verifier: string | null
  prev_entry_hash: string | null
  entry_hash: string
}

function computePersonEntryHash(
  r: PersonAuditRow,
  prevEntryHash: string | null,
): string {
  const h = createHash('sha256')
  const join = (s: string) => {
    h.update(s)
    h.update('|')
  }
  join(String(r.ts_ms))
  join(r.smart_account_address.toLowerCase())
  join(r.session_id)
  join(r.grant_hash)
  join(r.action_id)
  join(r.action_type)
  join(r.action_hash)
  join(r.decision)
  join(r.reason ?? '')
  join(r.audience ?? '')
  join(r.verifier ?? '')
  h.update(prevEntryHash ?? '')
  return h.digest('hex')
}

/**
 * Walk every per-account chain in `audit_log` and verify each row's
 * `entry_hash` against its recomputed value and its `prev_entry_hash`
 * pointer against the previous row's stored hash.
 */
function verifyPersonChain(sqlite: Database.Database): {
  rowsVerified: number
  brokenAt: { account: string; seq: number } | null
  accountsScanned: number
} {
  const rows = sqlite
    .prepare(
      `SELECT seq, ts_ms, smart_account_address, session_id, grant_hash,
              action_id, action_type, action_hash, decision,
              reason, audience, verifier, prev_entry_hash, entry_hash
         FROM audit_log
        ORDER BY smart_account_address ASC, seq ASC`,
    )
    .all() as PersonAuditRow[]

  let rowsVerified = 0
  let currentAccount: string | null = null
  let prevEntryHash: string | null = null
  const accounts = new Set<string>()
  let brokenAt: { account: string; seq: number } | null = null

  for (const r of rows) {
    accounts.add(r.smart_account_address)
    if (currentAccount !== r.smart_account_address) {
      currentAccount = r.smart_account_address
      prevEntryHash = null
    }
    if (r.prev_entry_hash !== prevEntryHash) {
      console.error(
        `[verify-audit-chain] account=${r.smart_account_address} seq=${r.seq}: prev_entry_hash mismatch — stored=${r.prev_entry_hash} expected=${prevEntryHash}`,
      )
      brokenAt = { account: r.smart_account_address, seq: r.seq }
      break
    }
    const expected = computePersonEntryHash(r, prevEntryHash)
    if (r.entry_hash !== expected) {
      console.error(
        `[verify-audit-chain] account=${r.smart_account_address} seq=${r.seq}: entry_hash mismatch — stored=${r.entry_hash} expected=${expected}`,
      )
      brokenAt = { account: r.smart_account_address, seq: r.seq }
      break
    }
    prevEntryHash = r.entry_hash
    rowsVerified++
  }
  return { rowsVerified, brokenAt, accountsScanned: accounts.size }
}

async function main(): Promise<void> {
  const { service, dbPath, expectedSigner } = parseArgs()
  console.log(`[verify-audit-chain] service: ${service}`)
  console.log(`[verify-audit-chain] DB: ${dbPath}`)

  const sqlite = new Database(dbPath, { readonly: true })

  let chainBrokenAt: string | null = null
  if (service === 'a2a-agent') {
    chainBrokenAt = verifyA2aChain(sqlite)
  } else {
    const personResult = verifyPersonChain(sqlite)
    if (personResult.brokenAt) {
      chainBrokenAt = `account=${personResult.brokenAt.account} seq=${personResult.brokenAt.seq}`
      console.error(`[verify-audit-chain] person-mcp chain BROKEN at ${chainBrokenAt}`)
    } else {
      console.log(
        `[verify-audit-chain] person-mcp chain INTACT — ${personResult.rowsVerified} rows verified across ${personResult.accountsScanned} accounts`,
      )
    }
  }

  // ─── Verify audit_checkpoint signatures ────────────────────────────
  // a2a-agent's `audit_checkpoint` table has no `service` column (the
  // every-row-is-a2a-agent invariant is implicit). Person-mcp's table
  // adds the column (Sprint 4 A.3) so a single sink can join rows from
  // both streams. Probe via PRAGMA so the same CLI can read either DB.
  const cpCols = sqlite
    .prepare(`PRAGMA table_info(audit_checkpoint)`)
    .all() as Array<{ name: string }>
  const hasServiceColumn = cpCols.some((c) => c.name === 'service')
  let cpRows: CheckpointRow[]
  if (service === 'person-mcp' && hasServiceColumn) {
    cpRows = sqlite
      .prepare(
        `SELECT id, latest_entry_id, latest_entry_hash, timestamp, chain_id,
                signature, signer_address, sink_status, sink_attempts
           FROM audit_checkpoint
          WHERE service = 'person-mcp'
          ORDER BY id ASC`,
      )
      .all() as CheckpointRow[]
  } else {
    cpRows = sqlite
      .prepare(`SELECT * FROM audit_checkpoint ORDER BY id ASC`)
      .all() as CheckpointRow[]
  }
  console.log(`[verify-audit-chain] verifying ${cpRows.length} ${service} checkpoints`)

  let checkpointFailures = 0
  let signerObserved: string | null = null
  for (const cp of cpRows) {
    const digest = buildCheckpointDigest({
      latestEntryHash: cp.latest_entry_hash,
      timestamp: cp.timestamp,
      chainId: cp.chain_id,
    })
    let recovered: string
    try {
      recovered = await recoverMessageAddress({
        message: { raw: digest },
        signature: cp.signature as `0x${string}`,
      })
    } catch (err) {
      console.error(
        `[verify-audit-chain] checkpoint ${cp.id} signature recover threw: ${(err as Error).message}`,
      )
      checkpointFailures++
      continue
    }
    const recoveredLower = recovered.toLowerCase()
    const expectedLower = cp.signer_address.toLowerCase()
    if (recoveredLower !== expectedLower) {
      console.error(
        `[verify-audit-chain] checkpoint ${cp.id}: recovered=${recoveredLower} expected=${expectedLower}`,
      )
      checkpointFailures++
      continue
    }
    if (expectedSigner && recoveredLower !== expectedSigner) {
      console.error(
        `[verify-audit-chain] checkpoint ${cp.id}: signer ${recoveredLower} does not match --signer ${expectedSigner}`,
      )
      checkpointFailures++
      continue
    }
    if (signerObserved === null) {
      signerObserved = recoveredLower
    } else if (signerObserved !== recoveredLower) {
      console.error(
        `[verify-audit-chain] checkpoint ${cp.id}: signer changed mid-history (${signerObserved} → ${recoveredLower}). Could indicate rotation OR tampering.`,
      )
    }
  }

  const latest = cpRows[cpRows.length - 1]
  if (latest) {
    console.log(
      `[verify-audit-chain] most-recent ${service} checkpoint: id=${latest.id} ts=${latest.timestamp} latestEntryId=${latest.latest_entry_id} sinkStatus=${latest.sink_status}`,
    )
    console.log(`[verify-audit-chain] checkpoint signer: ${latest.signer_address}`)
  } else {
    console.log(
      `[verify-audit-chain] no ${service} checkpoints yet (service may not have run a full interval)`,
    )
  }

  const ok = chainBrokenAt === null && checkpointFailures === 0
  console.log(`[verify-audit-chain] ${service}: ${ok ? 'OK' : 'FAIL'}`)
  process.exit(ok ? 0 : 1)
}

void main().catch((err) => {
  console.error('[verify-audit-chain] uncaught:', err)
  process.exit(2)
})
