import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getOikosContacts } from '@/lib/actions/oikos.action'

/**
 * `<MyOikosSnapshotPanel>` — Multiplier mode panel showing the top
 * five oikos contacts by proximity (closest ring first), with their
 * spiritual response state and a "planned conversation" badge.
 *
 * The full oikos surface is at /oikos; this is just the at-a-glance
 * version that lives on Home so a Multiplier never has to leave their
 * dashboard to remember who they're praying for.
 */

const RESPONSE_LABEL: Record<string, string> = {
  'not-interested': 'Not interested',
  curious: 'Curious',
  interested: 'Interested',
  seeking: 'Seeking',
  decided: 'Decided',
  baptized: 'Baptized',
}

const PROXIMITY_LABEL: Record<number, string> = {
  1: 'Closest',
  2: 'Near',
  3: 'Acquaintance',
  4: 'Outer',
}

export async function MyOikosSnapshotPanel() {
  const me = await getCurrentUser()
  if (!me) return null

  const all = await getOikosContacts(me.id)
  const top = [...all]
    .sort((a, b) => a.proximity - b.proximity || a.personName.localeCompare(b.personName))
    .slice(0, 5)

  if (top.length === 0) {
    return (
      <section
        data-testid="my-oikos-snapshot"
        style={{
          background: '#fff', border: '1px dashed #ece6db',
          borderRadius: 12, padding: '0.85rem 1rem',
          marginBottom: '1rem',
          fontSize: 12, color: '#94a3b8',
        }}
      >
        Add a few people to your <Link href="/oikos" style={{ color: '#3f6ee8' }}>oikos</Link> to see them here.
      </section>
    )
  }

  return (
    <section
      data-testid="my-oikos-snapshot"
      style={{
        background: '#fff', border: '1px solid #ece6db', borderRadius: 12,
        padding: '1rem 1.1rem', marginBottom: '1rem',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Oikos at a glance</h2>
          <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
            Closest five. Open <Link href="/oikos" style={{ color: '#3f6ee8' }}>My People</Link> for the full list.
          </p>
        </div>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{all.length} total</span>
      </header>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {top.map(c => (
          <li
            key={c.id}
            data-testid={`oikos-row-${c.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '0.4rem 0.55rem', borderRadius: 8,
              background: '#fdf6ee',
            }}
          >
            <span style={{
              flexShrink: 0,
              fontSize: 10, fontWeight: 700,
              padding: '0.15rem 0.5rem', borderRadius: 999,
              background: '#fff', border: '1px solid #ece6db', color: '#5c4a3a',
            }}>
              {PROXIMITY_LABEL[c.proximity] ?? `Ring ${c.proximity}`}
            </span>
            <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0 }}>{c.personName}</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {RESPONSE_LABEL[c.response] ?? c.response}
            </span>
            {c.plannedConversation === 1 && (
              <span style={{
                fontSize: 10, fontWeight: 700,
                padding: '0.1rem 0.45rem', borderRadius: 6,
                background: '#e8f5ee', color: '#1f6b3a',
                border: '1px solid #bfe0cc',
              }}>
                Planned
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
