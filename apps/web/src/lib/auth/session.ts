import { PrivyClient } from '@privy-io/server-auth'
import { cookies } from 'next/headers'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET ?? ''
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

let privyClient: PrivyClient | null = null

function getPrivyClient(): PrivyClient {
  if (!privyClient) {
    privyClient = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
  }
  return privyClient
}

async function getDemoSessionFromCookie(
  signedCookie: string | undefined,
): Promise<AuthSession | null> {
  if (!signedCookie) return null

  // Verify signed cookie
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
  // The demo-login API will provision the wallet on next login
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
}

/**
 * Demo user seed metadata — NO wallet addresses.
 * Real keypairs are generated at first login and stored in the DB.
 * This makes demo users indistinguishable from Privy users at the
 * contract/A2A/MCP layers.
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
  // Global.Church
  'gc-user-001': { userId: 'did:privy:gc-001', email: 'james@gracecommunity.org', name: 'Pastor James', org: 'Grace Community Church', role: 'Senior Pastor', hubId: 'global-church' },
  'gc-user-002': { userId: 'did:privy:gc-002', email: 'sarah@sbc.net', name: 'Dr. Sarah Mitchell', org: 'Southern Baptist Convention', role: 'Executive Director', hubId: 'global-church' },
  'gc-user-003': { userId: 'did:privy:gc-003', email: 'dan@ecfa.org', name: 'Dan Busby', org: 'ECFA', role: 'Executive Director', hubId: 'global-church' },
  'gc-user-004': { userId: 'did:privy:gc-004', email: 'john@wycliffe.org', name: 'John Chesnut', org: 'Wycliffe Bible Translators', role: 'Director', hubId: 'global-church' },
  'gc-user-005': { userId: 'did:privy:gc-005', email: 'david@ncf.org', name: 'David Wills', org: 'National Christian Foundation', role: 'President', hubId: 'global-church' },
  // Catalyst Network
  'cat-user-001': { userId: 'did:privy:cat-001', email: 'maria@catalystnoco.org', name: 'Maria Gonzalez', org: 'Catalyst NoCo Network', role: 'Program Director', hubId: 'catalyst' },
  'cat-user-002': { userId: 'did:privy:cat-002', email: 'david@catalystnoco.org', name: 'Pastor David Chen', org: 'Fort Collins Hub', role: 'Hub Lead', hubId: 'catalyst' },
  'cat-user-003': { userId: 'did:privy:cat-003', email: 'rosa@comunidad-noco.org', name: 'Rosa Martinez', org: 'Fort Collins Hub', role: 'Hispanic Outreach Coordinator', hubId: 'catalyst' },
  'cat-user-004': { userId: 'did:privy:cat-004', email: 'carlos@comunidad-noco.org', name: 'Carlos Herrera', org: 'Fort Collins Hub', role: 'Community Partner', hubId: 'catalyst' },
  'cat-user-005': { userId: 'did:privy:cat-005', email: 'sarah@catalystnoco.org', name: 'Sarah Thompson', org: 'Catalyst NoCo Network', role: 'Regional Lead', hubId: 'catalyst' },
  'cat-user-006': { userId: 'did:privy:cat-006', email: 'ana@wellington-circle.org', name: 'Ana Reyes', org: 'Wellington Circle', role: 'Circle Leader', hubId: 'catalyst' },
  'cat-user-007': { userId: 'did:privy:cat-007', email: 'miguel@laporte-circle.org', name: 'Miguel Santos', org: 'Laporte Circle', role: 'Circle Leader', hubId: 'catalyst' },
  // Collective Impact Labs
  'cil-user-001': { userId: 'did:privy:cil-001', email: 'cameron@ilad.org', name: 'Cameron Henrion', org: 'ILAD', role: 'Operations Lead', hubId: 'cil' },
  'cil-user-002': { userId: 'did:privy:cil-002', email: 'nick@ilad.org', name: 'Nick Courchesne', org: 'ILAD', role: 'Reviewer', hubId: 'cil' },
  'cil-user-003': { userId: 'did:privy:cil-003', email: 'afia@market.tg', name: 'Afia Mensah', org: "Afia's Market", role: 'Business Owner', hubId: 'cil' },
  'cil-user-004': { userId: 'did:privy:cil-004', email: 'kossi@repairs.tg', name: 'Kossi Agbeko', org: 'Kossi Mobile Repairs', role: 'Business Owner', hubId: 'cil' },
  'cil-user-005': { userId: 'did:privy:cil-005', email: 'yaw@ilad-togo.org', name: 'Yaw', org: 'ILAD', role: 'Local Manager', hubId: 'cil' },
  'cil-user-006': { userId: 'did:privy:cil-006', email: 'john@cil.org', name: 'John F. Kim', org: 'Collective Impact Labs', role: 'Admin', hubId: 'cil' },
  'cil-user-007': { userId: 'did:privy:cil-007', email: 'paul@funder.org', name: 'Paul Martel', org: 'Collective Impact Labs', role: 'Funder', hubId: 'cil' },
}

/**
 * @deprecated Use DEMO_USER_META instead. This shim exists for backward compat
 * with code that reads walletAddress from the static map. It returns a placeholder
 * address — actual wallet comes from the DB after keypair generation.
 */
export const DEMO_USERS: Record<string, { userId: string; walletAddress: string; email: string; name: string; org: string; role: string }> = Object.fromEntries(
  Object.entries(DEMO_USER_META).map(([key, meta]) => [
    key,
    { ...meta, walletAddress: '0x0000000000000000000000000000000000000000' },
  ]),
)

export async function getSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies()
  const demoSession = SKIP_AUTH
    ? await getDemoSessionFromCookie(cookieStore.get('demo-user')?.value)
    : null
  const authToken = cookieStore.get('privy-token')?.value

  if (!authToken) {
    return demoSession
  }

  try {
    const client = getPrivyClient()
    const verifiedClaims = await client.verifyAuthToken(authToken)

    let walletAddress: string | null = null
    let email: string | null = null

    try {
      const user = await client.getUser(verifiedClaims.userId)
      walletAddress = user.wallet?.address ?? null
      email = user.email?.address ?? null
    } catch (userErr) {
      console.warn('[auth] Failed to fetch user details:', userErr)
    }

    return {
      userId: verifiedClaims.userId,
      walletAddress,
      email,
    }
  } catch (err) {
    console.warn('[auth] Session verification failed:', err)
    return demoSession
  }
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession()
  if (!session) {
    throw new Error('Unauthorized: No valid session')
  }
  return session
}
