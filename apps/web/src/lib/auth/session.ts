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

export async function getSession(): Promise<AuthSession | null> {
  if (SKIP_AUTH) {
    return {
      userId: 'did:privy:test-user-001',
      walletAddress: TEST_WALLET_ADDRESS,
      email: 'testuser@example.com',
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
