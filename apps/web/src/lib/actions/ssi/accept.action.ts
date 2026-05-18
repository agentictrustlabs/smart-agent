'use server'

/**
 * Routing rule (phase 3 of A2A-first consolidation):
 *   - Person-mcp tool calls go through `callMcp('person', …)` (the
 *     signed-in user IS the holder here, so no `agentAddress` opt).
 *   - Issuer-side calls (`org.offer`, `org.issue`, `family.offer`,
 *     `family.issue`) hit the issuer's protocol endpoints directly via
 *     the `clients.ts` SDK — these are not /tools/ MCP calls and not
 *     user-authenticated.
 *   - Idempotent (principal, context) lookup now routes via the
 *     `ssi_get_holder_wallet` MCP tool (Sprint 5 W3 P1-2 — no direct
 *     GET on /wallet/<principal>/<context>).
 */

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { org, family } from '@/lib/ssi/clients'
import { callMcp } from '@/lib/clients/mcp-client'

type IssuerKey = 'org' | 'family'
type CredentialType = 'OrgMembershipCredential' | 'GuardianOfMinorCredential'

const issuerClients = { org, family } as const

export async function acceptCredentialAction(args: {
  issuer: IssuerKey
  credentialType: CredentialType
  attributes: Record<string, string>
  walletContext?: string       // defaults to 'default'
}): Promise<{ success: boolean; credentialId?: string; walletContext?: string; error?: string }> {
  try {
    const walletContext = args.walletContext ?? 'default'
    const { principal } = await loadSignerForCurrentUser()

    // ── 0. Ensure a holder wallet exists for this (principal, context) ─────
    // Sprint 5 W3 P1-2: routed via callMcp('ssi_get_holder_wallet') so the
    // a2a→person hop carries the wire-auth envelope. Direct GET on
    // /wallet/<principal>/<context> is no longer accepted by person-mcp.
    let holderWalletId: string | undefined
    try {
      const r = await callMcp<{ found: boolean; holderWalletId?: string }>(
        'person',
        'ssi_get_holder_wallet',
        { principal, walletContext },
      )
      if (r.found && r.holderWalletId) holderWalletId = r.holderWalletId
    } catch { /* fall through to provision */ }
    if (!holderWalletId) {
      const { provisionHolderWalletAction } = await import('./provision.action')
      const p = await provisionHolderWalletAction(walletContext)
      if (!p.success || !p.holderWalletId) return { success: false, error: p.error ?? 'provision failed' }
      holderWalletId = p.holderWalletId
    }

    // ── 1. Fetch the offer from the issuer ───────────────────────────────
    const client = issuerClients[args.issuer]
    const offer = await client.offer(args.credentialType)

    // ── 2. Build + sign AcceptCredentialOffer action ────────────────────
    const built = await callMcp<{ action: WalletAction & { expiresAt: string } }>(
      'person',
      'ssi_create_wallet_action',
      {
        principal,
        walletContext,
        type: 'AcceptCredentialOffer',
        counterpartyId: offer.issuerId,
        purpose: `accept ${args.credentialType}`,
        credentialType: args.credentialType,
        holderWalletId,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const { signature } = await signWalletAction(action)

    const req = await callMcp<{ requestId: string; credentialRequestJson: string }>(
      'person',
      'ssi_start_credential_exchange',
      { action: built.action, signature, credentialOfferJson: offer.credentialOfferJson, credDefId: offer.credDefId },
    )

    const issuance = await client.issue({
      credentialOfferJson: offer.credentialOfferJson,
      credentialRequestJson: req.credentialRequestJson,
      attributes: args.attributes,
    })

    const fin = await callMcp<{ credentialId: string }>(
      'person',
      'ssi_finish_credential_exchange',
      {
        principal,
        walletContext,
        holderWalletId,
        requestId: req.requestId,
        credentialJson: issuance.credentialJson,
        credentialType: args.credentialType,
        issuerId: offer.issuerId,
        schemaId: offer.schemaId,
      },
    )

    revalidatePath('/wallet')
    return { success: true, credentialId: fin.credentialId, walletContext }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
