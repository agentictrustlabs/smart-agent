'use server'

/**
 * Round-trip a held AnonCreds credential through the third-party
 * verifier-mcp. Used by the "Test verification" button on
 * HeldCredentialsPanel — proves end-to-end that the holder can prove
 * possession of the credential to a counterparty that knows nothing
 * about them beyond the issuer's public credDef and the verifier's own
 * known-issuer list.
 *
 * Two-step prepare/submit because the AcceptCredentialOffer-style wallet
 * action must be signed client-side via passkey or MetaMask. EOA-only
 * users can short-circuit through `signWalletAction`, but we don't model
 * that here — passkey is the expected path.
 *
 *   prepareVerifyHeldCredential   — resolves credential + holder wallet,
 *                                   fetches verifier presentation_request,
 *                                   builds CreatePresentation action.
 *   completeVerifyHeldCredential  — submits signed action to
 *                                   ssi_create_presentation, then sends
 *                                   the resulting proof to verifier-mcp's
 *                                   /verify/<type>/check.
 */

import type { WalletAction } from '@smart-agent/privacy-creds'
import { walletActionDomain, WalletActionTypes } from '@smart-agent/privacy-creds'
import { hashTypedData } from 'viem'
import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import { person, verifier } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'
import { requireSession } from '@/lib/auth/session'
import { dispatchWalletAction, DispatchError } from '@/lib/wallet-action/dispatch'

type SignerKind = 'eoa' | 'passkey' | 'siwe'

