/**
 * EIP-712 Challenge Authentication
 *
 * Implements challenge-response authentication for the A2A agent.
 * The web app requests a challenge, the user signs it with their wallet,
 * and the A2A agent verifies the signature via ERC-1271.
 */

import { keccak256, encodePacked, toBytes } from 'viem'
import { randomHex } from './crypto'

export interface ChallengeData {
  id: string
  nonce: `0x${string}`
  accountAddress: `0x${string}`
  origin: string
  issuedAt: string
  expiresAt: string
}

/** EIP-712 domain for A2A web authentication */
export const A2A_AUTH_DOMAIN = {
  name: 'SmartAgentA2AAuth',
  version: '1',
} as const

/** EIP-712 types for the challenge message */
export const CHALLENGE_TYPES = {
  Challenge: [
    { name: 'challengeId', type: 'string' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'accountAddress', type: 'address' },
    { name: 'origin', type: 'string' },
    { name: 'issuedAt', type: 'string' },
    { name: 'expiresAt', type: 'string' },
  ],
} as const

/**
 * Create a new authentication challenge.
 * TTL defaults to 5 minutes.
 */
export function createChallenge(
  accountAddress: `0x${string}`,
  origin: string,
  chainId: number,
  ttlSeconds: number = 300,
): { challenge: ChallengeData; typedData: unknown } {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)

  const challenge: ChallengeData = {
    id: crypto.randomUUID(),
    nonce: `0x${randomHex(32)}` as `0x${string}`,
    accountAddress,
    origin,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }

  const typedData = {
    domain: {
      ...A2A_AUTH_DOMAIN,
      chainId,
      verifyingContract: accountAddress,
    },
    types: CHALLENGE_TYPES,
    primaryType: 'Challenge' as const,
    message: {
      challengeId: challenge.id,
      nonce: challenge.nonce,
      accountAddress: challenge.accountAddress,
      origin: challenge.origin,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
    },
  }

  return { challenge, typedData }
}

/**
 * Check if a challenge has expired.
 */
export function isChallengeExpired(challenge: ChallengeData): boolean {
  return new Date() > new Date(challenge.expiresAt)
}

/**
 * Compute the EIP-712 hash of a challenge for verification.
 * Used when verifying signatures via ERC-1271 on-chain.
 */
export function hashChallenge(challenge: ChallengeData, chainId: number): `0x${string}` {
  // Domain separator
  const domainSep = keccak256(
    encodePacked(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [
        keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        keccak256(toBytes(A2A_AUTH_DOMAIN.name)),
        keccak256(toBytes(A2A_AUTH_DOMAIN.version)),
        BigInt(chainId),
        challenge.accountAddress,
      ],
    ),
  )

  // Struct hash
  const structHash = keccak256(
    encodePacked(
      ['bytes32', 'bytes32', 'bytes32', 'address', 'bytes32', 'bytes32', 'bytes32'],
      [
        keccak256(toBytes('Challenge(string challengeId,bytes32 nonce,address accountAddress,string origin,string issuedAt,string expiresAt)')),
        keccak256(toBytes(challenge.id)),
        challenge.nonce,
        challenge.accountAddress,
        keccak256(toBytes(challenge.origin)),
        keccak256(toBytes(challenge.issuedAt)),
        keccak256(toBytes(challenge.expiresAt)),
      ],
    ),
  )

  // Final EIP-712 hash
  return keccak256(
    encodePacked(['bytes2', 'bytes32', 'bytes32'], ['0x1901', domainSep, structHash]),
  )
}
