'use server'

/**
 * Routing rule (phase 3 of A2A-first consolidation):
 *   - Person-mcp tool calls (`ssi_list_my_credentials`,
 *     `ssi_create_wallet_action`, `ssi_create_presentation`) go through
 *     `callMcp('person', …)`. The signed-in user IS the holder making
 *     the presentation; no `agentAddress` opt needed.
 *   - family-mcp verifier endpoints (`guardianRequest` / `guardianCheck`)
 *     are issuer/verifier PROTOCOL surfaces, not /tools/, and stay
 *     direct HTTP via the `family` client.
 *   - `dispatchWalletAction` continues to flow through the session-grant
 *     code path in `wallet-action/dispatch.ts` (see TODO there for the
 *     phase-4 wrapping of `/wallet-action/dispatch` as an MCP tool).
 */

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { family } from '@/lib/ssi/clients'
import { callMcp } from '@/lib/clients/mcp-client'
import { dispatchWalletAction, DispatchError } from '@/lib/wallet-action/dispatch'

export interface PresentToCoachResult {
  success: boolean
  verified?: boolean
  reason?: string
  revealedAttrs?: string[]
  pairwiseHandle?: string
  error?: string
}

/**
 * "A coach is asking you to prove you are the guardian of a minor."
 *
 * Fetches the verifier-signed request from family-mcp, builds + signs a
 * CreatePresentation action, submits proof + verifier envelope to
 * /verify/guardian/check, returns the verdict.
 */
export async function presentGuardianToCoachAction(args: {
  credentialId: string
}): Promise<PresentToCoachResult> {
  try {
    const { principal } = await loadSignerForCurrentUser()

    const list = await callMcp<{ credentials: Array<{
      id: string; holderWalletRef: string; credentialType: string; walletContext: string
    }> }>('person', 'ssi_list_my_credentials', { principal })
    const row = list.credentials.find(c => c.id === args.credentialId)
    if (!row) return { success: false, error: 'unknown credential' }
    if (row.credentialType !== 'GuardianOfMinorCredential') {
      return { success: false, error: 'not a guardian credential' }
    }
    const holderWalletId = row.holderWalletRef
    const walletContext = row.walletContext

    // Verifier supplies signed request.
    const req = await family.guardianRequest()
    const presentationRequest = req.presentationRequest

    const built = await callMcp<{ action: WalletAction & { expiresAt: string } }>(
      'person',
      'ssi_create_wallet_action',
      {
        principal,
        walletContext,
        type: 'CreatePresentation',
        counterpartyId: req.verifierId,
        purpose: 'prove_guardianship',
        credentialType: 'GuardianOfMinorCredential',
        holderWalletId,
        proofRequest: presentationRequest,
        allowedReveal: [],
        allowedPredicates: [{ attribute: 'minorBirthYear', operator: '>=', value: 2006 }],
        forbiddenAttrs: ['relationship', 'issuedYear'],
      },
    )

    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const { signer, signature } = await signWalletAction(action)

    const presRes = await callMcp<{
      presentation?: string
      auditSummary?: { revealedAttrs: string[]; pairwiseHandle: string }
      error?: string
    }>('person', 'ssi_create_presentation', {
      action: built.action,
      signature,
      expectedSigner: signer,
      presentationRequest,
      verifierId:        req.verifierId,
      verifierAddress:   req.verifierAddress,
      verifierSignature: req.signature,
      credentialSelections: [
        {
          credentialId: args.credentialId,
          revealReferents: ['attr_holder'],
          predicateReferents: ['pred_guardian'],
        },
      ],
    })
    if (presRes.error || !presRes.presentation) {
      return { success: false, error: presRes.error ?? 'no presentation' }
    }

    const check = await family.guardianCheck({
      presentation: presRes.presentation,
      presentationRequest,
    })

    revalidatePath('/wallet')
    revalidatePath('/verify/coach')
    return {
      success: true,
      verified: check.verified,
      reason: check.reason,
      revealedAttrs: presRes.auditSummary?.revealedAttrs,
      pairwiseHandle: presRes.auditSummary?.pairwiseHandle,
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Same flow, dispatched through the session-grant ceremony — no passkey or
 * EOA signing inline. The CreatePresentation action is signed by the
 * session-EOA derived from the cookie. The verifier-mcp's signed request
 * is forwarded to person-mcp via the dispatch payload (where the verifier
 * allowlist + audience rules apply per design doc §5).
 *
 * Returns errorCode='no_session' if the user has no grant cookie — caller
 * should fall back to the legacy presentGuardianToCoachAction.
 */
export async function presentGuardianToCoachViaSession(args: {
  credentialId: string
}): Promise<PresentToCoachResult & { errorCode?: string }> {
  try {
    const { principal } = await loadSignerForCurrentUser()

    const list = await callMcp<{ credentials: Array<{
      id: string; holderWalletRef: string; credentialType: string; walletContext: string
    }> }>('person', 'ssi_list_my_credentials', { principal })
    const row = list.credentials.find(c => c.id === args.credentialId)
    if (!row) return { success: false, error: 'unknown credential' }
    if (row.credentialType !== 'GuardianOfMinorCredential') {
      return { success: false, error: 'not a guardian credential' }
    }
    const holderWalletId = row.holderWalletRef

    const req = await family.guardianRequest()
    const presentationRequest = req.presentationRequest

    const dispatched = await dispatchWalletAction<{
      ok: boolean
      presentation: string
      auditSummary: { revealedAttrs: string[]; pairwiseHandle: string }
    }>({
      actionType: 'CreatePresentation',
      service: 'person-mcp',
      verifierDid: req.verifierId,
      payload: {
        holderWalletId,
        presentationRequest,
        credentialSelections: [{
          credentialId: args.credentialId,
          revealReferents: ['attr_holder'],
          predicateReferents: ['pred_guardian'],
        }],
        allowedReveal: [],
        allowedPredicates: [{ attribute: 'minorBirthYear', operator: '>=', value: 2006 }],
        forbiddenAttrs: ['relationship', 'issuedYear'],
        counterpartyId: req.verifierId,
        purpose: 'prove_guardianship',
      },
    })

    const check = await family.guardianCheck({
      presentation: dispatched.presentation,
      presentationRequest,
    })

    revalidatePath('/wallet')
    revalidatePath('/verify/coach')
    return {
      success: true,
      verified: check.verified,
      reason: check.reason,
      revealedAttrs: dispatched.auditSummary.revealedAttrs,
      pairwiseHandle: dispatched.auditSummary.pairwiseHandle,
    }
  } catch (err) {
    if (err instanceof DispatchError) {
      return { success: false, error: err.detail, errorCode: err.code }
    }
    return { success: false, error: (err as Error).message }
  }
}
