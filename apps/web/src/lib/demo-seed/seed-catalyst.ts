import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { ensureTablesExist } from './ensure-tables'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

// Deterministic addresses — each circle is a proper org agent
const ADDRS = {
  network: addr(0xb10001),
  hubDanang: addr(0xb10002),
  circleSontra: addr(0xb10003),
  circleHanhoa: addr(0xb10004),
  circleMyke: addr(0xb10005),
  circleThanh: addr(0xb10006),
  circleLien: addr(0xb10007),
  circleNgu: addr(0xb10008),
  circleCam: addr(0xb10009),
  analytics: addr(0xb20001),
  paElena: addr(0xb30001),
  paLinh: addr(0xb30002),
  paTran: addr(0xb30003),
  paMai: addr(0xb30004),
  paJames: addr(0xb30005),
  paHoa: addr(0xb30006),
  paDuc: addr(0xb30007),
}

export { ADDRS as CATALYST_ADDRS }

const USERS = [
  { id: 'cat-user-001', name: 'Elena Vasquez', email: 'elena@catalystglobal.org', wallet: '0x00000000000000000000000000000000000b0001', privy: 'did:privy:cat-001' },
  { id: 'cat-user-002', name: 'Linh Nguyen', email: 'linh@catalystglobal.org', wallet: '0x00000000000000000000000000000000000b0002', privy: 'did:privy:cat-002' },
  { id: 'cat-user-003', name: 'Tran Minh', email: 'tran@community.vn', wallet: '0x00000000000000000000000000000000000b0003', privy: 'did:privy:cat-003' },
  { id: 'cat-user-004', name: 'Mai Pham', email: 'mai@community.vn', wallet: '0x00000000000000000000000000000000000b0004', privy: 'did:privy:cat-004' },
  { id: 'cat-user-005', name: 'James Okafor', email: 'james@impactfund.org', wallet: '0x00000000000000000000000000000000000b0005', privy: 'did:privy:cat-005' },
  { id: 'cat-user-006', name: 'Hoa Tran', email: 'hoa@circle-sontra.vn', wallet: '0x00000000000000000000000000000000000b0006', privy: 'did:privy:cat-006' },
  { id: 'cat-user-007', name: 'Duc Le', email: 'duc@circle-hanhoa.vn', wallet: '0x00000000000000000000000000000000000b0007', privy: 'did:privy:cat-007' },
]

const PERSON_AGENTS = [
  { userId: 'cat-user-001', name: 'Elena Vasquez', addr: ADDRS.paElena },
  { userId: 'cat-user-002', name: 'Linh Nguyen', addr: ADDRS.paLinh },
  { userId: 'cat-user-003', name: 'Tran Minh', addr: ADDRS.paTran },
  { userId: 'cat-user-004', name: 'Mai Pham', addr: ADDRS.paMai },
  { userId: 'cat-user-005', name: 'James Okafor', addr: ADDRS.paJames },
  { userId: 'cat-user-006', name: 'Hoa Tran', addr: ADDRS.paHoa },
  { userId: 'cat-user-007', name: 'Duc Le', addr: ADDRS.paDuc },
]

