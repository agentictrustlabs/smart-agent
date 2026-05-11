/**
 * Spec 004 — issuer registrations for the two AnonCreds marketplace
 * credentials: ProposalSubmitterCredential (gates grant proposal
 * submit/edit/withdraw) and RoundVoterCredential (gates vote:cast).
 *
 * Both kinds reuse the existing catalyst IssuerAgent (one DID per
 * org-mcp). Schema + credDef ids are sourced from the SDK descriptor
 * table so the web app, verifier, and issuer stay in lockstep.
 */
import { CREDENTIAL_KINDS } from '@smart-agent/sdk'
import { catalystIssuer } from './membership.js'

interface IssuerSpec {
  credentialType: string
  schemaId: string
  credDefId: string
  name: string
  version: string
  attributeNames: string[]
}

function specFromKind(credentialType: string): IssuerSpec {
  const kind = CREDENTIAL_KINDS.find((k) => k.credentialType === credentialType)
  if (!kind) throw new Error(`marketplaceCreds: unknown credentialType ${credentialType}`)
  return {
    credentialType: kind.credentialType,
    schemaId: kind.schemaId,
    credDefId: kind.credDefId,
    name: kind.credentialType.replace(/Credential$/, ''),
    version: '1.0',
    attributeNames: [...kind.attributeNames],
  }
}

export const PROPOSAL_SUBMITTER_SPEC = specFromKind('ProposalSubmitterCredential')
export const ROUND_VOTER_SPEC = specFromKind('RoundVoterCredential')

let _registered = false

export async function ensureMarketplaceCredsRegistered(): Promise<void> {
  if (_registered) return
  await catalystIssuer.ensureSchemaAndCredDef(PROPOSAL_SUBMITTER_SPEC)
  await catalystIssuer.ensureSchemaAndCredDef(ROUND_VOTER_SPEC)
  _registered = true
}

export const MARKETPLACE_CRED_SPECS: Record<string, IssuerSpec> = {
  [PROPOSAL_SUBMITTER_SPEC.credentialType]: PROPOSAL_SUBMITTER_SPEC,
  [ROUND_VOTER_SPEC.credentialType]: ROUND_VOTER_SPEC,
}
