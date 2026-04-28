import type { WalletAction } from '@smart-agent/privacy-creds'
import { walletActionDomain, WalletActionTypes } from '@smart-agent/privacy-creds'
import { privateKeyToAccount } from 'viem/accounts'
import { ssiConfig } from '@/lib/ssi/config'
import { person } from '@/lib/ssi/clients'

/**
 * Idempotently provision an SSI holder wallet for a demo user, **without**
 * requiring a session cookie. Used by `/api/demo-login` so that as soon as
 * the demo user is signed in they can run trust search + presentation
 * flows without first having to issue a credential.
 *
 * Mirrors `provisionHolderWalletAction` but takes the user's principal +
 * EOA private key directly (the demo-login response is still mid-flight
 * when this runs, so `loadSignerForCurrentUser` would see no session).
 *
 * Returns silently when the wallet already exists or when person-mcp is
 * unreachable — failure here must never block the sign-in flow.
 */
export async function provisionHolderWalletForDemoUser(input: {
  principal: string
  privateKey: `0x${string}`
  walletContext?: string
}): Promise<{ ok: boolean; holderWalletId?: string; error?: string }> {
  const walletContext = input.walletContext ?? 'default'
  try {
    // Idempotent check — bail out if a holder wallet already exists.
    try {
      const res = await fetch(
        `${ssiConfig.walletUrl}/wallet/${encodeURIComponent(input.principal)}/${encodeURIComponent(walletContext)}`,
        { cache: 'no-store' },
      )
      if (res.ok) {
        const j = (await res.json()) as { holderWalletId?: string }
        if (j.holderWalletId) return { ok: true, holderWalletId: j.holderWalletId }
      }
    } catch { /* fall through to provision */ }

    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
      'ssi_create_wallet_action',
      {
        principal: input.principal,
        walletContext,
        type: 'ProvisionHolderWallet',
        counterpartyId: 'self',
        purpose: `provision ${walletContext}`,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }

    const account = privateKeyToAccount(input.privateKey)
    const signature = await account.signTypedData({
      domain: walletActionDomain(ssiConfig.chainId, ssiConfig.verifierContract),
      types: WalletActionTypes,
      primaryType: 'WalletAction',
      message: action,
    })

    const res = await person.callTool<{ holderWalletId?: string; error?: string }>(
      'ssi_provision_wallet',
      {
        action: built.action,
        signature,
        expectedSigner: account.address,
      },
    )
    if (res.error || !res.holderWalletId) {
      return { ok: false, error: res.error ?? 'no holderWalletId returned' }
    }
    return { ok: true, holderWalletId: res.holderWalletId }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
