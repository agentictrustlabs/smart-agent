import Link from 'next/link'
import type { EntitlementRow } from '@/lib/actions/entitlements.action'
import { CAPACITY_UNIT_LABEL, type CapacityUnit } from '@/lib/discover/capacity-defaults'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e',
  accent: '#8b5e3c',
}

const STATUS_COLORS: Record<EntitlementRow['status'], { bg: string; fg: string }> = {
  granted:    { bg: '#e0e7ff', fg: '#3730a3' },
  active:     { bg: '#dcfce7', fg: '#166534' },
  paused:     { bg: '#fef3c7', fg: '#92400e' },
  suspended:  { bg: '#fee2e2', fg: '#991b1b' },
  fulfilled:  { bg: '#dcfce7', fg: '#166534' },
  revoked:    { bg: '#f3f4f6', fg: '#6b7280' },
  expired:    { bg: '#f3f4f6', fg: '#6b7280' },
}

const TYPE_ICON: Record<string, string> = {
  'resourceType:Worker':       '👷',
  'resourceType:Skill':        '🎯',
  'resourceType:Money':        '💰',
  'resourceType:Prayer':       '🙏',
  'resourceType:Connector':    '🤝',
  'resourceType:Data':         '📊',
  'resourceType:Scripture':    '📖',
  'resourceType:Venue':        '🏠',
  'resourceType:Curriculum':   '📚',
  'resourceType:Church':       '⛪',
  'resourceType:Organization': '🏛️',
  'resourceType:Credential':   '🎓',
}

export function EntitlementCard({ entitlement, hubSlug, viewerAgent }: {
  entitlement: EntitlementRow
  hubSlug: string
  viewerAgent: string | null
}) {
  const status = STATUS_COLORS[entitlement.status]
  const role = viewerAgent
    ? entitlement.holderAgent === viewerAgent.toLowerCase() ? 'holder'
    : entitlement.providerAgent === viewerAgent.toLowerCase() ? 'provider'
    : 'observer'
    : 'observer'
  const icon = TYPE_ICON[entitlement.terms.object] ?? '📦'
  const unitLabel = CAPACITY_UNIT_LABEL[entitlement.capacityUnit as CapacityUnit] ?? ''
  const pct = entitlement.capacityGranted > 0
    ? Math.round((entitlement.capacityRemaining / entitlement.capacityGranted) * 100)
    : 0

  return (
    <Link
      href={`/h/${hubSlug}/entitlements/${entitlement.id}`}
      style={{
        display: 'block',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.85rem 1rem',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '1.1rem' }}>{icon}</span>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999, background: status.bg, color: status.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {entitlement.status}
        </span>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999, background: '#fafaf6', color: C.text, border: `1px solid ${C.border}`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {role === 'holder' ? '📥 you receive' : role === 'provider' ? '📤 you provide' : 'observing'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: C.textMuted, fontWeight: 600 }}>
          {entitlement.capacityRemaining}/{entitlement.capacityGranted}{unitLabel ? ` ${unitLabel}` : ''}
        </span>
      </div>
      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: C.text, marginBottom: '0.2rem' }}>
        {entitlement.terms.topic ?? entitlement.terms.scope ?? entitlement.terms.object.split(':').pop()}
      </div>
      <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
        {entitlement.cadence} · valid until {entitlement.validUntil ? new Date(entitlement.validUntil).toLocaleDateString() : 'open-ended'}
      </div>
      {/* Capacity bar */}
      <div style={{ height: 4, background: '#fafaf6', borderRadius: 999, marginTop: '0.45rem', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct > 50 ? '#10b981' : pct > 20 ? '#f59e0b' : '#ef4444' }} />
      </div>
    </Link>
  )
}
