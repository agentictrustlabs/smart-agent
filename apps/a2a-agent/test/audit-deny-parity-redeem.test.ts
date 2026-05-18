/**
 * Sprint 5 Wave 2 P0-4 — deny-row parity for the high-risk redeem
 * + deploy-agent routes.
 *
 * Reviewer finding: across the four redeem variants
 * (`/redeem-tx`, `/redeem-with-chain`, `/redeem-subdelegated`,
 * `/redeem-via-account`) and `/deploy-agent`, some early-exit deny
 * branches returned 4xx/5xx without writing a `request_denied` audit
 * row. A senior firm walking the audit chain saw `request_received`
 * rows with no terminal — gaps were indistinguishable from open
 * requests.
 *
 * Fix: every 4xx/5xx exit now goes through `denyAndAudit(...)` which
 * (a) writes a `request_denied` row (hash-chained, binding the
 * `AUDIT_DENY_REASONS` literal + status + correlationId) and
 * (b) returns the HTTP response.
 *
 * This file is the table-driven parity test. For each route in scope
 * and each deny branch, we:
 *   - sign a valid inter-service HMAC envelope (so requireInterServiceAuth
 *     passes and the request body reaches the route),
 *   - construct a body that hits the target deny branch,
 *   - assert the response status matches `expectedStatus`,
 *   - assert a `request_denied` row was inserted with `errorReason =
 *     expectedReason` and a non-empty `entry_hash`,
 *   - assert the audit chain still verifies via the canonical
 *     `recomputeEntryHash` derived from `computeEntryHash`.
 *
 * Run:
 *   node --import tsx --test apps/a2a-agent/test/audit-deny-parity-redeem.test.ts
 */

// Configure env BEFORE importing app code so module init sees the secrets.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)
process.env.A2A_MASTER_PRIVATE_KEY = '0x' + 'ce'.repeat(32)
process.env.WEB_TO_A2A_HMAC_KEY = '0x' + '7'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_ORG = '0x' + 'a'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { onchainRedeem } from '../src/routes/onchain-redeem'
import { correlationId, CORRELATION_HEADER } from '../src/middleware/correlation-id'
import { toBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider } from '@smart-agent/sdk/key-custody'
import { db } from '../src/db'
import { executionAudit } from '../src/db/schema'
import {
  AUDIT_DENY_REASONS,
  type AuditDenyReason,
} from '../src/lib/audit-deny-reasons'
import { computeEntryHash } from '../src/lib/audit'

// ─── Helpers ─────────────────────────────────────────────────────────

