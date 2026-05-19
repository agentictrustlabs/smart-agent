/**
 * Spec 007 Phase G.1 — cross-tenant property tests for person-mcp.
 *
 * The architectural commitment: multi-tenant isolation is a PROPERTY of
 * the system, not a convention. For every tool that reads user data,
 * principal A's invocation MUST NEVER return principal B's data. The
 * tool surface is black-box tested: we exercise the actual exported
 * handler, not the SQL layer.
 *
 * Mechanism:
 *   1. Stub `principal-context.js` via `node:test`'s `mock.module` so
 *      the handler's `requirePrincipal(token, …)` call returns whichever
 *      principal we choose. This bypasses the on-chain delegation
 *      verifier (which would otherwise need a live anvil node) while
 *      still exercising the full handler logic — token-to-principal
 *      mapping is the same boundary the production verifier produces.
 *   2. Seed two principals (PRINCIPAL_A, PRINCIPAL_B) with known-distinct
 *      data in every read-bearing table.
 *   3. Call each tool's handler as A, assert the response contains ONLY
 *      A-tagged rows and ZERO B-tagged rows. Symmetric assertion for B.
 *   4. For deterministic coverage in lieu of fast-check (not in the
 *      workspace dep set), enumerate combinations of (caller, target)
 *      and assert no operation by A ever surfaces B's data.
 *
 * Run:
 *   node --import tsx --experimental-test-module-mocks --test \
 *     apps/person-mcp/test/cross-tenant-isolation.test.ts
 */

// Configure env BEFORE importing anything that reads it.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = '0x' + 'a'.repeat(64)
// Test-scoped DB so concurrent runs of other tests don't see seeded data.
process.env.PERSON_MCP_DB_PATH = process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.isolation.test.db'

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

// ─── Module mock — patch principal-context.js BEFORE any tool import ──
//
// The mock replaces both export names with stubs whose behavior is
// controlled by `setCurrentPrincipal(...)`. Every tool calls
// `requirePrincipal(args.token, '<toolname>')`; the stub returns whatever
// principal we set. The token argument is ignored; we use it as a poor-
// man's correlation handle in case a test needs to inspect what was
// passed.

let CURRENT_PRINCIPAL = '0x0000000000000000000000000000000000000000'
const principalSeen: string[] = []

function setCurrentPrincipal(p: string) {
  CURRENT_PRINCIPAL = p.toLowerCase()
}

mock.module('../src/auth/principal-context.js', {
  namedExports: {
    requirePrincipal: async (token: string | undefined, _toolName?: string): Promise<string> => {
      if (!token) throw new Error('Missing delegation token')
      principalSeen.push(token)
      return CURRENT_PRINCIPAL
    },
  },
})

// ─── Now the imports — tool modules pull the mocked principal-context ──

const { oikosTools } = await import('../src/tools/oikos.js')
const { prayersTools } = await import('../src/tools/prayers.js')
const { trainingTools } = await import('../src/tools/training.js')
const { coachingTools } = await import('../src/tools/coaching.js')
const { receivedDelegationsTools } = await import('../src/tools/received-delegations.js')
const { notificationsTools } = await import('../src/tools/notifications.js')
const { beliefsTools } = await import('../src/tools/beliefs.js')
const { pinnedTools } = await import('../src/tools/pinned.js')
const { sqlite } = await import('../src/db/index.js')

// ─── Test principals ──────────────────────────────────────────────────

const PRINCIPAL_A = '0xaaaa00000000000000000000000000000000aaaa'
const PRINCIPAL_B = '0xbbbb00000000000000000000000000000000bbbb'
const TOKEN_A = 'fake-token-for-principal-A'
const TOKEN_B = 'fake-token-for-principal-B'

// Each tool-MCP response is `{ content: [{ type: 'text', text: '<json>' }] }`.
// Unwrap to the JSON payload.
function unwrap(resp: unknown): unknown {
  const wrapped = resp as { content: Array<{ text: string }> }
  return JSON.parse(wrapped.content[0].text)
}

