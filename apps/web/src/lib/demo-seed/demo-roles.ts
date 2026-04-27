/**
 * Demo community role mappings — used when on-chain edges are unavailable.
 * Maps demo user IDs to their org memberships and roles.
 *
 * This is ONLY used in SKIP_AUTH mode as a fallback when contracts aren't deployed.
 */

interface DemoOrgRole {
  /** Smart account address of the org (lowercase) */
  orgAddress: string
  roles: string[]
}

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

// CPM addresses (must match seed-cpm.ts)
const CPM = {
  network: addr(0xa10001),
  teamKol: addr(0xa10002),
  grpBaran: addr(0xa10003),
  grpSalt: addr(0xa10004),
}

// Global.Church addresses (must match seed-globalchurch-onchain.ts)
const GC = {
  network: addr(0xc10001),     // placeholder — actual addrs are CREATE2-derived
  graceChurch: addr(0xc10002),
  sbc: addr(0xc10003),
  ecfa: addr(0xc10004),
  wycliffe: addr(0xc10005),
  ncf: addr(0xc10006),
  youthMinistry: addr(0xc10007),
  smallGroups: addr(0xc10008),
  missionsTeam: addr(0xc10009),
}

// CIL addresses (must match seed-cil-onchain.ts)
const CIL = {
  cil: addr(0xd10001),           // placeholder — actual addrs are CREATE2-derived
  ilad: addr(0xd10002),
  ravah: addr(0xd10003),
  afiaMarket: addr(0xd10004),
  kossiRepair: addr(0xd10005),
  lomeHub: addr(0xd10006),
  wave1: addr(0xd10007),
  wave2: addr(0xd10008),
}

// Catalyst NoCo addresses (must match seed-catalyst-onchain.ts)
const CAT = {
  network: addr(0xb10001),        // Catalyst NoCo Network
  hubFortCollins: addr(0xb10002), // Fort Collins Network (regional facilitator)
  circleWellington: addr(0xb10003),
  circleLaporte: addr(0xb10004),
  circleTimnath: addr(0xb10005),
  circleLoveland: addr(0xb10006),
  circleBerthoud: addr(0xb10007),
  circleJohnstown: addr(0xb10008),
  circleRedFeather: addr(0xb10009),
}

/**
 * Returns org memberships for a demo user when on-chain edges are unavailable.
 */
