/**
 * POST /api/auth/passkey-verify
 *
 *   Body: {
 *     token,                       // from /api/auth/passkey-challenge
 *     challenge,                   // base64url, what the device signed
 *     credentialIdBase64Url,
 *     authenticatorData,           // base64url
 *     clientDataJSON,              // base64url (raw bytes)
 *     signature,                   // base64url, DER-encoded
 *   }
 *
 * Server:
 *   1. Verify the (token, challenge) pair via verifyChallenge.
 *   2. Look up the user row by credentialIdDigest (= keccak(credentialIdBytes)).
 *   3. Pack the WebAuthn assertion as 0x01 || abi.encode(WebAuthnLib.Assertion).
 *   4. Call account.isValidSignature(challengeHash, packedSig). If it returns
 *      ERC1271_MAGIC_VALUE the passkey checks out.
 *   5. Mint a session JWT (kind=session, via=passkey) and set the cookie.
 *
 * No client-side P-256 math, no JS port of WebAuthnLib — verification reuses
 * the on-chain logic via ERC-1271. Same code path the contract uses for
 * UserOp validation, so the trust surface is identical.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  keccak256,
  toBytes,
  toHex,
  encodeAbiParameters,
  createPublicClient,
  http,
  getAddress,
} from 'viem'
import { localhost } from 'viem/chains'
import { agentAccountAbi, parseDerSignature, normaliseLowS } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { mintSession, SESSION_COOKIE } from '@/lib/auth/native-session'
import { verifyPasskeyChallenge as verifyChallenge } from '@/lib/auth/passkey-challenge'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

const ERC1271_MAGIC = '0x1626ba7e'

interface VerifyBody {
  token: string
  challenge: string                 // base64url of the 32-byte server-issued challenge
  credentialIdBase64Url: string
  authenticatorDataBase64Url: string
  clientDataJSONBase64Url: string
  signatureBase64Url: string
}

export async function POST(request: Request) {
  // CSRF guard.
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin && host && !origin.includes(host.split(':')[0])) {
    return NextResponse.json({ error: 'CSRF rejected' }, { status: 403 })
  }

  const body = await request.json() as VerifyBody
  if (!verifyChallenge(body.token, body.challenge)) {
    return NextResponse.json({ error: 'invalid or expired challenge' }, { status: 401 })
  }

  // Lookup the user for this credential. Two paths so we work for every
  // signup history:
  //   (a) modern: server-side `passkeys` mirror — the canonical source for
  //       every passkey enrolled post-Phase-2-cleanup.
  //   (b) legacy passkey-signup: user.id was set to the credentialIdDigest
  //       (lowercased hex) before the mirror existed. Fallback covers users
  //       who signed up via that path and never re-enrolled.
  const credIdBytes = base64UrlDecode(body.credentialIdBase64Url)
  const credentialIdDigest = keccak256(credIdBytes) // 0x...
  const credIdHex = credentialIdDigest.toLowerCase()

  const passkeyRow = await db.select().from(schema.passkeys)
    .where(eq(schema.passkeys.credentialIdBase64Url, body.credentialIdBase64Url))
    .limit(1).then(r => r[0])
  let row = passkeyRow
    ? await db.select().from(schema.users)
        .where(eq(schema.users.id, passkeyRow.userId)).limit(1).then(r => r[0])
    : undefined
  if (!row) {
    // Legacy passkey-signup: user.id was set to the lowercased credIdHex.
    row = await db.select().from(schema.users)
      .where(eq(schema.users.id, credIdHex)).limit(1).then(r => r[0])
  }

  if (!row || !row.smartAccountAddress) {
    return NextResponse.json({ error: 'unknown credential' }, { status: 404 })
  }
  const accountAddr = getAddress(row.smartAccountAddress as `0x${string}`)

  // Build the assertion payload our PasskeyValidator/WebAuthnLib expects.
  const authData = base64UrlDecode(body.authenticatorDataBase64Url)
  const clientDataJSON = base64UrlDecode(body.clientDataJSONBase64Url)
  const cdjStr = new TextDecoder().decode(clientDataJSON)
  const der = base64UrlDecode(body.signatureBase64Url)

  const typeMarker = new TextEncoder().encode('"type":"webauthn.get"')
  const typeIndex = findIndex(clientDataJSON, typeMarker)
  if (typeIndex < 0) {
    return NextResponse.json({ error: 'clientDataJSON: missing type' }, { status: 400 })
  }
  const challengeMarker = new TextEncoder().encode('"challenge":"')
  const challengeIndex = findIndex(clientDataJSON, challengeMarker)
  if (challengeIndex < 0) {
    return NextResponse.json({ error: 'clientDataJSON: missing challenge' }, { status: 400 })
  }

  const { r, s } = parseDerSignature(der)

  // Pack: 0x01 || abi.encode(Assertion)
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

  // The HASH the contract verifies against is the 32 raw bytes of the server-issued
  // challenge — base64url-decoded.
  const challengeHash = toHex(base64UrlDecode(body.challenge)) as `0x${string}`

  const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })
  let isValid = false
  try {
    const result = (await publicClient.readContract({
      address: accountAddr, abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [challengeHash, packedSig],
    })) as `0x${string}`
    isValid = result.toLowerCase() === ERC1271_MAGIC
  } catch (err) {
    return NextResponse.json({ error: `signature check reverted: ${(err as Error).message}` }, { status: 401 })
  }

  if (!isValid) {
    return NextResponse.json({ error: 'invalid passkey signature' }, { status: 401 })
  }

  // Mint session.
  const cookieStore = await cookies()
  const did = row.did ?? `did:passkey:${CHAIN_ID}:${accountAddr.toLowerCase()}`
  const jwt = mintSession({
    sub: did,
    walletAddress: row.walletAddress,
    smartAccountAddress: row.smartAccountAddress,
    name: row.name,
    email: row.email ?? null,
    via: 'passkey',
    kind: 'session',
  })
  const response = NextResponse.json({
    success: true,
    user: {
      id: row.id,
      did,
      name: row.name,
      smartAccountAddress: row.smartAccountAddress,
    },
  })
  // Set the cookie on the response object directly — most reliable in Next 15
  // route handlers; cookies().set() can occasionally fall out of the response
  // chain if other awaits run between mintSession and the final return.
  response.cookies.set(SESSION_COOKIE, jwt, {
    path: '/', maxAge: 60 * 60 * 24 * 30, httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  void cookieStore
  return response
}

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

// Suppress linter — challengeIndex/typeIndex bytes refer to the same buffer
// after decode but we leverage them as integer indices.
void toBytes
