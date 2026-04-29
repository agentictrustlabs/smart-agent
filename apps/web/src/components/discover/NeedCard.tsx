import Link from 'next/link'
import type { NeedRow } from '@/lib/actions/needs.action'

const C = {
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
}

const PRIORITY_COLORS: Record<NeedRow['priority'], { bg: string; fg: string; label: string }> = {
  critical: { bg: '#fee2e2', fg: '#991b1b', label: 'Critical' },
  high:     { bg: '#fef3c7', fg: '#92400e', label: 'High' },
  normal:   { bg: '#e0e7ff', fg: '#3730a3', label: 'Normal' },
  low:      { bg: '#ede9fe', fg: '#5b21b6', label: 'Low' },
}

const STATUS_COLORS: Record<NeedRow['status'], { bg: string; fg: string }> = {
  'open':        { bg: '#dcfce7', fg: '#166534' },
  'in-progress': { bg: '#fef3c7', fg: '#92400e' },
  'met':         { bg: '#e2e8f0', fg: '#475569' },
  'cancelled':   { bg: '#f3f4f6', fg: '#6b7280' },
  'expired':     { bg: '#f3f4f6', fg: '#6b7280' },
}

export function NeedCard({ need, hubSlug, matchCount }: { need: NeedRow; hubSlug: string; matchCount?: number }) {
  const pri = PRIORITY_COLORS[need.priority]
  const st = STATUS_COLORS[need.status]
  return (
    <Link
      href={`/h/${hubSlug}/needs/${need.id}`}
      style={{
        display: 'block',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.85rem 1rem',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999, background: pri.bg, color: pri.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {pri.label}
          </span>
          <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '0.15rem 0.5rem', borderRadius: 999, background: st.bg, color: st.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {need.status}
          </span>
        </div>
        {matchCount !== undefined && (
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: matchCount > 0 ? C.accent : C.textMuted }}>
            {matchCount > 0 ? `${matchCount} match${matchCount === 1 ? '' : 'es'}` : 'no matches yet'}
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: C.text, marginBottom: '0.25rem' }}>{need.title}</div>
      <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
        {need.needTypeLabel}
        {need.requirements?.geo && (<> · <span style={{ color: C.accent }}>{need.requirements.geo.split('/').slice(-1)[0]}</span></>)}
      </div>
      {need.detail && (
        <div style={{ fontSize: '0.78rem', color: C.text, marginTop: '0.4rem', lineHeight: 1.4 }}>{need.detail}</div>
      )}
    </Link>
  )
}
