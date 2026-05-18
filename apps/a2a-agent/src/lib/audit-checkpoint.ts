/**
 * Audit hash-chain external anchor (Sprint 3 S3.1).
 *
 * The `executionAudit` table is a prevEntryHash-chained ledger
 * (`apps/a2a-agent/src/lib/audit.ts`). The chain alone proves no rows
 * have been retroactively edited — but it lives in the same SQLite DB
 * an attacker / admin could mutate. To get a witness OUTSIDE the DB,
 * the agent emits periodic SIGNED CHECKPOINTS:
 *
 *   { latestEntryId, latestEntryHash, timestamp, signature, signerAddress }
 *
 * Signature = `await masterSigner.signMessage(keccak256(latestEntryHash || timestamp || chainId))`.
 *
 * Each checkpoint is:
 *   1. Persisted to the `audit_checkpoint` table — the local archive.
 *   2. Optionally POSTed to an external sink (Azure Log Analytics Data
 *      Collector, S3 immutable blob, generic JSON webhook) when
 *      `AUDIT_CHECKPOINT_SINK_URL` is configured. The sink call has a
 *      5s timeout and retries 3× with exponential backoff; failure to
 *      reach the sink does NOT roll back the local archive.
 *
 * Verification (`scripts/verify-audit-chain.ts`) walks the local chain,
 * recomputes every `entry_hash`, then asserts the most-recent
 * checkpoint's signature matches the master signer's address AND its
 * `latestEntryHash` equals the chain head at that point. A divergence
 * between the chain and the most-recent external checkpoint is
 * forensic evidence of post-emission tampering.
 *
 * Out of scope (deferred):
 *   - Cross-instance shared checkpoint queue (single-instance for now)
 *   - Signing checkpoints via a dedicated KMS signing key (we reuse the
 *     master signer; rotating that key rotates checkpoint signing too)
 *   - person-mcp checkpoint export (mirror of this; same pattern;
 *     follow-up PR — see TODO in `apps/person-mcp/src/session-store/index.ts`)
 */

import { keccak256, concat, toBytes, toHex, hashMessage } from 'viem'
import { desc } from 'drizzle-orm'
import { db } from '../db'
import { auditCheckpoint, executionAudit } from '../db/schema'
import { getMasterSignerBackend, getMasterSigner } from '../auth/a2a-signer'
import { config } from '../config'
import { getAuditChainHead } from './audit'

/**
 * Public shape returned by `exportCheckpoint()`. Mirrors the
 * `audit_checkpoint` row layout one-to-one so a sink consumer can
 * deserialize the wire body straight into a database row.
 */
export interface Checkpoint {
  latestEntryId: number
  latestEntryHash: string
  /** ISO 8601 UTC timestamp of the export. */
  timestamp: string
  /** Chain id this agent is configured for — bound into the signature. */
  chainId: number
  /** EIP-191 signature (`personal_sign` over the keccak digest). */
  signature: string
  /** Address that produced the signature (the master signer). */
  signerAddress: string
}

/**
 * Domain separator for the checkpoint signing digest. Keeps the digest
 * distinct from any other use of the master signer (transactions, ERC-
 * 1271 challenges) so a signed transaction can never be replayed as a
 * checkpoint.
 */
const CHECKPOINT_DOMAIN_TAG = 'sa:audit-checkpoint:v1'

/**
 * Build the 32-byte digest the master signer signs over:
 *
 *   keccak256(CHECKPOINT_DOMAIN_TAG || latestEntryHash || timestamp || chainId)
 *
 * Exported so `scripts/verify-audit-chain.ts` can re-derive the digest
 * for signature recovery without importing the rest of this module.
 */