const ORGS = [
  { name: 'Mekong Catalyst Network', desc: 'Regional coordination for grassroots community development across the Mekong Delta', addr: ADDRS.network, user: 'cat-user-001', tpl: 'catalyst-network' },
  { name: 'Da Nang Hub', desc: 'Facilitator hub — community development in Da Nang and central Vietnam', addr: ADDRS.hubDanang, user: 'cat-user-002', tpl: 'facilitator-hub' },
  { name: 'Son Tra Group', desc: 'Established learning circle — Son Tra district (G1)', addr: ADDRS.circleSontra, user: 'cat-user-006', tpl: 'local-group' },
  { name: 'Han Hoa Group', desc: 'Established learning circle — Han Hoa ward (G2)', addr: ADDRS.circleHanhoa, user: 'cat-user-007', tpl: 'local-group' },
  { name: 'My Khe Group', desc: 'Learning group — My Khe Beach area (G2)', addr: ADDRS.circleMyke, user: 'cat-user-002', tpl: 'local-group' },
  { name: 'Thanh Khe Group', desc: 'Learning group — Thanh Khe district (G1)', addr: ADDRS.circleThanh, user: 'cat-user-003', tpl: 'local-group' },
  { name: 'Lien Chieu Group', desc: 'Learning group — Lien Chieu district (G2)', addr: ADDRS.circleLien, user: 'cat-user-003', tpl: 'local-group' },
  { name: 'Ngu Hanh Son Group', desc: 'Learning group — Ngu Hanh Son (G3)', addr: ADDRS.circleNgu, user: 'cat-user-002', tpl: 'local-group' },
  { name: 'Cam Le Group', desc: 'Learning group — Cam Le district (G1)', addr: ADDRS.circleCam, user: 'cat-user-003', tpl: 'local-group' },
]

const AI_AGENTS = [
  { name: 'Growth Analytics', desc: 'Tracks generational multiplication and movement health reports', type: 'discovery' as const, user: 'cat-user-001', opBy: ADDRS.network, addr: ADDRS.analytics },
]

// Circle health data keyed by org address
const CIRCLE_HEALTH: Array<{
  addr: string; gen: number; parent: string | null; leader: string; loc: string; status: string; started: string
  health: Record<string, unknown>
}> = [
  { addr: ADDRS.circleSontra, gen: 1, parent: ADDRS.hubDanang, leader: 'Hoa Tran', loc: 'Son Tra District', status: 'multiplied', started: '2025-04-20',
    health: { seekers: 9, believers: 7, baptized: 5, leaders: 3, giving: true, isChurch: true, groupsStarted: 2, attenders: 9, peoplGroup: 'Vietnamese Kinh', baptismSelf: true, teachingSelf: true } },
  { addr: ADDRS.circleHanhoa, gen: 2, parent: ADDRS.circleSontra, leader: 'Duc Le', loc: 'Han Hoa Ward', status: 'multiplied', started: '2025-08-12',
    health: { seekers: 7, believers: 5, baptized: 3, leaders: 1, giving: true, isChurch: true, groupsStarted: 1, attenders: 7, peoplGroup: 'Vietnamese Kinh', baptismSelf: true, teachingSelf: true } },
  { addr: ADDRS.circleMyke, gen: 2, parent: ADDRS.circleSontra, leader: 'Anh Bui', loc: 'My Khe Beach', status: 'active', started: '2025-09-30',
    health: { seekers: 4, believers: 2, baptized: 1, leaders: 0, giving: false, isChurch: false, groupsStarted: 0, attenders: 4 } },
  { addr: ADDRS.circleThanh, gen: 1, parent: ADDRS.hubDanang, leader: 'Binh Vo', loc: 'Thanh Khe', status: 'active', started: '2025-05-15',
    health: { seekers: 5, believers: 3, baptized: 1, leaders: 1, giving: false, isChurch: false, groupsStarted: 1, attenders: 5, peoplGroup: 'Vietnamese Kinh' } },
  { addr: ADDRS.circleLien, gen: 2, parent: ADDRS.circleThanh, leader: 'Phuong Dang', loc: 'Lien Chieu', status: 'active', started: '2025-11-05',
    health: { seekers: 6, believers: 2, baptized: 0, leaders: 0, giving: false, isChurch: false, groupsStarted: 0, attenders: 6 } },
  { addr: ADDRS.circleNgu, gen: 3, parent: ADDRS.circleHanhoa, leader: 'Khoa Phan', loc: 'Ngu Hanh Son', status: 'active', started: '2026-01-15',
    health: { seekers: 8, believers: 3, baptized: 1, leaders: 0, giving: false, isChurch: false, groupsStarted: 0, attenders: 8, peoplGroup: 'Vietnamese Kinh' } },
  { addr: ADDRS.circleCam, gen: 1, parent: ADDRS.hubDanang, leader: 'Thao Ngo', loc: 'Cam Le', status: 'active', started: '2025-12-01',
    health: { seekers: 4, believers: 2, baptized: 0, leaders: 0, giving: false, isChurch: false, groupsStarted: 0, attenders: 4 } },
]

