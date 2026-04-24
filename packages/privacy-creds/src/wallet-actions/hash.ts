import { keccak256, toBytes } from 'viem'

/**
 * Canonical JSON stringify (simple JCS-ish: sorted keys, no extra whitespace).
 * Used so issuer/verifier and the wallet agree on the proof-request hash even
 * if one side reorders object keys.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}'
}

export function hashProofRequest(proofRequest: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalJson(proofRequest)))
}
