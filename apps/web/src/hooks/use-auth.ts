'use client'

import { usePrivy } from '@privy-io/react-auth'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const MOCK_USER = {
  id: 'did:privy:test-user-001',
  wallet: { address: TEST_WALLET_ADDRESS },
  email: { address: 'testuser@example.com' },
  google: { name: 'Test User' },
} as const

export function useAuth() {
  if (SKIP_AUTH) {
    return {
      authenticated: true,
      ready: true,
      user: MOCK_USER as ReturnType<typeof usePrivy>['user'],
      login: () => {},
      logout: () => Promise.resolve(),
    }
  }

  return usePrivy()
}
