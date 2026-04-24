'use server'

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { person, org, family } from '@/lib/ssi/clients'

type IssuerKey = 'org' | 'family'
type CredentialType = 'OrgMembershipCredential' | 'GuardianOfMinorCredential'

const issuerClients = { org, family } as const

export async function acceptCredentialAction(args: {
  issuer: IssuerKey
  credentialType: CredentialType
  attributes: Record<string, string>
}): Promise<{ success: boolean; credentialId?: string; error?: string }> {
  try {
    const { principal } = await loadSignerForCurrentUser()

    // ── 0. Ensure a holder wallet exists ─────────────────────────────────
    const info = await person.callTool<{ credentials: Array<{ holderWalletRef: string }> }>(
      'ssi_list_my_credentials', { principal },
    ).catch(() => ({ credentials: [] }))
    let holderWalletId = info.credentials[0]?.holderWalletRef
    if (!holderWalletId) {
      const { provisionHolderWalletAction } = await import('./provision.action')
      const p = await provisionHolderWalletAction()
      if (!p.success || !p.holderWalletId) return { success: false, error: p.error ?? 'provision failed' }
      holderWalletId = p.holderWalletId
    }

    // ── 1. Fetch the offer from the issuer ───────────────────────────────
    const client = issuerClients[args.issuer]
    const offer = await client.offer(args.credentialType)

    // ── 2. Build + sign AcceptCredentialOffer action ────────────────────
    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
      'ssi_create_wallet_action',
      {
        principal,
        type: 'AcceptCredentialOffer',
        counterpartyId: offer.issuerId,
        purpose: `accept ${args.credentialType}`,
        credentialType: args.credentialType,
        holderWalletId,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const { signature } = await signWalletAction(action)

    // ── 3. Wallet builds credential request ─────────────────────────────
    const req = await person.callTool<{ requestId: string; credentialRequestJson: string }>(
      'ssi_start_credential_exchange',
      { action: built.action, signature, credentialOfferJson: offer.credentialOfferJson, credDefId: offer.credDefId },
    )

    // ── 4. Issuer signs and issues the credential ───────────────────────
    const issuance = await client.issue({
      credentialOfferJson: offer.credentialOfferJson,
      credentialRequestJson: req.credentialRequestJson,
      attributes: args.attributes,
    })

    // ── 5. Wallet stores the credential ─────────────────────────────────
    const fin = await person.callTool<{ credentialId: string }>(
      'ssi_finish_credential_exchange',
      {
        principal,
        holderWalletId,
        requestId: req.requestId,
        credentialJson: issuance.credentialJson,
        credentialType: args.credentialType,
        issuerId: offer.issuerId,
        schemaId: offer.schemaId,
      },
    )

    revalidatePath('/wallet')
    return { success: true, credentialId: fin.credentialId }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
