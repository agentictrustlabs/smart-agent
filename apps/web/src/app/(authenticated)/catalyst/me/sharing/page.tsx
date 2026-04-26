import { getSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getIncomingDelegations, getOutgoingDelegations } from '@/lib/actions/data-delegation.action'
import { SharingClient } from './SharingClient'

export default async function SharingPage() {
  const session = await getSession()
  if (!session) return <div style={{ padding: '2rem' }}>Not authenticated</div>

  const users = await db.select().from(schema.users)
    .where(eq(schema.users.did, session.userId)).limit(1)
  const user = users[0]
  if (!user) return <div style={{ padding: '2rem' }}>User not found</div>

  const incoming = await getIncomingDelegations(user.id)
  const outgoing = await getOutgoingDelegations(user.id)

  return <SharingClient incoming={incoming} outgoing={outgoing} userId={user.id} />
}