// Build a deep-search predicate: returns true iff `needle` appears anywhere
// in the JSON-stringified `haystack`. Catches leakage no matter where in the
// response shape the cross-tenant value surfaces.
function jsonContains(haystack: unknown, needle: string): boolean {
  return JSON.stringify(haystack).toLowerCase().includes(needle.toLowerCase())
}

// ─── Seed helpers ─────────────────────────────────────────────────────

function seedData() {
  // Wipe + seed every table we read. Each principal gets ONE row per table
  // with a distinctive marker we can search for. Most tables use the
  // `principal` column; `received_delegations` uses `holder_principal`.
  const principalTables = [
    'oikos_contacts',
    'prayers',
    'training_progress',
    'coaching_notes',
    'notifications',
    'beliefs',
    'pinned_items',
  ]
  for (const t of principalTables) {
    sqlite.exec(`DELETE FROM ${t} WHERE principal LIKE '0xaaaa%' OR principal LIKE '0xbbbb%'`)
  }
  sqlite.exec(`DELETE FROM received_delegations WHERE holder_principal LIKE '0xaaaa%' OR holder_principal LIKE '0xbbbb%'`)

  const now = new Date().toISOString()

  // oikos_contacts
  sqlite.prepare(
    `INSERT INTO oikos_contacts (id, principal, person_name, proximity, planned_conversation, created_at, updated_at)
     VALUES (?, ?, ?, 'ring1', 0, ?, ?)`,
  ).run('oikos-A', PRINCIPAL_A, 'AliceMarker', now, now)
  sqlite.prepare(
    `INSERT INTO oikos_contacts (id, principal, person_name, proximity, planned_conversation, created_at, updated_at)
     VALUES (?, ?, ?, 'ring1', 0, ?, ?)`,
  ).run('oikos-B', PRINCIPAL_B, 'BobMarker', now, now)

  // prayers
  sqlite.prepare(
    `INSERT INTO prayers (id, principal, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('prayer-A', PRINCIPAL_A, 'AlicePrayerTitle', 'AlicePrayerBody', now, now)
  sqlite.prepare(
    `INSERT INTO prayers (id, principal, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('prayer-B', PRINCIPAL_B, 'BobPrayerTitle', 'BobPrayerBody', now, now)

  // training_progress
  sqlite.prepare(
    `INSERT INTO training_progress (id, principal, module_key, status, hours_logged, updated_at)
     VALUES (?, ?, ?, 'completed', 3, ?)`,
  ).run('train-A', PRINCIPAL_A, 'AliceModule', now)
  sqlite.prepare(
    `INSERT INTO training_progress (id, principal, module_key, status, hours_logged, updated_at)
     VALUES (?, ?, ?, 'completed', 3, ?)`,
  ).run('train-B', PRINCIPAL_B, 'BobModule', now)

  // coaching_notes — coach owns row (PRINCIPAL_A / PRINCIPAL_B)
  sqlite.prepare(
    `INSERT INTO coaching_notes (id, principal, subject_agent, content, shared_with_subject, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run('coach-A', PRINCIPAL_A, '0xsubjectA', 'AliceCoachingNote', now, now)
  sqlite.prepare(
    `INSERT INTO coaching_notes (id, principal, subject_agent, content, shared_with_subject, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run('coach-B', PRINCIPAL_B, '0xsubjectB', 'BobCoachingNote', now, now)

  // received_delegations
  sqlite.prepare(
    `INSERT INTO received_delegations (id, holder_principal, delegator_principal, audience, kind, subject_label, delegation_json, delegation_hash, created_at)
     VALUES (?, ?, ?, 'person-mcp', 'coaching', 'AliceReceivedLabel', '{}', ?, ?)`,
  ).run('recv-A', PRINCIPAL_A, '0xdelegatorA', '0xhashA', now)
  sqlite.prepare(
    `INSERT INTO received_delegations (id, holder_principal, delegator_principal, audience, kind, subject_label, delegation_json, delegation_hash, created_at)
     VALUES (?, ?, ?, 'person-mcp', 'coaching', 'BobReceivedLabel', '{}', ?, ?)`,
  ).run('recv-B', PRINCIPAL_B, '0xdelegatorB', '0xhashB', now)

  // notifications
  sqlite.prepare(
    `INSERT INTO notifications (id, principal, kind, payload, created_at)
     VALUES (?, ?, 'invite-received', ?, ?)`,
  ).run('notif-A', PRINCIPAL_A, '{"marker":"AliceNotifPayload"}', now)
  sqlite.prepare(
    `INSERT INTO notifications (id, principal, kind, payload, created_at)
     VALUES (?, ?, 'invite-received', ?, ?)`,
  ).run('notif-B', PRINCIPAL_B, '{"marker":"BobNotifPayload"}', now)

  // beliefs
  sqlite.prepare(
    `INSERT INTO beliefs (id, principal, statement, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('belief-A', PRINCIPAL_A, 'AliceBeliefStatement', now, now)
  sqlite.prepare(
    `INSERT INTO beliefs (id, principal, statement, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('belief-B', PRINCIPAL_B, 'BobBeliefStatement', now, now)

  // pinned_items
  sqlite.prepare(
    `INSERT INTO pinned_items (id, principal, item_type, item_ref, display_order, created_at)
     VALUES (?, ?, 'agent', ?, 0, ?)`,
  ).run('pin-A', PRINCIPAL_A, '0xAliceItemRef', now)
  sqlite.prepare(
    `INSERT INTO pinned_items (id, principal, item_type, item_ref, display_order, created_at)
     VALUES (?, ?, 'agent', ?, 0, ?)`,
  ).run('pin-B', PRINCIPAL_B, '0xBobItemRef', now)
}

before(() => seedData())
beforeEach(() => seedData())

// ─── Per-tool isolation cases ─────────────────────────────────────────

// Every tool gets two checks:
//   1. As A, response contains A's marker, NOT B's marker.
//   2. As B, response contains B's marker, NOT A's marker.
// That gives 2 negative assertions per read tool.

test('list_oikos_contacts: A sees only Alice, never Bob', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await oikosTools.list_oikos_contacts.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceMarker'), 'expected Alice in A\'s response')
  assert.equal(jsonContains(res, 'BobMarker'), false, 'CROSS-TENANT LEAK: Bob appeared in A\'s oikos list')
})

test('list_oikos_contacts: B sees only Bob, never Alice', async () => {
  setCurrentPrincipal(PRINCIPAL_B)
  const res = unwrap(await oikosTools.list_oikos_contacts.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobMarker'))
  assert.equal(jsonContains(res, 'AliceMarker'), false, 'CROSS-TENANT LEAK: Alice appeared in B\'s oikos list')
})

test('list_prayers: A sees only Alice\'s prayer, never Bob\'s', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await prayersTools.list_prayers.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AlicePrayerTitle'))
  assert.equal(jsonContains(res, 'BobPrayerTitle'), false)
  assert.equal(jsonContains(res, 'BobPrayerBody'), false)
})

test('list_prayers: B sees only Bob\'s prayer, never Alice\'s', async () => {
  setCurrentPrincipal(PRINCIPAL_B)
  const res = unwrap(await prayersTools.list_prayers.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobPrayerTitle'))
  assert.equal(jsonContains(res, 'AlicePrayerTitle'), false)
})

test('list_training_progress: A sees only AliceModule, never BobModule', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await trainingTools.list_training_progress.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceModule'))
  assert.equal(jsonContains(res, 'BobModule'), false)
})

test('list_training_progress: B sees only BobModule, never AliceModule', async () => {
  setCurrentPrincipal(PRINCIPAL_B)
  const res = unwrap(await trainingTools.list_training_progress.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobModule'))
  assert.equal(jsonContains(res, 'AliceModule'), false)
})

test('list_coaching_notes: A sees only AliceCoachingNote, never BobCoachingNote', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await coachingTools.list_coaching_notes.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceCoachingNote'))
  assert.equal(jsonContains(res, 'BobCoachingNote'), false)
})

test('list_coaching_notes: B sees only BobCoachingNote, never AliceCoachingNote', async () => {
  setCurrentPrincipal(PRINCIPAL_B)
  const res = unwrap(await coachingTools.list_coaching_notes.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobCoachingNote'))
  assert.equal(jsonContains(res, 'AliceCoachingNote'), false)
})

test('list_received_delegations: A sees only AliceReceivedLabel, never BobReceivedLabel', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await receivedDelegationsTools.list_received_delegations.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceReceivedLabel'))
  assert.equal(jsonContains(res, 'BobReceivedLabel'), false)
})

test('list_received_delegations: B sees only BobReceivedLabel, never AliceReceivedLabel', async () => {
  setCurrentPrincipal(PRINCIPAL_B)
  const res = unwrap(await receivedDelegationsTools.list_received_delegations.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobReceivedLabel'))
  assert.equal(jsonContains(res, 'AliceReceivedLabel'), false)
})

test('list_notifications: A sees only AliceNotifPayload, never BobNotifPayload', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await notificationsTools.list_notifications.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceNotifPayload'))
  assert.equal(jsonContains(res, 'BobNotifPayload'), false)
})

test('list_notifications: B sees only BobNotifPayload, never AliceNotifPayload', async () => {
  setCurrentPrincipal(PRINCIPAL_B)
  const res = unwrap(await notificationsTools.list_notifications.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobNotifPayload'))
  assert.equal(jsonContains(res, 'AliceNotifPayload'), false)
})

test('list_beliefs: A sees only AliceBeliefStatement, never BobBeliefStatement', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await beliefsTools.list_beliefs.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceBeliefStatement'))
  assert.equal(jsonContains(res, 'BobBeliefStatement'), false)
})

test('list_beliefs: B sees only BobBeliefStatement, never AliceBeliefStatement', async () => {
  setCurrentPrincipal(PRINCIPAL_B)
  const res = unwrap(await beliefsTools.list_beliefs.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobBeliefStatement'))
  assert.equal(jsonContains(res, 'AliceBeliefStatement'), false)
})

test('list_pinned_items: A sees only AliceItemRef, never BobItemRef', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await pinnedTools.list_pinned_items.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, '0xAliceItemRef'))
  assert.equal(jsonContains(res, '0xBobItemRef'), false)
})

test('list_pinned_items: B sees only BobItemRef, never AliceItemRef', async () => {
  setCurrentPrincipal(PRINCIPAL_B)
  const res = unwrap(await pinnedTools.list_pinned_items.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, '0xBobItemRef'))
  assert.equal(jsonContains(res, '0xAliceItemRef'), false)
})

// ─── Cross-tenant write attempts: A tries to mutate B's data by id ──
//
// The pattern in these tools: handler accepts an `id` arg and updates
// where `id = ? AND principal = ?`. A request from A with B's id MUST
// result in 0 rows affected (or `{ updated: false }`), never B's row
// being modified.

test('update_oikos_contact: A cannot update B\'s contact by id', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await oikosTools.update_oikos_contact.handler({
    token: TOKEN_A,
    id: 'oikos-B', // Bob's row
    personName: 'PWNED-BY-ALICE',
  })) as { updated: boolean }
  assert.equal(res.updated, false, 'CROSS-TENANT LEAK: A wrote to B\'s oikos contact')
  // Sanity: B's row still has 'BobMarker'
  const row = sqlite.prepare(`SELECT person_name FROM oikos_contacts WHERE id = 'oikos-B'`).get() as { person_name: string }
  assert.equal(row.person_name, 'BobMarker', 'CROSS-TENANT LEAK: B\'s row was mutated')
})

