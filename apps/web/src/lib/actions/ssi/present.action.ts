'use server'

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { person, family } from '@/lib/ssi/clients'

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

    const list = await person.callTool<{ credentials: Array<{
      id: string; holderWalletRef: string; credentialType: string; walletContext: string
    }> }>('ssi_list_my_credentials', { principal })
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

    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
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

    const presRes = await person.callTool<{
      presentation?: string
      auditSummary?: { revealedAttrs: string[]; pairwiseHandle: string }
      error?: string
    }>('ssi_create_presentation', {
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
