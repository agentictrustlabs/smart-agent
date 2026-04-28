/**
 * SessionGrant.v1 + WalletAction.v1 + supporting types.
 *
 * Design doc: docs/architecture/passkey-session-signing.md §4.
 * Audit findings: docs/architecture/passkey-session-signing-review.md.
 *
 * Key decisions baked in:
 *  - Server-side risk classification (no client-supplied risk field — C2).
 *  - audience is a list, supporting unified A2A + SSI + verifier-mcp (C5).
 *  - SessionRecord caches verifiedPasskeyPubkey from one-shot ERC-1271 (C1).
 *  - Smart-account address is the only subject identifier (H2).
 *  - Hard TTL signed; idle deadline is server-state only (H4, H5).
 */

export type RiskLevel = 'low' | 'medium' | 'high'

/** WalletAction types we currently support. Extend the literal union
 *  whenever a new action gets a risk classification. The classifier
 *  table in `./risk-classifier.ts` must list every member. */
export type SessionWalletActionType =
  | 'ProvisionHolderWallet'
  | 'AcceptCredentialOffer'
  | 'CreatePresentation'
  | 'MatchAgainstPublicSet'
  | 'MatchAgainstPublicGeoSet'
  | 'RotateLinkSecret'
  | 'RevokeCredential'
  | 'AddPasskey'
  | 'RemovePasskey'
  | 'RecoveryUpdate'
  | 'CreateDelegation'

export interface SessionGrantV1 {
  schema: 'SessionGrant.v1'
  policyVersion: string

  issuer: string
  rpId: string
  origin: string

  subject: {
    smartAccountAddress: `0x${string}`
  }

  delegate: {
    type: 'session-eoa'
    address: `0x${string}`
  }

  /** Services this grant authorizes. Verifier asserts
   *  `audience.includes(this.serviceName)`. */
  audience: string[]

  session: {
    sessionId: string
    issuedAt: number
    notBefore: number
    expiresAt: number
    revocationEpoch: number
  }

  scope: {
    maxRisk: 'low' | 'medium'
    tools: string[]
    walletActions: SessionWalletActionType[]
    verifiers?: string[]
    credentialTypes?: string[]
    presentationDefinitionIds?: string[]
    maxActions?: number
    maxActionsPerMinute?: number
  }

  constraints: {
    requireKnownVerifier: boolean
    allowAttributeReveal: boolean
    allowUnknownVerifier: boolean
    allowOnchainWrite: boolean
    allowAccountMutation: boolean
    allowDelegationMutation: boolean
  }

  nonce: string
}

export interface WalletActionV1 {
  schema: 'WalletAction.v1'

  actionId: string
  sessionId: string

  actor: {
    smartAccountAddress: `0x${string}`
    sessionSignerAddress: `0x${string}`
  }

  action: {
    type: SessionWalletActionType
    payloadHash: string
    payloadCanonicalization: 'json-c14n-v1'
  }

  audience: {
    service: string
    verifierDid?: string
    verifierDomain?: string
    verifierAllowlistId?: string
  }

  timing: {
    createdAt: number
    expiresAt: number
  }

  replayProtection: {
    actionNonce: string
    sequence?: number
  }
}

export interface SessionRecord {
  sessionId: string
  sessionIdHash: string
  smartAccountAddress: `0x${string}`
  sessionSignerAddress: `0x${string}`
  /** Verified once at grant minting; cached for the session lifetime. */
  verifiedPasskeyPubkey: { x: string; y: string }
  /** Canonical signed grant. Verifier re-canonicalizes for caveat checks. */
  grant: SessionGrantV1
  grantHash: string
  idleExpiresAt: Date
  expiresAt: Date
  createdAt: Date
  revokedAt?: Date | null
  revocationEpoch: number
}

export interface AuditLogEntry {
  ts: Date
  smartAccountAddress: `0x${string}`
  sessionId: string
  grantHash: string
  actionId: string
  actionType: string
  actionHash: string
  decision: 'allowed' | 'denied' | 'high-risk-passthrough' | 'session_revoked' | 'grant_minted'
  reason?: string
  audience?: string
  verifier?: string
  /** Forward-only chain hash; null for the first entry per account. */
  prevEntryHash: string | null
  entryHash: string
}

/** RFC 8693-shaped envelope for service-to-service propagation.
 *  See design doc §4.5. */
export interface ActorEnvelopeV1 {
  schema: 'ActorEnvelope.v1'
  sub: `0x${string}`             // user smart account
  act: string                    // calling service name
  aud: string                    // target service name
  scope: SessionGrantV1['scope']
  sessionId: string
  iat: number
  exp: number
}

/** Hard caps applied by the verifier regardless of grant. */
export const SESSION_GRANT_DEFAULTS = {
  /** Hard TTL; design doc §3.7. */
  expiresInSeconds: 8 * 60 * 60,
  /** Idle window; sliding via SessionRecord.idleExpiresAt. */
  idleSeconds: 30 * 60,
  /** Max action expiry from createdAt. */
  maxActionExpirySeconds: 5 * 60,
} as const
