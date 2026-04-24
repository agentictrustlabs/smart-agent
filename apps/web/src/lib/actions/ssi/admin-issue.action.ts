'use server'

import { revalidatePath } from 'next/cache'
import { acceptCredentialAction } from './accept.action'

/**
 * Admin-side shortcut: issue a credential with arbitrary attrs to the
 * current user via the normal accept flow. In a real deployment the admin
 * view would issue to *another* user via an OID4VCI pre-auth offer URI;
 * this shortcut targets the logged-in user for demo simplicity.
 */
export async function adminIssueMembershipAction(attrs: {
  membershipStatus: string
  role: string
  joinedYear: string
  circleId: string
}) {
  const r = await acceptCredentialAction({
    issuer: 'org', credentialType: 'OrgMembershipCredential', attributes: attrs,
  })
  revalidatePath('/wallet')
  return r
}

export async function adminIssueGuardianAction(attrs: {
  relationship: string
  minorBirthYear: string
  issuedYear: string
}) {
  const r = await acceptCredentialAction({
    issuer: 'family', credentialType: 'GuardianOfMinorCredential', attributes: attrs,
  })
  revalidatePath('/wallet')
  return r
}

/**
 * Admin creates an OID4VCI pre-auth offer. The UI can hand the offer URI
 * to another user who pastes it into /wallet/oid4vci.
 */
export async function adminCreateOid4vciOfferAction(attrs: {
  membershipStatus: string
  role: string
  joinedYear: string
  circleId: string
}) {
  const { org } = await import('@/lib/ssi/clients')
  try {
    const r = await org.oid4vciOffer(attrs)
    return {
      success: true,
      preAuthCode: r.pre_authorized_code,
      offerUri: r.credential_offer_uri,
      credDefId: r.credential_definition_id,
      schemaId: r.schema_id,
      issuerId: r.issuer_id,
      anoncredsOfferJson: r.anoncreds_credential_offer,
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
