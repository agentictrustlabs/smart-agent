import { IssuerAgent, AnonCreds } from '@smart-agent/privacy-creds'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import { privateKeyToAccount } from 'viem/accounts'
import { findCredentialKind } from '@smart-agent/sdk'
import { config } from '../config.js'

AnonCreds.registerNativeBinding(anoncredsNodeJS)

/**
 * GeoLocationCredential — issuer-signed AnonCreds credential binding a
 * holder to a public `.geo` feature with a relation kind, confidence,
 * and validity window. Lives only in the holder vault — geo-mcp never
 * writes to GeoClaimRegistry on issuance.
 *
 * Attribute set is flat (AnonCreds requirement) and chosen so common
 * verifier predicates work without fetching the GeoFeature row:
 *
 *   featureId        — bytes32 hex of the on-chain GeoFeature (canonical key)
 *   featureName      — "fortcollins.colorado.us.geo" (human-readable)
 *   city             — coarse-tier same-city checks
 *   region           — coarse-tier same-region checks
 *   country          — coarse-tier same-country checks
 *   relation         — residentOf | operatesIn | servesWithin | …
 *   confidence       — 0–100 numeric; predicate-friendly (≥80, …)
 *   validFrom        — unix seconds (predicate: validFrom ≤ now)
 *   validUntil       — unix seconds (predicate: now ≤ validUntil)
 *   attestedAt       — unix seconds the issuer signed
 */

const KIND = findCredentialKind('GeoLocationCredential')
if (!KIND) throw new Error('GeoLocationCredential descriptor missing from sdk registry')

export const LOCATION_SCHEMA_ID  = KIND.schemaId
export const LOCATION_CRED_DEF_ID = KIND.credDefId

const address = privateKeyToAccount(config.privateKey).address
export const GEO_ISSUER_DID = `did:ethr:${config.chainId}:${address.toLowerCase()}`

export const geoIssuer = new IssuerAgent({
  did: GEO_ISSUER_DID,
  privateKey: config.privateKey,
  displayName: config.displayName,
  rpcUrl: config.rpcUrl,
  chainId: config.chainId,
  credentialRegistryAddress: config.credentialRegistryAddress,
  privateStorePath: config.privateStorePath,
})

export const LOCATION_SPEC = {
  schemaId: LOCATION_SCHEMA_ID,
  credDefId: LOCATION_CRED_DEF_ID,
  name: 'GeoLocation',
  version: '1.0',
  attributeNames: [...KIND.attributeNames],
}

export async function ensureLocationRegistered(): Promise<void> {
  await geoIssuer.ensureSchemaAndCredDef(LOCATION_SPEC)
}