test('delete_oikos_contact: A cannot delete B\'s contact by id', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  const res = unwrap(await oikosTools.delete_oikos_contact.handler({
    token: TOKEN_A,
    id: 'oikos-B',
  })) as { deleted: boolean }
  assert.equal(res.deleted, false)
  // Sanity: B's row still exists
  const row = sqlite.prepare(`SELECT id FROM oikos_contacts WHERE id = 'oikos-B'`).get()
  assert.ok(row, 'CROSS-TENANT LEAK: A deleted B\'s row')
})

test('toggle_planned_conversation: A cannot toggle B\'s flag', async () => {
  setCurrentPrincipal(PRINCIPAL_A)
  // B's row id = 'oikos-B'. Per the tool's source it throws if the
  // (id, principal) pair finds nothing. We assert it throws — that is
  // the "explicit not found" negative case.
  await assert.rejects(
    () => oikosTools.toggle_planned_conversation.handler({ token: TOKEN_A, id: 'oikos-B' }),
    /not found|not owned/i,
  )
})

// ─── Property-style: enumerated pairwise isolation ──────────────────
//
// For every (caller, target-marker) pair in {A,B}×{A,B}, assert:
//   - caller sees own marker
//   - caller does NOT see the OTHER principal's marker
// across every list tool. This gives 2 callers × 8 list-tools × 2
// markers = 32 micro-assertions in a single property-style enumeration.

