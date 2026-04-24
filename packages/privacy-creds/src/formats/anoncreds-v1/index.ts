/**
 * Thin wrappers over @hyperledger/anoncreds-shared (v0.4.x).
 *
 * The package models every AnonCreds object as a native handle; the public
 * ceremony is:
 *   1. register a native binding once (callers from a Node process do this
 *      by importing this module's `registerNativeBinding` helper and passing
 *      `anoncredsNodeJS` from `@hyperledger/anoncreds-nodejs`).
 *   2. use classes directly: Schema.create, CredentialDefinition.create, ...
 *
 * Values cross our trust boundary as JSON strings (what we serialize to DB).
 * Internally we round-trip through JSON.parse/stringify once at each boundary.
 */

import {
  Schema,
  CredentialDefinition,
  CredentialDefinitionPrivate,
  KeyCorrectnessProof,
  CredentialOffer,
  CredentialRequest,
  CredentialRequestMetadata,
  Credential,
  Presentation,
  PresentationRequest,
  LinkSecret,
  NativeAnoncreds,
  type Anoncreds,
  type JsonObject,
} from '@hyperledger/anoncreds-shared'

export type JsonString = string

let registered = false
export function registerNativeBinding(native: Anoncreds): void {
  if (registered) return
  NativeAnoncreds.register(native)
  registered = true
}

// ─── Link secret ─────────────────────────────────────────────────────────────

export function createLinkSecretValue(): string {
  return LinkSecret.create()
}

// ─── Issuer side ─────────────────────────────────────────────────────────────

export interface CreateSchemaInput {
  name: string
  version: string
  attributeNames: string[]
  issuerId: string
}

export function issuerCreateSchema(input: CreateSchemaInput): JsonString {
  const schema = Schema.create(input)
  return JSON.stringify(schema.toJson())
}

export interface CreateCredDefInput {
  schemaJson: JsonString
  schemaId: string
  issuerId: string
  tag: string
  supportRevocation?: boolean
}

export interface CreateCredDefOutput {
  credentialDefinition: JsonString
  credentialDefinitionPrivate: JsonString
  keyCorrectnessProof: JsonString
}

export function issuerCreateCredDef(input: CreateCredDefInput): CreateCredDefOutput {
  const schema = Schema.fromJson(JSON.parse(input.schemaJson) as JsonObject)
  const {
    credentialDefinition,
    credentialDefinitionPrivate,
    keyCorrectnessProof,
  } = CredentialDefinition.create({
    schema,
    schemaId: input.schemaId,
    issuerId: input.issuerId,
    tag: input.tag,
    signatureType: 'CL',
    supportRevocation: input.supportRevocation ?? false,
  })
  return {
    credentialDefinition: JSON.stringify(credentialDefinition.toJson()),
    credentialDefinitionPrivate: JSON.stringify(credentialDefinitionPrivate.toJson()),
    keyCorrectnessProof: JSON.stringify(keyCorrectnessProof.toJson()),
  }
}

export interface CreateCredentialOfferInput {
  schemaId: string
  credentialDefinitionId: string
  keyCorrectnessProofJson: JsonString
}

export function issuerCreateCredentialOffer(input: CreateCredentialOfferInput): JsonString {
  const kcp = KeyCorrectnessProof.fromJson(JSON.parse(input.keyCorrectnessProofJson) as JsonObject)
  const offer = CredentialOffer.create({
    schemaId: input.schemaId,
    credentialDefinitionId: input.credentialDefinitionId,
    keyCorrectnessProof: kcp,
  })
  return JSON.stringify(offer.toJson())
}

export interface IssueCredentialInput {
  credentialOfferJson: JsonString
  credentialRequestJson: JsonString
  credentialDefinitionJson: JsonString
  credentialDefinitionPrivateJson: JsonString
  attributes: Record<string, string>
}

export function issuerCreateCredential(input: IssueCredentialInput): JsonString {
  const credential = Credential.create({
    credentialDefinition: CredentialDefinition.fromJson(JSON.parse(input.credentialDefinitionJson) as JsonObject),
    credentialDefinitionPrivate: CredentialDefinitionPrivate.fromJson(
      JSON.parse(input.credentialDefinitionPrivateJson) as JsonObject,
    ),
    credentialOffer: CredentialOffer.fromJson(JSON.parse(input.credentialOfferJson) as JsonObject),
    credentialRequest: CredentialRequest.fromJson(JSON.parse(input.credentialRequestJson) as JsonObject),
    attributeRawValues: input.attributes,
  })
  return JSON.stringify(credential.toJson())
}

// ─── Holder side ────────────────────────────────────────────────────────────

export interface HolderCreateCredentialRequestInput {
  credentialOfferJson: JsonString
  credentialDefinitionJson: JsonString
  linkSecret: string
  linkSecretId: string
  proverDid?: string
  entropy?: string
}

export interface HolderCreateCredentialRequestOutput {
  credentialRequest: JsonString
  credentialRequestMetadata: JsonString
}

