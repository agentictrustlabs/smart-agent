/**
 * Sprint 2 S2.1 — action-counter + per-minute rate-limit enforcement.
 *
 * `SessionGrant.v1` declares `scope.maxActions` (total) and
 * `scope.maxActionsPerMinute` (sliding 60s window). Before S2.1 the
 * WalletAction verifier ignored both fields — a compromised session
 * could replay actions up to the TTL window with no ceiling. These
 * tests cover:
 *
 *   - First action increments total to 1 (lazy row creation).
 *   - Bounded counter: maxActions=2 → 3rd denied with `action-cap-exceeded`.
 *   - Sliding window: maxActionsPerMinute=5 → 6th denied with `rate-cap-exceeded`.
 *   - 60s window reset: simulate `now` advancing past the window;
 *     `windowCount` resets to 0 while `totalActions` persists.
 *   - Concurrent verifies race-test: parallel `consumeAction` calls
 *     respect the cap; sqlite's write lock serializes the SELECT+UPDATE.
 *   - Missing row idempotent: a fresh sessionId is treated as count=0.
 *   - Default values applied when grant omits the fields.
 *   - Audit-deny row written when verifier denies on counter limit
 *     (covers `verify-delegated-action.ts` integration site → 403 path).
 *
 * Run: `node --import tsx --test apps/person-mcp/test/action-counter.test.ts`
 */

// Pre-import env wiring — same as wallet-action-audit-deny.test.ts so
// when the verifier module pulls in `config.ts`, requireEnv hits a value.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = '0x' + 'a'.repeat(64)
process.env.DELEGATION_MANAGER_ADDRESS = process.env.DELEGATION_MANAGER_ADDRESS ?? ('0x' + '1'.repeat(40))
// Separate test DB so this file can run concurrently with other test
// files (node --test runs files in parallel by default) without writer
// contention.
process.env.PERSON_MCP_DB_PATH = process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.action-counter.test.db'
// Defense-in-depth defaults: pick a low cap so the "defaults applied"
// integration test can exercise both accept + deny paths without
// running 1000 actions. Per-grant maxActions still wins when present.
process.env.SESSION_DEFAULT_MAX_ACTIONS = process.env.SESSION_DEFAULT_MAX_ACTIONS ?? '2'
process.env.SESSION_DEFAULT_MAX_ACTIONS_PER_MINUTE = process.env.SESSION_DEFAULT_MAX_ACTIONS_PER_MINUTE ?? '60'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { hashCanonical, type SessionGrantV1, type SessionRecord } from '@smart-agent/privacy-creds/session-grant'
import {
  consumeAction,
  getActionCounter,
  insertSession,
  revokeSession,
} from '../src/session-store/index'
import { sqlite } from '../src/db/index'
import {
  verifyDelegatedWalletAction,
  DelegatedActionDenied,
} from '../src/auth/verify-delegated-action'
import { walletActionRoutes } from '../src/auth/wallet-action-routes'
import {
  buildInboundCanonical,
  resetInboundMacProviderForTest,
} from '../src/auth/require-inbound-service-auth'
import { toBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider } from '@smart-agent/sdk/key-custody'

resetInboundMacProviderForTest()

const macProvider = buildMcpMacProvider('person', process.env)

function mountApp(): Hono {
  const app = new Hono()
  app.route('/', walletActionRoutes)
  return app
}

async function signedHeaders(path: string, bodyRaw: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const canonical = buildInboundCanonical(timestamp, nonce, path, bodyRaw)
  const { mac } = await macProvider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return {
    'content-type': 'application/json',
    'x-sa-service': 'a2a-agent',
    'x-sa-timestamp': String(timestamp),
    'x-sa-nonce': nonce,
    'x-sa-signature': toBase64Url(mac),
  }
}

// ─── consumeAction unit tests (atomic helper) ───────────────────────

test('first action increments total to 1 (lazy row creation)', () => {
  const sessionId = 'cnt-first-' + randomUUID()
  const before = getActionCounter(sessionId)
  assert.equal(before.totalActions, 0)
  assert.equal(before.windowCount, 0)

  const result = consumeAction({
    sessionId,
    maxActions: 100,
    maxActionsPerMinute: 60,
    now: Date.now(),
  })
  assert.equal(result.allowed, true)
  assert.equal(result.totalActions, 1)
  assert.equal(result.windowCount, 1)

  const after = getActionCounter(sessionId)
  assert.equal(after.totalActions, 1)
  assert.equal(after.windowCount, 1)
})

