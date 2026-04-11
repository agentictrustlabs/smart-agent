import { PrivyClient } from '@privy-io/server-auth'
import { cookies } from 'next/headers'

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ''
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET ?? ''
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

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
  'test-user-001': { userId: 'did:privy:test-user-001', walletAddress: TEST_WALLET_ADDRESS, email: 'alice@example.com', name: 'Alice (Default)', org: 'Agentic Trust Labs', role: 'Owner' },
  'gc-user-001': { userId: 'did:privy:gc-001', walletAddress: '0x0000000000000000000000000000000000010001', email: 'james@gracecommunity.org', name: 'Pastor James', org: 'Grace Community Church', role: 'Senior Pastor' },
  'gc-user-002': { userId: 'did:privy:gc-002', walletAddress: '0x0000000000000000000000000000000000010002', email: 'sarah@sbc.net', name: 'Dr. Sarah Mitchell', org: 'Southern Baptist Convention', role: 'Executive Director' },
  'gc-user-003': { userId: 'did:privy:gc-003', walletAddress: '0x0000000000000000000000000000000000010003', email: 'dan@ecfa.org', name: 'Dan Busby', org: 'ECFA', role: 'Executive Director' },
  'gc-user-004': { userId: 'did:privy:gc-004', walletAddress: '0x0000000000000000000000000000000000010004', email: 'john@wycliffe.org', name: 'John Chesnut', org: 'Wycliffe Bible Translators', role: 'Director' },
  'gc-user-005': { userId: 'did:privy:gc-005', walletAddress: '0x0000000000000000000000000000000000010005', email: 'david@ncf.org', name: 'David Wills', org: 'National Christian Foundation', role: 'President' },
  // ILAD Mission Collective
  'mc-user-001': { userId: 'did:privy:mc-001', walletAddress: '0x0000000000000000000000000000000000050001', email: 'john@collectiveimpactlabs.org', name: 'John', org: 'Collective Impact Labs', role: 'Managing Director' },
  'mc-user-002': { userId: 'did:privy:mc-002', walletAddress: '0x0000000000000000000000000000000000050002', email: 'cameron@ilad.org', name: 'Cameron Henrion', org: 'ILAD Togo', role: 'Operations Lead' },
  'mc-user-003': { userId: 'did:privy:mc-003', walletAddress: '0x0000000000000000000000000000000000050003', email: 'nick@ilad.org', name: 'Nick Courchesne', org: 'ILAD Togo', role: 'Operations' },
  'mc-user-004': { userId: 'did:privy:mc-004', walletAddress: '0x0000000000000000000000000000000000050004', email: 'joseph@ilad-togo.org', name: 'Joseph', org: 'ILAD Togo', role: 'Local Manager (Lomé)' },
  'mc-user-005': { userId: 'did:privy:mc-005', walletAddress: '0x0000000000000000000000000000000000050005', email: 'paul@funder.org', name: 'Paul Martel', org: 'Collective Impact Labs', role: 'Funder / Advisor' },
  'mc-user-006': { userId: 'did:privy:mc-006', walletAddress: '0x0000000000000000000000000000000000050006', email: 'adama@togokafe.tg', name: 'Adama Mensah', org: 'TogoKafe', role: 'Business Owner' },
  'mc-user-007': { userId: 'did:privy:mc-007', walletAddress: '0x0000000000000000000000000000000000050007', email: 'fatou@savonafriq.tg', name: 'Fatou Amegah', org: 'SavonAfriq', role: 'Business Owner' },
  // Togo Revenue-Sharing Pilot
  'tg-user-001': { userId: 'did:privy:tg-001', walletAddress: '0x0000000000000000000000000000000000080001', email: 'kofi@cafelome.tg', name: 'Kofi Adenu', org: 'Café Lomé', role: 'Business Owner' },
  'tg-user-002': { userId: 'did:privy:tg-002', walletAddress: '0x0000000000000000000000000000000000080002', email: 'ama@mamaafi.tg', name: 'Ama Lawson', org: 'Mama Afi Restaurant', role: 'Business Owner' },
  'tg-user-003': { userId: 'did:privy:tg-003', walletAddress: '0x0000000000000000000000000000000000080003', email: 'edem@techfix.tg', name: 'Edem Togbi', org: 'TechFix Lomé', role: 'Business Owner' },
  'tg-user-004': { userId: 'did:privy:tg-004', walletAddress: '0x0000000000000000000000000000000000080004', email: 'akosua@couturedior.tg', name: 'Akosua Mensah', org: "Couture d'Or", role: 'Business Owner' },
  'tg-user-005': { userId: 'did:privy:tg-005', walletAddress: '0x0000000000000000000000000000000000080005', email: 'yao@agriplus.tg', name: 'Yao Agbeko', org: 'AgriPlus Togo', role: 'Business Owner' },
  'tg-user-006': { userId: 'did:privy:tg-006', walletAddress: '0x0000000000000000000000000000000000080006', email: 'essi@ilad-togo.org', name: 'Essi Amegah', org: 'ILAD Togo', role: 'Local Coordinator' },
  'tg-user-007': { userId: 'did:privy:tg-007', walletAddress: '0x0000000000000000000000000000000000080007', email: 'kokou@ilad-togo.org', name: 'Kokou Abalo', org: 'ILAD Togo', role: 'BDC Trainer' },
  'tg-user-008': { userId: 'did:privy:tg-008', walletAddress: '0x0000000000000000000000000000000000080008', email: 'lawrence@ilad-togo.org', name: 'Lawrence', org: 'ILAD Togo', role: 'Training Assessor' },
}

export async function getSession(): Promise<AuthSession | null> {
  if (SKIP_AUTH) {
    const cookieStore = await cookies()
    const demoUser = cookieStore.get('demo-user')?.value ?? 'test-user-001'
    const user = DEMO_USERS[demoUser] ?? DEMO_USERS['test-user-001']
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
