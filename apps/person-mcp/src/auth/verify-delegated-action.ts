/**
 * Deterministic verifier for session-signer-signed WalletActions.
 *
 * Per design doc §5. Reads SessionRecord (canonical state); does NOT
 * round-trip to chain per action (audit C1). Risk classified
 * server-side (audit C2). Auditable on every decision.
 */

import { recoverAddress } from 'viem'
import {
  type WalletActionV1,
  hashCanonical,
  classifyRisk,
  riskLessOrEqual,
  SESSION_GRANT_DEFAULTS,
} from '@smart-agent/privacy-creds/session-grant'
import {
  getSessionById,
  getRevocationEpoch,
  consumeActionNonce,
  appendAuditEntry,
  bumpIdleDeadline,
} from '../session-store/index.js'

export interface VerifyDelegatedInput {
  action: WalletActionV1
  /** 0x-hex secp256k1 signature with recovery byte (viem-style). */
  actionSignature: `0x${string}`
  /** Echoes the session id from the cookie / wire envelope. */
  sessionId: string
}

export interface VerifyDelegatedCtx {
  /** Self-reported service name of this verifier instance. */
  serviceName: string
}

export class DelegatedActionDenied extends Error {
  constructor(public readonly code: string, public readonly detail: string) {
    super(`${code}: ${detail}`)
  }
}

export async function verifyDelegatedWalletAction(
  input: VerifyDelegatedInput,
  ctx: VerifyDelegatedCtx,
): Promise<true> {
  const action = input.action

  // 1. Canonicalize.
  const actionHash = hashCanonical(action as unknown as Parameters<typeof hashCanonical>[0])

  // 2. Load SessionRecord (single source of truth).
  const session = getSessionById(input.sessionId)
  if (!session) throw deny('unknown_session', 'no SessionRecord for sessionId')
  if (session.revokedAt) throw deny('session_revoked', 'session was revoked')
  const now = Date.now()
  if (now >= session.expiresAt.getTime()) throw deny('session_expired', 'hard TTL passed')
  if (now >= session.idleExpiresAt.getTime()) throw deny('session_idle', 'idle window passed')

  // 3. Revocation-epoch panic check.
  const accountEpoch = getRevocationEpoch(session.smartAccountAddress)
  if (accountEpoch !== session.revocationEpoch) {
    throw deny('epoch_mismatch', `account epoch ${accountEpoch}, session ${session.revocationEpoch}`)
  }

  // 4. Sanity: action references this session.
  if (action.sessionId !== session.sessionId) {
    throw deny('session_mismatch', 'action.sessionId != SessionRecord.sessionId')
  }
  if (action.actor.smartAccountAddress.toLowerCase() !== session.smartAccountAddress.toLowerCase()) {
    throw deny('subject_mismatch', 'action.actor.smartAccountAddress != session subject')
  }
  if (action.actor.sessionSignerAddress.toLowerCase() !== session.sessionSignerAddress.toLowerCase()) {
    throw deny('delegate_mismatch', 'action.actor.sessionSignerAddress != session signer')
  }

  // 5. Audience: this service is in the grant; action targets this service.
  if (!session.grant.audience.includes(ctx.serviceName)) {
    throw deny('audience_excluded', `${ctx.serviceName} not in grant.audience`)
  }
  if (action.audience.service !== ctx.serviceName) {
    throw deny('action_audience_mismatch', `action targets ${action.audience.service} not ${ctx.serviceName}`)
  }

  // 6. Server-side risk classification — NEVER trust client-supplied.
  const serverRisk = classifyRisk(action.action.type)
  if (!riskLessOrEqual(serverRisk, session.grant.scope.maxRisk)) {
    throw deny('risk_exceeds_ceiling', `${action.action.type} is ${serverRisk}; grant maxRisk ${session.grant.scope.maxRisk}`)
  }

  // 7. Scope: action.type is in grant.scope.walletActions.
  if (!session.grant.scope.walletActions.includes(action.action.type)) {
    throw deny('action_not_in_scope', `${action.action.type} not in grant.scope.walletActions`)
  }

  // 8. Caveats — type-specific gates.
  enforceConstraints(action, session.grant)
  if (action.action.type === 'CreatePresentation') {
    enforceVerifierPolicy(action, session.grant)
  }

  // 9. Action timing.
  if (now >= action.timing.expiresAt) {
    throw deny('action_expired', `action expired at ${action.timing.expiresAt}`)
  }
  const window = action.timing.expiresAt - action.timing.createdAt
  if (window <= 0 || window > SESSION_GRANT_DEFAULTS.maxActionExpirySeconds * 1000) {
    throw deny('action_window_invalid', `action expiry window ${window}ms exceeds cap`)
  }

  // 10. Verify ECDSA signature against the cached delegate address.
  const recovered = await recoverAddress({ hash: actionHash as `0x${string}`, signature: input.actionSignature })
  if (recovered.toLowerCase() !== session.sessionSignerAddress.toLowerCase()) {
    throw deny('signature_invalid', `recovered ${recovered}, expected ${session.sessionSignerAddress}`)
  }

  // 11. Replay protection — nonce burned even if downstream tool fails.
  consumeActionNonce(session.smartAccountAddress, action.replayProtection.actionNonce)

  // 12. Slide the idle deadline forward.
  bumpIdleDeadline(session.sessionId, new Date(now + SESSION_GRANT_DEFAULTS.idleSeconds * 1000))

  // 13. Audit.
  appendAuditEntry({
    ts: new Date(),
    smartAccountAddress: session.smartAccountAddress,
    sessionId: session.sessionId,
    grantHash: session.grantHash,
    actionId: action.actionId,
    actionType: action.action.type,
    actionHash,
    decision: 'allowed',
    audience: ctx.serviceName,
    verifier: action.audience.verifierDid ?? action.audience.verifierDomain,
  })

  return true
}

function enforceConstraints(action: WalletActionV1, grant: import('@smart-agent/privacy-creds/session-grant').SessionGrantV1): void {
  // Hard rails: certain action types are NEVER reachable through this path.
  switch (action.action.type) {
    case 'AddPasskey':
    case 'RemovePasskey':
    case 'RecoveryUpdate':
      throw deny('account_mutation_forbidden', `${action.action.type} requires fresh passkey`)
    case 'CreateDelegation':
      throw deny('delegation_mutation_forbidden', 'delegation creation requires fresh passkey')
  }
  // Constraint flags from the grant.
  if (grant.constraints.allowAccountMutation === true) {
    // We never mint grants with this true; defense-in-depth.
    throw deny('grant_invariant_violated', 'allowAccountMutation must be false')
  }
}

function enforceVerifierPolicy(
  action: WalletActionV1,
  grant: import('@smart-agent/privacy-creds/session-grant').SessionGrantV1,
): void {
  const verifier = action.audience.verifierDid ?? action.audience.verifierDomain
  if (!verifier) {
    throw deny('verifier_unspecified', 'CreatePresentation requires verifierDid or verifierDomain')
  }
  if (grant.constraints.requireKnownVerifier && grant.scope.verifiers && grant.scope.verifiers.length > 0) {
    if (!grant.scope.verifiers.includes(verifier)) {
      throw deny('unknown_verifier', `verifier ${verifier} not in grant.scope.verifiers`)
    }
  } else if (grant.constraints.requireKnownVerifier) {
    throw deny('verifier_allowlist_empty', 'requireKnownVerifier=true but grant.scope.verifiers is empty')
  }
}

function deny(code: string, detail: string): DelegatedActionDenied {
  return new DelegatedActionDenied(code, detail)
}