test('missing row treated as count=0 (idempotent on first read)', () => {
  const sessionId = 'cnt-missing-' + randomUUID()
  // No row, no write — pure read.
  const view = getActionCounter(sessionId)
  assert.equal(view.totalActions, 0)
  assert.equal(view.windowCount, 0)

  // Confirm no row was inserted by getActionCounter.
  const row = sqlite
    .prepare(`SELECT COUNT(*) as c FROM session_action_count WHERE session_id = ?`)
    .get(sessionId) as { c: number }
  assert.equal(row.c, 0)
})

test('maxActions=2 — 1st + 2nd accepted, 3rd denied with action-cap-exceeded', () => {
  const sessionId = 'cnt-cap2-' + randomUUID()
  const now = Date.now()

  const a = consumeAction({ sessionId, maxActions: 2, maxActionsPerMinute: 100, now })
  assert.equal(a.allowed, true)
  assert.equal(a.totalActions, 1)

  const b = consumeAction({ sessionId, maxActions: 2, maxActionsPerMinute: 100, now: now + 1 })
  assert.equal(b.allowed, true)
  assert.equal(b.totalActions, 2)

  const c = consumeAction({ sessionId, maxActions: 2, maxActionsPerMinute: 100, now: now + 2 })
  assert.equal(c.allowed, false)
  assert.equal(c.exceeded, 'total')
  assert.equal(c.cap, 2)
  // Total stays at 2 — denied attempt does NOT increment.
  assert.equal(c.totalActions, 2)

  const view = getActionCounter(sessionId)
  assert.equal(view.totalActions, 2)
})

test('maxActionsPerMinute=5 — 6 actions within 1s → 6th denied with rate-cap-exceeded', () => {
  const sessionId = 'cnt-rate5-' + randomUUID()
  const base = Date.now()
  // 5 accepts within the same millisecond window.
  for (let i = 0; i < 5; i++) {
    const r = consumeAction({
      sessionId,
      maxActions: 1000,
      maxActionsPerMinute: 5,
      now: base + i, // microsecond-spaced; all within the 60s window
    })
    assert.equal(r.allowed, true, `expected #${i + 1} to be allowed`)
  }
  // 6th in the same window → denied.
  const r6 = consumeAction({
    sessionId,
    maxActions: 1000,
    maxActionsPerMinute: 5,
    now: base + 5,
  })
  assert.equal(r6.allowed, false)
  assert.equal(r6.exceeded, 'rate')
  assert.equal(r6.cap, 5)

  const view = getActionCounter(sessionId, base + 5)
  // 5 successful → total = 5, window = 5
  assert.equal(view.totalActions, 5)
  assert.equal(view.windowCount, 5)
})

test('60s window resets while total persists (now mock advances past window)', () => {
  const sessionId = 'cnt-window-' + randomUUID()
  const t0 = 1_700_000_000_000 // fixed virtual epoch

  // Burn the rate budget at t0.
  for (let i = 0; i < 3; i++) {
    const r = consumeAction({
      sessionId,
      maxActions: 1000,
      maxActionsPerMinute: 3,
      now: t0 + i,
    })
    assert.equal(r.allowed, true)
  }
  // 4th within the same window → denied.
  const denied = consumeAction({
    sessionId,
    maxActions: 1000,
    maxActionsPerMinute: 3,
    now: t0 + 3,
  })
  assert.equal(denied.allowed, false)
  assert.equal(denied.exceeded, 'rate')

  // Advance 61 seconds — the 3 timestamps are now outside the window.
  const tLate = t0 + 61_000
  const next = consumeAction({
    sessionId,
    maxActions: 1000,
    maxActionsPerMinute: 3,
    now: tLate,
  })
  assert.equal(next.allowed, true, 'window should have reset after 60s')
  // Total persists across the window boundary.
  assert.equal(next.totalActions, 4)
  // Window now contains only the just-appended timestamp.
  assert.equal(next.windowCount, 1)

  const view = getActionCounter(sessionId, tLate)
  assert.equal(view.totalActions, 4)
  assert.equal(view.windowCount, 1)
})

