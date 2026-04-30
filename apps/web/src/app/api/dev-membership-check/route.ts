import { NextRequest, NextResponse } from 'next/server'
import { listHubsForOnboarding } from '@/lib/actions/onboarding/setup-agent.action'
import { getEdgesBySubject, getEdge } from '@/lib/contracts'
import { HAS_MEMBER } from '@smart-agent/sdk'

/** Diagnostic: are HAS_MEMBER edges from the catalyst hub pointing at the
 * given person agent? Hits the chain directly — no DB / cookies. */
export async function GET(req: NextRequest) {
  const personAgent = req.nextUrl.searchParams.get('agent') as `0x${string}` | null
  if (!personAgent) return NextResponse.json({ error: 'missing agent param' }, { status: 400 })

  const hubs = await listHubsForOnboarding()
  const catalyst = hubs.find(h => `${h.displayName} ${h.primaryName}`.toLowerCase().includes('catalyst'))
  if (!catalyst) return NextResponse.json({ error: 'catalyst hub not found', hubs })

  const HAS_MEMBER_HEX = (HAS_MEMBER as string).toLowerCase()
  const edgeIds = await getEdgesBySubject(catalyst.address as `0x${string}`)
  const memberEdges: Array<{ edgeId: string; object: string; relType: string }> = []
  let foundMatch = false
  for (const id of edgeIds) {
    const edge = await getEdge(id)
    if (!edge) continue
    if ((edge.relationshipType ?? '').toLowerCase() !== HAS_MEMBER_HEX) continue
    const obj = edge.object_.toLowerCase()
    memberEdges.push({ edgeId: id, object: obj, relType: edge.relationshipType ?? '' })
    if (obj === personAgent.toLowerCase()) foundMatch = true
  }

  return NextResponse.json({
    hub: catalyst,
    targetPersonAgent: personAgent.toLowerCase(),
    foundMatch,
    totalEdges: edgeIds.length,
    hasMemberEdges: memberEdges.length,
    edges: memberEdges,
  })
}
