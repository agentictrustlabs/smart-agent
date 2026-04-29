import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'

/**
 * GET /api/agents/can-manage?address=0x…
 *
 * Returns `{ canManage: true | false }` indicating whether the connected
 * user's person agent owns or controls the target agent. The
 * `AgentSubNav` component uses this to decide whether to render the
 * Manage tab. Defaults to `false` whenever any input is missing so an
 * unauthenticated request never sees a "true" answer.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const target = url.searchParams.get('address')
  if (!target) return NextResponse.json({ canManage: false })

  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ canManage: false })

  const personAgent = await getPersonAgentForUser(me.id)
  if (!personAgent) return NextResponse.json({ canManage: false })

  const ok = await canManageAgent(personAgent, target)
  return NextResponse.json({ canManage: ok })
}