test('concurrent verifies do not both succeed past the cap', async () => {
  // Race test: schedule 5 parallel consume calls against a cap of 2.
  // The check-and-increment runs inside a sync sqlite transaction so the
  // second call sees the first's increment. Exactly 2 must be allowed.
  const sessionId = 'cnt-race-' + randomUUID()
  const now = Date.now()

  const launches: Promise<ReturnType<typeof consumeAction>>[] = []
  for (let i = 0; i < 5; i++) {
    launches.push(
      Promise.resolve().then(() =>
        consumeAction({
          sessionId,
          maxActions: 2,
          maxActionsPerMinute: 100,
          now: now + i,
        }),
      ),
    )
  }
  const results = await Promise.all(launches)
  const allowed = results.filter(r => r.allowed).length
  const denied = results.filter(r => !r.allowed).length
  assert.equal(allowed, 2, `exactly 2 of 5 should be allowed; got ${allowed}`)
  assert.equal(denied, 3, `the remaining 3 should be denied; got ${denied}`)

  // Persisted counter is exactly 2 — no over-increment.
  const view = getActionCounter(sessionId)
  assert.equal(view.totalActions, 2)
})

// ─── Verifier integration tests (default values + audit-deny wiring) ──

interface MintedSession {
  sessionId: string
  smartAccountAddress: `0x${string}`
  signerKey: `0x${string}`
  signerAddress: `0x${string}`
  grant: SessionGrantV1
}

function mintTestSession(opts: { maxActions?: number; maxActionsPerMinute?: number } = {}): MintedSession {
  const sessionId = 'sess-' + randomUUID()
  const signerKey = generatePrivateKey()
  const signer = privateKeyToAccount(signerKey)
  const smartAccountAddress = ('0x' + 'a'.repeat(40)) as `0x${string}`
  const now = Date.now()

  const grant: SessionGrantV1 = {
    schema: 'SessionGrant.v1',
    policyVersion: 'test-2026-05',
    issuer: 'test',
    rpId: 'localhost',
    origin: 'http://localhost:3000',
    subject: { smartAccountAddress },
    delegate: { type: 'session-eoa', address: signer.address },
    audience: ['person-mcp'],
    session: {
      sessionId,
      issuedAt: now,
      notBefore: now,
      expiresAt: now + 8 * 60 * 60 * 1000,
      revocationEpoch: 0,
    },
    scope: {
      maxRisk: 'medium',
      tools: [],
      walletActions: ['CreatePresentation', 'ProvisionHolderWallet'],
      // Opts are intentionally absent in the default-values test.
      ...(opts.maxActions !== undefined ? { maxActions: opts.maxActions } : {}),
      ...(opts.maxActionsPerMinute !== undefined ? { maxActionsPerMinute: opts.maxActionsPerMinute } : {}),
    },
    constraints: {
      requireKnownVerifier: false,
      allowAttributeReveal: true,
      allowUnknownVerifier: true,
      allowOnchainWrite: false,
      allowAccountMutation: false,
      allowDelegationMutation: false,
    },
    nonce: randomUUID(),
  }
  const grantHash = hashCanonical(grant as unknown as Parameters<typeof hashCanonical>[0])

  const record: SessionRecord = {
    sessionId,
    sessionIdHash: 'hash-' + sessionId,
    smartAccountAddress,
    sessionSignerAddress: signer.address,
    verifiedPasskeyPubkey: { x: '0', y: '0' },
    grant,
    grantHash,
    idleExpiresAt: new Date(now + 30 * 60 * 1000),
    expiresAt: new Date(grant.session.expiresAt),
    createdAt: new Date(now),
    revokedAt: null,
    revocationEpoch: 0,
  }
  insertSession(record)
  return { sessionId, smartAccountAddress, signerKey, signerAddress: signer.address, grant }
}

async function buildSignedAction(s: MintedSession, opts: { actionId?: string } = {}): Promise<{
  action: unknown
  signature: `0x${string}`
}> {
  const now = Date.now()
  const action = {
    schema: 'WalletAction.v1' as const,
    actionId: opts.actionId ?? 'act-' + randomUUID(),
    sessionId: s.sessionId,
    actor: {
      smartAccountAddress: s.smartAccountAddress,
      sessionSignerAddress: s.signerAddress,
    },
    action: {
      type: 'CreatePresentation' as const,
      payloadHash: '0x' + '0'.repeat(64),
      payloadCanonicalization: 'json-c14n-v1' as const,
    },
    audience: { service: 'person-mcp', verifierDomain: 'example.test' },
    timing: { createdAt: now, expiresAt: now + 60_000 },
    replayProtection: { actionNonce: randomUUID() },
  }
  const hash = hashCanonical(action as unknown as Parameters<typeof hashCanonical>[0])
  const account = privateKeyToAccount(s.signerKey)
  const signature = await account.sign({ hash: hash as `0x${string}` })
  return { action, signature }
}

