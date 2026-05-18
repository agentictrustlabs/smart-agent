/**
 * Tests for Sprint 1 W2.2 S1.6 — legacy session-table fallback kill
 * switch in `apps/a2a-agent/src/middleware/require-session.ts`.
 *
 * Path A (SessionGrant lookup on person-mcp) is mocked by pointing
 * `PERSON_MCP_URL` at an unreachable host so the `fetch` in
 * `require-session.ts` throws and falls through to Path B (or to the
 * kill-switch denial when disabled).
 *
 * Path B (legacy a2a sessions table) is exercised by seeding a row
 * directly into the `sessions` table.
 *
 * Configuration is read at request time via the live `config` object,
 * which we mutate between tests to flip the kill switch.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/legacy-session-kill.test.ts`
 */

// Configure env BEFORE importing config / middleware so module init sees
// the values. Path A is mocked by pointing at an unreachable address —
// the fetch in require-session.ts will throw and fall through.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'e'.repeat(64)
process.env.PERSON_MCP_URL = 'http://127.0.0.1:1'
process.env.NODE_ENV = 'development'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { config } from '../src/config'
import { requireSession } from '../src/middleware/require-session'
import { correlationId } from '../src/middleware/correlation-id'
import { db } from '../src/db'
import { sessions, executionAudit } from '../src/db/schema'

function mountApp() {
  const app = new Hono()
  app.use('*', correlationId)
  app.get('/protected', requireSession, (c) => {
    const sess = c.get('session')
    return c.json({ ok: true, sessionId: sess.id })
  })
  return app
}

async function seedLegacySession(): Promise<string> {
  const id = 'sess-legacy-' + randomUUID()
  await db.insert(sessions).values({
    id,
    accountAddress: '0x' + '1'.repeat(40),
    sessionKeyAddress: '0x' + '2'.repeat(40),
    encryptedPackage: null,
    iv: null,
    status: 'active',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })
  return id
}

async function latestDenyRowForRoute(routePath: string) {
  const rows = await db
    .select()
    .from(executionAudit)
    .where(eq(executionAudit.status, 'denied'))
    .orderBy(desc(executionAudit.id))
    .limit(20)
  for (const r of rows) {
    if (r.mcpTool === routePath) return r
  }
  return null
}

// Mutate-friendly handle to flip the kill switch. `as const` is a
// type-level guarantee, not a runtime freeze; we lean on that here.
function setAllowLegacy(value: boolean) {
  ;(config as { ALLOW_LEGACY_A2A_SESSIONS: boolean }).ALLOW_LEGACY_A2A_SESSIONS = value
}

// ─── Path B in dev (default true) ────────────────────────────────────

test('dev default (ALLOW_LEGACY_A2A_SESSIONS=true) → Path B fires for a legacy session bearer', async () => {
  setAllowLegacy(true)
  const id = await seedLegacySession()
  const app = mountApp()
  const res = await app.request('/protected', {
    method: 'GET',
    headers: { Authorization: `Bearer ${id}` },
  })
  assert.equal(res.status, 200)
  const body = await res.json() as { ok: boolean; sessionId: string }
  assert.equal(body.ok, true)
  assert.equal(body.sessionId, id)
})

// ─── Path B in prod with default flag → blocked + audit-deny ─────────

test('prod with default flag (false) → Path B rejected with 401 + audit-deny row', async () => {
  setAllowLegacy(false)
  const id = await seedLegacySession()
  const app = mountApp()
  const res = await app.request('/protected', {
    method: 'GET',
    headers: { Authorization: `Bearer ${id}` },
  })
  assert.equal(res.status, 401)
  const row = await latestDenyRowForRoute('/protected')
  assert.ok(row, 'expected audit-deny row tagged legacy-session-fallback-disabled')
  assert.equal(row.status, 'denied')
  assert.match(row.errorReason, /legacy-session-fallback-disabled/)
})

// ─── Prod with explicit opt-in → escape hatch works ──────────────────

test('prod with explicit ALLOW_LEGACY_A2A_SESSIONS=true → Path B fires (escape hatch)', async () => {
  setAllowLegacy(true)
  const id = await seedLegacySession()
  const app = mountApp()
  const res = await app.request('/protected', {
    method: 'GET',
    headers: { Authorization: `Bearer ${id}` },
  })
  assert.equal(res.status, 200)
  const body = await res.json() as { ok: boolean; sessionId: string }
  assert.equal(body.sessionId, id)
})

// ─── Path A regardless of flag ───────────────────────────────────────
//
// When Path A returns a valid SessionGrant we never reach the kill
// switch. We assert that by pointing fetch at a tiny in-process server
// that returns a synthesized grant, then turning the kill switch OFF
// (default-prod posture). The request must still succeed.

test('Path A always works regardless of ALLOW_LEGACY_A2A_SESSIONS=false', async () => {
  setAllowLegacy(false)

  // Intercept `fetch` so the SessionGrant lookup (Path A) returns a
  // synthesized record. PERSON_MCP_URL is captured at module load so we
  // can't repoint the URL — we mock the call instead.
  const sessionId = 'sess-grant-' + randomUUID()
  const accountAddress = '0x' + 'a'.repeat(40)
  const signerAddress = '0x' + 'b'.repeat(40)
  const realFetch = globalThis.fetch
  ;(globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as URL).toString()
    if (url.includes('/session-store/by-cookie/')) {
      const record = {
        sessionId,
        smartAccountAddress: accountAddress,
        sessionSignerAddress: signerAddress,
        grant: { audience: ['a2a-agent'] },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }
      return new Response(JSON.stringify({ record }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return realFetch(input as RequestInfo)
  }) as typeof fetch

  try {
    const app = mountApp()
    const res = await app.request('/protected', {
      method: 'GET',
      headers: { Authorization: 'Bearer any-grant-token' },
    })
    assert.equal(res.status, 200)
    const body = await res.json() as { ok: boolean; sessionId: string }
    assert.equal(body.sessionId, sessionId)
  } finally {
    ;(globalThis as { fetch: typeof fetch }).fetch = realFetch
  }
})