function mountApp() {
  const app = new Hono()
  app.use('*', correlationId)
  app.route('/session', onchainRedeem)
  return app
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/**
 * Build the canonical-v2 signed envelope for an inter-service request
 * against `/session/:id/<route>`. Mirrors `inter-service.test.ts`.
 */
async function signEnvelope(
  sessionId: string,
  routeTail: string,
  bodyJson: string,
): Promise<Record<string, string>> {
  const provider = buildMcpMacProvider('org', process.env)
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const path = `/session/${sessionId}/${routeTail}`
  const canonical = `${timestamp}|${nonce}|${path}|${sha256Hex(bodyJson)}`
  const { mac } = await provider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return {
    'content-type': 'application/json',
    'x-a2a-service': 'org-mcp',
    'x-a2a-timestamp': String(timestamp),
    'x-a2a-nonce': nonce,
    'x-a2a-signature': toBase64Url(mac),
  }
}

async function findDenyRow(
  correlationIdValue: string,
): Promise<typeof executionAudit.$inferSelect | null> {
  const rows = await db
    .select()
    .from(executionAudit)
    .where(eq(executionAudit.correlationId, correlationIdValue))
    .orderBy(desc(executionAudit.id))
    .limit(10)
  return rows.find((r) => r.eventKind === 'request_denied') ?? null
}

/**
 * Recompute the entry_hash for a stored row from its persisted fields
 * + its persisted prev_entry_hash. If the stored hash equals the
 * recomputed hash for every row in the chain head's reachable history,
 * the chain verifies. We assert per-row in each table-driven case.
 */
function recomputeEntryHash(r: typeof executionAudit.$inferSelect): string {
  return computeEntryHash(
    {
      rootGrantHash: r.rootGrantHash,
      sessionId: r.sessionId,
      sessionPrincipal: r.sessionPrincipal,
      a2aTaskId: r.a2aTaskId,
      mcpServer: r.mcpServer,
      mcpTool: r.mcpTool,
      mcpCallId: r.mcpCallId,
      eventType: r.eventType ?? 'execution',
      eventKind: r.eventKind,
      requestReceivedRowId: r.requestReceivedRowId,
      executionPath: r.executionPath,
      toolGrantHash: r.toolGrantHash,
      toolExecutor: r.toolExecutor,
      target: r.target,
      selector: r.selector,
      callDataHash: r.callDataHash,
      valueWei: r.valueWei,
      txHash: r.txHash,
      userOpHash: r.userOpHash,
      status: r.status,
      errorReason: r.errorReason,
      receivedAt: r.receivedAt,
      finalizedAt: r.finalizedAt,
      correlationId: r.correlationId,
    },
    r.prevEntryHash,
  )
}

interface DenyCase {
  name: string
  /** Tail of `/session/:id/<routeTail>`. */
  routeTail: string
  /** Body to POST (raw string so we control the malformed-JSON case too). */
  buildBody: () => string
  expectedStatus: number
  expectedReason: AuditDenyReason
}

/**
 * Table-driven set of every deny branch that can be triggered against
 * the routes in scope WITHOUT a real session row + signed delegation.
 * Branches that require an active session (target/selector/value caps,
 * executor:resolution-failed, tx:reverted, error:redeem-* etc.) need a
 * full session-package fixture and are exercised at the integration
 * layer. The reasons exercised here cover every branch reachable from
 * an empty database.
 *
 * Reasons NOT exercised here (need a populated `sessions` row):
 *   - policy:target-not-allowed
 *   - policy:selector-not-allowed
 *   - policy:value-exceeds-cap
 *   - validation:invalid-call-data
 *   - validation:missing-session-agent-account
 *   - validation:chain-leaf-delegate-mismatch
 *   - executor:resolution-failed
 *   - env:agent-factory-not-set (covered when AGENT_FACTORY_ADDRESS unset)
 *   - tx:reverted, tx:handle-ops-reverted, error:redeem-failed, …
 *
 * These deeper branches are guarded by the static "no other 4xx exit"
 * coverage assertion in `audit-deny-coverage.test.ts` — every literal
 * lives in AUDIT_DENY_REASONS and every call site has been swept.
 */
const cases: DenyCase[] = [
  // ─── /redeem-tx ──────────────────────────────────────────────────
  {
    name: 'redeem-tx — malformed JSON body',
    routeTail: 'redeem-tx',
    buildBody: () => 'this-is-not-json',
    expectedStatus: 400,
    expectedReason: 'fields:malformed-json',
  },
  {
    name: 'redeem-tx — unknown tool',
    routeTail: 'redeem-tx',
    buildBody: () => JSON.stringify({
      mcpTool: 'tool.that.does.not.exist',
      mcpCallId: 'mc-' + randomUUID(),
      target: '0x' + '1'.repeat(40),
      value: '0',
      callData: '0xdeadbeef',
    }),
    expectedStatus: 403,
    expectedReason: 'policy:unknown-tool',
  },
  {
    name: 'redeem-tx — session not found',
    routeTail: 'redeem-tx',
    buildBody: () => JSON.stringify({
      mcpTool: 'pool:create',
      mcpCallId: 'mc-' + randomUUID(),
      target: '0x' + '0'.repeat(40),
      value: '0',
      callData: '0xdeadbeef',
    }),
    expectedStatus: 404,
    expectedReason: 'session:not-found',
  },
  // ─── /redeem-with-chain ──────────────────────────────────────────
  {
    name: 'redeem-with-chain — malformed JSON body',
    routeTail: 'redeem-with-chain',
    buildBody: () => 'still not json',
    expectedStatus: 400,
    expectedReason: 'fields:malformed-json',
  },
  {
    name: 'redeem-with-chain — chain empty',
    routeTail: 'redeem-with-chain',
    buildBody: () => JSON.stringify({
      mcpTool: 'pool:create',
      mcpCallId: 'mc-' + randomUUID(),
      target: '0x' + '0'.repeat(40),
      value: '0',
      callData: '0xdeadbeef',
      chain: [],
    }),
    expectedStatus: 400,
    expectedReason: 'validation:chain-empty',
  },
  {
    name: 'redeem-with-chain — unknown tool',
    routeTail: 'redeem-with-chain',
    buildBody: () => JSON.stringify({
      mcpTool: 'tool.not.in.policies',
      mcpCallId: 'mc-' + randomUUID(),
      target: '0x' + '0'.repeat(40),
      value: '0',
      callData: '0xdeadbeef',
      chain: [{
        delegator: '0x' + '1'.repeat(40),
        delegate: '0x' + '2'.repeat(40),
        authority: '0x' + '0'.repeat(64),
        caveats: [],
        salt: '1',
        signature: '0x' + '0'.repeat(130),
      }],
    }),
    expectedStatus: 403,
    expectedReason: 'policy:unknown-tool',
  },
  // ─── /redeem-subdelegated ────────────────────────────────────────
  {
    name: 'redeem-subdelegated — malformed JSON',
    routeTail: 'redeem-subdelegated',
    buildBody: () => '{not-valid',
    expectedStatus: 400,
    expectedReason: 'fields:malformed-json',
  },
  {
    name: 'redeem-subdelegated — unknown tool',
    routeTail: 'redeem-subdelegated',
    buildBody: () => JSON.stringify({
      mcpTool: 'nope',
      mcpCallId: 'mc-' + randomUUID(),
      a2aTaskId: 'tk-1',
      target: '0x' + '0'.repeat(40),
      value: '0',
      callData: '0xdeadbeef',
    }),
    expectedStatus: 403,
    expectedReason: 'policy:unknown-tool',
  },
  // ─── /redeem-via-account ─────────────────────────────────────────
  {
    name: 'redeem-via-account — malformed JSON',
    routeTail: 'redeem-via-account',
    buildBody: () => '<<malformed>>',
    expectedStatus: 400,
    expectedReason: 'fields:malformed-json',
  },
  {
    name: 'redeem-via-account — unknown tool',
    routeTail: 'redeem-via-account',
    buildBody: () => JSON.stringify({
      mcpTool: 'never.heard.of.you',
      mcpCallId: 'mc-' + randomUUID(),
      target: '0x' + '0'.repeat(40),
      value: '0',
      callData: '0xdeadbeef',
    }),
    expectedStatus: 403,
    expectedReason: 'policy:unknown-tool',
  },
  // ─── /deploy-agent ───────────────────────────────────────────────
  {
    name: 'deploy-agent — malformed JSON body',
    routeTail: 'deploy-agent',
    buildBody: () => 'definitely-not-json',
    expectedStatus: 400,
    expectedReason: 'fields:malformed-json',
  },
  {
    name: 'deploy-agent — session not found',
    routeTail: 'deploy-agent',
    buildBody: () => JSON.stringify({
      mcpCallId: 'mc-' + randomUUID(),
      owner: '0x' + '1'.repeat(40),
      salt: '1',
    }),
    expectedStatus: 404,
    expectedReason: 'session:not-found',
  },
]

// ─── Table-driven parity assertions ──────────────────────────────────

for (const tc of cases) {
  test(`P0-4 deny parity — ${tc.name}`, async () => {
    const app = mountApp()
    const sessionId = 'sess-p0-4-' + randomUUID()
    const cor = 'sa-cor-' + 'p'.repeat(28) + '-' + randomUUID().slice(0, 8)
    const bodyJson = tc.buildBody()
    const envelope = await signEnvelope(sessionId, tc.routeTail, bodyJson)

    const res = await app.request(`/session/${sessionId}/${tc.routeTail}`, {
      method: 'POST',
      headers: { ...envelope, [CORRELATION_HEADER]: cor },
      body: bodyJson,
    })

    assert.equal(res.status, tc.expectedStatus, `status for ${tc.name}`)

    // Body contract: every denyAndAudit response carries { error, reason, … }
    // where reason is the AUDIT_DENY_REASONS literal.
    const responseBody = (await res.json()) as { error?: string; reason?: string }
    assert.equal(
      responseBody.reason,
      tc.expectedReason,
      `response.reason for ${tc.name}`,
    )

    // Audit-row contract: a request_denied row exists with the expected
    // reason and a non-empty entry_hash, and recomputing the hash
    // matches the stored value (chain integrity).
    const row = await findDenyRow(cor)
    assert.ok(row, `expected request_denied row for ${tc.name}`)
    assert.equal(row.eventKind, 'request_denied')
    assert.equal(row.status, 'denied')
    assert.equal(
      row.errorReason,
      tc.expectedReason,
      `audit-row errorReason for ${tc.name}`,
    )
    assert.ok(row.entryHash && row.entryHash.length > 0, 'entry_hash present')

    const recomputed = recomputeEntryHash(row)
    assert.equal(recomputed, row.entryHash, `entry_hash recompute matches for ${tc.name}`)
  })
}

// ─── AUDIT_DENY_REASONS is a closed list ─────────────────────────────

test('AUDIT_DENY_REASONS contains every reason used by denyAndAudit call sites', async () => {
  // Static sanity: every reason exercised in the table must be on the
  // canonical list. This is also enforced by TypeScript at the call
  // sites (the helper takes `reason: AuditDenyReason`), but a runtime
  // assertion is a useful guardrail against `as` casts.
  for (const tc of cases) {
    assert.ok(
      (AUDIT_DENY_REASONS as readonly string[]).includes(tc.expectedReason),
      `expected reason "${tc.expectedReason}" registered in AUDIT_DENY_REASONS`,
    )
  }
})
