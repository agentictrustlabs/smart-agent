'use server'

/**
 * Anonymous-org-registration flow with **client-side signing**.
 *
 * The full AnonCreds dance (provision wallet → offer → request → issue → store)
 * has two WalletActions that need user-controlled signatures: ProvisionHolder
 * Wallet (only the first time the user uses the SSI wallet) and Accept
 * CredentialOffer (every issuance). These actions must be signed by either
 *
 *   - the user's EOA (SIWE / demo) — the EOA is an owner of the smart account
 *     so plain ECDSA signatures pass ERC-1271 isValidSignature; OR
 *   - the user's passkey (passkey / Google) — assertion signed against the
 *     smart account's registered passkey, packed with 0x01 type byte.
 *
 *   ❌ We never use the deployer key. The whole point of these actions is
 *      that the holder authorizes them — using the relayer would defeat the
 *      privacy model.
 *
 * The flow is split into prepare/submit pairs because client-side signing
 * has to happen between server roundtrips.
 *
 *   prepareAnonOrgRegistration       → returns existing wallet info OR a
 *                                       ProvisionHolderWallet action to sign
 *   submitProvisionWallet            → server forwards signed action to
 *                                       ssi-wallet-mcp, returns holderWalletId
 *   prepareAcceptCredentialOffer     → server fetches offer, builds Accept
 *                                       CredentialOffer action, returns the
 *                                       hash + the action to sign
 *   completeAnonOrgRegistration      → server runs request → issue → store
 *                                       with the signed action; returns
 *                                       credentialId
 */

import type { WalletAction } from '@smart-agent/privacy-creds'
import { walletActionDomain, WalletActionTypes } from '@smart-agent/privacy-creds'
import { hashTypedData } from 'viem'
import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import { person, org } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'
import { requireSession } from '@/lib/auth/session'

const WALLET_CONTEXT = 'default'

/** What the client needs to know about the user's signing path. */
type SignerKind = 'eoa' | 'passkey' | 'siwe'

interface SignerContext {
  kind: SignerKind
  /** EIP-712 verifying contract — same regardless of signer kind. */
  chainId: number
  verifyingContract: `0x${string}`
  /** Address that will appear as `signer` in verifyWalletAction. */
  signerAddress: `0x${string}`
  /** Smart account address (== signerAddress for OAuth/passkey users). */
  smartAccountAddress: `0x${string}` | null
  /** EOA wallet address — for SIWE users this is the actual MetaMask account. */
  walletAddress: `0x${string}` | null
}

async function getSignerContext(): Promise<SignerContext> {
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

  // Smart-account user — could be passkey, google, or siwe (which has the
  // wallet EOA as smart-account owner). Use the session's `via` to pick the
  // signing path.
  const via = session.via
  if (via === 'siwe') {
    return {
      kind: 'siwe',
      chainId: ssiConfig.chainId,
      verifyingContract: ssiConfig.verifierContract,
      signerAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
      smartAccountAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
      walletAddress: session.walletAddress as `0x${string}`,
    }
  }
  // Passkey, google, or unknown smart-account → passkey path.
  return {
    kind: 'passkey',
    chainId: ssiConfig.chainId,
    verifyingContract: ssiConfig.verifierContract,
    signerAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
    smartAccountAddress: ctx.userRow.smartAccountAddress as `0x${string}`,
    walletAddress: null,
  }
}

function hashAction(action: WalletAction, ctx: SignerContext): `0x${string}` {
  return hashTypedData({
    domain: walletActionDomain(ctx.chainId, ctx.verifyingContract),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })
}

/**
 * Step 1 — figure out whether we need to provision a holder wallet first.
 * Returns either an existing holderWalletId OR an unsigned ProvisionHolder
 * Wallet action for the client to sign.
 */
