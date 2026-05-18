/**
 * Tests for Hardening Phase 1D #1 — cross-service correlation id.
 *
 * Covers:
 *   1. The middleware echoes back an incoming X-SA-Correlation-Id.
 *   2. The middleware generates a fresh id when absent and echoes it.
 *   3. Audit rows written via auditAppend carry the correlation id from
 *      the request context.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/audit-correlation.test.ts`
 */

process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)
process.env.A2A_KMS_BACKEND = 'local-aes'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { correlationId, CORRELATION_HEADER, newCorrelationId } from '../src/middleware/correlation-id'
import { auditAppend, auditDeny, readCorrelationId } from '../src/lib/audit'
import { db } from '../src/db'
import { executionAudit } from '../src/db/schema'

function mountApp() {
  const app = new Hono()
  app.use('*', correlationId)
  app.get('/ping', (c) => {
    return c.json({ correlationId: readCorrelationId(c) })
  })
  app.post('/audit-write', async (c) => {
    const id = await auditAppend({
      rootGrantHash: '0xroot',
      sessionId: 'sess-test-' + randomUUID(),
      sessionPrincipal: '0xPrincipal',
      mcpServer: 'test',
      mcpTool: 'test:tool',
      mcpCallId: 'call-' + randomUUID(),
      executionPath: 'mcp-only',
      status: 'completed',
      correlationId: readCorrelationId(c),
    })
    return c.json({ rowId: id, correlationId: readCorrelationId(c) })
  })
  app.post('/audit-deny', async (c) => {
    const rowId = await auditDeny(c, {
      route: '/audit-deny',
      reason: 'test denial',
      executionPath: 'mcp-only',
      mcpServer: 'test',
    })
    return c.json({ rowId, correlationId: readCorrelationId(c) }, 403)
  })
  return app
}

test('correlation-id middleware echoes back an incoming id', async () => {
  const app = mountApp()
  const incoming = 'sa-cor-' + 'a'.repeat(32)
  const res = await app.request('/ping', {
    method: 'GET',
    headers: { [CORRELATION_HEADER]: incoming },
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get(CORRELATION_HEADER), incoming)
  const body = await res.json() as { correlationId: string }
  assert.equal(body.correlationId, incoming)
})

test('correlation-id middleware generates a fresh id when absent', async () => {
  const app = mountApp()
  const res = await app.request('/ping', { method: 'GET' })
  assert.equal(res.status, 200)
  const echoed = res.headers.get(CORRELATION_HEADER)
  assert.match(echoed ?? '', /^sa-cor-[0-9a-f]{32}$/)
  const body = await res.json() as { correlationId: string }
  assert.equal(body.correlationId, echoed)
})

test('newCorrelationId produces unique, shape-stable ids', () => {
  const a = newCorrelationId()
  const b = newCorrelationId()
  assert.notEqual(a, b)
  assert.match(a, /^sa-cor-[0-9a-f]{32}$/)
  assert.match(b, /^sa-cor-[0-9a-f]{32}$/)
})

test('audit row written via auditAppend persists the correlation id', async () => {
  const app = mountApp()
  const incoming = 'sa-cor-' + 'b'.repeat(32)
  const res = await app.request('/audit-write', {
    method: 'POST',
    headers: { [CORRELATION_HEADER]: incoming, 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(res.status, 200)
  const { rowId } = await res.json() as { rowId: number }
  const [row] = await db.select().from(executionAudit).where(eq(executionAudit.id, rowId)).limit(1)
  assert.ok(row, 'audit row missing')
  assert.equal(row.correlationId, incoming)
})

test('auditDeny persists status="denied" plus correlation id', async () => {
  const app = mountApp()
  const incoming = 'sa-cor-' + 'c'.repeat(32)
  const res = await app.request('/audit-deny', {
    method: 'POST',
    headers: { [CORRELATION_HEADER]: incoming, 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(res.status, 403)
  const { rowId } = await res.json() as { rowId: number }
  const [row] = await db.select().from(executionAudit).where(eq(executionAudit.id, rowId)).limit(1)
  assert.ok(row, 'audit row missing')
  assert.equal(row.status, 'denied')
  assert.equal(row.correlationId, incoming)
  assert.equal(row.mcpServer, 'test')
  assert.equal(row.mcpTool, '/audit-deny')
  assert.match(row.errorReason, /test denial/)
})

test('correlation-id middleware rejects an overlong incoming header (treats as missing)', async () => {
  const app = mountApp()
  // 200-char incoming — middleware should ignore and synthesize fresh.
  const incoming = 'sa-cor-' + 'x'.repeat(200)
  const res = await app.request('/ping', {
    method: 'GET',
    headers: { [CORRELATION_HEADER]: incoming },
  })
  const echoed = res.headers.get(CORRELATION_HEADER)
  assert.notEqual(echoed, incoming)
  assert.match(echoed ?? '', /^sa-cor-[0-9a-f]{32}$/)
})
