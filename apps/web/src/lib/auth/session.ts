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

export interface AuthSession {
  userId: string
  walletAddress: string | null
  email: string | null
}

/** Demo user profiles for SKIP_AUTH mode */
export const DEMO_USERS: Record<string, { userId: string; walletAddress: string; email: string; name: string; org: string; role: string }> = {
  // Global.Church
  'gc-user-001': { userId: 'did:privy:gc-001', walletAddress: '0x0000000000000000000000000000000000010001', email: 'james@gracecommunity.org', name: 'Pastor James', org: 'Grace Community Church', role: 'Senior Pastor' },
  'gc-user-002': { userId: 'did:privy:gc-002', walletAddress: '0x0000000000000000000000000000000000010002', email: 'sarah@sbc.net', name: 'Dr. Sarah Mitchell', org: 'Southern Baptist Convention', role: 'Executive Director' },
  'gc-user-003': { userId: 'did:privy:gc-003', walletAddress: '0x0000000000000000000000000000000000010003', email: 'dan@ecfa.org', name: 'Dan Busby', org: 'ECFA', role: 'Executive Director' },
  'gc-user-004': { userId: 'did:privy:gc-004', walletAddress: '0x0000000000000000000000000000000000010004', email: 'john@wycliffe.org', name: 'John Chesnut', org: 'Wycliffe Bible Translators', role: 'Director' },
  'gc-user-005': { userId: 'did:privy:gc-005', walletAddress: '0x0000000000000000000000000000000000010005', email: 'david@ncf.org', name: 'David Wills', org: 'National Christian Foundation', role: 'President' },
  // Catalyst Network (Northern Colorado — Hispanic outreach)
  'cat-user-001': { userId: 'did:privy:cat-001', walletAddress: '0x00000000000000000000000000000000000b0001', email: 'maria@catalystnoco.org', name: 'Maria Gonzalez', org: 'Catalyst NoCo Network', role: 'Program Director' },
  'cat-user-002': { userId: 'did:privy:cat-002', walletAddress: '0x00000000000000000000000000000000000b0002', email: 'david@catalystnoco.org', name: 'Pastor David Chen', org: 'Fort Collins Hub', role: 'Hub Lead' },
  'cat-user-003': { userId: 'did:privy:cat-003', walletAddress: '0x00000000000000000000000000000000000b0003', email: 'rosa@comunidad-noco.org', name: 'Rosa Martinez', org: 'Fort Collins Hub', role: 'Hispanic Outreach Coordinator' },
  'cat-user-004': { userId: 'did:privy:cat-004', walletAddress: '0x00000000000000000000000000000000000b0004', email: 'carlos@comunidad-noco.org', name: 'Carlos Herrera', org: 'Fort Collins Hub', role: 'Community Partner' },
  'cat-user-005': { userId: 'did:privy:cat-005', walletAddress: '0x00000000000000000000000000000000000b0005', email: 'sarah@catalystnoco.org', name: 'Sarah Thompson', org: 'Catalyst NoCo Network', role: 'Regional Lead' },
  'cat-user-006': { userId: 'did:privy:cat-006', walletAddress: '0x00000000000000000000000000000000000b0006', email: 'ana@wellington-circle.org', name: 'Ana Reyes', org: 'Wellington Circle', role: 'Circle Leader' },
  'cat-user-007': { userId: 'did:privy:cat-007', walletAddress: '0x00000000000000000000000000000000000b0007', email: 'miguel@laporte-circle.org', name: 'Miguel Santos', org: 'Laporte Circle', role: 'Circle Leader' },
  // Collective Impact Labs (Ravah Capital Pilot — Togo)
  'cil-user-001': { userId: 'did:privy:cil-001', walletAddress: '0x00000000000000000000000000000000000c0001', email: 'cameron@ilad.org', name: 'Cameron Henrion', org: 'ILAD', role: 'Operations Lead' },
  'cil-user-002': { userId: 'did:privy:cil-002', walletAddress: '0x00000000000000000000000000000000000c0002', email: 'nick@ilad.org', name: 'Nick Courchesne', org: 'ILAD', role: 'Reviewer' },
  'cil-user-003': { userId: 'did:privy:cil-003', walletAddress: '0x00000000000000000000000000000000000c0003', email: 'afia@market.tg', name: 'Afia Mensah', org: "Afia's Market", role: 'Business Owner' },
  'cil-user-004': { userId: 'did:privy:cil-004', walletAddress: '0x00000000000000000000000000000000000c0004', email: 'kossi@repairs.tg', name: 'Kossi Agbeko', org: 'Kossi Mobile Repairs', role: 'Business Owner' },
  'cil-user-005': { userId: 'did:privy:cil-005', walletAddress: '0x00000000000000000000000000000000000c0005', email: 'yaw@ilad-togo.org', name: 'Yaw', org: 'ILAD', role: 'Local Manager' },
  'cil-user-006': { userId: 'did:privy:cil-006', walletAddress: '0x00000000000000000000000000000000000c0006', email: 'john@cil.org', name: 'John F. Kim', org: 'Collective Impact Labs', role: 'Admin' },
  'cil-user-007': { userId: 'did:privy:cil-007', walletAddress: '0x00000000000000000000000000000000000c0007', email: 'paul@funder.org', name: 'Paul Martel', org: 'Collective Impact Labs', role: 'Funder' },
}

export async function getSession(): Promise<AuthSession | null> {
  if (SKIP_AUTH) {
    const cookieStore = await cookies()
    const demoUser = cookieStore.get('demo-user')?.value ?? 'gc-user-001'
    const user = DEMO_USERS[demoUser] ?? DEMO_USERS['gc-user-001']
    return {
      userId: user.userId,
      walletAddress: user.walletAddress,
      email: user.email,
    }
  }

  const cookieStore = await cookies()
  const authToken = cookieStore.get('privy-token')?.value

  if (!authToken) {
    return null
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
    return null
  }
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession()
  if (!session) {
    throw new Error('Unauthorized: No valid session')
  }
  return session
}
