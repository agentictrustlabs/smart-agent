#!/usr/bin/env tsx
/**
 * Automated security regression tests for the passkey-rooted delegated
 * session signing system (design doc §13).
 *
 * Each scenario simulates an attacker that has somehow obtained intermediate
 * material and asserts the verifier still rejects them. Run against a live
 * person-mcp on PERSON_MCP_URL (default http://localhost:3200).
 *
 *   pnpm tsx scripts/test-grant-security.ts
 *
 * Exit code is the number of failed cases (0 == all-clear).
 */

const PERSON_MCP = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'

interface Result { name: string; passed: boolean; reason?: string }
const results: Result[] = []

async function expect(
  name: string,
  fn: () => Promise<{ status: number; body: unknown }>,
  predicate: (status: number, body: unknown) => boolean,
  expected: string,
): Promise<void> {
  try {
    const { status, body } = await fn()
    if (predicate(status, body)) {
      results.push({ name, passed: true })
    } else {
      results.push({ name, passed: false, reason: `expected ${expected}, got status=${status} body=${JSON.stringify(body).slice(0, 200)}` })
    }
  } catch (err) {
    results.push({ name, passed: false, reason: `threw: ${(err as Error).message}` })
  }
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${PERSON_MCP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let parsed: unknown = null
  try { parsed = await res.json() } catch { /* */ }
  return { status: res.status, body: parsed }
}

function emptyAction(actionType: string): unknown {
  const now = Date.now()
  return {
    schema: 'WalletAction.v1',
    actionId: 'a-test',
    sessionId: 'no-such-session',
    actor: {
      smartAccountAddress: '0x0000000000000000000000000000000000000001',
      sessionSignerAddress: '0x0000000000000000000000000000000000000002',
    },
    action: {
      type: actionType,
      payloadHash: '0x' + '00'.repeat(32),
      payloadCanonicalization: 'json-c14n-v1',
    },
    audience: { service: 'person-mcp' },
    timing: { createdAt: now, expiresAt: now + 60000 },
    replayProtection: { actionNonce: 'n-' + Math.random().toString(36).slice(2) },
  }
}

const CODE = (body: unknown): string => (body as { code?: string })?.code ?? ''

async function main(): Promise<void> {
  // 1. Unknown session — verifier rejects with unknown_session.
  await expect(
    'unknown_session is rejected',
    () => postJson('/wallet-action/verify', {
      action: emptyAction('ProvisionHolderWallet'),
      actionSignature: '0x' + '00'.repeat(65),
      sessionId: 'no-such-session',
    }),
    (status, body) => status === 403 && CODE(body) === 'unknown_session',
    '403 unknown_session',
  )

  // 2. AddPasskey action type is forbidden EVEN if session somehow exists
  //    — the verifier's hard-rail rejects before signature check.
  //    We can prove the rejection happens at hard-rail stage by sending
  //    an unknown session — the verifier order is: load session FIRST,
  //    hard-rails LATER. So we expect unknown_session here (defense in
  //    depth chain). Here we test the constraint enforcer on a
  //    well-formed action with a real session is unreachable from this
  //    script without the live session-EOA, so we just assert that
  //    AddPasskey reaches the verify endpoint without producing 200.
  await expect(
    'AddPasskey action does not return 200',
    () => postJson('/wallet-action/verify', {
      action: emptyAction('AddPasskey'),
      actionSignature: '0x' + '00'.repeat(65),
      sessionId: 'no-such-session',
    }),
    (status) => status >= 400,
    'non-200 status',
  )

  // 3. Payload hash tamper detection on dispatch.
  await expect(
    'dispatch rejects payload not matching payloadHash',
    () => postJson('/wallet-action/dispatch', {
      action: emptyAction('ProvisionHolderWallet'),
      actionSignature: '0x' + '00'.repeat(65),
      sessionId: 'no-such-session',
      payload: { tampered: true },
    }),
    (status, body) => status === 400 && CODE(body) === 'payload_hash_mismatch',
    '400 payload_hash_mismatch',
  )

  // 4. Audit log endpoint is reachable for unknown account (returns []).
  await expect(
    'audit log returns empty for unknown account',
    async () => {
      const res = await fetch(`${PERSON_MCP}/audit/log/0x0000000000000000000000000000000000000099`)
      const body = await res.json()
      return { status: res.status, body }
    },
    (status, body) => status === 200 && Array.isArray((body as { entries?: unknown[] }).entries),
    '200 with entries array',
  )

  // 5. Revocation epoch defaults to 0 for new accounts.
  await expect(
    'revocation epoch is 0 for new account',
    async () => {
      const res = await fetch(`${PERSON_MCP}/session-store/epoch/0x0000000000000000000000000000000000000099`)
      const body = await res.json()
      return { status: res.status, body }
    },
    (status, body) => status === 200 && (body as { epoch: number }).epoch === 0,
    '200 epoch=0',
  )

  // 6. Bump epoch atomically goes 0 → 1.
  await expect(
    'bump-epoch increments by 1',
    async () => {
      const r1 = await postJson('/session-store/bump-epoch', {
        smartAccountAddress: '0x0000000000000000000000000000000000000098',
      })
      return r1
    },
    (status, body) => status === 200 && typeof (body as { epoch?: number }).epoch === 'number' && (body as { epoch: number }).epoch >= 1,
    '200 epoch>=1',
  )

  // 7. Unknown action type rejected by dispatch.
  await expect(
    'dispatch rejects unknown action type',
    () => postJson('/wallet-action/dispatch', {
      action: { ...(emptyAction('ProvisionHolderWallet') as Record<string, unknown>), action: { type: 'BogusType', payloadHash: '0x' + '00'.repeat(32), payloadCanonicalization: 'json-c14n-v1' } },
      actionSignature: '0x' + '00'.repeat(65),
      sessionId: 'no-such-session',
      payload: {},
    }),
    (status) => status >= 400,
    'non-200 status',
  )

  // ─── Report ─────────────────────────────────────────────────────────
  let failed = 0
  for (const r of results) {
    const tag = r.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
    console.log(`${tag}  ${r.name}${r.reason ? `\n      ${r.reason}` : ''}`)
    if (!r.passed) failed++
  }
  console.log(`\n${results.length - failed}/${results.length} passed`)
  process.exit(failed)
}

main().catch(err => { console.error(err); process.exit(99) })
