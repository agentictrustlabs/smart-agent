/**
 * Single source of truth for AnonCreds credential kinds Smart Agent
 * supports today.
 *
 * The registry is **pure data** — it carries credential type, schema id,
 * credDef id, AnonCreds attribute names, and human-readable
 * `displayName` / `noun` strings. Both the web app and `verifier-mcp`
 * import from here so issuance, vault display, and verification stay in
 * lockstep.
 *
 * Vocabulary used across the UI:
 *
 *   • Relationship  — `AgentRelationship` on chain; agent ↔ agent.
 *   • Geo claim     — `GeoClaimRegistry` on chain; agent ↔ feature.
 *   • Credential    — vault-held AnonCred. Private until presented.
 *
 * Verbs that pair with each:
 *   • Publish — write the public on-chain version (relationship / geo claim).
 *   • Get     — receive an AnonCred into the vault.
 *   • Verify / Present — submit a vault credential to a verifier.
 *
 * To add a new credential kind:
 *   1. Append a `CredentialKindDescriptor` to `CREDENTIAL_KINDS` below.
 *   2. Wire the issuer's `/credential/offer` and `/credential/issue`
 *      endpoints into `apps/web/src/lib/ssi/clients.ts` (one entry per
 *      `issuerKey`).
 *   3. Register a verifier `buildRequest` and selection in
 *      `apps/verifier-mcp/src/verifiers/specs.ts`.
 *   4. Provide a React form in
 *      `apps/web/src/lib/credentials/forms/<kind>.tsx`.
 *      The dropdown menu, generic dialog, and held-credentials display
 *      pick the new kind up automatically.
 */

export type IssuerKey = 'org' | 'family' | 'geo' | 'skill'

export interface CredentialKindDescriptor {
  /** Stable string used in `credential_metadata.credential_type` rows
   *  and as the URL segment for verifier-mcp routes. */
  credentialType: string

  /** AnonCreds schema id, published on-chain by the issuer service. */
  schemaId: string

  /** AnonCreds credDef id, published on-chain by the issuer service. */
  credDefId: string

  /** AnonCreds attribute slot names — order does not matter, but every
   *  name must appear in the issuance attribute map. */
  attributeNames: string[]

  /** Human-readable label rendered in `HeldCredentialsPanel`,
   *  dialog titles, and verifier-mcp logs. */
  displayName: string

  /** Short word that fills "+ Get {noun} credential" in the dropdown
   *  menu and "Anonymous {noun} registration"-style copy.
   *  Keep it lowercase and ≤ 8 chars. */
  noun: string

  /** Sentence-length explainer rendered in `IssueCredentialDialog`. */
  description: string

  /** Which `clients.ts` entry to dispatch the offer + issue HTTP call at. */
  issuerKey: IssuerKey

  /** Set when issuance can only happen with a hub in scope (e.g. picking
   *  an org from the active hub's joinable list). The dropdown entry is
   *  hidden until a hub is active. */
  requiresActiveHub?: boolean
}

const ORG_MEMBERSHIP: CredentialKindDescriptor = {
  credentialType: 'OrgMembershipCredential',
  schemaId:       'https://catalyst.noco.org/schemas/OrgMembership/1.0',
  credDefId:      'https://catalyst.noco.org/creddefs/OrgMembership/1.0/v1',
  attributeNames: ['membershipStatus', 'role', 'joinedYear', 'circleId'],
  displayName:    'Org membership',
  noun:           'org',
  description:
    'Receive an AnonCreds credential proving you hold an active membership ' +
    'in one of the orgs in this hub. The credential lives in your wallet — ' +
    "verifiers only see it when you choose to present it.",
  issuerKey: 'org',
  requiresActiveHub: true,
}

const GUARDIAN_OF_MINOR: CredentialKindDescriptor = {
  credentialType: 'GuardianOfMinorCredential',
  schemaId:       'https://family.smartagent.io/schemas/GuardianOfMinor/1.0',
  credDefId:      'https://family.smartagent.io/creddefs/GuardianOfMinor/1.0/v1',
  attributeNames: ['relationship', 'minorBirthYear', 'issuedYear'],
  displayName:    'Guardian of minor',
  noun:           'guardian',
  description:
    'Receive an AnonCreds credential attesting you are the guardian of a minor. ' +
    'Verifiers can check the minor was born after a cutoff year without ever ' +
    "seeing the minor's exact birth year or your relationship label.",
  issuerKey: 'family',
}

const GEO_LOCATION: CredentialKindDescriptor = {
  credentialType: 'GeoLocationCredential',
  schemaId:       'https://smartagent.io/schemas/GeoLocation/1.0',
  credDefId:      'https://smartagent.io/creddefs/GeoLocation/1.0/v1',
  attributeNames: [
    'featureId', 'featureName',
    'city', 'region', 'country',
    'relation', 'confidence',
    'validFrom', 'validUntil', 'attestedAt',
  ],
  displayName: 'Geo location',
  noun:        'geo',
  description:
    'Receive an AnonCreds credential binding you to a `.geo` feature with a ' +
    'relation (residentOf, operatesIn, …). Nothing is written on chain — ' +
    'verifiers only learn the binding when you choose to present it.',
  issuerKey: 'geo',
}

const SKILLS_CREDENTIAL: CredentialKindDescriptor = {
  credentialType: 'SkillsCredential',
  schemaId:       'https://smartagent.io/schemas/Skills/1.0',
  credDefId:      'https://smartagent.io/creddefs/Skills/1.0/v1',
  attributeNames: [
    'skillId', 'skillName',
    'relation',          // 'hasSkill' | 'practicesSkill' | 'certifiedIn'
    'proficiencyScore',  // '0'..'10000'
    'confidence',        // '0'..'100'
    'issuerName',        // human-readable (audited against DID alsoKnownAs)
    'issuerDid',         // cryptographic identity check
    'validFrom', 'validUntil', 'issuedAt',
  ],
  displayName: 'Skill credential',
  noun:        'skill',
  description:
    'Receive an AnonCreds credential binding you to a skill or capability with ' +
    'optional proficiency and issuer attestation. Held in your private vault — ' +
    'verifiers only learn the binding when you choose to present it.',
  issuerKey: 'skill',
}

export const CREDENTIAL_KINDS: readonly CredentialKindDescriptor[] = [
  ORG_MEMBERSHIP,
  GUARDIAN_OF_MINOR,
  GEO_LOCATION,
  SKILLS_CREDENTIAL,
]

/** Lookup helper — returns null if `credentialType` is unknown. */
export function findCredentialKind(credentialType: string): CredentialKindDescriptor | null {
  return CREDENTIAL_KINDS.find(k => k.credentialType === credentialType) ?? null
}
