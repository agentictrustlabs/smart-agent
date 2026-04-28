'use server'

/**
 * Server-side signing fallback for `signWalletActionClient` when the
 * caller's signer kind is `eoa` (demo / SIWE-with-stored-key paths).
 * Demo users have a server-resident private key so there's no point
 * popping a wallet UI — we sign in the same request and hand the
 * signature back.
 */

import type { WalletAction } from '@smart-agent/privacy-creds'
import { signWalletAction } from '@/lib/ssi/signer'

export async function signWalletActionAsCurrentEoa(
  action: WalletAction & { expiresAt: string },
): Promise<{ signature?: `0x${string}`; signer?: `0x${string}`; error?: string }> {
  try {
    const fullAction: WalletAction = { ...action, expiresAt: BigInt(action.expiresAt) }
    const { signature, signer } = await signWalletAction(fullAction)
    return { signature, signer }
  } catch (err) {
    return { error: (err as Error).message }
  }
}
