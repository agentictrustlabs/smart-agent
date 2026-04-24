'use server'

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { person } from '@/lib/ssi/clients'

export async function provisionHolderWalletAction(
  walletContext: string = 'default',
): Promise<{ success: boolean; holderWalletId?: string; walletContext?: string; error?: string }> {
  try {
    const { userRow, principal } = await loadSignerForCurrentUser()

    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
      'ssi_create_wallet_action',
      {
        principal,
        walletContext,
        type: 'ProvisionHolderWallet',
        counterpartyId: 'self',
        purpose: `provision ${walletContext}`,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const { signature } = await signWalletAction(action)

    const res = await person.callTool<{ holderWalletId: string; error?: string }>(
      'ssi_provision_wallet',
      { action: built.action, signature, expectedSigner: userRow.walletAddress },
    )
    if (res.error) return { success: false, error: res.error }
    revalidatePath('/wallet')
    return { success: true, holderWalletId: res.holderWalletId, walletContext }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