// All 22 demo edges (person→org, org→org, AI→org)
const DEMO_EDGE_DATA: Array<{ sub: string; obj: string; type: string; roles: string[] }> = [
  // Person → Org (13 edges)
  { sub: ADDRS.paElena, obj: ADDRS.network, type: 'ORGANIZATION_GOVERNANCE', roles: ['owner'] },
  { sub: ADDRS.paJames, obj: ADDRS.network, type: 'ORGANIZATION_GOVERNANCE', roles: ['board-member'] },
  { sub: ADDRS.paLinh, obj: ADDRS.hubDanang, type: 'ORGANIZATION_GOVERNANCE', roles: ['owner'] },
  { sub: ADDRS.paLinh, obj: ADDRS.network, type: 'ORGANIZATION_MEMBERSHIP', roles: ['operator'] },
  { sub: ADDRS.paTran, obj: ADDRS.hubDanang, type: 'ORGANIZATION_MEMBERSHIP', roles: ['operator'] },
  { sub: ADDRS.paMai, obj: ADDRS.hubDanang, type: 'ORGANIZATION_MEMBERSHIP', roles: ['member'] },
  { sub: ADDRS.paHoa, obj: ADDRS.circleSontra, type: 'ORGANIZATION_GOVERNANCE', roles: ['owner'] },
  { sub: ADDRS.paHoa, obj: ADDRS.hubDanang, type: 'ORGANIZATION_MEMBERSHIP', roles: ['member'] },
  { sub: ADDRS.paDuc, obj: ADDRS.circleHanhoa, type: 'ORGANIZATION_GOVERNANCE', roles: ['owner'] },
  { sub: ADDRS.paDuc, obj: ADDRS.hubDanang, type: 'ORGANIZATION_MEMBERSHIP', roles: ['member'] },
  { sub: ADDRS.paLinh, obj: ADDRS.circleSontra, type: 'ORGANIZATION_MEMBERSHIP', roles: ['advisor'] },
  { sub: ADDRS.paTran, obj: ADDRS.circleHanhoa, type: 'ORGANIZATION_MEMBERSHIP', roles: ['advisor'] },
  { sub: ADDRS.paTran, obj: ADDRS.circleCam, type: 'ORGANIZATION_MEMBERSHIP', roles: ['advisor'] },
  // Org → Org (8 ALLIANCE edges — the generational chain)
  { sub: ADDRS.network, obj: ADDRS.hubDanang, type: 'ALLIANCE', roles: ['strategic-partner'] },
  { sub: ADDRS.hubDanang, obj: ADDRS.circleSontra, type: 'ALLIANCE', roles: ['strategic-partner'] },
  { sub: ADDRS.hubDanang, obj: ADDRS.circleThanh, type: 'ALLIANCE', roles: ['strategic-partner'] },
  { sub: ADDRS.hubDanang, obj: ADDRS.circleCam, type: 'ALLIANCE', roles: ['strategic-partner'] },
  { sub: ADDRS.circleSontra, obj: ADDRS.circleHanhoa, type: 'ALLIANCE', roles: ['strategic-partner'] },
  { sub: ADDRS.circleSontra, obj: ADDRS.circleMyke, type: 'ALLIANCE', roles: ['strategic-partner'] },
  { sub: ADDRS.circleThanh, obj: ADDRS.circleLien, type: 'ALLIANCE', roles: ['strategic-partner'] },
  { sub: ADDRS.circleHanhoa, obj: ADDRS.circleNgu, type: 'ALLIANCE', roles: ['strategic-partner'] },
  // AI → Org (1 edge)
  { sub: ADDRS.analytics, obj: ADDRS.network, type: 'ORGANIZATIONAL_CONTROL', roles: ['operated-agent'] },
]

