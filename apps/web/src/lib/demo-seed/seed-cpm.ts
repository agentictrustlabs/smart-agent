import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { ensureTablesExist } from './ensure-tables'


const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

// Deterministic addresses for CPM demo (no chain needed)
const ADDRS = {
  network: addr(0xa10001),
  teamKol: addr(0xa10002),
  grpBaran: addr(0xa10003),
  grpSalt: addr(0xa10004),
  analytics: addr(0xa20001),
  paMark: addr(0xa30001),
  paPriya: addr(0xa30002),
  paRaj: addr(0xa30003),
  paAnita: addr(0xa30004),
  paDavid: addr(0xa30005),
  paSamuel: addr(0xa30006),
  paMeera: addr(0xa30007),
}

const USERS = [
  { id: 'cpm-user-001', name: 'Mark Thompson', email: 'mark@reachglobal.org', wallet: '0x00000000000000000000000000000000000a0001', privy: 'did:privy:cpm-001' },
  { id: 'cpm-user-002', name: 'Priya Sharma', email: 'priya@reachglobal.org', wallet: '0x00000000000000000000000000000000000a0002', privy: 'did:privy:cpm-002' },
  { id: 'cpm-user-003', name: 'Raj Patel', email: 'raj@localpartner.in', wallet: '0x00000000000000000000000000000000000a0003', privy: 'did:privy:cpm-003' },
  { id: 'cpm-user-004', name: 'Anita Das', email: 'anita@localpartner.in', wallet: '0x00000000000000000000000000000000000a0004', privy: 'did:privy:cpm-004' },
  { id: 'cpm-user-005', name: 'David Kim', email: 'david@sendagency.org', wallet: '0x00000000000000000000000000000000000a0005', privy: 'did:privy:cpm-005' },
  { id: 'cpm-user-006', name: 'Samuel Bose', email: 'samuel@housechurch.in', wallet: '0x00000000000000000000000000000000000a0006', privy: 'did:privy:cpm-006' },
  { id: 'cpm-user-007', name: 'Meera Ghosh', email: 'meera@housechurch.in', wallet: '0x00000000000000000000000000000000000a0007', privy: 'did:privy:cpm-007' },
]

const PERSON_AGENTS = [
  { userId: 'cpm-user-001', name: 'Mark Thompson', addr: ADDRS.paMark },
  { userId: 'cpm-user-002', name: 'Priya Sharma', addr: ADDRS.paPriya },
  { userId: 'cpm-user-003', name: 'Raj Patel', addr: ADDRS.paRaj },
  { userId: 'cpm-user-004', name: 'Anita Das', addr: ADDRS.paAnita },
  { userId: 'cpm-user-005', name: 'David Kim', addr: ADDRS.paDavid },
  { userId: 'cpm-user-006', name: 'Samuel Bose', addr: ADDRS.paSamuel },
  { userId: 'cpm-user-007', name: 'Meera Ghosh', addr: ADDRS.paMeera },
]

const ORGS = [
  { name: 'South Asia Movement Network', desc: 'Multi-agency CPM coordination — tracking generational multiplication across South Asia', addr: ADDRS.network, user: 'cpm-user-001', tpl: 'movement-network' },
  { name: 'Kolkata Team', desc: 'Church planting team — Bengali-speaking communities in Kolkata', addr: ADDRS.teamKol, user: 'cpm-user-002', tpl: 'church-planting-team' },
  { name: 'Baranagar Group', desc: 'House church — Baranagar neighborhood, Kolkata (Generation 1)', addr: ADDRS.grpBaran, user: 'cpm-user-006', tpl: 'local-group' },
  { name: 'Salt Lake Group', desc: 'House church — Salt Lake City, Kolkata (Generation 2, started by Baranagar)', addr: ADDRS.grpSalt, user: 'cpm-user-007', tpl: 'local-group' },
]

const AI_AGENTS = [
  { name: 'Movement Analytics', desc: 'Tracks generational growth, identifies stalled streams, and generates movement health reports', type: 'discovery' as const, user: 'cpm-user-001', opBy: ADDRS.network, addr: ADDRS.analytics },
]

