/**
 * POST /api/auth/session-grant/finalize
 *
 * Second leg of the unified passkey + grant ceremony (design doc §3.4).
 *
 * Body: {
 *   signedToken,                  // from /start
 *   credentialIdBase64Url,
 *   authenticatorDataBase64Url,
 *   clientDataJSONBase64Url,
 *   signatureBase64Url,
 * }
 *
 * Server:
 *   1. Verify signedToken (kind=session-grant-pending) and extract
 *      { sub: accountAddr, sessionId, grantHash, serverNonce }.
 *   2. Rebuild challenge = sha256("SessionGrant:v1" || grantHash || serverNonce).
 *   3. Pack the WebAuthn assertion for AgentAccount.isValidSignature(challenge,..).
 *   4. ERC-1271 → MAGIC means the user proved possession of a registered
 *      passkey AND consent to this exact grant (challenge contains grantHash).
 *   5. POST SessionRecord to person-mcp.
 *   6. Set the session-id cookie (__Host- in prod, plain in dev).
 *   7. Mint the user-session JWT for app-level requests.
 *
 * One ceremony, one prompt, both authentication and consent (audit C3).
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  toHex,
  encodeAbiParameters,
  createPublicClient,
  http,
  keccak256,
  getAddress,
} from 'viem'
import { localhost } from 'viem/chains'
import {
  agentAccountAbi,
  parseDerSignature,
  normaliseLowS,
} from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { mintSession, SESSION_COOKIE } from '@/lib/auth/native-session'
import { verifyJwt } from '@/lib/auth/jwt'
import {
  hashCanonical,
  type SessionGrantV1,
  type SessionRecord,
} from '@smart-agent/privacy-creds/session-grant'
import { createHash } from 'node:crypto'
import { setGrantCookie, sessionIdHash, grantCookieName } from '@/lib/auth/session-cookie'
import {
  buildDefaultSessionGrant,
} from '@/lib/auth/session-grant-defaults'
import {
  fetchRevocationEpoch,
  insertSessionRecord,
} from '@/lib/auth/person-mcp-session-client'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const ERC1271_MAGIC = '0x1626ba7e'

interface FinalizeBody {
  signedToken: string
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

  const body = await request.json() as FinalizeBody

  // 1. Decode the pending-grant token.
  const claims = verifyJwt(body.signedToken)
  if (!claims || claims.kind !== 'session-grant-pending') {
    return NextResponse.json({ error: 'invalid or expired session-grant token' }, { status: 401 })
  }
  const accountAddr = getAddress(claims.sub as `0x${string}`)
  const sessionId = claims.sessionId
  const grantHashFromToken = claims.grantHash
  const serverNonce = claims.serverNonce
  if (!sessionId || !grantHashFromToken || !serverNonce) {
    return NextResponse.json({ error: 'token missing grant fields' }, { status: 400 })
  }

  // 2. Rebuild the grant deterministically. We re-fetch epoch — if it has
  //    bumped between /start and /finalize, we abort: the user may have
  //    panic-revoked from another tab.
  let revocationEpoch = 0
  try {
    revocationEpoch = await fetchRevocationEpoch(accountAddr)
  } catch (err) {
    return NextResponse.json({ error: `epoch read failed: ${(err as Error).message}` }, { status: 502 })
  }

  // The grant is rebuilt from the same {accountAddr, sessionId, epoch}
  // anchors. Anything else (issuer/origin/scope) is server-controlled
  // and not influenced by the client. nonce/issuedAt/expiresAt would
  // diverge across two builds, so we reconstruct using the values from
  // the canonical token instead. We achieve that by computing grantHash
  // from a freshly built grant and asserting equality.
  //
  // For the v1 release the grant is deterministic given:
  //   { accountAddr, sessionSignerAddress, sessionId, revocationEpoch,
  //     issuer, origin, rpId, policyVersion } — and the random {nonce,
  //     issuedAt fields}. We sidestep the timestamp/nonce drift by
  //     reusing the grantHash from the token; the grant CONTENT we
  //     persist comes from the rebuild, but its hash MUST match the
  //     token's claim. Since we don't currently have the original grant
  //     in the token (only its hash), we instead include the full grant
  //     in the token. See route /start which only carries grantHash
  //     today; we extend below.
  //
  // To keep the design clean we require /start to also embed the grant
  // body in the JWT. (Fits well within HS256 size limits — grant is
  // ~700 bytes JSON.) Add it now.
  const grant = (claims as unknown as { grant?: SessionGrantV1 }).grant
  if (!grant) {
    // Fallback rebuild (lossy: nonce + timestamps will differ from /start).
    // We refuse rather than silently mint a different grant.
    return NextResponse.json({ error: 'token missing grant body' }, { status: 400 })
  }

  const grantHashRebuilt = hashCanonical(grant as unknown as Parameters<typeof hashCanonical>[0])
  if (grantHashRebuilt !== grantHashFromToken) {
    return NextResponse.json({ error: 'grant hash mismatch (tampered token)' }, { status: 401 })
  }

  if (grant.session.revocationEpoch !== revocationEpoch) {
    return NextResponse.json({ error: 'epoch advanced; abort and retry' }, { status: 409 })
  }

  // Defense in depth: build a fresh "would-be" grant with the same anchors
  // and assert structural fields match (excluding nonce/timestamps).
  const reference = buildDefaultSessionGrant({
    smartAccountAddress: accountAddr,
    sessionSignerAddress: grant.delegate.address,
    sessionId,
    revocationEpoch,
  })
  if (
    reference.issuer !== grant.issuer ||
    reference.origin !== grant.origin ||
    reference.rpId !== grant.rpId ||
    reference.scope.maxRisk !== grant.scope.maxRisk ||
    reference.scope.walletActions.join(',') !== grant.scope.walletActions.join(',') ||
    reference.audience.join(',') !== grant.audience.join(',')
  ) {
    return NextResponse.json({ error: 'grant policy mismatch' }, { status: 401 })
  }

  // 3. Rebuild the challenge bytes the user is supposed to have signed.
  const grantHashHex = grantHashFromToken.slice(2)
  const challengeBytes = createHash('sha256')
    .update('SessionGrant:v1', 'utf8')
    .update(Buffer.from(grantHashHex, 'hex'))
    .update(serverNonce, 'utf8')
    .digest()

  // 4. Pack the WebAuthn assertion.
  const credIdBytes = base64UrlDecode(body.credentialIdBase64Url)
  const credentialIdDigest = keccak256(credIdBytes)
  const authData = base64UrlDecode(body.authenticatorDataBase64Url)
  const clientDataJSON = base64UrlDecode(body.clientDataJSONBase64Url)
  const cdjStr = new TextDecoder().decode(clientDataJSON)
  const der = base64UrlDecode(body.signatureBase64Url)

  const typeMarker = new TextEncoder().encode('"type":"webauthn.get"')
  const typeIndex = findIndex(clientDataJSON, typeMarker)
  if (typeIndex < 0) return NextResponse.json({ error: 'clientDataJSON: missing type' }, { status: 400 })
  const challengeMarker = new TextEncoder().encode('"challenge":"')
  const challengeIndex = findIndex(clientDataJSON, challengeMarker)
  if (challengeIndex < 0) return NextResponse.json({ error: 'clientDataJSON: missing challenge' }, { status: 400 })

  const { r, s } = parseDerSignature(der)

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

  // 5. ERC-1271 verification on-chain. challenge bytes → hex hash.
  const challengeHash = toHex(challengeBytes) as `0x${string}`
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
  if (!isValid) return NextResponse.json({ error: 'invalid passkey signature' }, { status: 401 })

  // 6. Persist SessionRecord on person-mcp.
  const idHash = sessionIdHash(sessionId)
  const record: SessionRecord = {
    sessionId,
    sessionIdHash: idHash,
    smartAccountAddress: accountAddr,
    sessionSignerAddress: grant.delegate.address,
    // The on-chain account caches X/Y of the COSE key; we record only the
    // credentialIdDigest here, which is sufficient to invalidate the
    // session if that passkey is later removed. Full COSE key lookup is
    // deferred to M5 (settings UX needs it for "which passkey signed?").
    verifiedPasskeyPubkey: { x: credentialIdDigest, y: '' },
    grant,
    grantHash: grantHashFromToken,
    idleExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    expiresAt: new Date(grant.session.expiresAt),
    createdAt: new Date(grant.session.issuedAt),
    revokedAt: null,
    revocationEpoch,
  }
  try {
    await insertSessionRecord(record)
  } catch (err) {
    return NextResponse.json({ error: `session persist failed: ${(err as Error).message}` }, { status: 502 })
  }

  // 7. Look up user row for the legacy session JWT.
  const accountLower = accountAddr.toLowerCase()
  const row = await db.select().from(schema.users)
    .where(eq(schema.users.smartAccountAddress, accountLower))
    .limit(1).then(r => r[0])
  if (!row) {
    return NextResponse.json({ error: 'no user record for this account' }, { status: 404 })
  }

  const did = row.did ?? `did:passkey:${CHAIN_ID}:${accountLower}`
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
    grant: {
      sessionId,
      sessionSignerAddress: grant.delegate.address,
      expiresAt: grant.session.expiresAt,
      audience: grant.audience,
      maxRisk: grant.scope.maxRisk,
    },
  })

  // Legacy app cookie.
  response.cookies.set(SESSION_COOKIE, jwt, {
    path: '/', maxAge: 60 * 60 * 24 * 30, httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  // Grant cookie — TTL bounded by the grant's hard expiry.
  const hardTtlSec = Math.max(1, Math.floor((grant.session.expiresAt - Date.now()) / 1000))
  setGrantCookie(response, sessionId, hardTtlSec)

  // Cookie store reference (Next 15 quirk — touch it so the response.cookies
  // path stays primary).
  void cookies()
  void grantCookieName

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