export function holderCreateCredentialRequest(
  input: HolderCreateCredentialRequestInput,
): HolderCreateCredentialRequestOutput {
  const { credentialRequest, credentialRequestMetadata } = CredentialRequest.create({
    credentialDefinition: CredentialDefinition.fromJson(JSON.parse(input.credentialDefinitionJson) as JsonObject),
    credentialOffer: CredentialOffer.fromJson(JSON.parse(input.credentialOfferJson) as JsonObject),
    linkSecret: input.linkSecret,
    linkSecretId: input.linkSecretId,
    entropy: input.entropy ?? input.proverDid ?? 'entropy',
  })
  return {
    credentialRequest: JSON.stringify(credentialRequest.toJson()),
    credentialRequestMetadata: JSON.stringify(credentialRequestMetadata.toJson()),
  }
}

export interface HolderProcessCredentialInput {
  credentialJson: JsonString
  credentialRequestMetadataJson: JsonString
  linkSecret: string
  credentialDefinitionJson: JsonString
}

export function holderProcessCredential(
  input: HolderProcessCredentialInput,
): JsonString {
  const credential = Credential.fromJson(JSON.parse(input.credentialJson) as JsonObject)
  credential.process({
    credentialRequestMetadata: CredentialRequestMetadata.fromJson(
      JSON.parse(input.credentialRequestMetadataJson) as JsonObject,
    ),
    linkSecret: input.linkSecret,
    credentialDefinition: CredentialDefinition.fromJson(JSON.parse(input.credentialDefinitionJson) as JsonObject),
  })
  return JSON.stringify(credential.toJson())
}

export interface PresentationRequestJson {
  name: string
  version: string
  nonce: string
  requested_attributes: Record<
    string,
    { name: string; restrictions?: Array<Record<string, string>> }
  >
  requested_predicates: Record<
    string,
    { name: string; p_type: '>=' | '<=' | '>' | '<'; p_value: number; restrictions?: Array<Record<string, string>> }
  >
  non_revoked?: { from?: number; to?: number }
}

export interface HolderCredentialEntry {
  credentialJson: JsonString
  /** Referents from presentationRequest.requested_attributes to reveal from THIS cred. */
  revealAttrReferents: string[]
  /** Referents from presentationRequest.requested_predicates to answer from THIS cred. */
  predicateReferents: string[]
}

export interface HolderCreatePresentationInput {
  presentationRequestJson: JsonString
  /** One or more credentials. Each entry lists which referents it satisfies. */
  credentials: HolderCredentialEntry[]
  schemasJson: Record<string, JsonString>
  credDefsJson: Record<string, JsonString>
  linkSecret: string
  selfAttestedAttributes?: Record<string, string>
}

export function holderCreatePresentation(
  input: HolderCreatePresentationInput,
): JsonString {
  const request = PresentationRequest.fromJson(JSON.parse(input.presentationRequestJson) as JsonObject)

  const schemas: Record<string, Schema> = {}
  for (const [id, json] of Object.entries(input.schemasJson)) {
    schemas[id] = Schema.fromJson(JSON.parse(json) as JsonObject)
  }
  const credDefs: Record<string, CredentialDefinition> = {}
  for (const [id, json] of Object.entries(input.credDefsJson)) {
    credDefs[id] = CredentialDefinition.fromJson(JSON.parse(json) as JsonObject)
  }

  // Multi-credential: each cred gets an entryIndex; credentialsProve entries
  // reference it by index. Per-credential referent lists let callers split a
  // compound proof across N credentials (e.g. membership from wallet A,
  // guardian from wallet B as long as both share the same link secret).
  const credObjs = input.credentials.map(c =>
    Credential.fromJson(JSON.parse(c.credentialJson) as JsonObject),
  )
  const credentialsProve = input.credentials.flatMap((c, entryIndex) => [
    ...c.revealAttrReferents.map(r => ({ entryIndex, referent: r, isPredicate: false, reveal: true })),
    ...c.predicateReferents.map(r  => ({ entryIndex, referent: r, isPredicate: true,  reveal: true })),
  ])

  const presentation = Presentation.create({
    presentationRequest: request,
    credentials: credObjs.map(c => ({ credential: c })),
    credentialsProve,
    selfAttest: input.selfAttestedAttributes ?? {},
    linkSecret: input.linkSecret,
    schemas,
    credentialDefinitions: credDefs,
  })

  return JSON.stringify(presentation.toJson())
}

// ─── Verifier side ──────────────────────────────────────────────────────────

export interface VerifierVerifyPresentationInput {
  presentationJson: JsonString
  presentationRequestJson: JsonString
  schemasJson: Record<string, JsonString>
  credDefsJson: Record<string, JsonString>
}

export function verifierVerifyPresentation(
  input: VerifierVerifyPresentationInput,
): boolean {
  const presentation = Presentation.fromJson(JSON.parse(input.presentationJson) as JsonObject)
  const request = PresentationRequest.fromJson(JSON.parse(input.presentationRequestJson) as JsonObject)

  const schemas: Record<string, Schema> = {}
  for (const [id, json] of Object.entries(input.schemasJson)) {
    schemas[id] = Schema.fromJson(JSON.parse(json) as JsonObject)
  }
  const credDefs: Record<string, CredentialDefinition> = {}
  for (const [id, json] of Object.entries(input.credDefsJson)) {
    credDefs[id] = CredentialDefinition.fromJson(JSON.parse(json) as JsonObject)
  }

  return presentation.verify({
    presentationRequest: request,
    schemas,
    credentialDefinitions: credDefs,
  })
}