const GEN_MAP_NODES = [
  { id: 'gen-g0-priya', parent: null, gen: 0, name: 'Priya — Initial Contact', leader: 'Priya Sharma', loc: 'Kolkata Central', health: { seekers: 5, believers: 3, baptized: 2, leaders: 2, giving: false, isChurch: false, groupsStarted: 2 }, status: 'multiplied' as const, started: '2025-03-15' },
  { id: 'gen-g1-baranagar', parent: 'gen-g0-priya', gen: 1, name: 'Baranagar Group', leader: 'Samuel Bose', loc: 'Baranagar', health: { seekers: 8, believers: 6, baptized: 4, leaders: 2, giving: true, isChurch: true, groupsStarted: 2 }, status: 'multiplied' as const, started: '2025-05-20' },
  { id: 'gen-g1-howrah', parent: 'gen-g0-priya', gen: 1, name: 'Howrah Group', leader: 'Amit Roy', loc: 'Howrah', health: { seekers: 4, believers: 3, baptized: 1, leaders: 1, giving: false, isChurch: false, groupsStarted: 1 }, status: 'active' as const, started: '2025-06-10' },
  { id: 'gen-g2-saltlake', parent: 'gen-g1-baranagar', gen: 2, name: 'Salt Lake Group', leader: 'Meera Ghosh', loc: 'Salt Lake', health: { seekers: 6, believers: 4, baptized: 3, leaders: 1, giving: true, isChurch: true, groupsStarted: 1 }, status: 'multiplied' as const, started: '2025-09-01' },
  { id: 'gen-g2-dunlop', parent: 'gen-g1-baranagar', gen: 2, name: 'Dunlop Group', leader: 'Ravi Sen', loc: 'Dunlop', health: { seekers: 3, believers: 2, baptized: 1, leaders: 0, giving: false, isChurch: false, groupsStarted: 0 }, status: 'active' as const, started: '2025-10-05' },
  { id: 'gen-g2-shibpur', parent: 'gen-g1-howrah', gen: 2, name: 'Shibpur Group', leader: 'Deepa Mitra', loc: 'Shibpur', health: { seekers: 5, believers: 2, baptized: 0, leaders: 0, giving: false, isChurch: false, groupsStarted: 0 }, status: 'active' as const, started: '2025-11-12' },
  { id: 'gen-g3-newtown', parent: 'gen-g2-saltlake', gen: 3, name: 'New Town Group', leader: 'Kavita Dey', loc: 'New Town', health: { seekers: 7, believers: 3, baptized: 1, leaders: 0, giving: false, isChurch: false, groupsStarted: 0 }, status: 'active' as const, started: '2026-01-20' },
  { id: 'gen-g0-raj', parent: null, gen: 0, name: 'Raj — Initial Contact', leader: 'Raj Patel', loc: 'Jadavpur', health: { seekers: 4, believers: 2, baptized: 1, leaders: 1, giving: false, isChurch: false, groupsStarted: 1 }, status: 'active' as const, started: '2025-07-01' },
  { id: 'gen-g1-garia', parent: 'gen-g0-raj', gen: 1, name: 'Garia Group', leader: 'Sunil Das', loc: 'Garia', health: { seekers: 3, believers: 2, baptized: 0, leaders: 0, giving: false, isChurch: false, groupsStarted: 0 }, status: 'active' as const, started: '2025-12-08' },
]

const ACTIVITIES = [
  { user: 'cpm-user-002', type: 'outreach', title: 'Market outreach — Baranagar bazaar', desc: 'Shared with 12 vendors at the weekly market. 3 expressed interest in learning more. Exchanged contact info.', participants: 12, loc: 'Baranagar Bazaar', dur: 120, date: '2026-03-15' },
  { user: 'cpm-user-003', type: 'visit', title: 'Follow-up visit — Amit family', desc: 'Second visit to Amit and family in Howrah. Discussed Mark chapter 4. Wife Priti asked thoughtful questions about faith.', participants: 4, loc: 'Howrah', dur: 90, date: '2026-03-18' },
  { user: 'cpm-user-004', type: 'training', title: 'Discovery Bible Study training', desc: 'Trained 5 new believers in the DBS facilitation method. Practiced with Genesis 1 passage. All participated actively.', participants: 5, loc: 'Kolkata Central', dur: 180, date: '2026-03-20' },
  { user: 'cpm-user-002', type: 'coaching', title: 'Samuel coaching session', desc: 'Coached Samuel on facilitating group discussions and identifying emerging leaders in the Baranagar group.', participants: 2, loc: 'Baranagar', dur: 60, date: '2026-03-22' },
  { user: 'cpm-user-003', type: 'meeting', title: 'Garia group weekly meeting', desc: 'First regular meeting of the new Garia group. Sunil facilitated his first DBS. 3 seekers attended along with 2 believers.', participants: 5, loc: 'Garia', dur: 90, date: '2026-03-25' },
  { user: 'cpm-user-006', type: 'prayer', title: 'Baranagar prayer gathering', desc: 'Weekly prayer and worship meeting. 8 attended including 2 new seekers who came through the market outreach.', participants: 8, loc: 'Baranagar', dur: 60, date: '2026-03-27' },
  { user: 'cpm-user-007', type: 'outreach', title: 'Salt Lake neighborhood outreach', desc: 'Door-to-door visits in new apartment complex near the group meeting location. Shared with 6 families.', participants: 3, loc: 'Salt Lake', dur: 150, date: '2026-03-29' },
  { user: 'cpm-user-002', type: 'assessment', title: 'Monthly stream assessment', desc: 'Reviewed all groups in both streams. Dunlop group needs more attention — only 3 seekers and no leader development. New Town group growing fast with 7 seekers.', participants: 1, loc: 'Kolkata Central', dur: 60, date: '2026-04-01' },
  { user: 'cpm-user-004', type: 'service', title: 'Community service with Baranagar group', desc: 'Group organized neighborhood cleanup and served tea to elderly residents. Good visibility with local community.', participants: 12, loc: 'Baranagar', dur: 120, date: '2026-04-03' },
  { user: 'cpm-user-003', type: 'follow-up', title: 'New believer follow-up — Priti', desc: 'Priti shared she wants to be baptized. Connected her with Anita for ongoing discipleship. Discussed next steps and set weekly meeting time.', participants: 2, loc: 'Howrah', dur: 45, date: '2026-04-05' },
  { user: 'cpm-user-002', type: 'training', title: 'Leader development — Samuel & Meera', desc: 'Monthly leader development session. Covered how to identify and train new leaders within their groups. Both are showing strong multiplication instincts.', participants: 3, loc: 'Kolkata Central', dur: 120, date: '2026-04-07' },
  { user: 'cpm-user-006', type: 'meeting', title: 'Baranagar Sunday gathering', desc: 'Full group meeting. 6 believers, 4 seekers present. Samuel led worship and DBS on Acts 2. One seeker (Rupa) asked about baptism.', participants: 10, loc: 'Baranagar', dur: 90, date: '2026-04-08' },
]

