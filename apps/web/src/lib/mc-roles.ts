/**
 * Determine a CIL user's Mission Collective role from their user ID.
 * In production this would check on-chain roles; for demo mode we use ID prefixes.
 */
export type MCRole = 'business-owner' | 'ilad-ops' | 'reviewer' | 'local-manager' | 'admin' | 'funder'

export function getMCRole(userId: string): MCRole {
  switch (userId) {
    case 'cil-user-001': return 'ilad-ops'      // Cameron
    case 'cil-user-002': return 'reviewer'       // Nick
    case 'cil-user-003': return 'business-owner' // Afia
    case 'cil-user-004': return 'business-owner' // Kossi
    case 'cil-user-005': return 'local-manager'  // Yaw
    case 'cil-user-006': return 'admin'          // John
    case 'cil-user-007': return 'funder'         // Paul
    default: return 'ilad-ops'
  }
}

export function canApproveReports(role: MCRole): boolean {
  return role === 'ilad-ops' || role === 'admin' || role === 'reviewer'
}

export function canCreateProposals(role: MCRole): boolean {
  return role === 'ilad-ops' || role === 'admin'
}

export function canVote(role: MCRole): boolean {
  return role === 'admin' || role === 'funder'
}

export function canSubmitReports(role: MCRole): boolean {
  return role === 'business-owner'
}

// Business org addresses for filtering (from seed data wallet patterns)
export function getBusinessOrgAddressesForUser(userId: string): string[] | null {
  // null means "see all businesses"
  switch (userId) {
    case 'cil-user-003': return ['0x00000000000000000000000000000000000c0003'] // Afia's wallet
    case 'cil-user-004': return ['0x00000000000000000000000000000000000c0004'] // Kossi's wallet
    default: return null // all other roles see everything
  }
}
