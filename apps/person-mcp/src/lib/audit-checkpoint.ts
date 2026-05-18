/**
 * Sprint 4 A.3 — person-mcp audit hash-chain external anchor.
 *
 * Mirrors `apps/a2a-agent/src/lib/audit-checkpoint.ts` (Sprint 3 S3.1) for
 * person-mcp's own `audit_log` table (the prevEntryHash-chained ledger
 * defined in `session-store/index.ts`). Every authority-bearing decision
 * person-mcp makes (`appendAuditEntry`) is already chained in SQLite;
 * checkpoints publish a signed witness of the chain head at fixed
 * intervals so a divergence between the local chain and the external
 * sink is forensic evidence of post-emission tampering.
 *
 * Why call back to a2a-agent for signing?
 *
 *   Person-mcp holds NO signing key. The Smart Agent key-custody posture
 *   keeps the master signer + per-tool executor keys behind a2a-agent's
 *   KMS plane; adding a dedicated person-mcp signing key would widen the
 *   key inventory (one more KMS key per MCP, one more IAM scope, one more
 *   rotation surface). Instead, person-mcp builds the same digest the
 *   a2a-agent's own checkpoint exporter builds, then POSTs it to
 *   `a2a-agent /auth/sign-checkpoint` over the existing inter-service
 *   HMAC envelope. A2A returns `{ signature, signerAddress }`; person-mcp
 *   stores both in its local `audit_checkpoint` table and POSTs to the
 *   external sink. The signature carries `signerAddress` so the
 *   verification CLI knows which key the row was signed by — same as the
 *   a2a-agent path.
 *
 * Wire format for the sign request (single shared envelope):
 *
 *   POST /auth/sign-checkpoint
 *   x-a2a-service:   person-mcp
 *   x-a2a-timestamp: <unix-seconds>
 *   x-a2a-nonce:     <fresh-per-request>
 *   x-a2a-signature: <base64url MAC>
 *
 *   canonical = `${bodyJson}:${timestamp}:`   (legacy session-id slot empty)
 *   bodyJson  = { "digest": "0x<32-byte-hex>" }
 *
 * The reused `a2a-to-person` MAC key is symmetric — same key person-mcp's
 * outbound `lib/a2a-client.ts` already uses to call `/session/:id/redeem-tx`.
 * No new MAC key id is required; the empty session-id slot in the
 * canonical message keeps the existing `requireInterServiceAuth` verifier
 * shape (every binding still lives inside the signed message).
 */

import { keccak256, concat, toBytes, toHex, hashMessage } from 'viem'
import { buildMcpMacProvider, type KmsMacProvider } from '@smart-agent/sdk/key-custody'
import { toBase64Url } from '@smart-agent/sdk'
import { createHash, randomUUID } from 'node:crypto'
import { sqlite } from '../db/index.js'

/** Service tag stored on every row this module emits. */
const SERVICE_TAG = 'person-mcp'

/** a2a-agent base URL (same env var the existing a2a-client uses). */
const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://127.0.0.1:3100'

/**
 * Public shape of a signed person-mcp checkpoint. One-to-one with the
 * audit_checkpoint row so a sink consumer can deserialize the wire body
 * directly into a database row.
 */
export interface PersonMcpCheckpoint {
  /** Constant for this module — distinguishes person-mcp checkpoints when
   *  multiple services share a sink. */
  service: 'person-mcp'
  /** `seq` of the most-recent `audit_log` row, or 0 on empty chain. */
  latestEntryId: number
  /** Hex sha256 of the most-recent row's entry_hash, or the empty-chain sentinel. */
  latestEntryHash: string
  /** ISO 8601 UTC timestamp of the export. */
  timestamp: string
  /** Chain id this deployment is configured for — bound into the signature. */
  chainId: number
  /** EIP-191 signature (`personal_sign` over the keccak digest). */
  signature: string
  /** Address that produced the signature (a2a-agent's master signer). */
  signerAddress: string
}

/** Domain separator. MUST match `apps/a2a-agent/src/lib/audit-checkpoint.ts`
 *  so the verifier (`scripts/verify-audit-chain.ts`) re-derives the same
 *  digest. */