export async function prepareAnonOrgRegistration(): Promise<{
  success: boolean
  error?: string
  signer?: SignerContext
  alreadyProvisioned?: { holderWalletId: string }
  needsProvision?: {
    action: WalletAction & { expiresAt: string }
    hash: `0x${string}`
  }
}> {
  try {
    const signer = await getSignerContext()
    const ctx = await loadSignerForCurrentUser()
    const principal = ctx.principal

    // Check whether ssi-wallet-mcp already has a holder wallet for this
    // (principal, walletContext) — if so, skip the provision step.
    try {
      const res = await fetch(
        `${ssiConfig.walletUrl}/wallet/${encodeURIComponent(principal)}/${encodeURIComponent(WALLET_CONTEXT)}`,
        { cache: 'no-store' },
      )
      if (res.ok) {
        const j = (await res.json()) as { holderWalletId?: string }
        if (j.holderWalletId) {
          return { success: true, signer, alreadyProvisioned: { holderWalletId: j.holderWalletId } }
        }
      }
    } catch { /* fall through */ }

    // Build the unsigned ProvisionHolderWallet action.
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
    const hash = hashAction(action, signer)
    return {
      success: true,
      signer,
      needsProvision: { action: built.action, hash },
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Step 2 — submit the signed ProvisionHolderWallet action. The signature
 * was produced client-side via passkey assertion or wallet eth_signTypedData_v4.
 */
export async function submitProvisionWallet(input: {
  action: WalletAction & { expiresAt: string }
  signature: `0x${string}`
}): Promise<{ success: boolean; holderWalletId?: string; error?: string }> {
  try {
    const signer = await getSignerContext()
    // The downstream tool re-verifies the signature against the smart
    // account via ERC-1271, so we don't need to do it here. We just pass
    // through the signature + expectedSigner.
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
    return { success: true, holderWalletId: res.holderWalletId }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Step 3 — fetch the offer from org-mcp and build the AcceptCredentialOffer
 * action. Returns the unsigned action + its hash for the client to sign.
 */
export async function prepareAcceptCredentialOffer(input: {
  holderWalletId: string
}): Promise<{
  success: boolean
  error?: string
  signer?: SignerContext
  offer?: { credentialOfferJson: string; credDefId: string; schemaId: string; issuerId: string }
  toSign?: {
    action: WalletAction & { expiresAt: string }
    hash: `0x${string}`
  }
}> {
  try {
    const signer = await getSignerContext()
    const ctx = await loadSignerForCurrentUser()
    const principal = ctx.principal

    const offer = await org.offer('OrgMembershipCredential')

    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
      'ssi_create_wallet_action',
      {
        principal,
        walletContext: WALLET_CONTEXT,
        type: 'AcceptCredentialOffer',
        counterpartyId: offer.issuerId,
        purpose: 'accept OrgMembershipCredential',
        credentialType: 'OrgMembershipCredential',
        holderWalletId: input.holderWalletId,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const hash = hashAction(action, signer)

    return {
      success: true,
      signer,
      offer,
      toSign: { action: built.action, hash },
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Step 4 — run the rest of the credential exchange (request → issue →
 * store) using the signed AcceptCredentialOffer. The signature is the
 * holder's authorization for the entire issuance.
 */
export async function completeAnonOrgRegistration(input: {
  action: WalletAction & { expiresAt: string }
  signature: `0x${string}`
  holderWalletId: string
  offer: { credentialOfferJson: string; credDefId: string; schemaId: string; issuerId: string }
  attributes: Record<string, string>
}): Promise<{ success: boolean; credentialId?: string; error?: string }> {
  try {
    const ctx = await loadSignerForCurrentUser()
    const principal = ctx.principal

    // Holder builds the credentialRequest bound to its link secret.
    const req = await person.callTool<{ requestId: string; credentialRequestJson: string; error?: string }>(
      'ssi_start_credential_exchange',
      {
        action: input.action,
        signature: input.signature,
        credentialOfferJson: input.offer.credentialOfferJson,
        credDefId: input.offer.credDefId,
      },
    )
    if (req.error || !req.requestId) return { success: false, error: req.error ?? 'request build failed' }

    // Issuer issues against the request.
    const issuance = await org.issue({
      credentialOfferJson: input.offer.credentialOfferJson,
      credentialRequestJson: req.credentialRequestJson,
      attributes: input.attributes,
    })

    // Holder stores the credential, metadata records the receipt.
    const fin = await person.callTool<{ credentialId?: string; error?: string }>(
      'ssi_finish_credential_exchange',
      {
        principal,
        walletContext: WALLET_CONTEXT,
        holderWalletId: input.holderWalletId,
        requestId: req.requestId,
        credentialJson: issuance.credentialJson,
        credentialType: 'OrgMembershipCredential',
        issuerId: input.offer.issuerId,
        schemaId: input.offer.schemaId,
      },
    )
    if (fin.error || !fin.credentialId) return { success: false, error: fin.error ?? 'store failed' }
    return { success: true, credentialId: fin.credentialId }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
