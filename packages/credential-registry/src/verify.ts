import { verifyRecordSignature, didEthrToAddress } from './signing'
import type { CredentialRegistryStore } from './store'
import type { SchemaRecord, CredentialDefinitionRecord } from './types'

/**
 * Fetch-and-verify helpers. Every wallet/verifier read must go through these;
 * never trust `store.getSchema` / `store.getCredDef` output directly.
 */

export async function loadVerifiedSchema(
  store: CredentialRegistryStore,
  id: string,
): Promise<SchemaRecord> {
  const rec = store.getSchema(id)
  if (!rec) throw new Error(`schema not found: ${id}`)
  const issuer = store.getIssuer(rec.issuerId)
  if (!issuer) throw new Error(`issuer not registered: ${rec.issuerId}`)
  // Defence in depth: the DID and the registered address must agree.
  const derived = didEthrToAddress(rec.issuerId)
  if (derived.toLowerCase() !== issuer.address.toLowerCase()) {
    throw new Error(`issuer did/address mismatch for ${rec.issuerId}`)
  }
  const ok = await verifyRecordSignature(issuer.address, 'schema', rec.id, rec.json, rec.signature)
  if (!ok) throw new Error(`schema signature invalid: ${id}`)
  return rec
}

export async function loadVerifiedCredDef(
  store: CredentialRegistryStore,
  id: string,
): Promise<CredentialDefinitionRecord> {
  const rec = store.getCredDef(id)
  if (!rec) throw new Error(`credDef not found: ${id}`)
  const issuer = store.getIssuer(rec.issuerId)
  if (!issuer) throw new Error(`issuer not registered: ${rec.issuerId}`)
  const derived = didEthrToAddress(rec.issuerId)
  if (derived.toLowerCase() !== issuer.address.toLowerCase()) {
    throw new Error(`issuer did/address mismatch for ${rec.issuerId}`)
  }
  const ok = await verifyRecordSignature(issuer.address, 'credDef', rec.id, rec.json, rec.signature)
  if (!ok) throw new Error(`credDef signature invalid: ${id}`)
  return rec
}