const CHECKPOINT_DOMAIN_TAG = 'sa:audit-checkpoint:v1'

/**
 * Build the 32-byte digest the master signer signs over. Byte-identical
 * to the a2a-agent helper — exported so the verify-CLI can re-derive
 * the digest for signature recovery without importing this module.
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
 * Empty-chain sentinel — sha256("sa:audit-checkpoint:empty") in bare hex.
 * Matches the a2a-agent sentinel byte-for-byte so a single sink consumer
 * can recognize "this service has not written any audit rows yet" without
 * special-casing per service.
 */
function emptyChainHashHex(): string {
  return createHash('sha256').update('sa:audit-checkpoint:empty', 'utf8').digest('hex')
}

/**
 * Read the chain head from person-mcp's `audit_log` table. Returns `null`
 * when no rows exist; the caller substitutes the empty-chain sentinel.
 *
 * Note: a2a-agent's `executionAudit` chain is keyed per-row; person-mcp's
 * `audit_log` chain is keyed per `smart_account_address` (every account
 * has its own chain). For the checkpoint we anchor the GLOBAL most-recent
 * row irrespective of account — the sink consumer can join the timestamp
 * against the row's own account to localize tamper detection further.
 */
function getPersonMcpAuditChainHead(): { id: number; entryHash: string } | null {
  const row = sqlite
    .prepare(`SELECT seq, entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1`)
    .get() as { seq: number; entry_hash: string } | undefined
  if (!row) return null
  return { id: row.seq, entryHash: row.entry_hash }
}

/**
 * Build the canonical inter-service HMAC envelope and POST the digest to
 * a2a-agent's `/auth/sign-checkpoint`. Returns the master-signer's
 * signature + address. Throws on any 4xx / 5xx so the caller can record
 * the checkpoint as failed and surface the error.
 *
 * The MAC provider is the same `a2a-to-person` key person-mcp already
 * uses in `lib/a2a-client.ts`. HMAC is symmetric — a2a-agent verifies
 * with the same key on the other end of the wire.
 */
let cachedMacProvider: KmsMacProvider | null = null
function macProvider(): KmsMacProvider {
  if (!cachedMacProvider) {
    cachedMacProvider = buildMcpMacProvider('person', process.env)
  }
  return cachedMacProvider
}

/** Test hook — drop the cached provider so an env-change test can rebuild. */
export function __resetCheckpointMacProviderForTests(): void {
  cachedMacProvider = null
}

/**
 * Outbound signer for the checkpoint digest. Exported for tests so a
 * stub a2a-agent can be wired up via `setSignCheckpointFetch` while
 * preserving the production signing path.
 */
export async function postSignCheckpoint(
  digest: `0x${string}`,
): Promise<{ signature: `0x${string}`; signerAddress: `0x${string}` }> {
  const bodyJson = JSON.stringify({ digest })
  const timestamp = Math.floor(Date.now() / 1000)
  // The `requireInterServiceAuth` middleware on a2a-agent reads
  // `c.req.param('id')` for the session-id slot. `/auth/sign-checkpoint`
  // has no `:id`, so the canonical message ends with `:` (empty slot).
  // Same shape on both ends — wire-compatible with the verifier.
  const canonical = `${bodyJson}:${timestamp}:`
  const canonicalMessage = new TextEncoder().encode(canonical)
  const { mac } = await macProvider().generateMac({ canonicalMessage })
  const signature = toBase64Url(mac)
  const nonce = randomUUID()
  const res = await checkpointFetch(`${A2A_AGENT_URL}/auth/sign-checkpoint`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'person-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(
      `a2a /auth/sign-checkpoint failed (${res.status}): ${errText.slice(0, 200)}`,
    )
  }
  const json = (await res.json()) as {
    signature: `0x${string}`
    signerAddress: `0x${string}`
  }
  if (!json.signature || !json.signerAddress) {
    throw new Error('a2a /auth/sign-checkpoint returned malformed body')
  }
  return json
}

/**
 * Test seam — let a test substitute the fetch used to call a2a-agent.
 * Production code uses the global `fetch`; tests pass a stub that
 * synthesizes a signed response without spinning up a real a2a-agent.
 */
