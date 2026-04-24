/**
 * Fetch-and-verify helpers (on-chain resolver).
 *
 * Each call resolves the record from chain events, checks keccak(canonicalJson)
 * against the hash on-chain, and confirms the publisher matches the record's
 * issuer DID. Callers should never bypass these helpers.
 */

import { OnChainResolver, canonicalJsonHash } from './on-chain-resolver'
import { didEthrToAddress } from './signing'
import type { SchemaRecord, CredentialDefinitionRecord } from './types'

export async function loadVerifiedSchema(
  resolver: OnChainResolver,
  id: string,
): Promise<SchemaRecord> {
  const rec = await resolver.resolveSchema(id)
  await assertRecordIntegrity(rec)
  return rec
}

export async function loadVerifiedCredDef(
  resolver: OnChainResolver,
  id: string,
): Promise<CredentialDefinitionRecord> {
  const rec = await resolver.resolveCredDef(id)
  await assertRecordIntegrity(rec)
  // Defence in depth: the credDef must reference a published schema.
  const schemaPublished = await resolver.isSchemaPublished(rec.schemaId)
  if (!schemaPublished) {
    throw new Error(`credDef ${id} references unpublished schema ${rec.schemaId}`)
  }
  return rec
}

async function assertRecordIntegrity(
  rec: SchemaRecord | CredentialDefinitionRecord,
): Promise<void> {
  // OnChainResolver already verified keccak(canonicalJson) == jsonHash on the
  // event. Re-check belt-and-suspenders so anything mutating the cached
  // record object is caught here.
  const recomputed = canonicalJsonHash(rec.json)
  if (recomputed.toLowerCase() !== rec.jsonHash.toLowerCase()) {
    throw new Error(`record jsonHash mismatch for ${rec.id}`)
  }
  // The did:ethr address in the record must match the publish msg.sender.
  const fromDid = didEthrToAddress(rec.issuerId)
  if (fromDid.toLowerCase() !== rec.issuerAddress.toLowerCase()) {
    throw new Error(`record issuer did/address mismatch for ${rec.id}`)
  }
}

/**
 * did:evm:<chainId>:<contract>/<resource>/<id>
 *
 * Self-describing URI that tells a verifier which contract on which chain to
 * query, and what resource type / id to resolve. Not a full DID-core DID,
 * but we use the did: prefix for ergonomic parity with did:ethr.
 */
export function didEvmFor(
  chainId: number,
  contract: `0x${string}`,
  resource: 'schema' | 'credDef' | 'revStatus',
  id: string,
): string {
  return `did:evm:${chainId}:${contract.toLowerCase()}/${resource}/${encodeURIComponent(id)}`
}

export interface ParsedDidEvm {
  chainId: number
  contract: `0x${string}`
  resource: 'schema' | 'credDef' | 'revStatus'
  id: string
}

export function parseDidEvm(uri: string): ParsedDidEvm {
  const match = uri.match(/^did:evm:(\d+):(0x[0-9a-fA-F]{40})\/(schema|credDef|revStatus)\/(.+)$/)
  if (!match) throw new Error(`not a did:evm URI: ${uri}`)
  return {
    chainId: Number(match[1]),
    contract: match[2].toLowerCase() as `0x${string}`,
    resource: match[3] as ParsedDidEvm['resource'],
    id: decodeURIComponent(match[4]),
  }
}
