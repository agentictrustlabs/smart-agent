/**
 * Spec 007 Phase G.1 — cross-tenant property tests for org-mcp.
 *
 * Mirror of the person-mcp variant. The architectural commitment:
 * multi-tenant isolation is a PROPERTY of the system, not a convention.
 * For every org-mcp read tool, ORG A's invocation MUST NEVER return
 * ORG B's data.
 *
 * Mechanism:
 *   1. Stub `principal-context.js` via `mock.module` so handler calls
 *      to `requireOrgPrincipal*` return whichever org-principal we set.
 *   2. Seed two orgs (ORG_A, ORG_B) with known-distinct data.
 *   3. Call each tool, assert leakage-free responses.
 *
 * Run:
 *   node --import tsx --experimental-test-module-mocks --test \
 *     apps/org-mcp/test/cross-tenant-isolation.test.mts
 */

process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_ORG = '0x' + 'a'.repeat(64)
process.env.ORG_MCP_DB_PATH = process.env.ORG_MCP_DB_PATH ?? 'org-mcp.isolation.test.db'

import { test, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

let CURRENT_PRINCIPAL = '0x0000000000000000000000000000000000000000'

function setCurrentPrincipal(p: string) {
  CURRENT_PRINCIPAL = p.toLowerCase()
}

// Stub every export of principal-context.js so any tool's import shape
// (requireOrgPrincipal / requireOrgPrincipalAny / requireOrgPrincipalViaCrossDelegation)
// produces the same controlled principal.
mock.module('../src/auth/principal-context.js', {
  namedExports: {
    requireOrgPrincipal: async (token: string | undefined, _toolName?: string): Promise<string> => {
      if (!token) throw new Error('Missing delegation token')
      return CURRENT_PRINCIPAL
    },
    requireOrgPrincipalAny: async (token: string | undefined, _args: unknown, _toolName?: string): Promise<string> => {
      if (!token) throw new Error('Missing delegation token')
      return CURRENT_PRINCIPAL
    },
    requireOrgPrincipalViaCrossDelegation: async (token: string | undefined, _xd: unknown, _toolName?: string): Promise<string> => {
      if (!token) throw new Error('Missing delegation token')
      return CURRENT_PRINCIPAL
    },
  },
})

const { membersTools } = await import('../src/tools/members.js')
const { orgProfileTools } = await import('../src/tools/org-profile.js')
const { orgIntentsTools } = await import('../src/tools/intents.js')
const { orgNotificationsTools, orgBeliefsTools } = await import('../src/tools/notifications-beliefs.js')
const { activityTools } = await import('../src/tools/activity.js')
const { sqlite } = await import('../src/db/index.js')

const ORG_A = '0xaaaa00000000000000000000000000000000aaaa'
const ORG_B = '0xbbbb00000000000000000000000000000000bbbb'
const TOKEN_A = 'fake-token-for-org-A'
const TOKEN_B = 'fake-token-for-org-B'

function unwrap(resp: unknown): unknown {
  const wrapped = resp as { content: Array<{ text: string }> }
  return JSON.parse(wrapped.content[0].text)
}

function jsonContains(haystack: unknown, needle: string): boolean {
  return JSON.stringify(haystack).toLowerCase().includes(needle.toLowerCase())
}

function seedData() {
  // Wipe + reseed every table we read.
  const tables = [
    'detached_members',
    'org_profiles_private',
    'org_intents',
    'org_outcomes',
    'org_notifications',
    'org_beliefs',
    'org_activity_log_entries',
  ]
  for (const t of tables) {
    sqlite.exec(`DELETE FROM ${t} WHERE org_principal LIKE '0xaaaa%' OR org_principal LIKE '0xbbbb%'`)
  }

  const now = new Date().toISOString()

  // detached_members
  sqlite.prepare(
    `INSERT INTO detached_members (id, org_principal, display_name, contact_info_encrypted, role, notes, created_at)
     VALUES (?, ?, 'AliceOrgMember', '', 'attender', 'AliceOrgMemberNote', ?)`,
  ).run('dm-A', ORG_A, now)
  sqlite.prepare(
    `INSERT INTO detached_members (id, org_principal, display_name, contact_info_encrypted, role, notes, created_at)
     VALUES (?, ?, 'BobOrgMember', '', 'attender', 'BobOrgMemberNote', ?)`,
  ).run('dm-B', ORG_B, now)

  // org_profiles_private
  sqlite.prepare(
    `INSERT INTO org_profiles_private (org_principal, internal_notes, updated_at)
     VALUES (?, 'AlicePrivateOrgNote', ?)`,
  ).run(ORG_A, now)
  sqlite.prepare(
    `INSERT INTO org_profiles_private (org_principal, internal_notes, updated_at)
     VALUES (?, 'BobPrivateOrgNote', ?)`,
  ).run(ORG_B, now)

  // org_intents
  sqlite.prepare(
    `INSERT INTO org_intents (id, org_principal, direction, kind, summary, status, created_at, updated_at)
     VALUES (?, ?, 'give', 'service', 'AliceOrgIntentSummary', 'expressed', ?, ?)`,
  ).run('oi-A', ORG_A, now, now)
  sqlite.prepare(
    `INSERT INTO org_intents (id, org_principal, direction, kind, summary, status, created_at, updated_at)
     VALUES (?, ?, 'give', 'service', 'BobOrgIntentSummary', 'expressed', ?, ?)`,
  ).run('oi-B', ORG_B, now, now)

  // org_notifications
  sqlite.prepare(
    `INSERT INTO org_notifications (id, org_principal, kind, payload, created_at)
     VALUES (?, ?, 'invite-received', '{"marker":"AliceOrgNotifPayload"}', ?)`,
  ).run('on-A', ORG_A, now)
  sqlite.prepare(
    `INSERT INTO org_notifications (id, org_principal, kind, payload, created_at)
     VALUES (?, ?, 'invite-received', '{"marker":"BobOrgNotifPayload"}', ?)`,
  ).run('on-B', ORG_B, now)

  // org_beliefs
  sqlite.prepare(
    `INSERT INTO org_beliefs (id, org_principal, statement, created_at, updated_at)
     VALUES (?, ?, 'AliceOrgBeliefStatement', ?, ?)`,
  ).run('ob-A', ORG_A, now, now)
  sqlite.prepare(
    `INSERT INTO org_beliefs (id, org_principal, statement, created_at, updated_at)
     VALUES (?, ?, 'BobOrgBeliefStatement', ?, ?)`,
  ).run('ob-B', ORG_B, now, now)

  // org_activity_log_entries
  sqlite.prepare(
    `INSERT INTO org_activity_log_entries (id, org_principal, kind, performed_at, payload, created_at)
     VALUES (?, ?, 'gathering', ?, '{"marker":"AliceOrgActivityPayload"}', ?)`,
  ).run('oal-A', ORG_A, now, now)
  sqlite.prepare(
    `INSERT INTO org_activity_log_entries (id, org_principal, kind, performed_at, payload, created_at)
     VALUES (?, ?, 'gathering', ?, '{"marker":"BobOrgActivityPayload"}', ?)`,
  ).run('oal-B', ORG_B, now, now)
}

before(() => seedData())
beforeEach(() => seedData())

// ─── Per-tool isolation cases ─────────────────────────────────────────

test('list_detached_members: A sees only AliceOrgMember, never BobOrgMember', async () => {
  setCurrentPrincipal(ORG_A)
  const res = unwrap(await membersTools.list_detached_members.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceOrgMember'))
  assert.equal(jsonContains(res, 'BobOrgMember'), false, 'CROSS-TENANT LEAK')
})

test('list_detached_members: B sees only BobOrgMember, never AliceOrgMember', async () => {
  setCurrentPrincipal(ORG_B)
  const res = unwrap(await membersTools.list_detached_members.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobOrgMember'))
  assert.equal(jsonContains(res, 'AliceOrgMember'), false)
})

test('get_org_profile_private: A sees AlicePrivateOrgNote, never BobPrivateOrgNote', async () => {
  setCurrentPrincipal(ORG_A)
  const res = unwrap(await orgProfileTools.get_org_profile_private.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AlicePrivateOrgNote'))
  assert.equal(jsonContains(res, 'BobPrivateOrgNote'), false, 'CROSS-TENANT LEAK')
})

test('get_org_profile_private: B sees BobPrivateOrgNote, never AlicePrivateOrgNote', async () => {
  setCurrentPrincipal(ORG_B)
  const res = unwrap(await orgProfileTools.get_org_profile_private.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobPrivateOrgNote'))
  assert.equal(jsonContains(res, 'AlicePrivateOrgNote'), false)
})

test('list_org_intents: A sees AliceOrgIntent, never BobOrgIntent', async () => {
  setCurrentPrincipal(ORG_A)
  const res = unwrap(await orgIntentsTools.list_org_intents.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceOrgIntentSummary'))
  assert.equal(jsonContains(res, 'BobOrgIntentSummary'), false)
})

test('list_org_intents: B sees BobOrgIntent, never AliceOrgIntent', async () => {
  setCurrentPrincipal(ORG_B)
  const res = unwrap(await orgIntentsTools.list_org_intents.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobOrgIntentSummary'))
  assert.equal(jsonContains(res, 'AliceOrgIntentSummary'), false)
})

test('list_org_notifications: A sees AliceOrgNotifPayload, never BobOrgNotifPayload', async () => {
  setCurrentPrincipal(ORG_A)
  const res = unwrap(await orgNotificationsTools.list_org_notifications.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceOrgNotifPayload'))
  assert.equal(jsonContains(res, 'BobOrgNotifPayload'), false)
})

test('list_org_notifications: B sees BobOrgNotifPayload, never AliceOrgNotifPayload', async () => {
  setCurrentPrincipal(ORG_B)
  const res = unwrap(await orgNotificationsTools.list_org_notifications.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobOrgNotifPayload'))
  assert.equal(jsonContains(res, 'AliceOrgNotifPayload'), false)
})

test('list_org_beliefs: A sees AliceOrgBeliefStatement, never BobOrgBeliefStatement', async () => {
  setCurrentPrincipal(ORG_A)
  const res = unwrap(await orgBeliefsTools.list_org_beliefs.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceOrgBeliefStatement'))
  assert.equal(jsonContains(res, 'BobOrgBeliefStatement'), false)
})

test('list_org_beliefs: B sees BobOrgBeliefStatement, never AliceOrgBeliefStatement', async () => {
  setCurrentPrincipal(ORG_B)
  const res = unwrap(await orgBeliefsTools.list_org_beliefs.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobOrgBeliefStatement'))
  assert.equal(jsonContains(res, 'AliceOrgBeliefStatement'), false)
})

test('list_activities: A sees AliceOrgActivityPayload, never BobOrgActivityPayload', async () => {
  setCurrentPrincipal(ORG_A)
  const res = unwrap(await activityTools.list_activities.handler({ token: TOKEN_A }))
  assert.ok(jsonContains(res, 'AliceOrgActivityPayload'))
  assert.equal(jsonContains(res, 'BobOrgActivityPayload'), false)
})

test('list_activities: B sees BobOrgActivityPayload, never AliceOrgActivityPayload', async () => {
  setCurrentPrincipal(ORG_B)
  const res = unwrap(await activityTools.list_activities.handler({ token: TOKEN_B }))
  assert.ok(jsonContains(res, 'BobOrgActivityPayload'))
  assert.equal(jsonContains(res, 'AliceOrgActivityPayload'), false)
})

// ─── Cross-tenant write attempts ─────────────────────────────────────

test('delete_detached_member: A cannot delete B\'s detached member by id', async () => {
  setCurrentPrincipal(ORG_A)
  const res = unwrap(await membersTools.delete_detached_member.handler({ token: TOKEN_A, id: 'dm-B' })) as { deleted: boolean }
  assert.equal(res.deleted, false)
  const row = sqlite.prepare(`SELECT id FROM detached_members WHERE id = 'dm-B'`).get()
  assert.ok(row, 'CROSS-TENANT LEAK: A deleted B\'s detached member')
})

// ─── Property-style enumerated isolation across all list tools ──────

const LIST_TOOLS: Array<{ name: string; handler: (a: { token: string }) => Promise<unknown>; aMarker: string; bMarker: string }> = [
  { name: 'list_detached_members', handler: membersTools.list_detached_members.handler as never, aMarker: 'AliceOrgMember', bMarker: 'BobOrgMember' },
  { name: 'get_org_profile_private', handler: orgProfileTools.get_org_profile_private.handler as never, aMarker: 'AlicePrivateOrgNote', bMarker: 'BobPrivateOrgNote' },
  { name: 'list_org_intents', handler: orgIntentsTools.list_org_intents.handler as never, aMarker: 'AliceOrgIntentSummary', bMarker: 'BobOrgIntentSummary' },
  { name: 'list_org_notifications', handler: orgNotificationsTools.list_org_notifications.handler as never, aMarker: 'AliceOrgNotifPayload', bMarker: 'BobOrgNotifPayload' },
  { name: 'list_org_beliefs', handler: orgBeliefsTools.list_org_beliefs.handler as never, aMarker: 'AliceOrgBeliefStatement', bMarker: 'BobOrgBeliefStatement' },
  { name: 'list_activities', handler: activityTools.list_activities.handler as never, aMarker: 'AliceOrgActivityPayload', bMarker: 'BobOrgActivityPayload' },
]

test('PROPERTY: for every org-mcp list tool, A never sees B\'s marker (and vice-versa)', async () => {
  for (const t of LIST_TOOLS) {
    setCurrentPrincipal(ORG_A)
    const asA = unwrap(await t.handler({ token: TOKEN_A }))
    assert.ok(jsonContains(asA, t.aMarker), `${t.name}: A should see A's data`)
    assert.equal(jsonContains(asA, t.bMarker), false, `${t.name}: A LEAKED B's data`)

    setCurrentPrincipal(ORG_B)
    const asB = unwrap(await t.handler({ token: TOKEN_B }))
    assert.ok(jsonContains(asB, t.bMarker), `${t.name}: B should see B's data`)
    assert.equal(jsonContains(asB, t.aMarker), false, `${t.name}: B LEAKED A's data`)
  }
})