type CheckpointFetch = typeof fetch
let checkpointFetch: CheckpointFetch = globalThis.fetch.bind(globalThis)
export function setSignCheckpointFetch(impl: CheckpointFetch | null): void {
  checkpointFetch = impl ?? globalThis.fetch.bind(globalThis)
}

/**
 * Generate, sign (via a2a-agent), and persist a single person-mcp
 * checkpoint. Returns the persisted record.
 *
 * Layout matches a2a-agent's `exportCheckpoint`:
 *   1. Read the chain head from `audit_log` (sentinel on empty chain).
 *   2. POST the digest to a2a-agent's `/auth/sign-checkpoint`.
 *   3. INSERT a local row into `audit_checkpoint`.
 *   4. Fire-and-forget POST to `AUDIT_CHECKPOINT_SINK_URL` if set.
 */
export async function exportPersonMcpCheckpoint(): Promise<PersonMcpCheckpoint> {
  const head = getPersonMcpAuditChainHead()
  const latestEntryId = head?.id ?? 0
  const latestEntryHash = head?.entryHash ?? emptyChainHashHex()
  const timestamp = new Date().toISOString()
  const chainId = Number(process.env.CHAIN_ID ?? '31337')

  const digest = buildCheckpointDigest({ latestEntryHash, timestamp, chainId })
  // a2a-agent's `requireInterServiceAuth` accepts any 32-byte digest; the
  // signing endpoint applies the EIP-191 prefix exactly the way a2a-agent's
  // own checkpoint exporter does so the signature recovers via
  // `recoverMessageAddress({ message: { raw: digest } })` on the verifier
  // side (same as a2a-agent checkpoints).
  const { signature, signerAddress } = await postSignCheckpoint(digest)

  const cp: PersonMcpCheckpoint = {
    service: SERVICE_TAG,
    latestEntryId,
    latestEntryHash,
    timestamp,
    chainId,
    signature,
    signerAddress,
  }

  const sinkUrl = process.env.AUDIT_CHECKPOINT_SINK_URL
  const initialSinkStatus = sinkUrl ? 'pending' : 'not-configured'

  const info = sqlite
    .prepare(
      `INSERT INTO audit_checkpoint (
         service, latest_entry_id, latest_entry_hash, timestamp, chain_id,
         signature, signer_address, sink_status, sink_attempts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      SERVICE_TAG,
      latestEntryId,
      latestEntryHash,
      timestamp,
      chainId,
      signature,
      signerAddress,
      initialSinkStatus,
      0,
    )
  const rowId = Number(info.lastInsertRowid)

  if (sinkUrl) {
    void postToSinkWithRetry(sinkUrl, cp, rowId)
  }

  return cp
}

/**
 * Mirror of a2a-agent's `postToSinkWithRetry`: 3 attempts, exponential
 * backoff (500ms, 1.5s, 3.5s), 5s per-attempt timeout. The sink wire
 * format is the plain `PersonMcpCheckpoint` JSON; the `service: 'person-mcp'`
 * field distinguishes these from a2a-agent's checkpoints.
 *
 * Best-effort: a failing sink call updates the local row's `sink_status`
 * but never rolls back the local INSERT and never throws back to the
 * caller (checkpoint cadence keeps running).
 */
async function postToSinkWithRetry(
  sinkUrl: string,
  cp: PersonMcpCheckpoint,
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
  headers['x-sa-checkpoint-id'] = String(rowId)
  headers['x-sa-checkpoint-service'] = SERVICE_TAG

  let lastError = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const signal = AbortSignal.timeout(SINK_TIMEOUT_MS)
      const res = await checkpointFetch(sinkUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(cp),
        signal,
      })
      if (res.status >= 200 && res.status < 300) {
        updateCheckpointSinkStatus(rowId, 'ok', attempt)
        return
      }
      lastError = `HTTP ${res.status}`
    } catch (err) {
      lastError = (err as Error).message ?? 'fetch threw'
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise<void>((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 1000))
    }
  }
  updateCheckpointSinkStatus(rowId, `failed:${lastError.slice(0, 200)}`, MAX_ATTEMPTS)
  console.error(
    `[person-mcp audit-checkpoint] sink POST failed after ${MAX_ATTEMPTS} attempts: ${lastError}`,
  )
}

function updateCheckpointSinkStatus(rowId: number, status: string, attempts: number): void {
  try {
    sqlite
      .prepare(
        `UPDATE audit_checkpoint SET sink_status = ?, sink_attempts = ? WHERE id = ?`,
      )
      .run(status, attempts, rowId)
  } catch (err) {
    console.error('[person-mcp audit-checkpoint] sink-status update failed:', err)
  }
}

/**
 * Trim the local archive to the last 30 days. Matches the a2a-agent
 * cadence: the external sink is the authoritative anchor; the local
 * archive is just a 30-day operator-visible window.
 *
 * Filters on `service = 'person-mcp'` so this never touches a row that
 * a hypothetical operator-side import path stamped with a different
 * service tag.
 */
export function gcPersonMcpCheckpoints(maxAgeDays = 30): number {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()
  const result = sqlite
    .prepare(`DELETE FROM audit_checkpoint WHERE service = ? AND timestamp < ?`)
    .run(SERVICE_TAG, cutoff)
  return result.changes
}

/**
 * List recent person-mcp checkpoints (most-recent first). Test + verify
 * CLI helper.
 */
export function listRecentPersonMcpCheckpoints(limit = 10): PersonMcpCheckpoint[] {
  const rows = sqlite
    .prepare(
      `SELECT service, latest_entry_id, latest_entry_hash, timestamp, chain_id,
              signature, signer_address
         FROM audit_checkpoint
        WHERE service = ?
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(SERVICE_TAG, limit) as Array<{
    service: string
    latest_entry_id: number
    latest_entry_hash: string
    timestamp: string
    chain_id: number
    signature: string
    signer_address: string
  }>
  return rows.map((r) => ({
    service: SERVICE_TAG,
    latestEntryId: r.latest_entry_id,
    latestEntryHash: r.latest_entry_hash,
    timestamp: r.timestamp,
    chainId: r.chain_id,
    signature: r.signature,
    signerAddress: r.signer_address,
  }))
}

// ─── Scheduler ────────────────────────────────────────────────────────

/** Default cadence: 15 min in prod, 1 min in dev (matches a2a-agent). */
function defaultIntervalMs(): number {
  return process.env.NODE_ENV === 'production' ? 15 * 60_000 : 60_000
}

let scheduleHandle: ReturnType<typeof setInterval> | null = null
let gcHandle: ReturnType<typeof setInterval> | null = null

/**
 * Start the periodic checkpoint emitter. Idempotent — calling twice keeps
 * the original handle and is a no-op. Returns the handle so tests can
 * `clearInterval` between cases via `stopPersonMcpCheckpoints()`.
 *
 * Schedules TWO timers:
 *   - checkpoint emitter on `intervalMs`
 *   - daily GC at 24h cadence
 *
 * `.unref()` so the timers don't hold the Node event loop alive during
 * graceful shutdown.
 */
export function schedulePersonMcpCheckpoints(intervalMs: number = defaultIntervalMs()): void {
  if (scheduleHandle) return
  scheduleHandle = setInterval(() => {
    void (async () => {
      try {
        await exportPersonMcpCheckpoint()
      } catch (err) {
        console.error('[person-mcp audit-checkpoint] export failed:', err)
      }
    })()
  }, intervalMs)
  scheduleHandle.unref()

  const GC_INTERVAL_MS = 24 * 60 * 60_000 // 24 hours
  gcHandle = setInterval(() => {
    try {
      const deleted = gcPersonMcpCheckpoints()
      if (deleted > 0) console.log(`[person-mcp audit-checkpoint] gc evicted ${deleted} old rows`)
    } catch (err) {
      console.error('[person-mcp audit-checkpoint] gc failed:', err)
    }
  }, GC_INTERVAL_MS)
  gcHandle.unref()
}

/** Stop both scheduled timers. Test-only / shutdown helper. */
export function stopPersonMcpCheckpoints(): void {
  if (scheduleHandle) clearInterval(scheduleHandle)
  if (gcHandle) clearInterval(gcHandle)
  scheduleHandle = null
  gcHandle = null
}
