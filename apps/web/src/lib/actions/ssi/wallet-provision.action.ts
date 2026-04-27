'use server'

/**
 * Shared client-signing primitives for the AnonCreds wallet flow:
 *   • prepareWalletProvisionIfNeeded — idempotent check; returns either
 *     an existing holderWalletId OR an unsigned ProvisionHolderWallet
 *     action for the client to sign.
 *   • submitWalletProvision — submits a client-signed provision action
 *     and returns the new holderWalletId.
 *
 * Both steps are independent of credential type. They get used by every
 * `Get {noun} credential` flow before issuance can begin. Passkey users
 * will sign the provision action client-side via `signWalletActionClient`;
 * EOA / SIWE users go through the same shape via the same helper.
 */

import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import { person } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'
import { requireSession } from '@/lib/auth/session'
import { hashWalletAction, type SignerContext } from '@/lib/credentials/wallet-helpers'

const WALLET_CONTEXT = 'default'

export async function getSignerContext(): Promise<SignerContext> {
  const session = await requireSession()
  const ctx = await loadSignerForCurrentUser()

  if (ctx.kind === 'eoa') {
    return {
      kind: 'eoa',
      chainId: ssiConfig.chainId,
      verifyingContract: ssiConfig.verifierContract,
      signerAddress: ctx.userRow.walletAddress as `0x${string}`,
      smartAccountAddress: null,
      walletAddress: ctx.userRow.walletAddress as `0x${string}`,
    }
  }
  if (session.via === 'siwe') {
    return {
      kind: 'siwe',
      chainId: ssiConfig.chainId,
      verifyingContract: ssiConfig.verifierContract,
      signerAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
      smartAccountAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
      walletAddress: session.walletAddress as `0x${string}`,
    }
  }
  return {
    kind: 'passkey',
    chainId: ssiConfig.chainId,
    verifyingContract: ssiConfig.verifierContract,
    signerAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
    smartAccountAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
    walletAddress: null,
  }
}

export async function prepareWalletProvisionIfNeeded(): Promise<{
  success: boolean
  error?: string
  signer?: SignerContext
  alreadyProvisioned?: { holderWalletId: string; walletContext: string }
  needsProvision?: {
    action: WalletAction & { expiresAt: string }
    hash: `0x${string}`
    walletContext: string
  }
}> {
  try {
    const signer = await getSignerContext()
    const ctx = await loadSignerForCurrentUser()
    const principal = ctx.principal

    // Idempotent check — person-mcp may already have a holder wallet for
    // this (principal, walletContext) pair from an earlier session.
    try {
      const res = await fetch(
        `${ssiConfig.walletUrl}/wallet/${encodeURIComponent(principal)}/${encodeURIComponent(WALLET_CONTEXT)}`,
        { cache: 'no-store' },
      )
      if (res.ok) {
        const j = (await res.json()) as { holderWalletId?: string }
        if (j.holderWalletId) {
          return {
            success: true,
            signer,
            alreadyProvisioned: { holderWalletId: j.holderWalletId, walletContext: WALLET_CONTEXT },
          }
        }
      }
    } catch { /* fall through */ }

    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
      'ssi_create_wallet_action',
      {
        principal,
        walletContext: WALLET_CONTEXT,
        type: 'ProvisionHolderWallet',
        counterpartyId: 'self',
        purpose: `provision ${WALLET_CONTEXT}`,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const hash = hashWalletAction(action, signer)
    return {
      success: true,
      signer,
      needsProvision: { action: built.action, hash, walletContext: WALLET_CONTEXT },
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export async function submitWalletProvision(input: {
  action: WalletAction & { expiresAt: string }
  signature: `0x${string}`
}): Promise<{ success: boolean; holderWalletId?: string; walletContext?: string; error?: string }> {
  try {
    const signer = await getSignerContext()
    const res = await person.callTool<{ holderWalletId?: string; error?: string }>(
      'ssi_provision_wallet',
      {
        action: input.action,
        signature: input.signature,
        expectedSigner: signer.signerAddress,
      },
    )
    if (res.error || !res.holderWalletId) {
      return { success: false, error: res.error ?? 'provision failed' }
    }
    return { success: true, holderWalletId: res.holderWalletId, walletContext: WALLET_CONTEXT }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