const LIST_TOOLS: Array<{ name: string; handler: (a: { token: string }) => Promise<unknown>; aMarker: string; bMarker: string }> = [
  { name: 'list_oikos_contacts', handler: oikosTools.list_oikos_contacts.handler as never, aMarker: 'AliceMarker', bMarker: 'BobMarker' },
  { name: 'list_prayers', handler: prayersTools.list_prayers.handler as never, aMarker: 'AlicePrayerTitle', bMarker: 'BobPrayerTitle' },
  { name: 'list_training_progress', handler: trainingTools.list_training_progress.handler as never, aMarker: 'AliceModule', bMarker: 'BobModule' },
  { name: 'list_coaching_notes', handler: coachingTools.list_coaching_notes.handler as never, aMarker: 'AliceCoachingNote', bMarker: 'BobCoachingNote' },
  { name: 'list_received_delegations', handler: receivedDelegationsTools.list_received_delegations.handler as never, aMarker: 'AliceReceivedLabel', bMarker: 'BobReceivedLabel' },
  { name: 'list_notifications', handler: notificationsTools.list_notifications.handler as never, aMarker: 'AliceNotifPayload', bMarker: 'BobNotifPayload' },
  { name: 'list_beliefs', handler: beliefsTools.list_beliefs.handler as never, aMarker: 'AliceBeliefStatement', bMarker: 'BobBeliefStatement' },
  { name: 'list_pinned_items', handler: pinnedTools.list_pinned_items.handler as never, aMarker: '0xAliceItemRef', bMarker: '0xBobItemRef' },
]

test('PROPERTY: for every list tool, A never sees B\'s marker (and vice-versa)', async () => {
  for (const t of LIST_TOOLS) {
    setCurrentPrincipal(PRINCIPAL_A)
    const asA = unwrap(await t.handler({ token: TOKEN_A }))
    assert.ok(jsonContains(asA, t.aMarker), `${t.name}: A should see A's data`)
    assert.equal(jsonContains(asA, t.bMarker), false, `${t.name}: A LEAKED B's data`)

    setCurrentPrincipal(PRINCIPAL_B)
    const asB = unwrap(await t.handler({ token: TOKEN_B }))
    assert.ok(jsonContains(asB, t.bMarker), `${t.name}: B should see B's data`)
    assert.equal(jsonContains(asB, t.aMarker), false, `${t.name}: B LEAKED A's data`)
  }
})
