/**
 * Server-side risk classifier — single source of truth.
 *
 * Imported by both `apps/web` (dispatch) and `apps/person-mcp` (verifier).
 * Adding a new WalletAction type requires extending the union in `types.ts`
 * AND adding an entry here. The verifier rejects unknown action types.
 *
 * Per design doc §6 risk classification table.
 *
 * NOTE: client-supplied risk fields are not consulted. Risk is determined
 * server-side from `action.type` alone (audit C2).
 */

import type { RiskLevel, SessionWalletActionType } from './types'

const TABLE: Record<SessionWalletActionType, RiskLevel> = {
  // Low — no off-device disclosure, no authority change.
  ProvisionHolderWallet:    'low',
  MatchAgainstPublicSet:    'low',
  MatchAgainstPublicGeoSet: 'low',

  // Medium — external service receives data, but no privacy-sensitive
  // attribute reveal; verifier-mcp policy further constrains.
  AcceptCredentialOffer:    'medium',
  CreatePresentation:       'medium',  // gated on known-verifier + no-reveal in §6 caveats

  // High — authority mutation, private-data disclosure, or irreversible.
  RotateLinkSecret:   'high',
  RevokeCredential:   'high',
  AddPasskey:         'high',
  RemovePasskey:      'high',
  RecoveryUpdate:     'high',
  CreateDelegation:   'high',
}

/** Server-side classifier. Throws on unknown action types — defense
 *  against adding a new action without classifying it. */
export function classifyRisk(actionType: string): RiskLevel {
  const r = (TABLE as Record<string, RiskLevel>)[actionType]
  if (!r) throw new Error(`unclassified action type: ${actionType}`)
  return r
}

const RISK_RANK: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 }

/** Returns true iff `actual` is at or below `ceiling`. */
export function riskLessOrEqual(actual: RiskLevel, ceiling: RiskLevel): boolean {
  return RISK_RANK[actual] <= RISK_RANK[ceiling]
}

/** Whether an action is eligible for session-signed dispatch given a grant's maxRisk. */
export function sessionEligible(actionType: string, grantMaxRisk: 'low' | 'medium'): boolean {
  return riskLessOrEqual(classifyRisk(actionType), grantMaxRisk)
}
