'use server'

/**
 * Routing rule (phase 3 of A2A-first consolidation):
 *   - Person-mcp tool calls (`ssi_create_wallet_action`,
 *     `ssi_rotate_link_secret`) go through `callMcp('person', …)` —
 *     signed-in user IS the principal whose link secret is rotating.
 *   - `GET ${walletUrl}/wallet/<principal>/<context>` is a direct HTTP
 *     check on person-mcp's non-tool surface; TODO(phase-4) wrap as
 *     `ssi_get_holder_wallet`.
 */

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { callMcp } from '@/lib/clients/mcp-client'
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
    // TODO(phase-4): direct GET on person-mcp non-tool route. Wrap as
    // `ssi_get_holder_wallet` so this can route via callMcp.
    const res = await fetch(
      `${ssiConfig.walletUrl}/wallet/${encodeURIComponent(principal)}/${encodeURIComponent(args.walletContext)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return { success: false, error: `no wallet for context '${args.walletContext}'` }
    const { holderWalletId } = (await res.json()) as { holderWalletId: string }

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
