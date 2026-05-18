/** @sa-route web-auth @sa-auth session-cookie @sa-audit-event session.revoke @sa-validation none-no-body @sa-owner security */
/**
 * POST /api/a2a/revoke
 *
 * Revoke the active A2A session.
 *
 *   - Calls DelegationManager.revokeDelegation(rootGrantHash) so the on-chain
 *     authority is cryptographically dead.
 *   - Marks the a2a-agent session row as 'revoked'.
 *   - Clears the A2A session cookie.
 *
 * Returns a JSON shape consumable by the /sessions/permissions client form.
 */
import { NextResponse } from 'next/server'
import { revokeA2ASessionForUser } from '@/lib/actions/a2a-session-revoke.action'

export async function POST() {
  const result = await revokeA2ASessionForUser()
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}
