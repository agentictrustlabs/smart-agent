/**
 * Hardening §1.3 (Stream B Task B3) — person-mcp's defense-in-depth
 * re-verification of the passkey assertion that the web app produced
 * during the SessionGrant ceremony.
 *
 * The web app's `/session-grant/finalize` already calls ERC-1271 on the
 * smart account before sending the insert. But the insert passthrough
 * was historically unauthenticated end-to-end — anyone on the network
 * could fabricate a SessionRecord and POST it. This module verifies the
 * EXACT same assertion against the smart account a second time, on the
 * storage owner's side, so a forged insert (even one that bypasses the
 * a2a-edge HMAC envelope from Task B1) cannot land in person-mcp's
 * session table.
 *
 * Challenge reconstruction:
 *   challengeBytes = sha256("SessionGrant:v1" || record.grantHash || serverNonce)
 *
 * `record.grantHash` is part of the inserted record (so it's already
 * authenticated by the surrounding HMAC envelope when present) and
 * commits to every field of the SessionGrant — smart-account address,
 * session-signer address, session-id, expiresAt, scope, audience. The
 * `serverNonce` is opaque entropy that the web app supplies; we trust
 * it as-is because the assertion itself is bound to the challenge it
 * produced.
 */

import {
  agentAccountAbi,
  parseDerSignature,
  normaliseLowS,
} from '@smart-agent/sdk'
import {
  createPublicClient,
  http,
  toHex,
  keccak256,
  encodeAbiParameters,
} from 'viem'
import { localhost } from 'viem/chains'
import { createHash } from 'node:crypto'
import { config } from '../config.js'

const ERC1271_MAGIC = '0x1626ba7e'

export interface InsertPasskeyAssertion {
  credentialIdBase64Url: string
  authenticatorDataBase64Url: string
  clientDataJSONBase64Url: string
  signatureBase64Url: string
  serverNonce: string
}

export interface VerifyInsertPasskeyInput {
  smartAccountAddress: `0x${string}`
  grantHash: string
  assertion: InsertPasskeyAssertion
}

export type VerifyInsertResult =
  | { ok: true }
  | { ok: false; reason: string }

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  return new Uint8Array(Buffer.from(padded, 'base64'))
}

function findIndex(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/**
 * Re-verify the passkey assertion that the web app's
 * `/session-grant/finalize` produced. Returns `{ ok: true }` iff the
 * smart account's ERC-1271 implementation accepts the assertion at the
 * reconstructed challenge.
 */
export async function verifyInsertPasskey(
  input: VerifyInsertPasskeyInput,
): Promise<VerifyInsertResult> {
  const { smartAccountAddress, grantHash, assertion } = input

  if (!grantHash.startsWith('0x') || grantHash.length !== 66) {
    return { ok: false, reason: `invalid grantHash format: ${grantHash}` }
  }
  if (!assertion.serverNonce || assertion.serverNonce.length < 8) {
    return { ok: false, reason: 'missing or too-short serverNonce' }
  }

  // Rebuild the challenge bytes that `/session-grant/finalize` signed.
  const challengeBytes = createHash('sha256')
    .update('SessionGrant:v1', 'utf8')
    .update(Buffer.from(grantHash.slice(2), 'hex'))
    .update(assertion.serverNonce, 'utf8')
    .digest()

  // Pack the WebAuthn assertion (mirrors the web's packing in finalize).
  const credIdBytes = base64UrlDecode(assertion.credentialIdBase64Url)
  const credentialIdDigest = keccak256(credIdBytes)
  const authData = base64UrlDecode(assertion.authenticatorDataBase64Url)
  const clientDataJSON = base64UrlDecode(assertion.clientDataJSONBase64Url)
  const cdjStr = new TextDecoder().decode(clientDataJSON)
  const der = base64UrlDecode(assertion.signatureBase64Url)

  const typeMarker = new TextEncoder().encode('"type":"webauthn.get"')
  const typeIndex = findIndex(clientDataJSON, typeMarker)
  if (typeIndex < 0) return { ok: false, reason: 'clientDataJSON: missing type' }
  const challengeMarker = new TextEncoder().encode('"challenge":"')
  const challengeIndex = findIndex(clientDataJSON, challengeMarker)
  if (challengeIndex < 0) return { ok: false, reason: 'clientDataJSON: missing challenge' }

  let r: bigint
  let s: bigint
  try {
    ;({ r, s } = parseDerSignature(der))
  } catch (err) {
    return { ok: false, reason: `DER parse failed: ${(err as Error).message}` }
  }

  const assertionEncoded = encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'authenticatorData',  type: 'bytes'   },
        { name: 'clientDataJSON',     type: 'string'  },
        { name: 'challengeIndex',     type: 'uint256' },
        { name: 'typeIndex',          type: 'uint256' },
        { name: 'r',                  type: 'uint256' },
        { name: 's',                  type: 'uint256' },
        { name: 'credentialIdDigest', type: 'bytes32' },
      ],
    }],
    [{
      authenticatorData: toHex(authData),
      clientDataJSON: cdjStr,
      challengeIndex: BigInt(challengeIndex),
      typeIndex: BigInt(typeIndex),
      r,
      s: normaliseLowS(s),
      credentialIdDigest,
    }],
  )
  const packedSig = ('0x01' + assertionEncoded.slice(2)) as `0x${string}`

  const challengeHash = toHex(challengeBytes) as `0x${string}`
  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.chainId },
    transport: http(config.rpcUrl),
  })

  try {
    const result = await publicClient.readContract({
      address: smartAccountAddress,
      abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [challengeHash, packedSig],
    }) as `0x${string}`
    if (result.toLowerCase() !== ERC1271_MAGIC) {
      return { ok: false, reason: `ERC-1271 returned ${result}, expected ${ERC1271_MAGIC}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: `ERC-1271 check reverted: ${(err as Error).message}` }
  }
}
