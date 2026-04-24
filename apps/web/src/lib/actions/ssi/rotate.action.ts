'use server'

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { person } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'

export async function rotateLinkSecretAction(args: {
  walletContext: string
}): Promise<{
  success: boolean
  walletContext?: string
  oldLinkSecretId?: string
  newLinkSecretId?: string
  credentialsMarkedStale?: number
  error?: string
}> {
  try {
    const { principal } = await loadSignerForCurrentUser()

    // Resolve holderWalletId for (principal, context).
    const res = await fetch(
      `${ssiConfig.walletUrl}/wallet/${encodeURIComponent(principal)}/${encodeURIComponent(args.walletContext)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return { success: false, error: `no wallet for context '${args.walletContext}'` }
    const { holderWalletId } = (await res.json()) as { holderWalletId: string }

    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
      'ssi_create_wallet_action',
      {
        principal,
        walletContext: args.walletContext,
        type: 'RotateLinkSecret',
        counterpartyId: 'self',
        purpose: `rotate link secret ${args.walletContext}`,
        holderWalletId,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const { signature } = await signWalletAction(action)

    const rot = await person.callTool<{
      holderWalletId?: string
      oldLinkSecretId?: string
      newLinkSecretId?: string
      credentialsMarkedStale?: number
      error?: string
    }>('ssi_rotate_link_secret', { action: built.action, signature })

    if (rot.error) return { success: false, error: rot.error }

    revalidatePath('/wallet')
    return {
      success: true,
      walletContext: args.walletContext,
      oldLinkSecretId:        rot.oldLinkSecretId,
      newLinkSecretId:        rot.newLinkSecretId,
      credentialsMarkedStale: rot.credentialsMarkedStale,
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
