/** @sa-route bootstrap @sa-auth none-with-csrf @sa-rate-limit 10/min @sa-risk-tier high @sa-validation zod @sa-owner security */
/**
 * POST /api/auth/passkey-verify
 *
 *   Body: {
 *     name?,                       // .agent name (preferred discovery key)
 *     accountAddress?,             // explicit address fallback
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
 *   2. Resolve the smart account address. Preferred path: caller passes
 *      `name` (e.g. "richp.agent"); we resolve via AgentNameUniversalResolver
 *      → smart account. Fallback path: caller passes accountAddress directly.
 *   3. Pack the WebAuthn assertion as 0x01 || abi.encode(WebAuthnLib.Assertion).
 *   4. Call account.isValidSignature(challengeHash, packedSig). If it returns
 *      ERC1271_MAGIC_VALUE the passkey checks out.
 *   5. Look up the user row by smartAccountAddress and mint a session JWT.
 *
 * No client-side P-256 math, no JS port of WebAuthnLib — verification reuses
 * the on-chain logic via ERC-1271. Same code path the contract uses for
 * UserOp validation, so the trust surface is identical.
 *
 * The `passkeys` table is no longer consulted: .agent name is the discovery
 * key. The chain remains source of truth for which credentials authorise
 * which account.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  toBytes,
  toHex,
  encodeAbiParameters,
  createPublicClient,
  http,
  getAddress,
  keccak256,
  isAddress,
} from 'viem'
import { localhost } from 'viem/chains'
import {
  agentAccountAbi,
  agentNameUniversalResolverAbi,
  parseDerSignature,
  normaliseLowS,
  namehash,
} from '@smart-agent/sdk'
import { z } from 'zod'
import { mintSession, SESSION_COOKIE } from '@/lib/auth/native-session'
import { verifyPasskeyChallenge as verifyChallenge } from '@/lib/auth/passkey-challenge'
import { webErrorResponse } from '@/lib/auth/error-response'
import { requireOriginAllowed } from '@/lib/auth/csrf'
import { validateRequest, DELEGATION_BODY_LIMIT_BYTES } from '@/lib/auth/validate-request'

// WebAuthn assertion payloads can be several KB once the
// authenticator data + DER signature + clientDataJSON are base64-
// encoded. We accept the larger DELEGATION cap (1 MiB) — same class
// as session-grant/finalize, the other route that carries WebAuthn.
const BodySchema = z.object({
  name: z.string().max(256).optional(),
  accountAddress: z.string().max(64).optional(),
  token: z.string().min(1).max(8192),
  challenge: z.string().min(1).max(2048),
  credentialIdBase64Url: z.string().min(1).max(4096),
  authenticatorDataBase64Url: z.string().min(1).max(16384),
  clientDataJSONBase64Url: z.string().min(1).max(16384),
  signatureBase64Url: z.string().min(1).max(4096),
})

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

const ERC1271_MAGIC = '0x1626ba7e'

export async function POST(request: Request) {
  // S2.2 — CSRF guard via parsed-URL exact-allowlist.
  const csrfDenied = requireOriginAllowed(request)
  if (csrfDenied) return csrfDenied

  const parsed = await validateRequest(request, {
    schema: BodySchema,
    maxBytes: DELEGATION_BODY_LIMIT_BYTES,
  })
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (!verifyChallenge(body.token, body.challenge)) {
    return NextResponse.json({ error: 'invalid or expired challenge' }, { status: 401 })
  }

  // Resolve the smart-account address. Preferred path: caller supplies a
  // `.agent` name we resolve via AgentNameUniversalResolver. Fallback:
  // explicit accountAddress. No `passkeys` table lookup — the chain
  // (AgentAccount._passkeys) is the source of truth for which credentials
  // authorise this account, surfaced via isValidSignature below.
  const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })

  let accountAddr: `0x${string}` | null = null
  if (body.name && body.name.trim().length > 0) {
    const universal = process.env.AGENT_NAME_UNIVERSAL_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (!universal) {
      return NextResponse.json({ error: 'name resolver not configured' }, { status: 500 })
    }
    try {
      const node = namehash(body.name.trim())
      const resolved = await publicClient.readContract({
        address: universal, abi: agentNameUniversalResolverAbi,
        functionName: 'resolveNode', args: [node as `0x${string}`],
      }) as `0x${string}`
      if (!resolved || resolved === '0x0000000000000000000000000000000000000000') {
        return NextResponse.json({ error: `unknown name: ${body.name}` }, { status: 404 })
      }
      accountAddr = getAddress(resolved)
    } catch (err) {
      return webErrorResponse({
        publicMessage: 'Name resolution failed',
        logMessage: '[passkey-verify] name resolution failed',
        logFields: {
          name: body.name?.trim(),
          errorCode: 'name-resolve-failed',
          errorMessage: (err as Error).message,
        },
        status: 400,
        request,
      })
    }
  } else if (body.accountAddress && isAddress(body.accountAddress)) {
    accountAddr = getAddress(body.accountAddress as `0x${string}`)
  } else {
    return NextResponse.json({ error: 'name or accountAddress required' }, { status: 400 })
  }

  // Build the assertion payload our PasskeyValidator/WebAuthnLib expects.
  const credIdBytes = base64UrlDecode(body.credentialIdBase64Url)
  const credentialIdDigest = keccak256(credIdBytes)
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

  let isValid = false
  try {
    const result = (await publicClient.readContract({
      address: accountAddr, abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [challengeHash, packedSig],
    })) as `0x${string}`
    isValid = result.toLowerCase() === ERC1271_MAGIC
  } catch (err) {
    return webErrorResponse({
      publicMessage: 'Invalid passkey signature',
      logMessage: '[passkey-verify] signature check reverted',
      logFields: {
        accountAddr,
        errorCode: 'erc1271-threw',
        // `err.message` from a failed contract call can include
        // calldata fragments — keep in server log only.
        errorMessage: (err as Error).message,
      },
      status: 401,
      request,
    })
  }

  if (!isValid) {
    return NextResponse.json({ error: 'invalid passkey signature' }, { status: 401 })
  }

  // Auth is now stateless: name + on-chain resolution + ERC-1271 verify is
  // sufficient. No `users` table lookup — the session JWT carries
  // everything downstream callers need (smartAccountAddress, name, did).
  // Profile data (avatar / email / preferences) is fetched from the user's
  // person-mcp via delegation after auth.
  const accountLower = accountAddr.toLowerCase() as `0x${string}`
  const displayName = body.name?.trim() || accountLower
  const did = `did:passkey:${CHAIN_ID}:${accountLower}`

  const cookieStore = await cookies()
  const jwt = mintSession({
    sub: did,
    walletAddress: accountLower,        // passkey owners control the AA; no separate EOA
    smartAccountAddress: accountLower,
    name: displayName,
    email: null,
    via: 'passkey',
    kind: 'session',
  })
  const response = NextResponse.json({
    success: true,
    user: {
      id: accountLower,
      did,
      name: displayName,
      smartAccountAddress: accountLower,
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