test('default maxActions/maxActionsPerMinute applied when grant omits the fields', async () => {
  // Test file sets SESSION_DEFAULT_MAX_ACTIONS=2 at the top before
  // config.ts is imported; this test verifies the verifier applies that
  // default when the grant's scope omits maxActions.
  const s = mintTestSession({}) // both fields omitted
  const ctx = { serviceName: 'person-mcp' }

  const a = await buildSignedAction(s)
  await verifyDelegatedWalletAction({
    action: a.action as Parameters<typeof verifyDelegatedWalletAction>[0]['action'],
    actionSignature: a.signature,
    sessionId: s.sessionId,
  }, ctx)

  const b = await buildSignedAction(s)
  await verifyDelegatedWalletAction({
    action: b.action as Parameters<typeof verifyDelegatedWalletAction>[0]['action'],
    actionSignature: b.signature,
    sessionId: s.sessionId,
  }, ctx)

  // Third action — should hit the default cap of 2.
  const c = await buildSignedAction(s)
  await assert.rejects(
    verifyDelegatedWalletAction({
      action: c.action as Parameters<typeof verifyDelegatedWalletAction>[0]['action'],
      actionSignature: c.signature,
      sessionId: s.sessionId,
    }, ctx),
    (err: unknown) => err instanceof DelegatedActionDenied && err.code === 'action-cap-exceeded',
  )

  revokeSession(s.sessionId)
})

test('audit-deny row written when verifier denies on counter cap', async () => {
  // Mint a session with maxActions=1, then call /wallet-action/verify
  // twice. The second call must 403 and write an audit-deny row with
  // reason "action-cap-exceeded".
  const s = mintTestSession({ maxActions: 1, maxActionsPerMinute: 1000 })

  const app = mountApp()
  const path = '/wallet-action/verify'

  // First call — succeeds, audit-allow row written.
  const a = await buildSignedAction(s)
  const body1 = JSON.stringify({
    action: a.action,
    actionSignature: a.signature,
    sessionId: s.sessionId,
    serviceName: 'person-mcp',
  })
  const res1 = await app.request(path, {
    method: 'POST',
    headers: await signedHeaders(path, body1),
    body: body1,
  })
  assert.equal(res1.status, 200, await res1.text())

  // Second call — should be denied for action-cap-exceeded.
  const b = await buildSignedAction(s)
  const body2 = JSON.stringify({
    action: b.action,
    actionSignature: b.signature,
    sessionId: s.sessionId,
    serviceName: 'person-mcp',
  })
  const res2 = await app.request(path, {
    method: 'POST',
    headers: await signedHeaders(path, body2),
    body: body2,
  })
  assert.equal(res2.status, 403)
  const respBody = await res2.json() as { ok: boolean; code: string; detail: string }
  assert.equal(respBody.ok, false)
  assert.equal(respBody.code, 'action-cap-exceeded')

  // Audit row written — sessionId is the discriminator since auditDeny
  // doesn't currently propagate smartAccountAddress through the verify
  // catch path.
  const auditRow = sqlite
    .prepare(
      `SELECT decision, reason FROM audit_log
         WHERE session_id = ? AND decision = 'denied'
         ORDER BY seq DESC LIMIT 1`,
    )
    .get(s.sessionId) as { decision: string; reason: string | null } | undefined
  assert.ok(auditRow, 'expected audit-deny row for action-cap-exceeded')
  assert.match(auditRow.reason ?? '', /action-cap-exceeded/)

  revokeSession(s.sessionId)
})

test('verifier exposes the per-grant cap (grant value wins over default)', async () => {
  // Grant says maxActions=3, default env override would be lower; verify
  // 3 succeed and the 4th is denied — confirming the per-grant value
  // (not the default) is being used.
  const s = mintTestSession({ maxActions: 3, maxActionsPerMinute: 1000 })
  const ctx = { serviceName: 'person-mcp' }

  for (let i = 0; i < 3; i++) {
    const a = await buildSignedAction(s, { actionId: `act-${i}-` + randomUUID() })
    await verifyDelegatedWalletAction({
      action: a.action as Parameters<typeof verifyDelegatedWalletAction>[0]['action'],
      actionSignature: a.signature,
      sessionId: s.sessionId,
    }, ctx)
  }
  const a4 = await buildSignedAction(s, { actionId: 'act-overflow-' + randomUUID() })
  await assert.rejects(
    verifyDelegatedWalletAction({
      action: a4.action as Parameters<typeof verifyDelegatedWalletAction>[0]['action'],
      actionSignature: a4.signature,
      sessionId: s.sessionId,
    }, ctx),
    (err: unknown) => err instanceof DelegatedActionDenied && err.code === 'action-cap-exceeded',
  )

  revokeSession(s.sessionId)
})
