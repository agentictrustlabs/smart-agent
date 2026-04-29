import { cookies } from 'next/headers'
import { readSession, SESSION_COOKIE } from './native-session'

async function getDemoSessionFromCookie(
  signedCookie: string | undefined,
): Promise<AuthSession | null> {
  if (!signedCookie) return null

  // Verify signed cookie (legacy demo path — kept so in-flight sessions don't break).
  const { verifyCookie } = await import('@/lib/cookie-signing')
  const demoUser = verifyCookie(signedCookie)
  if (!demoUser) return null

  const meta = DEMO_USER_META[demoUser]
  if (!meta) return null

  // Look up the real wallet address from DB (generated at first login)
  try {
    const { db, schema } = await import('@/db')
    const { eq } = await import('drizzle-orm')
    const rows = await db.select().from(schema.users)
      .where(eq(schema.users.id, demoUser)).limit(1)

    if (rows[0]?.walletAddress) {
      return {
        userId: meta.userId,
        walletAddress: rows[0].walletAddress,
        email: meta.email,
      }
    }
  } catch { /* DB may not be ready yet */ }

  // Fallback: user not yet provisioned — return meta with null wallet
  return {
    userId: meta.userId,
    walletAddress: null,
    email: meta.email,
  }
}

export interface AuthSession {
  userId: string
  walletAddress: string | null
  email: string | null
  /** Auth method used to obtain this session — null for legacy demo cookies. */
  via?: 'demo' | 'passkey' | 'siwe' | 'google' | null
}

/**
 * Demo user seed metadata — NO wallet addresses.
 * Real keypairs are generated at first login and stored in the DB.
 */
export interface DemoUserMeta {
  userId: string
  email: string
  name: string
  org: string
  role: string
  hubId: 'global-church' | 'catalyst' | 'cil' | 'generic'
}

