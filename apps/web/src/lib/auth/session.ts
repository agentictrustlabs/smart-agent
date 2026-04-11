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