interface SignerContext {
  kind: SignerKind
  chainId: number
  verifyingContract: `0x${string}`
  signerAddress: `0x${string}`
  smartAccountAddress: `0x${string}` | null
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

function hashAction(action: WalletAction, ctx: SignerContext): `0x${string}` {
  return hashTypedData({
    domain: walletActionDomain(ctx.chainId, ctx.verifyingContract),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })
}

interface PrepareResult {
  success: boolean
  error?: string
  signer?: SignerContext
  credentialType?: string
  holderWalletId?: string
  walletContext?: string
  presentationRequest?: Record<string, unknown> & { name: string; nonce: string }
  selection?: { revealReferents: string[]; predicateReferents: string[] }
  verifierIdentity?: { verifierId: string; verifierAddress: `0x${string}`; signature: `0x${string}`; label: string }
  toSign?: { action: WalletAction & { expiresAt: string }; hash: `0x${string}` }
}

export async function prepareVerifyHeldCredential(input: {
  credentialId: string
}): Promise<PrepareResult> {
  try {
    const signer = await getSignerContext()
    const ctx = await loadSignerForCurrentUser()
    const principal = ctx.principal

    // Locate the credential row so we know which holder wallet + cred type
    // we're presenting from.
    const list = await person.callTool<{ credentials: Array<{
      id: string; holderWalletRef: string; credentialType: string; walletContext: string
    }> }>('ssi_list_my_credentials', { principal })
    const row = list.credentials.find(c => c.id === input.credentialId)
    if (!row) return { success: false, error: 'unknown credential' }

    // Verifier presentation request — verifier-mcp signs the request body
    // so the wallet can refuse to present to unknown verifiers.
    const req = await verifier.request(row.credentialType)

    // Build CreatePresentation wallet action with the verifier's selection
    // baked into allowedReveal/allowedPredicates. Anything outside is
    // refused by evaluateProofPolicy + DEFAULT_FORBIDDEN_ATTRS.
    const allowedReveal = req.selection.revealReferents
      .map(r => referentToAttrName(req.presentationRequest, r))
      .filter((x): x is string => Boolean(x))
    const allowedPredicates = req.selection.predicateReferents
      .map(r => predicateFromRequest(req.presentationRequest, r))
      .filter((x): x is { attribute: string; operator: '>=' | '<=' | '>' | '<'; value: number } => Boolean(x))

    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
      'ssi_create_wallet_action',
      {
        principal,
        walletContext: row.walletContext,
        type: 'CreatePresentation',
        counterpartyId: req.verifierId,
        purpose: `audit_${row.credentialType}`,
        credentialType: row.credentialType,
        holderWalletId: row.holderWalletRef,
        proofRequest: req.presentationRequest,
        allowedReveal,
        allowedPredicates,
        forbiddenAttrs: [],
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const hash = hashAction(action, signer)

    return {
      success: true,
      signer,
      credentialType: row.credentialType,
      holderWalletId: row.holderWalletRef,
      walletContext: row.walletContext,
      presentationRequest: req.presentationRequest,
      selection: req.selection,
      verifierIdentity: {
        verifierId: req.verifierId,
        verifierAddress: req.verifierAddress,
        signature: req.signature,
        label: req.label,
      },
      toSign: { action: built.action, hash },
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export interface ProofSummary {
  /** Top-level proof system label, e.g. "AnonCreds v1 (Hyperledger)". */
  format: string
  /** Specific signature/proof scheme. AnonCreds uses CL signatures + Schnorr-style ZK. */
  signatureScheme: string
  /** Cryptographic technique each predicate is proven with. */
  predicateTechnique: string
  /** Cryptographic technique used for selective disclosure of revealed attrs. */
  selectiveDisclosureTechnique: string
  /** How many credentials contributed to this presentation. */
  credentialCount: number
  /** Distinct identifiers (schema/credDef/rev_reg) referenced by the proof. */
  identifiers: Array<{ schemaId: string; credDefId: string; revRegId: string | null }>
  /** Names of attributes the holder revealed in plaintext. */
  revealedAttrs: string[]
  /** Names of attributes that stayed hidden (the proof commits to them but
   *  doesn't disclose). Read out of `requested_proof.unrevealed_attrs` and
   *  `requested_proof.predicates` since predicate-only attrs aren't revealed. */
  hiddenAttrs: string[]
  /** Range proofs (one per predicate) — `<attribute> <op> <value>`. */
  rangeProofs: Array<{ attribute: string; operator: string; value: number }>
  /** Whether revocation was checked (always false for our current AnonCreds setup). */
  revocationChecked: boolean
}

export interface CompleteVerifyResult {
  success: boolean
  verified?: boolean
  reason?: string
  revealedAttrs?: string[]
  revealedValues?: Record<string, string>
  pairwiseHandle?: string
  /** Cryptographic-detail summary of the proof the verifier accepted. */
  proofSummary?: ProofSummary
  error?: string
}

export async function completeVerifyHeldCredential(input: {
  action: WalletAction & { expiresAt: string }
  signature: `0x${string}`
  credentialId: string
  credentialType: string
  presentationRequest: Record<string, unknown> & { name: string; nonce: string }
  selection: { revealReferents: string[]; predicateReferents: string[] }
  verifierIdentity: { verifierId: string; verifierAddress: `0x${string}`; signature: `0x${string}` }
}): Promise<CompleteVerifyResult> {
  try {
    const signer = await getSignerContext()

    const presRes = await person.callTool<{
      presentation?: string
      auditSummary?: { revealedAttrs: string[]; pairwiseHandle: string }
      error?: string
    }>('ssi_create_presentation', {
      action: input.action,
      signature: input.signature,
      expectedSigner: signer.signerAddress,
      presentationRequest: input.presentationRequest,
      verifierId:        input.verifierIdentity.verifierId,
      verifierAddress:   input.verifierIdentity.verifierAddress,
      verifierSignature: input.verifierIdentity.signature,
      credentialSelections: [
        {
          credentialId: input.credentialId,
          revealReferents: input.selection.revealReferents,
          predicateReferents: input.selection.predicateReferents,
        },
      ],
    })
    if (presRes.error || !presRes.presentation) {
      return { success: false, error: presRes.error ?? 'no presentation' }
    }

    const check = await verifier.check(input.credentialType, {
      presentation: presRes.presentation,
      presentationRequest: input.presentationRequest,
    })

    const proofSummary = summarizeProof(presRes.presentation, input.presentationRequest)

    return {
      success: true,
      verified: check.verified,
      reason: check.reason,
      revealedAttrs: presRes.auditSummary?.revealedAttrs,
      revealedValues: check.revealedAttrs,
      pairwiseHandle: presRes.auditSummary?.pairwiseHandle,
      proofSummary,
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Session-grant path: verify a held credential WITHOUT a passkey prompt.
 *
 * Goes end-to-end in one server-side call:
 *   1. Look up the credential row + verifier presentation request.
 *   2. dispatchWalletAction('CreatePresentation', { holderWalletId,
 *      presentationRequest, credentialSelections, allowedReveal,
 *      allowedPredicates, ... }) — derived session-EOA signs.
 *   3. Forward the resulting AnonCreds proof to verifier-mcp /verify/<type>/check.
 *
 * Returns errorCode='no_session' if the user has no grant cookie — caller
 * should fall back to prepareVerifyHeldCredential / completeVerifyHeldCredential.
 */
export async function verifyHeldCredentialViaSession(input: {
  credentialId: string
}): Promise<CompleteVerifyResult & { errorCode?: string }> {
  try {
    const ctx = await loadSignerForCurrentUser()
    const principal = ctx.principal

    const list = await person.callTool<{ credentials: Array<{
      id: string; holderWalletRef: string; credentialType: string; walletContext: string
    }> }>('ssi_list_my_credentials', { principal })
    const row = list.credentials.find(c => c.id === input.credentialId)
    if (!row) return { success: false, error: 'unknown credential' }

    const req = await verifier.request(row.credentialType)

    const allowedReveal = req.selection.revealReferents
      .map(r => referentToAttrName(req.presentationRequest, r))
      .filter((x): x is string => Boolean(x))
    const allowedPredicates = req.selection.predicateReferents
      .map(r => predicateFromRequest(req.presentationRequest, r))
      .filter((x): x is { attribute: string; operator: '>=' | '<=' | '>' | '<'; value: number } => Boolean(x))

    const dispatched = await dispatchWalletAction<{
      ok: boolean
      presentation: string
      auditSummary: { revealedAttrs: string[]; pairwiseHandle: string }
    }>({
      actionType: 'CreatePresentation',
      service: 'person-mcp',
      verifierDid: req.verifierId,
      payload: {
        holderWalletId: row.holderWalletRef,
        presentationRequest: req.presentationRequest,
        credentialSelections: [{
          credentialId: input.credentialId,
          revealReferents: req.selection.revealReferents,
          predicateReferents: req.selection.predicateReferents,
        }],
        allowedReveal,
        allowedPredicates,
        forbiddenAttrs: [],
        counterpartyId: req.verifierId,
        purpose: `audit_${row.credentialType}`,
      },
    })

    const check = await verifier.check(row.credentialType, {
      presentation: dispatched.presentation,
      presentationRequest: req.presentationRequest,
    })

    const proofSummary = summarizeProof(dispatched.presentation, req.presentationRequest)

    return {
      success: true,
      verified: check.verified,
      reason: check.reason,
      revealedAttrs: dispatched.auditSummary?.revealedAttrs,
      revealedValues: check.revealedAttrs,
      pairwiseHandle: dispatched.auditSummary?.pairwiseHandle,
      proofSummary,
    }
  } catch (err) {
    if (err instanceof DispatchError) {
      return { success: false, error: err.detail, errorCode: err.code }
    }
    return { success: false, error: (err as Error).message }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Parse the AnonCreds presentation JSON and return a cryptographic-detail
 * summary the UI can render in the verified section. Tolerant of missing
 * fields — anything we can't parse falls back to a sane default.
 *
 * AnonCreds-v1 is Hyperledger's CL-signature-based privacy credential
 * format. The proof object is structured as:
 *
 *   proof.proofs[]:
 *     primary_proof.eq_proof  → Schnorr-style proof of knowledge of the
 *                                CL signature; carries `revealed_attrs`.
 *     primary_proof.ge_proofs → Boudot-style range proofs; one per predicate
 *                                (e.g. `confidence ≥ 50`). The attribute value
 *                                stays committed but never revealed.
 *     non_revoc_proof         → CKS revocation proof when `rev_reg_id` is set.
 *
 *   identifiers[] — schema/credDef/rev-reg ids the proof depends on.
 */
function summarizeProof(
  presentationJson: string,
  presentationRequest: Record<string, unknown> & { name: string; nonce: string },
): ProofSummary | undefined {
  try {
    const j = JSON.parse(presentationJson) as {
      proof?: {
        proofs?: Array<{
          primary_proof?: {
            eq_proof?: { revealed_attrs?: Record<string, unknown> }
            ge_proofs?: Array<{ predicate?: { attr_name?: string; p_type?: string; value?: number } }>
          }
          non_revoc_proof?: unknown
        }>
      }
      requested_proof?: {
        revealed_attrs?: Record<string, unknown>
        unrevealed_attrs?: Record<string, unknown>
        predicates?: Record<string, unknown>
        self_attested_attrs?: Record<string, unknown>
      }
      identifiers?: Array<{
        schema_id?: string
        cred_def_id?: string
        rev_reg_id?: string | null
      }>
    }

    const proofs = j.proof?.proofs ?? []
    const credentialCount = proofs.length

    const rangeProofs: ProofSummary['rangeProofs'] = []
    let revocationChecked = false
    for (const p of proofs) {
      if (p.non_revoc_proof) revocationChecked = true
      for (const ge of p.primary_proof?.ge_proofs ?? []) {
        const pred = ge.predicate
        if (pred?.attr_name && pred.p_type && typeof pred.value === 'number') {
          rangeProofs.push({
            attribute: pred.attr_name,
            operator: pred.p_type,
            value: pred.value,
          })
        }
      }
    }

    // Revealed = top-level requested_proof.revealed_attrs map names them.
    // Hidden  = unrevealed_attrs + predicates (predicate-only attrs are
    //           never disclosed, just proven to satisfy a relation).
    const revealedReferents = Object.keys(j.requested_proof?.revealed_attrs ?? {})
    const unrevealedReferents = Object.keys(j.requested_proof?.unrevealed_attrs ?? {})
    const predicateReferents  = Object.keys(j.requested_proof?.predicates ?? {})

    const reqAttrs = (presentationRequest as {
      requested_attributes?: Record<string, { name: string }>
      requested_predicates?: Record<string, { name: string }>
    })
    const referentToAttr = new Map<string, string>()
    for (const [referent, def] of Object.entries(reqAttrs.requested_attributes ?? {})) {
      if (def?.name) referentToAttr.set(referent, def.name)
    }
    for (const [referent, def] of Object.entries(reqAttrs.requested_predicates ?? {})) {
      if (def?.name) referentToAttr.set(referent, def.name)
    }

    const revealedAttrs = revealedReferents
      .map(r => referentToAttr.get(r) ?? r)
    const hiddenAttrs = [...unrevealedReferents, ...predicateReferents]
      .map(r => referentToAttr.get(r) ?? r)

    const identifiers = (j.identifiers ?? []).map(id => ({
      schemaId:  id.schema_id ?? '',
      credDefId: id.cred_def_id ?? '',
      revRegId:  id.rev_reg_id ?? null,
    }))

    return {
      format:          'AnonCreds v1 (Hyperledger)',
      signatureScheme: 'CL signatures (Camenisch-Lysyanskaya)',
      predicateTechnique:           'Boudot range proofs',
      selectiveDisclosureTechnique: 'Schnorr-style equality proofs',
      credentialCount,
      identifiers,
      revealedAttrs,
      hiddenAttrs,
      rangeProofs,
      revocationChecked,
    }
  } catch {
    return undefined
  }
}

function referentToAttrName(
  request: Record<string, unknown>,
  referent: string,
): string | null {
  const reqAttrs = (request as { requested_attributes?: Record<string, { name: string }> }).requested_attributes
  return reqAttrs?.[referent]?.name ?? null
}

function predicateFromRequest(
  request: Record<string, unknown>,
  referent: string,
): { attribute: string; operator: '>=' | '<=' | '>' | '<'; value: number } | null {
  const reqPreds = (request as {
    requested_predicates?: Record<string, { name: string; p_type: '>=' | '<=' | '>' | '<'; p_value: number }>
  }).requested_predicates
  const p = reqPreds?.[referent]
  if (!p) return null
  return { attribute: p.name, operator: p.p_type, value: p.p_value }
}
