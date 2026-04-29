import Link from 'next/link'

/**
 * `<CatalystFieldZone>` — 2-col field strip on the catalyst home: recent
 * activities (left) + my circles list (right). Pure server render — both
 * data sources are passed in by the dashboard so this never refetches.
 *
 * The full `<ActivityFeed>` component is interactive (a "Log Activity"
 * FAB, filters, type chips). This zone only wants the *recent items*
 * preview; the "+ Log Activity" hero CTA lives in the footer strip
 * (`<CatalystFooterCTA>`) which keeps the home calm and predictable.
 */

const C = {
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
  accentBorder: 'rgba(139,94,60,0.20)',
}

const ACTIVITY_ICON: Record<string, string> = {
  outreach: '🚶',
  visit: '🏠',
  training: '📖',
  meeting: '🤝',
  coaching: '🎯',
  'follow-up': '📞',
  prayer: '🙏',
  service: '❤️',
  assessment: '📊',
  other: '📝',
}

interface FieldActivity {
  id: string
  activityType: string
  title: string
  activityDate: string
  orgAddress: string
}

interface FieldCircle {
  address: string
  name: string
  role: string
}

interface Props {
  activities: FieldActivity[]
  myCircles: FieldCircle[]
  firstOrgAddr: string | null
}

export function CatalystFieldZone({ activities, myCircles }: Props) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: '0.75rem',
        marginBottom: '1rem',
      }}
      className="catalyst-field-grid"
    >
      {/* ─── Recent Activity ──────────────────────────────────────── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '0.85rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Recent activity</h2>
          <Link href="/activity" style={{ fontSize: '0.7rem', color: C.accent, textDecoration: 'none', fontWeight: 600 }}>View all →</Link>
        </div>
        {activities.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: C.textMuted, padding: '0.85rem 0' }}>
            No activities logged yet — use the &quot;+ Log activity&quot; button below to record your first one.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {activities.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.4rem 0.5rem', background: '#fafaf6', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.82rem' }}>
                <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>{ACTIVITY_ICON[a.activityType] ?? '📝'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                  <div style={{ fontSize: '0.7rem', color: C.textMuted, textTransform: 'capitalize' }}>{a.activityType}</div>
                </div>
                <span style={{ fontSize: '0.7rem', color: C.textMuted, flexShrink: 0 }}>{relativeDate(a.activityDate)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── My Circles ───────────────────────────────────────────── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '0.85rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>My circles</h2>
          <Link href="/groups" style={{ fontSize: '0.7rem', color: C.accent, textDecoration: 'none', fontWeight: 600 }}>Map view →</Link>
        </div>
        {myCircles.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: C.textMuted, padding: '0.85rem 0' }}>
            You&apos;re not in any circle yet.{' '}
            <Link href="/groups" style={{ color: C.accent, fontWeight: 600 }}>Find a circle →</Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {myCircles.slice(0, 6).map(c => (
              <Link
                key={c.address}
                href={`/agents/${c.address}`}
                style={{ textDecoration: 'none' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.4rem 0.55rem', background: '#fafaf6', border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 7, background: C.accentLight, color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.7rem', flexShrink: 0 }}>
                    {c.name.charAt(0)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.text, fontWeight: 600, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: '0.65rem', color: C.textMuted, textTransform: 'capitalize' }}>{c.role}</div>
                  </div>
                </div>
              </Link>
            ))}
            {myCircles.length > 6 && (
              <Link href="/groups" style={{ fontSize: '0.72rem', color: C.accent, textDecoration: 'none', fontWeight: 600, padding: '0.25rem 0' }}>
                +{myCircles.length - 6} more →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}
