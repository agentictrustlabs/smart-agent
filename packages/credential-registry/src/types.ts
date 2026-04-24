export interface SchemaRecord {
  id: string                    // canonical id (did-style or URL-like)
  name: string
  version: string
  attributeNames: string[]
  issuerId: string              // did:ethr:<chainId>:<address>
  json: string                  // serialized AnonCreds Schema
  /** EIP-191 signature over recordDigest('schema', id, json) by the issuer EOA. */
  signature: `0x${string}`
  createdAt: string
}

export interface CredentialDefinitionRecord {
  id: string
  schemaId: string
  issuerId: string              // did:ethr:<chainId>:<address>
  tag: string
  json: string                  // serialized CredentialDefinition (public)
  keyCorrectnessProof: string   // serialized KCP
  supportRevocation: boolean
  /** EIP-191 signature over recordDigest('credDef', id, json) by the issuer EOA. */
  signature: `0x${string}`
  createdAt: string
}

/** Private creddef material — kept only by the issuer. NOT part of the
 *  public registry interface but stored in the same SQLite for Phase 1 mocks. */
export interface CredentialDefinitionPrivateRecord {
  credentialDefinitionId: string
  privateJson: string
  createdAt: string
}

export interface IssuerRecord {
  id: string                    // did:ethr:31337:0x...
  address: `0x${string}`        // secp256k1 EOA derived from the did
  displayName: string
  createdAt: string
}
