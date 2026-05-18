'use server'

/**
 * Routing rule (phase 3 of A2A-first consolidation):
 *   - Person-mcp tool calls (`ssi_create_wallet_action`,
 *     `ssi_rotate_link_secret`, `ssi_get_holder_wallet`) go through
 *     `callMcp('person', …)` — signed-in user IS the principal whose
 *     link secret is rotating. Sprint 5 W3 P1-2: no direct GET on
 *     /wallet/<principal>/<context>.
 */

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { callMcp } from '@/lib/clients/mcp-client'

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
    // Sprint 5 W3 P1-2: routed via ssi_get_holder_wallet (a2a→person hop
    // signed). Direct GET on /wallet/<principal>/<context> is no longer
    // accepted by person-mcp.
    const lookup = await callMcp<{ found: boolean; holderWalletId?: string }>(
      'person',
      'ssi_get_holder_wallet',
      { principal, walletContext: args.walletContext },
    )
    if (!lookup.found || !lookup.holderWalletId) {
      return { success: false, error: `no wallet for context '${args.walletContext}'` }
    }
    const holderWalletId = lookup.holderWalletId

    const built = await callMcp<{ action: WalletAction & { expiresAt: string } }>(
      'person',
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

    const rot = await callMcp<{
      holderWalletId?: string
      oldLinkSecretId?: string
      newLinkSecretId?: string
      credentialsMarkedStale?: number
      error?: string
    }>('person', 'ssi_rotate_link_secret', { action: built.action, signature })

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
