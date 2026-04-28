/**
 * POST /api/auth/session-grant/start
 *
 * First leg of the unified passkey + grant ceremony (design doc §3.4).
 *
 * Body: { name?: string, accountAddress?: 0x... }
 *
 * Server:
 *   1. Resolve smart-account address (from .agent name or explicit addr).
 *   2. Mint a fresh sessionId (random UUID) and derive its session-EOA
 *      via the configured custody backend (HKDF over master IKM).
 *   3. Read the current revocationEpoch for the account.
 *   4. Build the SessionGrantV1 (default scope/audience/TTLs).
 *   5. Compute grantHash = sha256(canonicalize(grant)).
 *   6. Compute challenge = sha256("SessionGrant:v1" || grantHash || serverNonce).
 *   7. Wrap the grant + sessionId + serverNonce in a short-lived signed token
 *      so the finalize step can rebuild the challenge tamper-free.
 *
 * Returns:
 *   { challenge: base64url, grant: SessionGrantV1, grantHash, signedToken }
 *
 * The browser hands `challenge` to navigator.credentials.get(), then POSTs
 * the resulting WebAuthn assertion + signedToken to /finalize.
 */

import { NextResponse } from 'next/server'
import {
  createPublicClient,
  http,
  getAddress,
  isAddress,
} from 'viem'
import { localhost } from 'viem/chains'
import {
  agentNameUniversalResolverAbi,
  namehash,
} from '@smart-agent/sdk'
import {
  hashCanonical,
  deriveSessionGrantChallenge,
} from '@smart-agent/privacy-creds/session-grant'
import { signJwt } from '@/lib/auth/jwt'
import { getKeyCustody } from '@/lib/key-custody'
import { newSessionId } from '@/lib/key-custody/dev-pepper'
import { buildDefaultSessionGrant } from '@/lib/auth/session-grant-defaults'
import { fetchRevocationEpoch } from '@/lib/auth/person-mcp-session-client'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const TOKEN_TTL_S = 300  // 5 min — must outlive the user's passkey prompt

interface StartBody {
  name?: string
  accountAddress?: string
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin && host && !origin.includes(host.split(':')[0])) {
    return NextResponse.json({ error: 'CSRF rejected' }, { status: 403 })
  }

  const body = await request.json() as StartBody
  let accountAddr: `0x${string}` | null = null

  if (body.name && body.name.trim().length > 0) {
    const universal = process.env.AGENT_NAME_UNIVERSAL_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (!universal) {
      return NextResponse.json({ error: 'name resolver not configured' }, { status: 500 })
    }
    try {
      const publicClient = createPublicClient({ chain: { ...localhost, id: CHAIN_ID }, transport: http(RPC_URL) })
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
      return NextResponse.json({ error: `name resolution failed: ${(err as Error).message}` }, { status: 400 })
    }
  } else if (body.accountAddress && isAddress(body.accountAddress)) {
    accountAddr = getAddress(body.accountAddress as `0x${string}`)
  } else {
    return NextResponse.json({ error: 'name or accountAddress required' }, { status: 400 })
  }

  // Derive the session-EOA address up-front so the grant we hash already
  // commits to the delegate. We immediately forget the key — finalize will
  // re-derive from the same sessionId + master IKM.
  const sessionId = newSessionId()
  const custody = getKeyCustody()
  const signer = await custody.deriveSigner(sessionId)
  const sessionSignerAddress = signer.address
  signer.forget()

  // Read current epoch from person-mcp (canonical owner).
  let revocationEpoch = 0
  try {
    revocationEpoch = await fetchRevocationEpoch(accountAddr)
  } catch (err) {
    return NextResponse.json({ error: `epoch read failed: ${(err as Error).message}` }, { status: 502 })
  }

  const grant = buildDefaultSessionGrant({
    smartAccountAddress: accountAddr,
    sessionSignerAddress,
    sessionId,
    revocationEpoch,
  })
  const grantHash = hashCanonical(grant as unknown as Parameters<typeof hashCanonical>[0])
  const serverNonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = deriveSessionGrantChallenge(grant, serverNonce)

  // Signed token wraps everything finalize needs to rebuild the challenge
  // and persist the SessionRecord. Browser cannot tamper with grantHash or
  // sessionId without invalidating the token.
  const signedToken = signJwt(
    {
      sub: accountAddr,
      kind: 'session-grant-pending',
      sessionId,
      grantHash,
      serverNonce,
      grant,
    },
    { ttlSeconds: TOKEN_TTL_S },
  )

  return NextResponse.json({
    challenge,
    grant,
    grantHash,
    signedToken,
  })
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
