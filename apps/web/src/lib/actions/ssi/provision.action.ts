'use server'

/**
 * Routing rule (phase 3 of A2A-first consolidation): both person-mcp
 * tool calls (`ssi_create_wallet_action`, `ssi_provision_wallet`) go
 * through `callMcp('person', …)`. The signed-in user IS the principal
 * being provisioned, so no `agentAddress` opt — default A2A resolution
 * to the user's own person agent applies.
 */

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { callMcp } from '@/lib/clients/mcp-client'

export async function provisionHolderWalletAction(
  walletContext: string = 'default',
): Promise<{ success: boolean; holderWalletId?: string; walletContext?: string; error?: string }> {
  try {
    const ctx = await loadSignerForCurrentUser()
    if (ctx.kind !== 'eoa') {
      return { success: false, error: 'OAuth users must use the passkey-signed WalletAction flow (Phase 4 client path)' }
    }
    const { userRow, principal } = ctx

    const built = await callMcp<{ action: WalletAction & { expiresAt: string } }>(
      'person',
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

    const res = await callMcp<{ holderWalletId: string; error?: string }>(
      'person',
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
