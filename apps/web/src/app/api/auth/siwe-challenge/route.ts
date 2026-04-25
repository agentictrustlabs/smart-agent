import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { signJwt, type JwtClaims } from '@/lib/auth/jwt'

/**
 * EIP-4361 (Sign-In With Ethereum) challenge.
 *
 *   GET /api/auth/siwe-challenge?domain=localhost:3000&address=0x...
 *
 * Returns the canonical SIWE message + an opaque token. The client signs
 * the message with the user's wallet (`personal_sign`); /siwe-verify
 * checks the (token, message, signature) trio.
 */

const TTL_S = 600  // 10 min

export async function GET(req: Request) {
  const url = new URL(req.url)
  const domain = url.searchParams.get('domain') ?? 'localhost:3000'
  const address = url.searchParams.get('address')
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'address (0x... 40-hex) required' }, { status: 400 })
  }
  const nonce = randomBytes(16).toString('hex')
  const issuedAt = new Date().toISOString()

  const message = [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in to Smart Agent.',
    '',
    `URI: https://${domain}`,
    'Version: 1',
    `Chain ID: ${process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337'}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n')

  const token = signJwt({
    sub: 'siwe-challenge',
    kind: 'passkey-challenge', // reuse the short-lived challenge kind
    challenge: nonce,
  } as JwtClaims, { ttlSeconds: TTL_S })

  return NextResponse.json({ message, nonce, token })
}

