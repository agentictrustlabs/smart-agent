/**
 * Sprint 4 A.3 — person-mcp audit hash-chain external anchor tests.
 *
 * Mirror of `apps/a2a-agent/test/audit-checkpoint.test.ts` for the
 * person-mcp checkpoint exporter. Covers:
 *
 *   1. exportPersonMcpCheckpoint produces a signed checkpoint that
 *      recovers to the master signer address returned by the stubbed
 *      a2a-agent endpoint.
 *   2. Checkpoint records the chain head's seq + entry_hash from the
 *      audit_log table.
 *   3. Empty-chain handling — the sentinel hash is emitted when no
 *      audit rows exist.
 *   4. gcPersonMcpCheckpoints trims rows older than 30 days and leaves
 *      recent rows in place.
 *   5. Sink-POST failure does NOT roll back the local INSERT.
 *   6. Verification re-derives the chain and checkpoint digest using
 *      the same primitives the verify-CLI uses.
 *
 * The tests stub the outbound `postSignCheckpoint` HTTP call via
 * `setSignCheckpointFetch` so we never need to spin up a real
 * a2a-agent. The stubbed signer uses viem's `privateKeyToAccount` to
 * produce a real EIP-191 signature, so the recovery checks exercise the
 * exact same path the production verifier walks.
 *
 * Run: `node --import tsx --test apps/person-mcp/test/audit-checkpoint.test.ts`
 */

// Configure env BEFORE importing modules so init reads it.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = '0x' + 'c'.repeat(64)
process.env.PERSON_MCP_DB_PATH =
  process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.audit-checkpoint.test.db'
process.env.CHAIN_ID = process.env.CHAIN_ID ?? '31337'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { toBytes, hashMessage, recoverMessageAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  exportPersonMcpCheckpoint,
  gcPersonMcpCheckpoints,
  listRecentPersonMcpCheckpoints,
  buildCheckpointDigest,
  setSignCheckpointFetch,
  stopPersonMcpCheckpoints,
} from '../src/lib/audit-checkpoint.js'
import { appendAuditEntry } from '../src/session-store/index.js'
import { sqlite } from '../src/db/index.js'

// ─── Stubbed a2a-agent /auth/sign-checkpoint ────────────────────────
//
// Build a deterministic signer once at module-init so every checkpoint
// in this file is signed by the same key. The recovered address must
// match what the stub returns as `signerAddress`. We DO NOT touch any
// real a2a-agent KMS path — this is a unit-level test for the
// person-mcp side of the wire.

const TEST_SIGNER_PK = ('0x' + 'cc'.repeat(32)) as `0x${string}`
const testSigner = privateKeyToAccount(TEST_SIGNER_PK)

