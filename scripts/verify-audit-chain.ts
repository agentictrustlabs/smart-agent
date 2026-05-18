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

interface CliArgs {
  dbPath: string
  expectedSigner?: string
}

function parseArgs(): CliArgs {
  let dbPath = resolve(process.cwd(), 'apps/a2a-agent/local.db')
  let expectedSigner: string | undefined
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === '--db' && i + 1 < process.argv.length) {
      dbPath = resolve(process.argv[++i]!)
    } else if (a === '--signer' && i + 1 < process.argv.length) {
      expectedSigner = process.argv[++i]!.toLowerCase()
    } else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: verify-audit-chain.ts [--db <path>] [--signer <0x-address>]',
      )
      process.exit(0)
    }
  }
  return { dbPath, expectedSigner }
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
  execution_path: string
  tool_grant_hash: string | null
  tool_executor: string | null
  target: string | null
  selector: string | null
  call_data_hash: string | null
  value_wei: string
  received_at: string
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
    executionPath: r.execution_path,
    toolGrantHash: r.tool_grant_hash,
    toolExecutor: r.tool_executor,
    target: r.target,
    selector: r.selector,
    callDataHash: r.call_data_hash,
    valueWei: r.value_wei,
    receivedAt: r.received_at,
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

async function main(): Promise<void> {
  const { dbPath, expectedSigner } = parseArgs()
  console.log(`[verify-audit-chain] DB: ${dbPath}`)

  const sqlite = new Database(dbPath, { readonly: true })
  // ─── Verify the execution_audit chain ──────────────────────────────
  const auditRows = sqlite
    .prepare(`SELECT * FROM execution_audit ORDER BY id ASC`)
    .all() as AuditRow[]
  console.log(`[verify-audit-chain] scanning ${auditRows.length} audit rows`)

  let chainBrokenAt: number | null = null
  let prevEntryHash: string | null = null
  let chainStartId: number | null = null
  let rowsVerified = 0

  for (const r of auditRows) {
    // Rows inserted before Sprint 3 do not carry the hash chain. We
    // start verification from the FIRST row that has an entry_hash.
    if (r.prev_entry_hash === null && r.entry_hash === null) {
      // pre-S3 row; skip
      continue
    }
    if (chainStartId === null) chainStartId = r.id

    // Verify prev_entry_hash matches our running pointer.
    if (r.prev_entry_hash !== prevEntryHash) {
      console.error(
        `[verify-audit-chain] row ${r.id}: prev_entry_hash mismatch — stored=${r.prev_entry_hash} expected=${prevEntryHash}`,
      )
      chainBrokenAt = r.id
      break
    }

    // Recompute the entry hash from the bound fields.
    const expected = computeEntryHash(rowToHashFields(r), prevEntryHash)
    if (r.entry_hash !== expected) {
      console.error(
        `[verify-audit-chain] row ${r.id}: entry_hash mismatch — stored=${r.entry_hash} expected=${expected}`,
      )
      chainBrokenAt = r.id
      break
    }

    prevEntryHash = r.entry_hash
    rowsVerified++
  }

  if (chainBrokenAt === null) {
    console.log(
      `[verify-audit-chain] chain INTACT — ${rowsVerified} rows verified (starting at id=${chainStartId ?? 'n/a'})`,
    )
  } else {
    console.error(`[verify-audit-chain] chain BROKEN at row id=${chainBrokenAt}`)
  }

  // ─── Verify audit_checkpoint signatures ────────────────────────────
  const cpRows = sqlite
    .prepare(`SELECT * FROM audit_checkpoint ORDER BY id ASC`)
    .all() as CheckpointRow[]
  console.log(`[verify-audit-chain] verifying ${cpRows.length} checkpoints`)

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
      `[verify-audit-chain] most-recent checkpoint: id=${latest.id} ts=${latest.timestamp} latestEntryId=${latest.latest_entry_id} sinkStatus=${latest.sink_status}`,
    )
    console.log(`[verify-audit-chain] checkpoint signer: ${latest.signer_address}`)
  } else {
    console.log('[verify-audit-chain] no checkpoints yet (agent may not have run a full interval)')
  }

  const ok = chainBrokenAt === null && checkpointFailures === 0
  console.log(`[verify-audit-chain] ${ok ? 'OK' : 'FAIL'}`)
  process.exit(ok ? 0 : 1)
}

void main().catch((err) => {
  console.error('[verify-audit-chain] uncaught:', err)
  process.exit(2)
})
