/**
 * Canonical JSON + EIP-191 signing for registry records.
 *
 *   - Issuer has a secp256k1 keypair. Their `did:ethr:<chainId>:<address>`
 *     identifier is derived from the EOA.
 *   - They sign the canonical JSON of every schema/creddef public record.
 *   - The registry stores that signature alongside the record. Readers pull
 *     the record, re-canonicalize, and verify with the issuer's address.
 *
 * Anything that changes the canonical bytes (reordered keys, whitespace)
 * invalidates the signature.
 */

import { keccak256, toBytes, verifyMessage, type PrivateKeyAccount } from 'viem'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}'
}

export function recordDigest(type: 'schema' | 'credDef', id: string, json: string): `0x${string}` {
  // Binding the digest to (type, id, json) prevents cross-type / cross-id replay.
  const payload = canonicalJson({ type, id, json })
  return keccak256(toBytes(payload))
}

/** Sign with an in-memory issuer account (mock). Production: Privy/HSM. */
export async function signRecord(
  account: PrivateKeyAccount,
  type: 'schema' | 'credDef',
  id: string,
  json: string,
): Promise<`0x${string}`> {
  return account.signMessage({ message: { raw: recordDigest(type, id, json) } })
}

/** Verify a signature made by signRecord(). */
export async function verifyRecordSignature(
  issuerAddress: `0x${string}`,
  type: 'schema' | 'credDef',
  id: string,
  json: string,
  signature: `0x${string}`,
): Promise<boolean> {
  return verifyMessage({
    address: issuerAddress,
    message: { raw: recordDigest(type, id, json) },
    signature,
  })
}

/** Extract the EOA address from a did:ethr:<chainId>:<address> string. */
export function didEthrToAddress(did: string): `0x${string}` {
  const parts = did.split(':')
  const addr = parts[parts.length - 1]
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(`did:ethr must end in a 0x-address: ${did}`)
  }
  return addr as `0x${string}`
}