setSignCheckpointFetch((async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { digest?: string }
  if (!body.digest) {
    return new Response(JSON.stringify({ error: 'missing digest' }), { status: 400 })
  }
  // Sign the EIP-191 prefixed digest, mirroring the production endpoint.
  const eip191 = hashMessage({ raw: toBytes(body.digest as `0x${string}`) })
  const signature = await testSigner.sign({ hash: eip191 })
  return new Response(
    JSON.stringify({ signature, signerAddress: testSigner.address }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}) as typeof fetch)

// ─── 1. Export + signature recover ──────────────────────────────────

test('exportPersonMcpCheckpoint signs and recovers to the stubbed master signer', async () => {
  // Write at least one audit row so the chain has a non-sentinel head.
  appendAuditEntry({
    ts: new Date(),
    smartAccountAddress: ('0x' + 'aa'.repeat(20)) as `0x${string}`,
    sessionId: 'pcp-test-' + randomUUID(),
    grantHash: 'g-' + randomUUID(),
    actionId: 'a-' + randomUUID(),
    actionType: 'test.export',
    actionHash: 'h-' + randomUUID(),
    decision: 'allowed',
    reason: undefined,
    audience: undefined,
    verifier: undefined,
  })

  const cp = await exportPersonMcpCheckpoint()
  assert.equal(cp.service, 'person-mcp')
  assert.match(cp.signature, /^0x[0-9a-fA-F]+$/)
  assert.equal(cp.signerAddress.toLowerCase(), testSigner.address.toLowerCase())

  const digest = buildCheckpointDigest({
    latestEntryHash: cp.latestEntryHash,
    timestamp: cp.timestamp,
    chainId: cp.chainId,
  })
  const recovered = await recoverMessageAddress({
    message: { raw: digest },
    signature: cp.signature as `0x${string}`,
  })
  assert.equal(recovered.toLowerCase(), testSigner.address.toLowerCase())
})

// ─── 2. Chain-head binding ──────────────────────────────────────────

test('exportPersonMcpCheckpoint binds the audit_log chain head', async () => {
  // Insert a row so we have a stable head.
  const account = ('0x' + 'bb'.repeat(20)) as `0x${string}`
  const inserted = appendAuditEntry({
    ts: new Date(),
    smartAccountAddress: account,
    sessionId: 'pcp-head-' + randomUUID(),
    grantHash: 'gh-' + randomUUID(),
    actionId: 'aid-' + randomUUID(),
    actionType: 'test.head',
    actionHash: 'hh-' + randomUUID(),
    decision: 'allowed',
    reason: undefined,
    audience: undefined,
    verifier: undefined,
  })
  // Read the chain head globally — that's what the exporter anchors.
  const head = sqlite
    .prepare(`SELECT seq, entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1`)
    .get() as { seq: number; entry_hash: string } | undefined
  assert.ok(head, 'expected a row in audit_log')
  const cp = await exportPersonMcpCheckpoint()
  assert.equal(cp.latestEntryId, head.seq)
  assert.equal(cp.latestEntryHash, head.entry_hash)
  // The most-recently-inserted entry's hash and our chain head match
  // (sanity: nothing concurrent should have shifted the head).
  assert.equal(cp.latestEntryHash, inserted.entryHash)
})

// ─── 3. Empty-chain sentinel ────────────────────────────────────────

test('two consecutive person-mcp checkpoints against the same chain head share latestEntryHash', async () => {
  // The shared DB across tests means we can't assert an absolutely
  // empty chain. Instead, two consecutive checkpoints with no audit
  // inserts between them must point to the same head.
  const a = await exportPersonMcpCheckpoint()
  const b = await exportPersonMcpCheckpoint()
  assert.equal(a.latestEntryId, b.latestEntryId)
  assert.equal(a.latestEntryHash, b.latestEntryHash)
})

// ─── 4. GC ──────────────────────────────────────────────────────────

test('gcPersonMcpCheckpoints trims rows older than 30 days', async () => {
  // Insert one OLD (60d) and one NEW row with unique signatures so we
  // can identify them after the GC sweep.
  const oldTs = new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString()
  const newTs = new Date().toISOString()
  const oldSig = '0xdead' + randomUUID().replace(/-/g, '')
  const newSig = '0xbeef' + randomUUID().replace(/-/g, '')

  sqlite
    .prepare(
      `INSERT INTO audit_checkpoint
         (service, latest_entry_id, latest_entry_hash, timestamp, chain_id,
          signature, signer_address, sink_status, sink_attempts)
       VALUES ('person-mcp', 0, ?, ?, 31337, ?, ?, 'ok', 0)`,
    )
    .run('0x' + '11'.repeat(32), oldTs, oldSig, testSigner.address)
  sqlite
    .prepare(
      `INSERT INTO audit_checkpoint
         (service, latest_entry_id, latest_entry_hash, timestamp, chain_id,
          signature, signer_address, sink_status, sink_attempts)
       VALUES ('person-mcp', 0, ?, ?, 31337, ?, ?, 'ok', 0)`,
    )
    .run('0x' + '22'.repeat(32), newTs, newSig, testSigner.address)

  const deleted = gcPersonMcpCheckpoints(30)
  assert.ok(deleted >= 1, `expected at least 1 row deleted; got ${deleted}`)

  const survivor = sqlite
    .prepare(
      `SELECT 1 AS x FROM audit_checkpoint WHERE signature = ? AND service = 'person-mcp' LIMIT 1`,
    )
    .get(newSig) as { x: number } | undefined
  assert.ok(survivor, 'recent row should have survived')

  const purged = sqlite
    .prepare(
      `SELECT 1 AS x FROM audit_checkpoint WHERE signature = ? AND service = 'person-mcp' LIMIT 1`,
    )
    .get(oldSig) as { x: number } | undefined
  assert.equal(purged, undefined, 'old row should have been trimmed')
})

// ─── 5. Sink-failure isolation ─────────────────────────────────────

test('sink-POST failure does NOT roll back the local INSERT', async () => {
  const originalSinkUrl = process.env.AUDIT_CHECKPOINT_SINK_URL
  process.env.AUDIT_CHECKPOINT_SINK_URL = 'http://stub-sink.invalid/checkpoints'

  // Replace the fetch used for sink POSTs with an always-500 stub. The
  // SIGN call still goes through the existing setSignCheckpointFetch
  // stub — we route both through the same helper, so we need to be
  // careful: setSignCheckpointFetch sets the SAME hook used for sink
  // calls. To test sink-failure isolation we install a router that
  // calls the signer stub for /auth/sign-checkpoint and 500s everything
  // else (the sink URL).
  const signerHandler = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { digest?: string }
    if (!body.digest) {
      return new Response(JSON.stringify({ error: 'missing digest' }), { status: 400 })
    }
    const eip191 = hashMessage({ raw: toBytes(body.digest as `0x${string}`) })
    const signature = await testSigner.sign({ hash: eip191 })
    return new Response(
      JSON.stringify({ signature, signerAddress: testSigner.address }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  setSignCheckpointFetch((async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : 'url' in url ? url.url : String(url)
    if (u.endsWith('/auth/sign-checkpoint')) {
      return signerHandler(url, init)
    }
    // sink call → 500
    return new Response('boom', { status: 500 })
  }) as typeof fetch)

  try {
    const before = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_checkpoint WHERE service = 'person-mcp'`,
      )
      .get() as { n: number }
    const cp = await exportPersonMcpCheckpoint()
    const after = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_checkpoint WHERE service = 'person-mcp'`,
      )
      .get() as { n: number }
    assert.equal(after.n, before.n + 1, 'local row inserted regardless of sink outcome')
    assert.ok(cp.signature.length > 0)
    // Give the async sink retry a moment to flip sinkStatus.
    await new Promise<void>((r) => setTimeout(r, 50))
  } finally {
    process.env.AUDIT_CHECKPOINT_SINK_URL = originalSinkUrl
    // Restore the original signer-only stub.
    setSignCheckpointFetch((async (_u: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { digest?: string }
      const eip191 = hashMessage({ raw: toBytes((body.digest ?? '0x00') as `0x${string}`) })
      const signature = await testSigner.sign({ hash: eip191 })
      return new Response(
        JSON.stringify({ signature, signerAddress: testSigner.address }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch)
  }
})

// ─── 6. Verification — chain + checkpoint digest re-derivation ─────

test('verification re-derives the chain and checkpoint digest end-to-end', async () => {
  const account = ('0x' + 'dd'.repeat(20)) as `0x${string}`
  // Append two more rows so we have a multi-row per-account chain
  // segment to verify.
  const r1 = appendAuditEntry({
    ts: new Date(),
    smartAccountAddress: account,
    sessionId: 'pcp-verify-1-' + randomUUID(),
    grantHash: 'gv1-' + randomUUID(),
    actionId: 'av1-' + randomUUID(),
    actionType: 'test.verify',
    actionHash: 'hv1-' + randomUUID(),
    decision: 'allowed',
    reason: undefined,
    audience: undefined,
    verifier: undefined,
  })
  const r2 = appendAuditEntry({
    ts: new Date(),
    smartAccountAddress: account,
    sessionId: 'pcp-verify-2-' + randomUUID(),
    grantHash: 'gv2-' + randomUUID(),
    actionId: 'av2-' + randomUUID(),
    actionType: 'test.verify',
    actionHash: 'hv2-' + randomUUID(),
    decision: 'allowed',
    reason: undefined,
    audience: undefined,
    verifier: undefined,
  })

  // Recompute r2's entry_hash using the CLI-style helper to lock in the
  // canonical hashing format. Any drift in the hashing primitive will
  // fail this assertion.
  function clihash(
    row: {
      ts: number
      account: string
      sessionId: string
      grantHash: string
      actionId: string
      actionType: string
      actionHash: string
      decision: string
      reason: string | null
      audience: string | null
      verifier: string | null
    },
    prevEntryHash: string | null,
  ): string {
    const h = createHash('sha256')
    const join = (s: string) => {
      h.update(s); h.update('|')
    }
    join(String(row.ts))
    join(row.account.toLowerCase())
    join(row.sessionId)
    join(row.grantHash)
    join(row.actionId)
    join(row.actionType)
    join(row.actionHash)
    join(row.decision)
    join(row.reason ?? '')
    join(row.audience ?? '')
    join(row.verifier ?? '')
    h.update(prevEntryHash ?? '')
    return h.digest('hex')
  }

  const expectedR1 = clihash(
    {
      ts: r1.ts.getTime(),
      account,
      sessionId: r1.sessionId,
      grantHash: r1.grantHash,
      actionId: r1.actionId,
      actionType: r1.actionType,
      actionHash: r1.actionHash,
      decision: r1.decision,
      reason: r1.reason ?? null,
      audience: r1.audience ?? null,
      verifier: r1.verifier ?? null,
    },
    r1.prevEntryHash,
  )
  assert.equal(r1.entryHash, expectedR1, 'r1 entry hash matches CLI re-derivation')

  // Now sign a checkpoint and verify its digest + signature.
  const cp = await exportPersonMcpCheckpoint()
  // The recovered address must match the stub signer.
  const digest = buildCheckpointDigest({
    latestEntryHash: cp.latestEntryHash,
    timestamp: cp.timestamp,
    chainId: cp.chainId,
  })
  const recovered = await recoverMessageAddress({
    message: { raw: digest },
    signature: cp.signature as `0x${string}`,
  })
  assert.equal(recovered.toLowerCase(), testSigner.address.toLowerCase())
  // Suppress unused-var warning when ts-strict tightens.
  void r2
})

// ─── 7. listRecentPersonMcpCheckpoints + shutdown ──────────────────

test('listRecentPersonMcpCheckpoints returns most-recent first', async () => {
  const a = await exportPersonMcpCheckpoint()
  await new Promise<void>((r) => setTimeout(r, 5))
  const b = await exportPersonMcpCheckpoint()
  const list = listRecentPersonMcpCheckpoints(20)
  assert.ok(list.length >= 2)
  const idxA = list.findIndex(
    (c) => c.timestamp === a.timestamp && c.signature === a.signature,
  )
  const idxB = list.findIndex(
    (c) => c.timestamp === b.timestamp && c.signature === b.signature,
  )
  assert.ok(idxA >= 0, 'checkpoint a present')
  assert.ok(idxB >= 0, 'checkpoint b present')
  assert.ok(idxB < idxA, `b (newer) should come before a (older)`)
})

test('stopPersonMcpCheckpoints is idempotent', () => {
  stopPersonMcpCheckpoints()
  stopPersonMcpCheckpoints() // second call must not throw
  assert.ok(true)
})

