import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getMyMentoringRelationships, type MentoringRow } from '@/lib/people-graph/my-mentees'

/**
 * `<MyMenteesPanel>` — Multiplier / Coach mode panel showing the
 * caller's coaching graph. Two sections in one panel:
 *   • Disciples — people the caller is coaching
 *   • Coaches   — people the caller is being coached by
 *
 * Pure server component. Empty state stays compact so a Multiplier with
 * no edges still gets a non-empty home (the work-queue panel above it
 * carries the work).
 */

export async function MyMenteesPanel() {
  const me = await getCurrentUser()
  if (!me) return null
  const caller = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
  if (!caller) return <Empty reason="Finish onboarding to see your coaching graph." />

  let rows: MentoringRow[] = []
  try {
    rows = await getMyMentoringRelationships(caller)
  } catch {
    return <Empty reason="Couldn't load coaching edges." />
  }

  const disciples = rows.filter(r => r.relation === 'mentee')
  const coaches = rows.filter(r => r.relation === 'coach')

  if (rows.length === 0) {
    return <Empty reason="No coaching edges yet — once you accept a disciple or coach, they show up here." />
  }

  return (
    <section
      data-testid="my-mentees-panel"
      style={{
        background: '#fff',
        border: '1px solid #ece6db',
        borderRadius: 12,
        padding: '1rem 1.1rem',
        marginBottom: '1rem',
      }}
    >
      <header style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>People you&apos;re shepherding</h2>
        <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
          Direct coaching relationships from the on-chain graph.
        </p>
      </header>

      {disciples.length > 0 && (
        <Subsection
          label="Your disciples"
          testid="my-mentees-disciples"
          rows={disciples}
        />
      )}

      {coaches.length > 0 && (
        <Subsection
          label="Your coaches"
          testid="my-mentees-coaches"
          rows={coaches}
        />
      )}
    </section>
  )
}

function Subsection({ label, testid, rows }: { label: string; testid: string; rows: MentoringRow[] }) {
  return (
    <div data-testid={testid} style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 6 }}>
        {label} · {rows.length}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(r => (
          <li key={r.edgeId}>
            <Link
              href={`/agents/${r.address}`}
              data-testid={`mentees-row-${r.address.toLowerCase()}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                textDecoration: 'none', color: 'inherit',
                padding: '0.4rem 0.55rem', borderRadius: 8,
                background: '#fdf6ee',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>{r.displayName}</span>
              {r.primaryName && (
                <code style={{ fontSize: 11, color: '#8b5e3c' }}>{r.primaryName}</code>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Empty({ reason }: { reason: string }) {
  return (
    <section
      data-testid="my-mentees-panel"
      style={{
        background: '#fff', border: '1px dashed #ece6db',
        borderRadius: 12, padding: '0.85rem 1rem',
        marginBottom: '1rem',
        fontSize: 12, color: '#94a3b8',
      }}
    >
      {reason}
    </section>
  )
}
