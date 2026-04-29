import Link from 'next/link'
import { and, desc, eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getCurrentUser } from '@/lib/auth/get-current-user'

/**
 * `<PendingTriagePanel>` — Dispatcher / Route mode panel showing
 * incoming items waiting for the caller to look at and route:
 *
 *   • unread actionable messages (relationship_proposed, ownership_offered,
 *     review_received, invite_sent, …) with the latest three previewed,
 *   • pending invites the caller created that nobody has accepted yet.
 *
 * The full-fidelity view stays in /activity and the Work Queue panel —
 * this is the dashboard-level glance that lets a Dispatcher see "is
 * anything stuck waiting on me?" without scrolling.
 */

const ACTIONABLE_TYPES = [
  'relationship_proposed',
  'ownership_offered',
  'review_received',
  'dispute_filed',
  'proposal_created',
  'invite_sent',
] as const

export async function PendingTriagePanel() {
  const me = await getCurrentUser()
  if (!me) return null

  const [unread, openInvites] = await Promise.all([
    db.select().from(schema.messages)
      .where(and(
        eq(schema.messages.userId, me.id),
        eq(schema.messages.read, 0),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(20),
    db.select().from(schema.invites)
      .where(and(
        eq(schema.invites.createdBy, me.id),
        eq(schema.invites.status, 'pending'),
      ))
      .orderBy(desc(schema.invites.createdAt))
      .limit(10),
  ])

  const actionable = unread.filter(m =>
    (ACTIONABLE_TYPES as readonly string[]).includes(m.type),
  )

  if (actionable.length === 0 && openInvites.length === 0) {
    return (
      <section
        data-testid="pending-triage-panel"
        style={{
          background: '#fff', border: '1px dashed #ece6db',
          borderRadius: 12, padding: '0.85rem 1rem',
          marginBottom: '1rem',
          fontSize: 12, color: '#94a3b8',
        }}
      >
        Nothing waiting on you — your incoming queue is clear.
      </section>
    )
  }

  return (
    <section
      data-testid="pending-triage-panel"
      style={{
        background: '#fff', border: '1px solid #ece6db', borderRadius: 12,
        padding: '1rem 1.1rem', marginBottom: '1rem',
      }}
    >
      <header style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Incoming queue</h2>
        <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
          What&apos;s waiting on you to triage or route.
        </p>
      </header>

      {actionable.length > 0 && (
        <div data-testid="triage-messages" style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>
            Action-required messages · {actionable.length}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {actionable.slice(0, 3).map(m => (
              <li key={m.id}>
                <Link
                  href={m.link ?? '/activity'}
                  data-testid={`triage-message-${m.id}`}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 8,
                    textDecoration: 'none', color: 'inherit',
                    padding: '0.4rem 0.55rem', borderRadius: 8,
                    background: '#fdf6ee',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0 }}>{m.title}</span>
                  <span style={{ fontSize: 11, color: '#8b5e3c' }}>{m.type.replace(/_/g, ' ')}</span>
                </Link>
              </li>
            ))}
          </ul>
          {actionable.length > 3 && (
            <Link
              href="/activity"
              style={{ fontSize: 12, color: '#3f6ee8', display: 'inline-block', marginTop: 4 }}
            >
              See all {actionable.length} →
            </Link>
          )}
        </div>
      )}

      {openInvites.length > 0 && (
        <div data-testid="triage-invites" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>
            Invites you sent · awaiting acceptance · {openInvites.length}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {openInvites.slice(0, 3).map(inv => (
              <li
                key={inv.id}
                data-testid={`triage-invite-${inv.id}`}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '0.4rem 0.55rem', borderRadius: 8,
                  background: '#fdf6ee',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{inv.agentName}</span>
                <span style={{ fontSize: 11, color: '#8b5e3c' }}>{inv.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
