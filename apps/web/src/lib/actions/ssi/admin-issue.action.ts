'use server'

import { revalidatePath } from 'next/cache'
import { acceptCredentialAction } from './accept.action'

export async function adminIssueMembershipAction(args: {
  walletContext: string
  attrs: {
    membershipStatus: string
    role: string
    joinedYear: string
    circleId: string
  }
}) {
  const r = await acceptCredentialAction({
    issuer: 'org',
    credentialType: 'OrgMembershipCredential',
    attributes: args.attrs,
    walletContext: args.walletContext,
  })
  revalidatePath('/wallet')
  return r
}

export async function adminIssueGuardianAction(args: {
  walletContext: string
  attrs: {
    relationship: string
    minorBirthYear: string
    issuedYear: string
  }
}) {
  const r = await acceptCredentialAction({
    issuer: 'family',
    credentialType: 'GuardianOfMinorCredential',
    attributes: args.attrs,
    walletContext: args.walletContext,
  })
  revalidatePath('/wallet')
  return r
}

/**
 * Create an OID4VCI pre-auth offer. Offer URI is portable — any wallet can
 * redeem it and choose the target context at redeem time. Admin doesn't need
 * to decide the holder's context here; the holder picks on /wallet/oid4vci.
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
