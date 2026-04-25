/**
 * SSI wallet tools — person-mcp as the consent gateway for ssi-wallet-mcp.
 *
 * Pattern (per architecture plan §2.5):
 *   1. UI asks person-mcp for an unsigned WalletAction (purpose + allowlist).
 *   2. UI asks Privy to sign it (EIP-712).
 *   3. UI hands the signed action back to person-mcp, which:
 *        a. re-verifies the signature locally (defense in depth),
 *        b. forwards to ssi-wallet-mcp,
 *        c. writes an audit row.
 *
 * These tools accept an explicit `principal` arg in Phase 3; Phase 4 will
 * gate them with the same delegation-token pattern as get_profile et al.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createPublicClient, http } from 'viem'
import {
  verifyPrivyAction,
  hashProofRequest,
  type WalletAction,
  type WalletActionType,
} from '@smart-agent/privacy-creds'
import { db } from '../db/index.js'
import { ssiHolderWallets, ssiCredentialMetadata, ssiProofAudit } from '../db/schema.js'

const SSI_WALLET_URL = process.env.SSI_WALLET_MCP_URL ?? 'http://127.0.0.1:3300'
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '31337')
const VERIFIER = (process.env.SSI_ACTION_VERIFIER_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`
const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

let _publicClient: ReturnType<typeof createPublicClient> | null = null
function getPublicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: { id: CHAIN_ID, name: 'sa', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } },
      transport: http(RPC_URL),
    })
  }
  return _publicClient
}

const ZERO_HASH = ('0x' + '0'.repeat(64)) as `0x${string}`

function mcpText<T>(v: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(v) }] }
}

async function forward(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SSI_WALLET_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`ssi-wallet-mcp ${path} ${res.status}: ${text}`)
  return JSON.parse(text)
}

// ─── 1. create_wallet_action ────────────────────────────────────────────────

interface CreateWalletActionArgs {
  principal: string
  walletContext?: string                  // default 'default'
  type: WalletActionType
  counterpartyId?: string
  purpose?: string
  credentialType?: string
  holderWalletId?: string                 // required except for ProvisionHolderWallet
  proofRequest?: Record<string, unknown>  // presentation request body (for CreatePresentation)
  proofRequestHash?: `0x${string}`        // caller may supply precomputed hash (OID4VP preview path)
  allowedReveal?: string[]
  allowedPredicates?: Array<{ attribute: string; operator: '>='|'<='|'>'|'<'; value: number }>
  forbiddenAttrs?: string[]
  lifetimeSec?: number                    // default 120
}

const createWalletAction = {
  name: 'ssi_create_wallet_action',
  description: 'Build an unsigned WalletAction envelope for the UI to hand to Privy for EIP-712 signing.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      principal: { type: 'string' },
      type: { type: 'string' },
      counterpartyId: { type: 'string' },
      purpose: { type: 'string' },
      credentialType: { type: 'string' },
      holderWalletId: { type: 'string' },
      proofRequest: { type: 'object' },
      allowedReveal: { type: 'array', items: { type: 'string' } },
      allowedPredicates: { type: 'array' },
      forbiddenAttrs: { type: 'array', items: { type: 'string' } },
      lifetimeSec: { type: 'number' },
    },
    required: ['principal', 'type'],
  },
  handler: async (args: CreateWalletActionArgs) => {
    const lifetime = args.lifetimeSec ?? 120
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + lifetime)

    const isProvision = args.type === 'ProvisionHolderWallet'
    if (!isProvision && !args.holderWalletId) {
      return mcpText({ error: 'holderWalletId required for non-provision actions' })
    }

    const proofRequestHash = args.proofRequestHash
      ?? (args.proofRequest ? hashProofRequest(args.proofRequest) : ZERO_HASH)
    const action: WalletAction = {
      type: args.type,
      actionId: `wa_${randomUUID()}`,
      personPrincipal: args.principal,
      walletContext: args.walletContext ?? 'default',
      holderWalletId: args.holderWalletId ?? 'pending',
      counterpartyId: args.counterpartyId ?? 'self',
      purpose: args.purpose ?? '',
      credentialType: args.credentialType ?? '',
      proofRequestHash,
      allowedReveal: JSON.stringify(args.allowedReveal ?? []),
      allowedPredicates: JSON.stringify(args.allowedPredicates ?? []),
      forbiddenAttrs: JSON.stringify(args.forbiddenAttrs ?? []),
      nonce: ('0x' + randomBytes(32).toString('hex')) as `0x${string}`,
      expiresAt,
    }

    return mcpText({
      action: { ...action, expiresAt: action.expiresAt.toString() },
      domain: {
        name: 'SmartAgent SSI Wallet Action',
        version: '1',
        chainId: CHAIN_ID,
        verifyingContract: VERIFIER,
      },
    })
  },
}

// ─── 2. ssi_provision_wallet ────────────────────────────────────────────────

interface ProvisionArgs {
  action: WalletAction & { expiresAt: string | number | bigint }
  signature: `0x${string}`
  expectedSigner: `0x${string}`
}
const provisionWallet = {
  name: 'ssi_provision_wallet',
  description: 'Forward a signed ProvisionHolderWallet action to ssi-wallet-mcp and record the mapping.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'object' },
      signature: { type: 'string' },
      expectedSigner: { type: 'string' },
    },
    required: ['action', 'signature', 'expectedSigner'],
  },
  handler: async (args: ProvisionArgs) => {
    const action: WalletAction = { ...args.action, expiresAt: BigInt(args.action.expiresAt) }
    // Defence in depth: re-verify here, not just downstream.
    const verify = await verifyPrivyAction({
      action, signature: args.signature,
      expectedSigner: args.expectedSigner,
      chainId: CHAIN_ID, verifyingContract: VERIFIER,
      client: getPublicClient(),
    })
    if (!verify.ok) return mcpText({ error: `signature invalid: ${verify.reason}` })

    const res = (await forward('/wallet/provision', args)) as {
      holderWalletId: string
      linkSecretId: string
      askarProfile: string
      idempotent: boolean
    }

    const existing = db.select().from(ssiHolderWallets)
      .where(
        and(
          eq(ssiHolderWallets.principal, action.personPrincipal),
          eq(ssiHolderWallets.walletContext, action.walletContext),
        ),
      ).get()
    if (!existing) {
      db.insert(ssiHolderWallets).values({
        id: `pm_${randomUUID()}`,
        principal: action.personPrincipal,
        walletContext: action.walletContext,
        privyEoa: args.expectedSigner.toLowerCase(),
        holderWalletRef: res.holderWalletId,
        linkSecretRef: res.linkSecretId,
        status: 'active',
        createdAt: new Date().toISOString(),
      }).run()
    }
    return mcpText(res)
  },
}

// ─── 3. ssi_start_credential_exchange ───────────────────────────────────────

interface StartExchangeArgs {
  action: WalletAction & { expiresAt: string | number | bigint }
  signature: `0x${string}`
  credentialOfferJson: string
  credDefId: string
}
const startCredentialExchange = {
  name: 'ssi_start_credential_exchange',
  description: 'Forward a signed AcceptCredentialOffer to ssi-wallet-mcp /credentials/request and return the credential request body for the issuer.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'object' },
      signature: { type: 'string' },
      credentialOfferJson: { type: 'string' },
      credDefId: { type: 'string' },
    },
    required: ['action', 'signature', 'credentialOfferJson', 'credDefId'],
  },
  handler: async (args: StartExchangeArgs) => {
    const res = await forward('/credentials/request', args)
    return mcpText(res)
  },
}

// ─── 4. ssi_finish_credential_exchange ──────────────────────────────────────

interface FinishExchangeArgs {
  principal: string
  walletContext: string
  holderWalletId: string
  requestId: string
  credentialJson: string
  credentialType: string
  issuerId: string
  schemaId: string
}
const finishCredentialExchange = {
  name: 'ssi_finish_credential_exchange',
  description: 'Complete a credential exchange by forwarding the issued credential to ssi-wallet-mcp /credentials/store and recording metadata.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      principal: { type: 'string' },
      holderWalletId: { type: 'string' },
      requestId: { type: 'string' },
      credentialJson: { type: 'string' },
      credentialType: { type: 'string' },
      issuerId: { type: 'string' },
      schemaId: { type: 'string' },
    },
    required: ['principal', 'holderWalletId', 'requestId', 'credentialJson', 'credentialType', 'issuerId', 'schemaId'],
  },
  handler: async (args: FinishExchangeArgs) => {
    const res = (await forward('/credentials/store', {
      holderWalletId: args.holderWalletId,
      requestId: args.requestId,
      credentialJson: args.credentialJson,
      credentialType: args.credentialType,
      issuerId: args.issuerId,
      schemaId: args.schemaId,
    })) as {
      credentialId: string
      metadata: { credDefId: string }
    }

    db.insert(ssiCredentialMetadata).values({
      id: res.credentialId,
      principal: args.principal,
      walletContext: args.walletContext,
      holderWalletRef: args.holderWalletId,
      issuerId: args.issuerId,
      schemaId: args.schemaId,
      credDefId: res.metadata.credDefId,
      credentialType: args.credentialType,
      receivedAt: new Date().toISOString(),
      status: 'active',
    }).run()

    return mcpText(res)
  },
}

// ─── 5. ssi_create_presentation ─────────────────────────────────────────────

interface CreatePresentationArgs {
  action: WalletAction & { expiresAt: string | number | bigint }
  signature: `0x${string}`
  expectedSigner: `0x${string}`
  presentationRequest: Record<string, unknown>
  credentialSelections: Array<{
    credentialId: string
    revealReferents: string[]
    predicateReferents: string[]
  }>
}
const createPresentation = {
  name: 'ssi_create_presentation',
  description: 'Forward a signed CreatePresentation action to ssi-wallet-mcp /proofs/present, then write an audit row.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'object' },
      signature: { type: 'string' },
      expectedSigner: { type: 'string' },
      presentationRequest: { type: 'object' },
      credentialSelections: { type: 'array' },
    },
    required: ['action', 'signature', 'expectedSigner', 'presentationRequest', 'credentialSelections'],
  },
  handler: async (args: CreatePresentationArgs) => {
    const action: WalletAction = { ...args.action, expiresAt: BigInt(args.action.expiresAt) }
    // Local re-verify
    const verify = await verifyPrivyAction({
      action, signature: args.signature,
      expectedSigner: args.expectedSigner,
      chainId: CHAIN_ID, verifyingContract: VERIFIER,
      client: getPublicClient(),
    })
    if (!verify.ok) {
      db.insert(ssiProofAudit).values({
        id: `audit_${randomUUID()}`,
        principal: action.personPrincipal,
        walletContext: action.walletContext,
        holderWalletRef: action.holderWalletId,
        verifierId: action.counterpartyId,
        purpose: action.purpose,
        revealedAttrs: '[]',
        predicates: '[]',
        actionNonce: action.nonce,
        pairwiseHandle: null,
        holderBindingIncluded: 0,
        result: 'denied',
        createdAt: new Date().toISOString(),
      }).run()
      return mcpText({ error: `signature invalid: ${verify.reason}` })
    }

    try {
      const res = (await forward('/proofs/present', {
        action: args.action,
        signature: args.signature,
        presentationRequest: args.presentationRequest,
        credentialSelections: args.credentialSelections,
      })) as {
        presentation: string
        auditSummary: {
          revealedAttrs: string[]
          predicates: Array<{ attribute: string; operator: string; value: number }>
          verifier: string
          purpose: string
          actionHash: string
          pairwiseHandle: `0x${string}`
          holderBindingIncluded: boolean
        }
      }

      db.insert(ssiProofAudit).values({
        id: `audit_${randomUUID()}`,
        principal: action.personPrincipal,
        walletContext: action.walletContext,
        holderWalletRef: action.holderWalletId,
        verifierId: res.auditSummary.verifier,
        purpose: res.auditSummary.purpose,
        revealedAttrs: JSON.stringify(res.auditSummary.revealedAttrs),
        predicates: JSON.stringify(res.auditSummary.predicates),
        actionNonce: action.nonce,
        pairwiseHandle: res.auditSummary.pairwiseHandle,
        holderBindingIncluded: res.auditSummary.holderBindingIncluded ? 1 : 0,
        result: 'ok',
        createdAt: new Date().toISOString(),
      }).run()

      return mcpText(res)
    } catch (err) {
      db.insert(ssiProofAudit).values({
        id: `audit_${randomUUID()}`,
        principal: action.personPrincipal,
        walletContext: action.walletContext,
        holderWalletRef: action.holderWalletId,
        verifierId: action.counterpartyId,
        purpose: action.purpose,
        revealedAttrs: '[]',
        predicates: '[]',
        actionNonce: action.nonce,
        pairwiseHandle: null,
        holderBindingIncluded: 0,
        result: 'error',
        createdAt: new Date().toISOString(),
      }).run()
      throw err
    }
  },
}

// ─── 6. ssi_list_my_credentials ─────────────────────────────────────────────

const listMyCredentials = {
  name: 'ssi_list_my_credentials',
  description: 'List credential metadata (no blobs, no attribute values) for a principal. Optionally filter by walletContext.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      principal: { type: 'string' },
      walletContext: { type: 'string' },
    },
    required: ['principal'],
  },
  handler: async (args: { principal: string; walletContext?: string }) => {
    const rows = args.walletContext
      ? db.select().from(ssiCredentialMetadata)
          .where(and(
            eq(ssiCredentialMetadata.principal, args.principal),
            eq(ssiCredentialMetadata.walletContext, args.walletContext),
          )).all()
      : db.select().from(ssiCredentialMetadata)
          .where(eq(ssiCredentialMetadata.principal, args.principal))
          .all()
    return mcpText({ credentials: rows })
  },
}

// ─── 6b. ssi_list_wallets ───────────────────────────────────────────────────

const listWallets = {
  name: 'ssi_list_wallets',
  description: 'List all holder-wallet contexts for a principal.',
  inputSchema: {
    type: 'object' as const,
    properties: { principal: { type: 'string' } },
    required: ['principal'],
  },
  handler: async (args: { principal: string }) => {
    const rows = db.select().from(ssiHolderWallets)
      .where(eq(ssiHolderWallets.principal, args.principal))
      .all()
    return mcpText({ wallets: rows })
  },
}

// ─── 6c. ssi_rotate_link_secret ─────────────────────────────────────────────

interface RotateLinkSecretArgs {
  action: WalletAction & { expiresAt: string | number | bigint }
  signature: `0x${string}`
}
const rotateLinkSecret = {
  name: 'ssi_rotate_link_secret',
  description: 'Forward a signed RotateLinkSecret action to ssi-wallet-mcp. New link secret replaces the old; existing credentials marked stale.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'object' },
      signature: { type: 'string' },
    },
    required: ['action', 'signature'],
  },
  handler: async (args: RotateLinkSecretArgs) => {
    const res = await forward('/wallet/rotate-link-secret', args)
    return mcpText(res)
  },
}

// ─── 7. ssi_list_proof_audit ────────────────────────────────────────────────

const listProofAudit = {
  name: 'ssi_list_proof_audit',
  description: 'List proof audit rows for a principal (recent first).',
  inputSchema: {
    type: 'object' as const,
    properties: { principal: { type: 'string' }, limit: { type: 'number' } },
    required: ['principal'],
  },
  handler: async (args: { principal: string; limit?: number }) => {
    const rows = db.select().from(ssiProofAudit)
      .where(eq(ssiProofAudit.principal, args.principal))
      .all()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, args.limit ?? 50)
    return mcpText({ audit: rows })
  },
}

export const ssiWalletTools = {
  ssi_create_wallet_action:        createWalletAction,
  ssi_provision_wallet:            provisionWallet,
  ssi_start_credential_exchange:   startCredentialExchange,
  ssi_finish_credential_exchange:  finishCredentialExchange,
  ssi_create_presentation:         createPresentation,
  ssi_list_my_credentials:         listMyCredentials,
  ssi_list_wallets:                listWallets,
  ssi_list_proof_audit:            listProofAudit,
  ssi_rotate_link_secret:          rotateLinkSecret,
}
