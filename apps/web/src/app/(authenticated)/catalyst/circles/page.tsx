import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getOikosContacts as getCircles } from '@/lib/actions/oikos.action'
import { db, schema } from '@/db'
import { CirclesClient } from './CirclesClient'

export default async function CatalystCirclesPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const oikos = await getCircles(currentUser.id).catch(() => [])
  const userOrgs = await getUserOrgs(currentUser.id)
  const orgAddress = userOrgs[0]?.address ?? ''

  // Map MCP rows to the client's legacy CirclePerson shape.
  const circles = oikos.map(c => ({
    id: c.id,
    userId: currentUser.id,
    personName: c.personName,
    proximity: Number(c.proximity ?? 3),
    response: (c.spiritualResponseState ?? 'curious') as 'not-interested' | 'curious' | 'interested' | 'seeking' | 'decided' | 'baptized',
    plannedConversation: c.plannedConversation,
    tags: c.tags,
    notes: c.notes,
    createdAt: c.createdAt,
  }))

  // Last-contact map: activity logs still in web SQL (Phase 5 work).
  const lastContactMap: Record<string, string> = {}
  try {
    const allActivities = await db.select().from(schema.activityLogs)
    for (const circle of circles) {
      const matching = allActivities
        .filter(a => a.title.toLowerCase().includes(circle.personName.toLowerCase()))
        .sort((a, b) => b.activityDate.localeCompare(a.activityDate))
      if (matching[0]) lastContactMap[circle.id] = matching[0].activityDate
    }
  } catch { /* ignored */ }

  return (
    <CirclesClient
      circles={circles}
      lastContactMap={lastContactMap}
      orgAddress={orgAddress}
    />
  )
}