export const DEMO_USER_META: Record<string, DemoUserMeta> = {
  // ─── Global.Church ───────────────────────────────────────────────
  'gc-user-001': { userId: 'did:demo:gc-001', email: 'james@gracecommunity.org',  name: 'Pastor James',         org: 'Grace Community Church',          role: 'Senior Pastor',           hubId: 'global-church' },
  'gc-user-002': { userId: 'did:demo:gc-002', email: 'sarah@sbc.net',             name: 'Dr. Sarah Mitchell',   org: 'Southern Baptist Convention',     role: 'Executive Director',      hubId: 'global-church' },
  'gc-user-003': { userId: 'did:demo:gc-003', email: 'dan@ecfa.org',              name: 'Dan Busby',            org: 'ECFA',                            role: 'Executive Director',      hubId: 'global-church' },
  'gc-user-004': { userId: 'did:demo:gc-004', email: 'john@wycliffe.org',         name: 'John Chesnut',         org: 'Wycliffe Bible Translators',      role: 'Director',                hubId: 'global-church' },
  'gc-user-005': { userId: 'did:demo:gc-005', email: 'david@ncf.org',             name: 'David Wills',          org: 'National Christian Foundation',   role: 'President',               hubId: 'global-church' },
  'gc-user-006': { userId: 'did:demo:gc-006', email: 'mike@gracecommunity.org',   name: 'Pastor Mike Thompson', org: 'Grace Youth Ministry',            role: 'Youth Pastor',            hubId: 'global-church' },
  'gc-user-007': { userId: 'did:demo:gc-007', email: 'janet@gracecommunity.org',  name: 'Janet Wilson',         org: 'Grace Small Groups',              role: 'Small Groups Director',   hubId: 'global-church' },
  'gc-user-008': { userId: 'did:demo:gc-008', email: 'marcus@gracecommunity.org', name: 'Marcus Lee',           org: 'Grace Missions Team',             role: 'Missions Director',       hubId: 'global-church' },

  // ─── Catalyst Network ────────────────────────────────────────────
  // Network-level
  'cat-user-001': { userId: 'did:demo:cat-001', email: 'maria@catalystnoco.org',     name: 'Maria Gonzalez',      org: 'Catalyst NoCo Network',  role: 'Program Director',          hubId: 'catalyst' },
  'cat-user-005': { userId: 'did:demo:cat-005', email: 'sarah@catalystnoco.org',     name: 'Sarah Thompson',      org: 'Catalyst NoCo Network',  role: 'Regional Lead',             hubId: 'catalyst' },
  // Regional facilitator (Fort Collins Network — the city-level facilitator org)
  'cat-user-002': { userId: 'did:demo:cat-002', email: 'david@catalystnoco.org',     name: 'Pastor David Chen',   org: 'Fort Collins Network',   role: 'Network Lead',              hubId: 'catalyst' },
  'cat-user-003': { userId: 'did:demo:cat-003', email: 'rosa@comunidad-noco.org',    name: 'Rosa Martinez',       org: 'Fort Collins Network',   role: 'Outreach Coordinator',      hubId: 'catalyst' },
  'cat-user-004': { userId: 'did:demo:cat-004', email: 'carlos@comunidad-noco.org',  name: 'Carlos Herrera',      org: 'Fort Collins Network',   role: 'Community Partner',         hubId: 'catalyst' },
  // Local circle leaders — every circle has its own owner.
  'cat-user-006': { userId: 'did:demo:cat-006', email: 'ana@wellington-circle.org',  name: 'Ana Reyes',           org: 'Wellington Circle',      role: 'Circle Leader',             hubId: 'catalyst' },
  'cat-user-007': { userId: 'did:demo:cat-007', email: 'miguel@laporte-circle.org',  name: 'Miguel Santos',       org: 'Laporte Circle',         role: 'Circle Leader',             hubId: 'catalyst' },
  'cat-user-008': { userId: 'did:demo:cat-008', email: 'elena@timnath-circle.org',   name: 'Elena Vasquez',       org: 'Timnath Circle',         role: 'Circle Leader',             hubId: 'catalyst' },
  'cat-user-009': { userId: 'did:demo:cat-009', email: 'luis@loveland-circle.org',   name: 'Luis Hernandez',      org: 'Loveland Circle',        role: 'Circle Leader',             hubId: 'catalyst' },
  'cat-user-010': { userId: 'did:demo:cat-010', email: 'sofia@berthoud-circle.org',  name: 'Sofia Ramirez',       org: 'Berthoud Circle',        role: 'Circle Leader',             hubId: 'catalyst' },
  'cat-user-011': { userId: 'did:demo:cat-011', email: 'diego@johnstown-circle.org', name: 'Diego Morales',       org: 'Johnstown Circle',       role: 'Circle Leader',             hubId: 'catalyst' },
  'cat-user-012': { userId: 'did:demo:cat-012', email: 'isabel@redfeather-circle.org', name: 'Isabel Cruz',       org: 'Red Feather Circle',     role: 'Circle Leader',             hubId: 'catalyst' },

  // ─── Collective Impact Labs ──────────────────────────────────────
  'cil-user-001': { userId: 'did:demo:cil-001', email: 'cameron@ilad.org',          name: 'Cameron Henrion',     org: 'ILAD',                       role: 'Operations Lead',           hubId: 'cil' },
  'cil-user-002': { userId: 'did:demo:cil-002', email: 'nick@ilad.org',             name: 'Nick Courchesne',     org: 'ILAD',                       role: 'Reviewer',                  hubId: 'cil' },
  'cil-user-003': { userId: 'did:demo:cil-003', email: 'afia@market.tg',            name: 'Afia Mensah',         org: "Afia's Market",              role: 'Business Owner',            hubId: 'cil' },
  'cil-user-004': { userId: 'did:demo:cil-004', email: 'kossi@repairs.tg',          name: 'Kossi Agbeko',        org: 'Kossi Mobile Repairs',       role: 'Business Owner',            hubId: 'cil' },
  'cil-user-005': { userId: 'did:demo:cil-005', email: 'yaw@ilad-togo.org',         name: 'Yaw',                 org: 'Lomé Business Cluster',      role: 'Cluster Manager',           hubId: 'cil' },
  'cil-user-006': { userId: 'did:demo:cil-006', email: 'john@cil.org',              name: 'John F. Kim',         org: 'Collective Impact Labs',     role: 'Admin',                     hubId: 'cil' },
  'cil-user-007': { userId: 'did:demo:cil-007', email: 'paul@funder.org',           name: 'Paul Martel',         org: 'Collective Impact Labs',     role: 'Funder',                    hubId: 'cil' },
  'cil-user-008': { userId: 'did:demo:cil-008', email: 'akosua@cil.org',            name: 'Akosua Boateng',      org: 'Wave 1 Cohort',              role: 'Cohort Coordinator',        hubId: 'cil' },
  'cil-user-009': { userId: 'did:demo:cil-009', email: 'kwame@cil.org',             name: 'Kwame Asante',        org: 'Wave 2 Cohort',              role: 'Cohort Coordinator',        hubId: 'cil' },

  // ─── Front Range House Churches (Catalyst sister — Estes / Loveland foothills) ──
  // House-church multiplication in NoCo's mountain + foothills corridor.
  // Mirrors the Harvest-East archetype set: admin, dispatcher, two
  // frontline multipliers, a multi-gen coach, a strategist.
  'fr-user-001': { userId: 'did:demo:fr-001', email: 'annika@frontrangehouses.org', name: 'Annika Hartwell',   org: 'Front Range House Churches',    role: 'Network Admin',             hubId: 'catalyst' },
  'fr-user-002': { userId: 'did:demo:fr-002', email: 'brent@frontrangehouses.org',  name: 'Brent Saunders',    org: 'Front Range House Churches',    role: 'Dispatcher',                hubId: 'catalyst' },
  'fr-user-003': { userId: 'did:demo:fr-003', email: 'rachel@frontrangehouses.org', name: 'Rachel Park',       org: 'Front Range House Churches',    role: 'Multiplier',                hubId: 'catalyst' },
  'fr-user-004': { userId: 'did:demo:fr-004', email: 'kenji@frontrangehouses.org',  name: 'Kenji Tanaka',      org: 'Front Range House Churches',    role: 'Multi-Gen Coach',           hubId: 'catalyst' },
  'fr-user-005': { userId: 'did:demo:fr-005', email: 'lina@frontrangehouses.org',   name: 'Lina Chen',         org: 'Front Range House Churches',    role: 'Strategist',                hubId: 'catalyst' },

  // ─── Plains Church Planters (Catalyst sister — eastern CO plains) ──
  // Greeley / Sterling / Yuma corridor church planting. Smaller team
  // with a digital-responder lead because the plains catchment leans
  // on radio + social media, not foot traffic.
  'pl-user-001': { userId: 'did:demo:pl-001', email: 'joseph@plainscp.org',         name: 'Joseph Kane',       org: 'Plains Church Planters',        role: 'Network Admin',             hubId: 'catalyst' },
  'pl-user-002': { userId: 'did:demo:pl-002', email: 'sophia@plainscp.org',         name: 'Sophia Mendoza',    org: 'Plains Church Planters',        role: 'Digital Responder',         hubId: 'catalyst' },
  'pl-user-003': { userId: 'did:demo:pl-003', email: 'peter@plainscp.org',          name: 'Peter Nielsen',     org: 'Plains Church Planters',        role: 'Multiplier',                hubId: 'catalyst' },
  'pl-user-004': { userId: 'did:demo:pl-004', email: 'esther@plainscp.org',         name: 'Esther Walsh',      org: 'Plains Church Planters',        role: 'Strategist',                hubId: 'catalyst' },

  // ─── Denver Metro Bridge (Catalyst sister — Denver / Aurora / Lakewood) ──
  // Urban disciple-making in the Denver metros — coffee-shop discipling,
  // dispatcher routes leads across multiple neighborhood hubs.
  'dm-user-001': { userId: 'did:demo:dm-001', email: 'marcus@denvermetrobridge.org',  name: 'Marcus Hill',     org: 'Denver Metro Bridge',           role: 'Network Admin',             hubId: 'catalyst' },
  'dm-user-002': { userId: 'did:demo:dm-002', email: 'priya@denvermetrobridge.org',   name: 'Priya Nair',      org: 'Denver Metro Bridge',           role: 'Multiplier',                hubId: 'catalyst' },
  'dm-user-003': { userId: 'did:demo:dm-003', email: 'terrence@denvermetrobridge.org', name: 'Terrence Owens', org: 'Denver Metro Bridge',           role: 'Dispatcher',                hubId: 'catalyst' },
}

/**
 * @deprecated kept for backward-compat with code that reads walletAddress
 * from the static map.
 */
export const DEMO_USERS: Record<string, { userId: string; walletAddress: string; email: string; name: string; org: string; role: string }> = Object.fromEntries(
  Object.entries(DEMO_USER_META).map(([key, meta]) => [
    key,
    { ...meta, walletAddress: '0x0000000000000000000000000000000000000000' },
  ]),
)

/**
 * Returns the active session, if any. Order of precedence:
 *   1. Native JWT cookie (`smart-agent-session`) — preferred.
 *   2. Legacy demo-user cookie (HMAC-signed user id) — fallback during the
 *      legacy → native transition. Drops out once everyone re-logs in.
 */
export async function getSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies()
  const jwt = cookieStore.get(SESSION_COOKIE)?.value
  const claims = readSession(jwt)
  if (claims) {
    return {
      userId: claims.sub,
      walletAddress: claims.walletAddress ?? null,
      email: claims.email ?? null,
      via: claims.via ?? null,
    }
  }
  // Legacy demo cookie path.
  return getDemoSessionFromCookie(cookieStore.get('demo-user')?.value)
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession()
  if (!session) {
    throw new Error('Unauthorized: No valid session')
  }
  return session
}