export function buildCheckpointDigest(input: {
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

/**
 * Empty-chain sentinel. When the audit table has no rows yet, the
 * checkpoint records `latestEntryId=0` and `latestEntryHash` equals
 * `sha256('sa:audit-checkpoint:empty')` (64 hex chars, NO 0x prefix —
 * matches the format the chain's `entry_hash` column uses). This keeps
 * the checkpoint cadence running even on a fresh deployment so any
 * subsequent reset is visible (an attacker cannot wipe the DB and
 * re-deploy without the sink seeing the timeline gap).
 */
function emptyChainHashHex(): string {
  // Use Node's sha256 so the digest format matches the chain rows.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  return createHash('sha256').update('sa:audit-checkpoint:empty', 'utf8').digest('hex')
}

/**
 * Generate, sign, and persist a single checkpoint. Returns the
 * persisted record. Caller is responsible for scheduling — see
 * `scheduleCheckpoints()` for the runtime interval.
 *
 * The external sink call (if `AUDIT_CHECKPOINT_SINK_URL` is set) happens
 * AFTER the local insert. A failing sink call updates the local row's
 * `sinkStatus` to `failed` / `error` so an operator can see the sync
 * gap in the local archive; the next checkpoint still attempts the
 * sink (no permanent backoff).
 */
export async function exportCheckpoint(): Promise<Checkpoint> {
  const head = await getAuditChainHead()
  const latestEntryId = head?.id ?? 0
  const latestEntryHash = head?.entryHash ?? emptyChainHashHex()
  const timestamp = new Date().toISOString()
  const chainId = config.CHAIN_ID

  // Sprint 3 S3.1 — call the signer backend directly with a
  // `checkpoint:` actionId prefix so the kms-sign audit hook in
  // `a2a-signer.ts::makeSignerAudit` can skip the row. Going through
  // the viem LocalAccount instead would produce a kms-sign row that
  // shifts the chain head before we record this checkpoint — a
  // recursive instability we explicitly avoid.
  //
  // We still recover the signer address up front so the recorded
  // `signerAddress` matches what the verifier expects.
  const signer = await getMasterSigner() // cached after first call; no-op here
  const backend = getMasterSignerBackend()
  const digest = buildCheckpointDigest({ latestEntryHash, timestamp, chainId })
  // Apply the EIP-191 prefix manually so the resulting signature
  // verifies with `recoverMessageAddress({ message: { raw: digest } })`.
  const eip191Digest = hashMessage({ raw: digest })
  const { signature: sigBytes } = await backend.signA2AAction({
    canonicalPayload: new Uint8Array(0),
    accountAddress: signer.address,
    chainId: String(chainId),
    sessionId: 'audit-checkpoint',
    actionId: `checkpoint:${timestamp}`,
    digest: toBytes(eip191Digest),
  })
  const signature = toHex(sigBytes)

  const cp: Checkpoint = {
    latestEntryId,
    latestEntryHash,
    timestamp,
    chainId,
    signature,
    signerAddress: signer.address,
  }

  const sinkUrl = process.env.AUDIT_CHECKPOINT_SINK_URL
  const initialSinkStatus = sinkUrl ? 'pending' : 'not-configured'

  const inserted = await db
    .insert(auditCheckpoint)
    .values({
      latestEntryId,
      latestEntryHash,
      timestamp,
      chainId,
      signature,
      signerAddress: signer.address,
      sinkStatus: initialSinkStatus,
      sinkAttempts: 0,
    })
    .returning({ id: auditCheckpoint.id })

  const rowId = inserted[0]!.id

  if (sinkUrl) {
    void postToSinkWithRetry(sinkUrl, cp, rowId)
  }

  return cp
}

/**
 * POST a checkpoint to the configured sink with up to 3 attempts and
 * exponential backoff (500ms, 1500ms, 3500ms). Updates the local row's
 * `sink_status` and `sink_attempts` so the operator can see whether
 * the sink is healthy. Best-effort — never throws back to the caller.
 *
 * The sink wire format is plain JSON. Authentication is the operator's
 * responsibility — the sink URL CAN embed a query-string secret (Azure
 * Monitor DCR token), a bearer token via the `AUDIT_CHECKPOINT_SINK_AUTH`
 * env var, or HMAC headers. We keep this module agnostic to the
 * specific sink technology so swapping vendors is one env-var change.
 */
async function postToSinkWithRetry(
  sinkUrl: string,
  cp: Checkpoint,
  rowId: number,
): Promise<void> {
  const SINK_TIMEOUT_MS = 5_000
  const MAX_ATTEMPTS = 3
  const BACKOFF_MS = [500, 1500, 3500] as const

  const auth = process.env.AUDIT_CHECKPOINT_SINK_AUTH
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (auth && auth.length > 0) {
    headers['authorization'] = auth
  }
  // Stable correlation id per checkpoint, so the operator can grep the
  // sink log for the same row id.
  headers['x-sa-checkpoint-id'] = String(rowId)

  let lastError = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const controller = AbortSignal.timeout(SINK_TIMEOUT_MS)
      const res = await fetch(sinkUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(cp),
        signal: controller,
      })
      // Treat 2xx as success.
      if (res.status >= 200 && res.status < 300) {
        await updateCheckpointSinkStatus(rowId, 'ok', attempt)
        return
      }
      lastError = `HTTP ${res.status}`
    } catch (err) {
      lastError = (err as Error).message ?? 'fetch threw'
    }
    // Backoff before next attempt (no sleep after the last one).
    if (attempt < MAX_ATTEMPTS) {
      await new Promise<void>((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 1000))
    }
  }
  await updateCheckpointSinkStatus(rowId, `failed:${lastError.slice(0, 200)}`, MAX_ATTEMPTS)
  console.error(`[audit-checkpoint] sink POST failed after ${MAX_ATTEMPTS} attempts: ${lastError}`)
}