const ACTIVITIES = [
  { user: 'cat-user-002', type: 'outreach', title: 'Community needs assessment — Son Tra market', desc: 'Surveyed 15 vendors about vocational training needs. 4 expressed interest in joining a learning circle.', participants: 15, loc: 'Son Tra Market', dur: 120, date: '2026-03-12' },
  { user: 'cat-user-003', type: 'visit', title: 'Home visit — Binh family follow-up', desc: 'Second visit to Binh and family. Discussed financial literacy module.', participants: 4, loc: 'Hai Chau', dur: 90, date: '2026-03-15' },
  { user: 'cat-user-004', type: 'training', title: 'Facilitator skills workshop', desc: 'Trained 6 emerging facilitators in discussion-based learning methods.', participants: 6, loc: 'Da Nang Central', dur: 180, date: '2026-03-18' },
  { user: 'cat-user-002', type: 'coaching', title: 'Hoa coaching session', desc: 'Coached Hoa on managing group dynamics and identifying potential new circle leaders.', participants: 2, loc: 'Son Tra', dur: 60, date: '2026-03-20' },
  { user: 'cat-user-003', type: 'meeting', title: 'Cam Le circle weekly session', desc: 'First regular session of the new Cam Le circle. Thao facilitated. 4 new participants.', participants: 6, loc: 'Cam Le', dur: 90, date: '2026-03-23' },
  { user: 'cat-user-006', type: 'meeting', title: 'Son Tra weekly circle', desc: 'Weekly learning session. 9 attended including 3 newcomers from the market outreach.', participants: 9, loc: 'Son Tra', dur: 75, date: '2026-03-25' },
  { user: 'cat-user-007', type: 'outreach', title: 'Han Hoa neighborhood engagement', desc: 'Door-to-door visits in new housing development. Introduced the program to 8 families.', participants: 3, loc: 'Han Hoa Ward', dur: 150, date: '2026-03-27' },
  { user: 'cat-user-002', type: 'assessment', title: 'Monthly impact review', desc: 'Reviewed all circles across both streams. My Khe needs more support. Ngu Hanh Son growing well.', participants: 1, loc: 'Da Nang Central', dur: 60, date: '2026-04-01' },
  { user: 'cat-user-004', type: 'service', title: 'Community cleanup with Son Tra group', desc: 'Group organized beach cleanup event. Great community visibility and engagement.', participants: 14, loc: 'Son Tra Beach', dur: 120, date: '2026-04-03' },
  { user: 'cat-user-003', type: 'follow-up', title: 'New participant onboarding — Lan', desc: 'Lan completed orientation. Connected her with Mai for ongoing mentorship.', participants: 2, loc: 'Hai Chau', dur: 45, date: '2026-04-05' },
  { user: 'cat-user-002', type: 'training', title: 'Leadership development — Hoa and Duc', desc: 'Monthly leader development session. Covered identifying emerging facilitators.', participants: 3, loc: 'Da Nang Central', dur: 120, date: '2026-04-07' },
  { user: 'cat-user-006', type: 'meeting', title: 'Son Tra Saturday session', desc: 'Full circle session. 7 participants, 3 prospects. Digital literacy module.', participants: 10, loc: 'Son Tra', dur: 90, date: '2026-04-09' },
]

function upsertUser(u: typeof USERS[number]) {
  const existing = db.select().from(schema.users).where(eq(schema.users.id, u.id)).get()
  if (!existing) {
    db.insert(schema.users).values({ id: u.id, email: u.email, name: u.name, walletAddress: u.wallet, privyUserId: u.privy }).run()
  }
}

