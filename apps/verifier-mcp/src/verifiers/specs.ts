import { Nonce } from '@hyperledger/anoncreds-shared'
import { AnonCreds } from '@smart-agent/privacy-creds'
import {
  type OnChainResolver,
  loadVerifiedSchema,
  loadVerifiedCredDef,
} from '@smart-agent/credential-registry'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import {
  CREDENTIAL_KINDS,
  findCredentialKind,
  type CredentialKindDescriptor,
} from '@smart-agent/sdk'

AnonCreds.registerNativeBinding(anoncredsNodeJS)

/**
 * Verifier-mcp speaks AnonCreds against schemas/credDefs that other issuers
 * (org-mcp, family-mcp, geo-mcp) published. Resolution is via the same
 * `OnChainResolver` the issuers use; nothing here is issuer-private.
 *
 * Each spec defines:
 *   - The credentialType / schemaId / credDefId (imported from the shared
 *     `CREDENTIAL_KINDS` registry).
 *   - `buildRequest`: presentation_request body — small enough to read at a
 *     glance. We always layer in a holder slot (`attr_holder`) so the wallet
 *     can attach a pairwise handle.
 *   - `selection`: which referent each held credential should reveal /
 *     predicate against. The web action passes these straight through to
 *     ssi_create_presentation.
 */

export interface PresentationSelection {
  /** Which referents the holder should reveal in plaintext. */
  revealReferents: string[]
  /** Which predicate referents the holder should fulfill. */
  predicateReferents: string[]
}

export interface VerifierSpec extends CredentialKindDescriptor {
  /** Human label rendered in the verifier-mcp UI/logs. Mirrors `displayName`. */
  label: string
  /** Build the AnonCreds presentation_request for this credential type. */
  buildRequest(): {
    name: string
    version: string
    nonce: string
    requested_attributes: Record<string, { name: string; restrictions?: unknown[] }>
    requested_predicates: Record<string, {
      name: string
      p_type: '>=' | '<=' | '>' | '<'
      p_value: number
      restrictions?: unknown[]
    }>
  }
  /** What the wallet should reveal / predicate-prove. */
  selection: PresentationSelection
}

/**
 * Per-credential-type request shape. Edits here change the verifier's
 * default proof policy. The shared registry guarantees schema/credDef
 * ids stay in lockstep with what issuers publish.
 */
type RequestBuilder = VerifierSpec['buildRequest']

function orgMembershipRequest(d: CredentialKindDescriptor): RequestBuilder {
  return () => ({
    name: 'OrgMembership audit',
    version: '1.0',
    nonce: Nonce.generate(),
    requested_attributes: {
      attr_holder: { name: 'holder' },
      attr_status: { name: 'membershipStatus', restrictions: [{ cred_def_id: d.credDefId }] },
    },
    requested_predicates: {
      pred_recent: {
        name: 'joinedYear',
        p_type: '>=',
        p_value: 2000,
        restrictions: [{ cred_def_id: d.credDefId }],
      },
    },
  })
}

function guardianRequest(d: CredentialKindDescriptor): RequestBuilder {
  return () => ({
    name: 'Guardian audit',
    version: '1.0',
    nonce: Nonce.generate(),
    requested_attributes: {
      attr_holder: { name: 'holder' },
    },
    requested_predicates: {
      pred_guardian: {
        name: 'minorBirthYear',
        p_type: '>=',
        p_value: 2006,
        restrictions: [{ cred_def_id: d.credDefId }],
      },
    },
  })
}

function geoLocationRequest(d: CredentialKindDescriptor): RequestBuilder {
  return () => ({
    name: 'GeoLocation audit',
    version: '1.0',
    nonce: Nonce.generate(),
    requested_attributes: {
      attr_holder:   { name: 'holder' },
      attr_country:  { name: 'country',  restrictions: [{ cred_def_id: d.credDefId }] },
      attr_region:   { name: 'region',   restrictions: [{ cred_def_id: d.credDefId }] },
      attr_relation: { name: 'relation', restrictions: [{ cred_def_id: d.credDefId }] },
    },
    requested_predicates: {
      pred_confidence: {
        name: 'confidence',
        p_type: '>=',
        p_value: 50,
        restrictions: [{ cred_def_id: d.credDefId }],
      },
    },
  })
}