/**
 * Write back the sink status / attempt count after the POST completes.
 * Best-effort: a failing update is logged but does not surface.
 */
async function updateCheckpointSinkStatus(
  rowId: number,
  status: string,
  attempts: number,
): Promise<void> {
  try {
    const { eq } = await import('drizzle-orm')
    await db
      .update(auditCheckpoint)
      .set({ sinkStatus: status, sinkAttempts: attempts })
      .where(eq(auditCheckpoint.id, rowId))
  } catch (err) {
    console.error('[audit-checkpoint] sink-status update failed:', err)
  }
}

/**
 * Trim the local `audit_checkpoint` archive to the last 30 days. The
 * authoritative anchor is the EXTERNAL sink; we keep a local 30-day
 * window only so the operator can inspect the recent cadence offline.
 *
 * Returns the number of rows deleted (informational).
 */
export async function gcCheckpoints(maxAgeDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()
  const { lt } = await import('drizzle-orm')
  const result = await db
    .delete(auditCheckpoint)
    .where(lt(auditCheckpoint.timestamp, cutoff))
    .returning({ id: auditCheckpoint.id })
  return result.length
}

/**
 * List recent checkpoints (most-recent first). Test + verify-cli helper.
 */
export async function listRecentCheckpoints(limit = 10): Promise<Checkpoint[]> {
  const rows = await db
    .select()
    .from(auditCheckpoint)
    .orderBy(desc(auditCheckpoint.id))
    .limit(limit)
  return rows.map((r) => ({
    latestEntryId: r.latestEntryId,
    latestEntryHash: r.latestEntryHash,
    timestamp: r.timestamp,
    chainId: r.chainId,
    signature: r.signature,
    signerAddress: r.signerAddress,
  }))
}

// ─── Scheduler ────────────────────────────────────────────────────────

/**
 * Default checkpoint cadence:
 *   - prod ('production'): 15 minutes
 *   - dev / test:           1 minute
 *
 * Tuned to keep the sink call rate low while still bounding the
 * "tampering window" — if an attacker mutates the DB between checkpoints
 * and the next checkpoint observes the tampered chain head, the next
 * signed external record disagrees with the row history we'd recompute
 * locally; verify-cli flags the gap.
 */
function defaultIntervalMs(): number {
  return process.env.NODE_ENV === 'production' ? 15 * 60_000 : 60_000
}

let scheduleHandle: ReturnType<typeof setInterval> | null = null
let gcHandle: ReturnType<typeof setInterval> | null = null

/**
 * Start the periodic checkpoint emitter. Idempotent — calling twice
 * keeps the original handle and is a no-op. Returns the handle so
 * tests can `clearInterval` between cases via `stopCheckpoints()`.
 *
 * Schedules TWO timers:
 *   - checkpoint emitter on `intervalMs`
 *   - daily GC at 24h cadence (light DELETE on indexed `timestamp` col)
 *
 * `.unref()` so the timers don't keep the Node event loop alive during
 * graceful shutdown.
 */
export function scheduleCheckpoints(intervalMs: number = defaultIntervalMs()): void {
  if (scheduleHandle) return
  scheduleHandle = setInterval(() => {
    void (async () => {
      try {
        await exportCheckpoint()
      } catch (err) {
        console.error('[audit-checkpoint] export failed:', err)
      }
    })()
  }, intervalMs)
  scheduleHandle.unref()

  const GC_INTERVAL_MS = 24 * 60 * 60_000 // 24 hours
  gcHandle = setInterval(() => {
    void (async () => {
      try {
        const deleted = await gcCheckpoints()
        if (deleted > 0) console.log(`[audit-checkpoint] gc evicted ${deleted} old rows`)
      } catch (err) {
        console.error('[audit-checkpoint] gc failed:', err)
      }
    })()
  }, GC_INTERVAL_MS)
  gcHandle.unref()
}

/**
 * Stop both scheduled timers. Used by tests; production agents simply
 * let the process exit.
 */
export function stopCheckpoints(): void {
  if (scheduleHandle) clearInterval(scheduleHandle)
  if (gcHandle) clearInterval(gcHandle)
  scheduleHandle = null
  gcHandle = null
}

// Suppress unused import lint for executionAudit (re-exported only to
// keep the binding visible if a future tests-only path imports it).
void executionAudit
