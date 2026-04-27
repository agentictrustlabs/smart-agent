'use server'

/**
 * Generic AnonCreds issuance flow — replaces per-credential-type actions
 * (`anon-org.action.ts`, `geo-attestation.action.ts`). Adding a new
 * credential type means adding an entry to `CREDENTIAL_KINDS` and a form
 * component in `apps/web/src/lib/credentials/forms/`; this action stays
 * unchanged.
 *
 * Two server entry points (paired with the wallet-provision pair):
 *   prepareCredentialIssuance   — fetches offer from the issuer's
 *                                 /credential/offer, builds the
 *                                 AcceptCredentialOffer wallet action.
 *   completeCredentialIssuance  — runs request → issue → store with
 *                                 the signed action.
 *
 * Issuer dispatch goes through `issuerClientByKey()`, which maps
 * `descriptor.issuerKey` → the appropriate `clients.ts` HTTP client.
 */

import type { WalletAction } from '@smart-agent/privacy-creds'
import {
  CREDENTIAL_KINDS,
  findCredentialKind,
  type IssuerKey,
} from '@smart-agent/sdk'
import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import { person, org, family, geo } from '@/lib/ssi/clients'
import { getSignerContext } from './wallet-provision.action'
import { hashWalletAction, type SignerContext } from '@/lib/credentials/wallet-helpers'

interface OfferResponse {
  credentialOfferJson: string
  credDefId: string
  schemaId: string
  issuerId: string
}

interface IssuerClient {
  offer: (credentialType: string) => Promise<OfferResponse>
  issue: (args: { credentialOfferJson: string; credentialRequestJson: string; attributes: Record<string, string> }) => Promise<{ credentialJson: string }>
}

function issuerClientByKey(key: IssuerKey): IssuerClient {
  switch (key) {
    case 'org':    return org as IssuerClient
    case 'family': return family as IssuerClient
    case 'geo':    return geo as IssuerClient
  }
}

/**
 * Step 1 — fetch credential offer + build AcceptCredentialOffer action.
 *
 * `attributes` must already conform to the descriptor's `attributeNames`
 * (the form component is responsible for that). `extraIssueArgs` is a
 * passthrough for credential-kind-specific issue parameters (e.g.
 * `targetOrgAddress` for org-mcp); it's echoed back to the caller and
 * forwarded to step 2.
 */
export async function prepareCredentialIssuance(input: {
  credentialType: string
  holderWalletId: string
  walletContext: string
  attributes: Record<string, string>
  extraIssueArgs?: { targetOrgAddress?: string }
}): Promise<{
  success: boolean
  error?: string
  signer?: SignerContext
  offer?: OfferResponse
  toSign?: { action: WalletAction & { expiresAt: string }; hash: `0x${string}` }
  attributes?: Record<string, string>
  extraIssueArgs?: { targetOrgAddress?: string }
}> {
  try {
    const descriptor = findCredentialKind(input.credentialType)
    if (!descriptor) return { success: false, error: `unknown credential type: ${input.credentialType}` }

    // Validate every required attribute slot is present and stringified.
    for (const name of descriptor.attributeNames) {
      const v = input.attributes[name]
      if (typeof v !== 'string') {
        return { success: false, error: `attribute "${name}" missing or not stringified` }
      }
    }

    const signer = await getSignerContext()
    const ctx = await loadSignerForCurrentUser()
    const principal = ctx.principal

    const client = issuerClientByKey(descriptor.issuerKey)
    const offer = await client.offer(descriptor.credentialType)

    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
      'ssi_create_wallet_action',
      {
        principal,
        walletContext: input.walletContext,
        type: 'AcceptCredentialOffer',
        counterpartyId: offer.issuerId,
        purpose: `accept ${descriptor.credentialType}`,
        credentialType: descriptor.credentialType,
        holderWalletId: input.holderWalletId,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const hash = hashWalletAction(action, signer)

    return {
      success: true,
      signer,
      offer,
      toSign: { action: built.action, hash },
      attributes: input.attributes,
      extraIssueArgs: input.extraIssueArgs,
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Step 2 — run holder request → issuer issue → holder store using the
 * signed AcceptCredentialOffer.
 */
export async function completeCredentialIssuance(input: {
  credentialType: string
  action: WalletAction & { expiresAt: string }
  signature: `0x${string}`
  holderWalletId: string
  walletContext: string
  offer: OfferResponse
  attributes: Record<string, string>
  extraIssueArgs?: { targetOrgAddress?: string }
}): Promise<{ success: boolean; credentialId?: string; error?: string }> {
  try {
    const descriptor = findCredentialKind(input.credentialType)
    if (!descriptor) return { success: false, error: `unknown credential type: ${input.credentialType}` }

    const ctx = await loadSignerForCurrentUser()
    const principal = ctx.principal

    const client = issuerClientByKey(descriptor.issuerKey)

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

    const issuance = await client.issue({
      credentialOfferJson: input.offer.credentialOfferJson,
      credentialRequestJson: req.credentialRequestJson,
      attributes: input.attributes,
    })

    const fin = await person.callTool<{ credentialId?: string; error?: string }>(
      'ssi_finish_credential_exchange',
      {
        principal,
        walletContext: input.walletContext,
        holderWalletId: input.holderWalletId,
        requestId: req.requestId,
        credentialJson: issuance.credentialJson,
        credentialType: descriptor.credentialType,
        issuerId: input.offer.issuerId,
        schemaId: input.offer.schemaId,
        ...(input.extraIssueArgs?.targetOrgAddress
          ? { targetOrgAddress: input.extraIssueArgs.targetOrgAddress }
          : {}),
      },
    )
    if (fin.error || !fin.credentialId) return { success: false, error: fin.error ?? 'store failed' }
    return { success: true, credentialId: fin.credentialId }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Convenience helper for UI surfaces that want to show one button per
 * supported credential kind. Filters `CREDENTIAL_KINDS` by hub-context
 * availability so org membership only appears when an active hub is in
 * scope.
 */
export async function listIssuableCredentialKinds(args: { hasActiveHub: boolean }): Promise<{
  credentialType: string
  displayName: string
  noun: string
  description: string
}[]> {
  return CREDENTIAL_KINDS
    .filter(k => !k.requiresActiveHub || args.hasActiveHub)
    .map(k => ({
      credentialType: k.credentialType,
      displayName:    k.displayName,
      noun:           k.noun,
      description:    k.description,
    }))
}
