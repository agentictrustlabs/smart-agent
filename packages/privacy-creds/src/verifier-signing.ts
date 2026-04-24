/**
 * Verifier signs its presentation_request with EIP-191 over the canonical
 * JSON. Wallet verifies against a known verifier-registry (static config
 * today; CredentialRegistry-anchored later).
 *
 * Closes "any website can ask the wallet for a guardian proof" — the wallet
 * only generates a proof if the request was signed by a recognised verifier.
 */

import { keccak256, toBytes, verifyMessage, type PrivateKeyAccount } from 'viem'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}'
}

export function presentationRequestDigest(request: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalJson({ kind: 'presentation-request', body: request })))
}

export async function signPresentationRequest(
  account: PrivateKeyAccount,
  request: unknown,
): Promise<`0x${string}`> {
  return account.signMessage({ message: { raw: presentationRequestDigest(request) } })
}

export async function verifyPresentationRequestSignature(
  verifierAddress: `0x${string}`,
  request: unknown,
  signature: `0x${string}`,
): Promise<boolean> {
  return verifyMessage({
    address: verifierAddress,
    message: { raw: presentationRequestDigest(request) },
    signature,
  })
}
