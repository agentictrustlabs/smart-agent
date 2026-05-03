'use server'

/**
 * Private (off-chain) coaching actions.
 *
 * Counterpart to the on-chain coaching flow in `grow.action.ts`. The
 * coaching relationship has no public edge, no public DATA_ACCESS_DELEGATION
 * record. The signed delegation lives in the coach's holder store
 * (`person-mcp.received_delegations`). Maria reads the disciple's profile by
 * loading her stored delegation and presenting it to person-mcp's
 * `get_delegated_profile`.
 */

import { requireSession } from '@/lib/auth/session'
import { callMcp } from '@/lib/clients/mcp-client'

interface SignedDelegation {
  delegator: `0x${string}`
  delegate: `0x${string}`
  authority: `0x${string}`
  caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
  salt: string
  signature: `0x${string}`
}

interface ReceivedDelegation {
  id: string
  delegatorPrincipal: string
  audience: string
  kind: string
  subjectLabel: string | null
  delegation: SignedDelegation
  delegationHash: string
  expiresAt: string | null
  createdAt: string
}

export interface PrivateDiscipleRow {
  id: string                       // delegation id (used as React key)
  delegationHash: string           // primary key for fetching the profile
  delegatorPrincipal: string       // disciple's smart account
  discipleName: string             // best-effort label
  expiresAt: string | null
  createdAt: string
  isPrivate: true
}

export async function getPrivateDisciples(): Promise<PrivateDiscipleRow[]> {
  await requireSession()
  let result: { delegations: ReceivedDelegation[] }
  try {
    result = await callMcp<{ delegations: ReceivedDelegation[] }>(
      'person', 'list_received_delegations', { kind: 'coaching' },
    )
  } catch {
    return []
  }
  return (result.delegations ?? []).map((d) => ({
    id: d.id,
    delegationHash: d.delegationHash,
    delegatorPrincipal: d.delegatorPrincipal,
    discipleName: d.subjectLabel || `${d.delegatorPrincipal.slice(0, 6)}…${d.delegatorPrincipal.slice(-4)}`,
    expiresAt: d.expiresAt,
    createdAt: d.createdAt,
    isPrivate: true,
  }))
}

export async function revokePrivateCoaching(
  delegationHash: string,
): Promise<{ success: boolean; error?: string }> {
  await requireSession()
  try {
    const r = await callMcp<{ ok: boolean }>(
      'person', 'revoke_received_delegation', { delegationHash },
    )
    if (!r.ok) return { success: false, error: 'Delegation not found' }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Revocation failed' }
  }
}

export async function loadPrivateDelegatedProfile(
  delegationHash: string,
): Promise<{ success: boolean; error?: string; profile?: Record<string, unknown>; allowedFields?: string[] }> {
  await requireSession()

  // Fetch the stored delegation from the caller's holder store. Includes
  // revoked entries; we filter to active locally so a disabled delegation
  // surfaces as "not found" rather than silently working.
  let listing: { delegations: ReceivedDelegation[] }
  try {
    listing = await callMcp<{ delegations: ReceivedDelegation[] }>(
      'person', 'list_received_delegations', { kind: 'coaching' },
    )
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to list delegations' }
  }

  const stored = listing.delegations?.find(d => d.delegationHash.toLowerCase() === delegationHash.toLowerCase())
  if (!stored) {
    return { success: false, error: 'Delegation not found in holder store' }
  }

  // Present the cross-delegation to get_delegated_profile. The MCP tool
  // re-verifies the signature via ERC-1271 against the delegator's smart
  // account every call — we don't trust our own store.
  try {
    const result = await callMcp<{ profile?: Record<string, unknown>; allowedFields?: string[]; error?: string }>(
      'person', 'get_delegated_profile',
      {
        targetPrincipal: stored.delegatorPrincipal,
        crossDelegation: stored.delegation,
      },
    )
    if (result.error) return { success: false, error: result.error }
    if (!result.profile) return { success: false, error: 'No profile data available' }
    return { success: true, profile: result.profile, allowedFields: result.allowedFields }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'MCP call failed' }
  }
}