export function getDemoUserOrgRoles(userId: string): DemoOrgRole[] {
  const map: Record<string, DemoOrgRole[]> = {
    // CPM community
    'cpm-user-001': [ // Mark Thompson — Network Director
      { orgAddress: CPM.network, roles: ['owner'] },
      { orgAddress: CPM.teamKol, roles: ['board-member'] },
    ],
    'cpm-user-002': [ // Priya Sharma — Team Leader
      { orgAddress: CPM.teamKol, roles: ['owner'] },
      { orgAddress: CPM.network, roles: ['operator'] },
      { orgAddress: CPM.grpBaran, roles: ['advisor'] },
    ],
    'cpm-user-003': [ // Raj Patel — Church Planter
      { orgAddress: CPM.teamKol, roles: ['operator'] },
      { orgAddress: CPM.grpSalt, roles: ['advisor'] },
    ],
    'cpm-user-004': [ // Anita Das — National Partner
      { orgAddress: CPM.teamKol, roles: ['member'] },
    ],
    'cpm-user-005': [ // David Kim — Strategy Lead
      { orgAddress: CPM.network, roles: ['board-member'] },
    ],
    'cpm-user-006': [ // Samuel Bose — Group Leader
      { orgAddress: CPM.grpBaran, roles: ['owner'] },
      { orgAddress: CPM.teamKol, roles: ['member'] },
    ],
    'cpm-user-007': [ // Meera Ghosh — Group Leader
      { orgAddress: CPM.grpSalt, roles: ['owner'] },
      { orgAddress: CPM.teamKol, roles: ['member'] },
    ],
    // Catalyst NoCo Network (Northern Colorado Hispanic outreach)
    'cat-user-001': [ // Maria Gonzalez — Program Director
      { orgAddress: CAT.network, roles: ['owner'] },
      { orgAddress: CAT.hubFortCollins, roles: ['board-member'] },
    ],
    'cat-user-002': [ // Pastor David Chen — Hub Lead
      { orgAddress: CAT.hubFortCollins, roles: ['owner'] },
      { orgAddress: CAT.network, roles: ['operator'] },
      { orgAddress: CAT.circleWellington, roles: ['advisor'] },
    ],
    'cat-user-003': [ // Rosa Martinez — Hispanic Outreach Coordinator
      { orgAddress: CAT.hubFortCollins, roles: ['operator'] },
      { orgAddress: CAT.circleLaporte, roles: ['advisor'] },
      { orgAddress: CAT.circleRedFeather, roles: ['advisor'] },
    ],
    'cat-user-004': [ // Carlos Herrera — Community Partner
      { orgAddress: CAT.hubFortCollins, roles: ['member'] },
    ],
    'cat-user-005': [ // Sarah Thompson — Regional Lead
      { orgAddress: CAT.network, roles: ['board-member'] },
    ],
    'cat-user-006': [ // Ana Reyes — Circle Leader, Wellington
      { orgAddress: CAT.circleWellington, roles: ['owner'] },
      { orgAddress: CAT.hubFortCollins, roles: ['member'] },
    ],
    'cat-user-007': [ // Miguel Santos — Circle Leader, Laporte
      { orgAddress: CAT.circleLaporte, roles: ['owner'] },
      { orgAddress: CAT.hubFortCollins, roles: ['member'] },
    ],
    // Global.Church community
    'gc-user-001': [ // Pastor James — Senior Pastor
      { orgAddress: GC.graceChurch, roles: ['owner'] },
      { orgAddress: GC.network, roles: ['board-member'] },
    ],
    'gc-user-002': [ // Dr. Sarah Mitchell — Executive Director
      { orgAddress: GC.sbc, roles: ['owner'] },
      { orgAddress: GC.network, roles: ['operator'] },
    ],
    'gc-user-003': [ // Dan Busby — Executive Director
      { orgAddress: GC.ecfa, roles: ['owner'] },
      { orgAddress: GC.network, roles: ['member'] },
    ],
    'gc-user-004': [ // John Chesnut — Director
      { orgAddress: GC.wycliffe, roles: ['owner'] },
      { orgAddress: GC.network, roles: ['member'] },
    ],
    'gc-user-005': [ // David Wills — President
      { orgAddress: GC.ncf, roles: ['owner'] },
      { orgAddress: GC.network, roles: ['board-member'] },
    ],
    // Collective Impact Labs (CIL)
    'cil-user-001': [ // Cameron Henrion — Operations Lead
      { orgAddress: CIL.ilad, roles: ['owner'] },
      { orgAddress: CIL.ravah, roles: ['operator'] },
    ],
    'cil-user-002': [ // Nick Courchesne — Reviewer
      { orgAddress: CIL.ilad, roles: ['operator'] },
    ],
    'cil-user-003': [ // Afia Mensah — Business Owner
      { orgAddress: CIL.afiaMarket, roles: ['owner'] },
      { orgAddress: CIL.wave1, roles: ['member'] },
    ],
    'cil-user-004': [ // Kossi Agbeko — Business Owner
      { orgAddress: CIL.kossiRepair, roles: ['owner'] },
      { orgAddress: CIL.wave1, roles: ['member'] },
    ],
    'cil-user-005': [ // Yaw — Local Manager
      { orgAddress: CIL.ilad, roles: ['operator'] },
      { orgAddress: CIL.lomeHub, roles: ['owner'] },
    ],
    'cil-user-006': [ // John F. Kim — Admin
      { orgAddress: CIL.cil, roles: ['owner'] },
    ],
    'cil-user-007': [ // Paul Martel — Funder
      { orgAddress: CIL.cil, roles: ['board-member'] },
    ],
  }
  return map[userId] ?? []
}
