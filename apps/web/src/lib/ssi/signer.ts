import { privateKeyToAccount } from 'viem/accounts'
import { walletActionDomain, WalletActionTypes, type WalletAction } from '@smart-agent/privacy-creds'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { ssiConfig } from './config'

/**
 * Load the currently-authenticated user + their stored signing key.
 * Mirrors the pattern used by the A2A bootstrap action.
 */
export async function loadSignerForCurrentUser(): Promise<{
  userRow: { id: string; walletAddress: string; privateKey: string; name: string }
  principal: string
}> {
  const session = await requireSession()
  if (!session.walletAddress) throw new Error('No wallet address in session')

  const rows = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress))
    .limit(1)
  const user = rows[0]
  if (!user) throw new Error('User not found')
  if (!user.privateKey) throw new Error('User has no stored key (demo wallet required)')

  return {
    userRow: {
      id: user.id,
      walletAddress: user.walletAddress,
      privateKey: user.privateKey,
      name: user.name,
    },
    principal: `person_${user.id}`,
  }
}

/**
 * Sign a WalletAction with the current user's stored EOA key.
 * Returns both the message-shaped action (bigint expiresAt) and the signature.
 */
export async function signWalletAction(action: WalletAction): Promise<{ signature: `0x${string}`; signer: `0x${string}` }> {
  const { userRow } = await loadSignerForCurrentUser()
  const account = privateKeyToAccount(userRow.privateKey as `0x${string}`)
  const signature = await account.signTypedData({
    domain: walletActionDomain(ssiConfig.chainId, ssiConfig.verifierContract),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })
  return { signature, signer: account.address }
}
