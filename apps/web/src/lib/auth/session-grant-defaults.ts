/**
 * Default scope/constraints for the SessionGrant.v1 minted at signin.
 *
 * Per design doc §3.7: maxRisk='medium' covers all routine SSI flows.
 * High-risk actions (RotateLinkSecret, RevokeCredential, anything that
 * mutates passkeys/delegations) are NEVER reachable through this path
 * regardless of grant content — see verify-delegated-action.ts §8.
 */

import type {
  SessionGrantV1,
  SessionWalletActionType,
} from '@smart-agent/privacy-creds/session-grant'

const DEFAULT_AUDIENCES = [
  'person-mcp',
  'a2a-agent',
  'verifier-mcp',
  'web',
]

/** Action types this grant authorizes by default. Anything not in this list
 *  is rejected by the verifier even if scope is fully open. */
const DEFAULT_WALLET_ACTIONS: SessionWalletActionType[] = [
  'ProvisionHolderWallet',
  'AcceptCredentialOffer',
  'CreatePresentation',
  'MatchAgainstPublicSet',
  'MatchAgainstPublicGeoSet',
]

export interface BuildGrantInput {
  smartAccountAddress: `0x${string}`
  sessionSignerAddress: `0x${string}`
  sessionId: string
  revocationEpoch: number
  /** Optional verifier allowlist; required when constraints.requireKnownVerifier. */
  verifiers?: string[]
}

export function buildDefaultSessionGrant(input: BuildGrantInput): SessionGrantV1 {
  const now = Date.now()
  const issuer = process.env.SESSION_GRANT_ISSUER ?? 'web'
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000'
  const rpId = process.env.NEXT_PUBLIC_RP_ID ?? new URL(origin).hostname

  return {
    schema: 'SessionGrant.v1',
    policyVersion: '2026-04-27',
    issuer,
    rpId,
    origin,
    subject: { smartAccountAddress: input.smartAccountAddress },
    delegate: { type: 'session-eoa', address: input.sessionSignerAddress },
    audience: DEFAULT_AUDIENCES,
    session: {
      sessionId: input.sessionId,
      issuedAt: now,
      notBefore: now,
      expiresAt: now + 8 * 60 * 60 * 1000,
      revocationEpoch: input.revocationEpoch,
    },
    scope: {
      maxRisk: 'medium',
      tools: [
        'wallet.provision',
        'credentials.accept',
        'credentials.present',
        'wallet.match-against-public-set',
        'wallet.match-against-public-geo-set',
      ],
      walletActions: DEFAULT_WALLET_ACTIONS,
      verifiers: input.verifiers ?? [],
      maxActions: 1000,
      maxActionsPerMinute: 60,
    },
    constraints: {
      requireKnownVerifier: false,
      allowAttributeReveal: true,
      allowUnknownVerifier: true,
      allowOnchainWrite: false,
      allowAccountMutation: false,
      allowDelegationMutation: false,
    },
    nonce: cryptoRandomNonce(),
  }
}

function cryptoRandomNonce(): string {
  // 16 random bytes → base64url; sufficient for replay-resistance at the
  // grant level (the action layer has its own actionNonce).
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
