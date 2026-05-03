import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { callMcp, McpCallError } from '@/lib/clients/mcp-client'

interface NotificationRow {
  id: string
  principal: string
  kind: string
  payload: string | null
  readAt: string | null
  createdAt: string
}

/**
 * Inbox endpoint — proxies to person-mcp.list_notifications via the user's
 * delegation token (A2A `/mcp/person/list_notifications`). Reshapes the
 * MCP rows into the legacy `messages` JSON the UI expects.
 */
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { notifications = [] } = await callMcp<{ notifications: NotificationRow[] }>(
      'person', 'list_notifications', { includeRead: true },
    )
    const messages = notifications.map(n => {
      let parsed: { title?: string; body?: string; link?: string } = {}
      try { parsed = n.payload ? JSON.parse(n.payload) : {} } catch { /* ignore */ }
      return {
        id: n.id,
        userId: session.userId,
        type: n.kind,
        title: parsed.title ?? n.kind,
        body: parsed.body ?? '',
        link: parsed.link ?? null,
        read: n.readAt ? 1 : 0,
        createdAt: n.createdAt,
      }
    })
    const unread = messages.filter(m => m.read === 0).length
    return NextResponse.json({ messages, unread })
  } catch (err) {
    if (err instanceof McpCallError && err.status === 401) {
      // No A2A session yet — return empty inbox rather than 401.
      return NextResponse.json({ messages: [], unread: 0 })
    }
    return NextResponse.json({ messages: [], unread: 0 })
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'Messages moved to person-mcp / org-mcp. Use /mcp/:server/create_notification.' },
    { status: 410 },
  )
}
