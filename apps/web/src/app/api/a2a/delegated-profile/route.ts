import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { cookies } from 'next/headers'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' })

    const { searchParams } = new URL(request.url)
    const targetPrincipal = searchParams.get('target')
    if (!targetPrincipal) return NextResponse.json({ success: false, error: 'Missing target' })

    // Get A2A session token from cookie
    const cookieStore = await cookies()
    const a2aToken = cookieStore.get('a2a-session')?.value
    if (!a2aToken) return NextResponse.json({ success: false, error: 'No A2A session' })

    // Resolve current user's person agent address
    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    const user = users[0]
    const myPersonAgent = user ? await getPersonAgentForUser(user.id) : null

    let url = `${A2A_AGENT_URL}/profile/delegated?target=${encodeURIComponent(targetPrincipal)}`
    if (myPersonAgent) url += `&grantee=${encodeURIComponent(myPersonAgent)}`

    console.log(`[delegated-profile] Fetching: ${url}`)

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${a2aToken}` },
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      console.log('[delegated-profile] A2A error:', err)
      return NextResponse.json({ success: false, error: err.error ?? 'A2A error' })
    }

    const data = await res.json()
    console.log('[delegated-profile] A2A response:', JSON.stringify(data).slice(0, 200))
    return NextResponse.json({ success: true, profile: data.profile ?? null, allowedFields: data.allowedFields })
  } catch (err) {
    console.error('[delegated-profile] Error:', err)
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
