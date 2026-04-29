import Link from 'next/link'
import type { MatchRow as MatchRowType } from '@/lib/actions/discover.action'

const C = {
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
}

function scoreBg(score: number): { bg: string; fg: string; label: string } {
  if (score >= 8000) return { bg: '#dcfce7', fg: '#166534', label: 'Strong fit' }
  if (score >= 6000) return { bg: '#dbeafe', fg: '#1d4ed8', label: 'Good fit' }
  if (score >= 4000) return { bg: '#fef3c7', fg: '#92400e', label: 'Partial fit' }
  return { bg: '#f3f4f6', fg: '#6b7280', label: 'Weak fit' }
}

const STATUS_LABEL: Record<MatchRowType['status'], string> = {
  proposed:  'Proposed',
  accepted:  'Accepted',
  rejected:  'Rejected',
  stale:     'Stale',
  fulfilled: 'Fulfilled',
}

export function MatchRowCard({ match, hubSlug, showNeed = false }: { match: MatchRowType; hubSlug: string; showNeed?: boolean }) {
  const sc = scoreBg(match.score)
  return (
    <Link
      href={`/h/${hubSlug}/matches/${match.id}`}
      style={{
        display: 'block',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '0.7rem 0.85rem',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: 999, background: sc.bg, color: sc.fg, minWidth: 56, textAlign: 'center' }}>
          {match.scorePct}%
        </span>
        <span style={{ fontSize: '0.65rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{sc.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {STATUS_LABEL[match.status]}
        </span>
      </div>
      {showNeed && match.need && (
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: C.text, marginBottom: '0.2rem' }}>{match.need.title}</div>
      )}
      <div style={{ fontSize: '0.78rem', color: C.text, fontWeight: 600 }}>
        {match.offering?.title ?? 'Offering'}
      </div>
      <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.15rem' }}>
        {match.offering?.resourceTypeLabel}
        {match.satisfies.length > 0 && (
          <> · satisfies {match.satisfies.join(', ')}</>
        )}
        {match.misses.length > 0 && (
          <> · missing {match.misses.join(', ')}</>
        )}
      </div>
    </Link>
  )
}