/** Upsert a user row */
function ensureUser(u: typeof USERS[number]) {
  const existing = db.select().from(schema.users)
    .where(eq(schema.users.id, u.id)).get()
  if (!existing) {
    db.insert(schema.users).values({
      id: u.id, email: u.email, name: u.name,
      walletAddress: u.wallet, privyUserId: u.privy,
    }).run()
  }
}

export function seedCpmCommunity() {
  // Ensure new tables exist
  ensureTablesExist()

  console.log('[demo-seed] Ensuring CPM community data...')

  // Users
  for (const u of USERS) ensureUser(u)

  // Person agents
  for (const p of PERSON_AGENTS) {
    const existing = db.select().from(schema.personAgents)
      .where(eq(schema.personAgents.userId, p.userId)).get()
    if (!existing) {
      db.insert(schema.personAgents).values({
        id: randomUUID(), name: p.name, userId: p.userId,
        smartAccountAddress: p.addr, chainId: 31337,
        salt: '0x' + randomUUID().replace(/-/g, '').slice(0, 8),
        implementationType: 'hybrid', status: 'deployed',
      }).run()
    }
  }

  // Org agents
  for (const o of ORGS) {
    const existing = db.select().from(schema.orgAgents)
      .where(eq(schema.orgAgents.smartAccountAddress, o.addr)).get()
    if (!existing) {
      db.insert(schema.orgAgents).values({
        id: randomUUID(), name: o.name, description: o.desc,
        createdBy: o.user, smartAccountAddress: o.addr,
        templateId: o.tpl, chainId: 31337,
        salt: '0x' + randomUUID().replace(/-/g, '').slice(0, 8),
        implementationType: 'hybrid', status: 'deployed',
      }).run()
    }
  }

  // AI agents
  for (const a of AI_AGENTS) {
    const existing = db.select().from(schema.aiAgents)
      .where(eq(schema.aiAgents.smartAccountAddress, a.addr)).get()
    if (!existing) {
      db.insert(schema.aiAgents).values({
        id: randomUUID(), name: a.name, description: a.desc,
        agentType: a.type, createdBy: a.user, operatedBy: a.opBy,
        smartAccountAddress: a.addr, chainId: 31337,
        salt: '0x' + randomUUID().replace(/-/g, '').slice(0, 8),
        implementationType: 'hybrid', status: 'deployed',
      }).run()
    }
  }

  // Gen map nodes
  const networkAddr = ADDRS.network.toLowerCase()
  for (const n of GEN_MAP_NODES) {
    const existing = db.select().from(schema.genMapNodes)
      .where(eq(schema.genMapNodes.id, n.id)).get()
    if (!existing) {
      db.insert(schema.genMapNodes).values({
        id: n.id, networkAddress: networkAddr,
        groupAddress: null, parentId: n.parent,
        generation: n.gen, name: n.name,
        leaderName: n.leader, location: n.loc,
        healthData: JSON.stringify(n.health),
        status: n.status, startedAt: n.started,
      }).run()
    }
  }

  // Activity logs (for Kolkata Team)
  const teamAddr = ADDRS.teamKol.toLowerCase()
  const existingActivities = db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.orgAddress, teamAddr)).all()
  if (existingActivities.length === 0) {
    for (const a of ACTIVITIES) {
      db.insert(schema.activityLogs).values({
        id: randomUUID(), orgAddress: teamAddr, userId: a.user,
        activityType: a.type as 'meeting' | 'visit' | 'training' | 'outreach' | 'follow-up' | 'assessment' | 'coaching' | 'prayer' | 'service' | 'other',
        title: a.title, description: a.desc,
        participants: a.participants, location: a.loc,
        durationMinutes: a.dur, activityDate: a.date,
      }).run()
    }
    console.log('[demo-seed] Seeded', ACTIVITIES.length, 'activities')
  }

  console.log('[demo-seed] CPM community seeded: 7 users, 4 orgs, 1 AI agent, 9 gen map nodes, 12 activities')
}