export function seedCatalystCommunity() {
  ensureTablesExist()
  console.log('[demo-seed] Ensuring Catalyst community data...')

  // Users
  for (const u of USERS) upsertUser(u)

  // Person agents
  for (const p of PERSON_AGENTS) {
    const existing = db.select().from(schema.personAgents).where(eq(schema.personAgents.userId, p.userId)).get()
    if (!existing) {
      db.insert(schema.personAgents).values({
        id: randomUUID(), name: p.name, userId: p.userId,
        smartAccountAddress: p.addr, chainId: 31337,
        salt: '0x' + randomUUID().replace(/-/g, '').slice(0, 8),
        implementationType: 'hybrid', status: 'deployed',
      }).run()
    }
  }

  // Org agents (network, hub, AND all circles) — circles get metadata with health data
  for (const o of ORGS) {
    const existing = db.select().from(schema.orgAgents).where(eq(schema.orgAgents.smartAccountAddress, o.addr)).get()
    // Find circle health data for this org if it's a circle
    const circleData = CIRCLE_HEALTH.find(ch => ch.addr === o.addr)
    const metadata = circleData ? JSON.stringify({
      ...circleData.health,
      generation: circleData.gen,
      leaderName: circleData.leader,
      location: circleData.loc,
      meetingFrequency: 'weekly',
      startedAt: circleData.started,
      circleStatus: circleData.status,
    }) : null

    if (!existing) {
      db.insert(schema.orgAgents).values({
        id: randomUUID(), name: o.name, description: o.desc,
        metadata,
        createdBy: o.user, smartAccountAddress: o.addr,
        templateId: o.tpl, chainId: 31337,
        salt: '0x' + randomUUID().replace(/-/g, '').slice(0, 8),
        implementationType: 'hybrid', status: 'deployed',
      }).run()
    } else if (circleData && !(existing as Record<string, unknown>).metadata) {
      // Backfill metadata on existing org agent
      db.update(schema.orgAgents).set({ metadata }).where(eq(schema.orgAgents.smartAccountAddress, o.addr)).run()
    }
  }

  // AI agents
  for (const a of AI_AGENTS) {
    const existing = db.select().from(schema.aiAgents).where(eq(schema.aiAgents.smartAccountAddress, a.addr)).get()
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

  // ─── Demo Edges (all 22 relationships — source of truth for hierarchy) ──
  try {
    const existingEdges = db.select().from(schema.demoEdges).all()
    const catalystEdges = existingEdges.filter(e =>
      e.subjectAddress.startsWith('0x00000000000000000000000000000000000b') ||
      e.objectAddress.startsWith('0x00000000000000000000000000000000000b')
    )
    if (catalystEdges.length < DEMO_EDGE_DATA.length) {
      // Seed missing edges
      for (const edge of DEMO_EDGE_DATA) {
        const exists = existingEdges.some(e =>
          e.subjectAddress === edge.sub.toLowerCase() &&
          e.objectAddress === edge.obj.toLowerCase() &&
          e.relationshipType === edge.type
        )
        if (!exists) {
          db.insert(schema.demoEdges).values({
            id: randomUUID(),
            subjectAddress: edge.sub.toLowerCase(),
            objectAddress: edge.obj.toLowerCase(),
            relationshipType: edge.type,
            roles: JSON.stringify(edge.roles),
            status: 'active',
          }).run()
        }
      }
      console.log('[demo-seed] Seeded', DEMO_EDGE_DATA.length, 'demo edges')
    }
  } catch { /* table may not exist */ }

  // ─── Gen Map Nodes (cache — derived from org_agents + circle_health) ──
  const networkAddr = ADDRS.network.toLowerCase()
  try {
    const existingNodes = db.select().from(schema.genMapNodes).where(eq(schema.genMapNodes.networkAddress, networkAddr)).all()
    if (existingNodes.length === 0 || !existingNodes.some(n => n.groupAddress)) {
      try { db.delete(schema.genMapNodes).where(eq(schema.genMapNodes.networkAddress, networkAddr)).run() } catch { /* ignored */ }

      // Build from circle_health + org_agents
      // G0 roots (pilot contacts — not circles, no org agent)
      const roots = [
        { id: 'cat-g0-linh', name: 'Linh — Pilot Program', leader: 'Linh Nguyen', loc: 'Da Nang Central', gen: 0, parent: null, groupAddr: null, health: { seekers: 6, believers: 4, baptized: 3, leaders: 2, giving: false, isChurch: false, groupsStarted: 2, attenders: 6, peoplGroup: 'Vietnamese Kinh' }, status: 'multiplied', started: '2025-02-10' },
        { id: 'cat-g0-tran', name: 'Tran — Hai Chau Pilot', leader: 'Tran Minh', loc: 'Hai Chau', gen: 0, parent: null, groupAddr: null, health: { seekers: 5, believers: 3, baptized: 1, leaders: 1, giving: false, isChurch: false, groupsStarted: 1, attenders: 5, peoplGroup: 'Vietnamese Kinh' }, status: 'active', started: '2025-06-01' },
      ]
      for (const r of roots) {
        db.insert(schema.genMapNodes).values({
          id: r.id, networkAddress: networkAddr, groupAddress: r.groupAddr,
          parentId: r.parent, generation: r.gen, name: r.name,
          leaderName: r.leader, location: r.loc,
          healthData: JSON.stringify(r.health), status: r.status as 'active',
          startedAt: r.started,
        }).run()
      }

      // Circle nodes from circle_health
      const circleToParentNode: Record<string, string> = {
        [ADDRS.circleSontra]: 'cat-g0-linh',
        [ADDRS.circleThanh]: 'cat-g0-linh',
        [ADDRS.circleHanhoa]: 'cat-ch-sontra',
        [ADDRS.circleMyke]: 'cat-ch-sontra',
        [ADDRS.circleLien]: 'cat-ch-thanh',
        [ADDRS.circleNgu]: 'cat-ch-hanhoa',
        [ADDRS.circleCam]: 'cat-g0-tran',
      }
      for (const ch of CIRCLE_HEALTH) {
        const org = ORGS.find(o => o.addr === ch.addr)
        const nodeId = `cat-ch-${org?.name.toLowerCase().replace(/\s+/g, '').replace('circle', '').slice(0, 8) ?? randomUUID().slice(0, 8)}`
        const parentNodeId = circleToParentNode[ch.addr] ?? null
        db.insert(schema.genMapNodes).values({
          id: nodeId, networkAddress: networkAddr,
          groupAddress: ch.addr.toLowerCase(),
          parentId: parentNodeId, generation: ch.gen,
          name: org?.name ?? ch.leader, leaderName: ch.leader,
          location: ch.loc, healthData: JSON.stringify(ch.health),
          status: ch.status as 'active', startedAt: ch.started,
        }).run()
      }
      console.log('[demo-seed] Rebuilt gen map cache:', roots.length + CIRCLE_HEALTH.length, 'nodes')
    }
  } catch { /* ignored */ }

  // ─── Activity Logs ────────────────────────────────────────────────
  const hubAddr = ADDRS.hubDanang.toLowerCase()
  try {
    const existingActivities = db.select().from(schema.activityLogs).where(eq(schema.activityLogs.orgAddress, hubAddr)).all()
    if (existingActivities.length === 0) {
      for (const a of ACTIVITIES) {
        db.insert(schema.activityLogs).values({
          id: randomUUID(), orgAddress: hubAddr, userId: a.user,
          activityType: a.type as 'outreach' | 'visit' | 'training' | 'meeting' | 'coaching' | 'assessment' | 'service' | 'follow-up' | 'prayer' | 'other',
          title: a.title, description: a.desc,
          participants: a.participants, location: a.loc,
          durationMinutes: a.dur, activityDate: a.date,
        }).run()
      }
      console.log('[demo-seed] Seeded', ACTIVITIES.length, 'Catalyst activities')
    }
  } catch { /* ignored */ }

  console.log('[demo-seed] Catalyst community ready')
}