function skillsRequest(d: CredentialKindDescriptor): RequestBuilder {
  return () => ({
    name: 'Skills audit',
    version: '1.0',
    nonce: Nonce.generate(),
    requested_attributes: {
      attr_holder:    { name: 'holder' },
      attr_skill:     { name: 'skillName', restrictions: [{ cred_def_id: d.credDefId }] },
      attr_relation:  { name: 'relation',  restrictions: [{ cred_def_id: d.credDefId }] },
      attr_issuer:    { name: 'issuerDid', restrictions: [{ cred_def_id: d.credDefId }] },
    },
    requested_predicates: {
      pred_proficiency: {
        name: 'proficiencyScore',
        p_type: '>=',
        p_value: 4000,  // ≈ "advanced" floor; verifier asks for at least Advanced
        restrictions: [{ cred_def_id: d.credDefId }],
      },
    },
  })
}

const REQUEST_BUILDERS: Record<string, (d: CredentialKindDescriptor) => RequestBuilder> = {
  OrgMembershipCredential:    orgMembershipRequest,
  GuardianOfMinorCredential:  guardianRequest,
  GeoLocationCredential:      geoLocationRequest,
  SkillsCredential:           skillsRequest,
}

const SELECTIONS: Record<string, PresentationSelection> = {
  OrgMembershipCredential: {
    revealReferents: ['attr_holder', 'attr_status'],
    predicateReferents: ['pred_recent'],
  },
  GuardianOfMinorCredential: {
    revealReferents: ['attr_holder'],
    predicateReferents: ['pred_guardian'],
  },
  GeoLocationCredential: {
    revealReferents: ['attr_holder', 'attr_country', 'attr_region', 'attr_relation'],
    predicateReferents: ['pred_confidence'],
  },
  SkillsCredential: {
    revealReferents: ['attr_holder', 'attr_skill', 'attr_relation', 'attr_issuer'],
    predicateReferents: ['pred_proficiency'],
  },
}

const SPECS: Record<string, VerifierSpec> = Object.fromEntries(
  CREDENTIAL_KINDS
    .filter(k => REQUEST_BUILDERS[k.credentialType] && SELECTIONS[k.credentialType])
    .map(k => [k.credentialType, {
      ...k,
      label: k.displayName,
      buildRequest: REQUEST_BUILDERS[k.credentialType](k),
      selection: SELECTIONS[k.credentialType],
    }]),
)

export function getSpec(credentialType: string): VerifierSpec | null {
  // Try exact lookup first; fall back to URL-friendly aliases (e.g.
  // "geo-location" → GeoLocationCredential).
  const direct = SPECS[credentialType]
  if (direct) return direct
  const normalized = credentialType.toLowerCase().replace(/-/g, '')
  for (const s of Object.values(SPECS)) {
    const key = s.credentialType.toLowerCase().replace(/credential$/, '')
    if (key === normalized) return s
  }
  // Allow the descriptor's `noun` as an alias too — verifier-mcp's URL
  // shape becomes /verify/geo/request etc.
  for (const s of Object.values(SPECS)) {
    if (s.noun.toLowerCase() === normalized) return s
  }
  return null
}

export function listSpecs(): VerifierSpec[] {
  return Object.values(SPECS)
}

/**
 * Verify a presentation against the spec's pinned schema + credDef. Returns
 * `{ verified: true }` on success or `{ verified: false, reason }` on failure.
 *
 * The resolver is shared across all specs because every issuer publishes
 * into the same on-chain CredentialRegistry.
 */
export async function verifyPresentationForSpec(
  resolver: OnChainResolver,
  spec: VerifierSpec,
  presentationJson: string,
  presentationRequest: Record<string, unknown>,
): Promise<{ verified: boolean; reason?: string }> {
  try {
    const schema = await loadVerifiedSchema(resolver, spec.schemaId)
    const credDef = await loadVerifiedCredDef(resolver, spec.credDefId)
    const ok = AnonCreds.verifierVerifyPresentation({
      presentationJson,
      presentationRequestJson: JSON.stringify(presentationRequest),
      schemasJson:  { [spec.schemaId]:  schema.json },
      credDefsJson: { [spec.credDefId]: credDef.json },
    })
    return ok ? { verified: true } : { verified: false, reason: 'anoncreds verify returned false' }
  } catch (err) {
    return { verified: false, reason: (err as Error).message }
  }
}

// Silence unused-import warning when the registry is empty during a partial
// rollout (we intentionally fail-open — only kinds with both a builder and
// selection appear in the verifier).
void findCredentialKind
