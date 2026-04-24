/**
 * Resolved registry records.
 *
 * Schema and credential-definition canonical JSON live on-chain in event
 * data. When OnChainResolver recovers them, it returns these typed views.
 * Provenance is the msg.sender that emitted the publish event — no
 * off-chain signature is carried on the record.
 */

export interface SchemaRecord {
  id: string                      // canonical id (URL-like or did-scoped)
  issuerId: string                // did:ethr:<chainId>:<address>
  issuerAddress: `0x${string}`    // msg.sender of the publish tx
  json: string                    // canonical AnonCreds schema JSON
  jsonHash: `0x${string}`         // keccak256(canonicalJson)
  blockNumber: bigint
  publishedAt: Date
}

export interface CredentialDefinitionRecord {
  id: string
  schemaId: string
  issuerId: string
  issuerAddress: `0x${string}`
  json: string                    // canonical CredentialDefinition JSON (public)
  jsonHash: `0x${string}`
  blockNumber: bigint
  publishedAt: Date
}

export interface IssuerRecord {
  did: string                     // did:ethr:<chainId>:<address>
  address: `0x${string}`
  registeredAt: Date
}
