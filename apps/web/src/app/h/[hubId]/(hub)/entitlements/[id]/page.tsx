import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getEntitlement } from '@/lib/actions/entitlements.action'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { CAPACITY_UNIT_LABEL, type CapacityUnit } from '@/lib/discover/capacity-defaults'
import { LogFulfillmentForEntitlementButton } from './LogFulfillmentForEntitlementButton'
import { EntitlementStatusActions } from './EntitlementStatusActions'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  card: '#ffffff', border: '#ece6db', accentLight: 'rgba(139,94,60,0.10)',
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

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  granted:    { bg: '#e0e7ff', fg: '#3730a3' },
  active:     { bg: '#dcfce7', fg: '#166534' },
  paused:     { bg: '#fef3c7', fg: '#92400e' },
  suspended:  { bg: '#fee2e2', fg: '#991b1b' },
  fulfilled:  { bg: '#dcfce7', fg: '#166534' },
  revoked:    { bg: '#f3f4f6', fg: '#6b7280' },
  expired:    { bg: '#f3f4f6', fg: '#6b7280' },
}

const ACTIVITY_ICON: Record<string, string> = {
  meeting: '🤝', visit: '🏠', training: '📖', outreach: '🚶',
  coaching: '🎯', 'follow-up': '📞', prayer: '🙏', service: '❤️',
  assessment: '📊', other: '📝',
}

export default async function EntitlementDetailPage({ params }: {
  params: Promise<{ hubId: string; id: string }>
}) {
  const { hubId: slug, id } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const detail = await getEntitlement(id)
  if (!detail) notFound()
  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  const myLower = myAgent?.toLowerCase() ?? null

  const role = myLower === detail.holderAgent ? 'holder'
    : myLower === detail.providerAgent ? 'provider'
    : 'observer'
  const counterAgent = role === 'holder' ? detail.providerAgent
    : role === 'provider' ? detail.holderAgent
    : detail.holderAgent
  const counterMeta = await getAgentMetadata(counterAgent as `0x${string}`).catch(() => null)
  const counterName = counterMeta?.displayName ?? `${counterAgent.slice(0, 6)}…${counterAgent.slice(-4)}`

  const status = STATUS_COLORS[detail.status] ?? STATUS_COLORS.granted
  const icon = TYPE_ICON[detail.terms.object] ?? '📦'
  const unitLabel = CAPACITY_UNIT_LABEL[detail.capacityUnit as CapacityUnit] ?? ''
  const pct = detail.capacityGranted > 0
    ? Math.round((detail.capacityRemaining / detail.capacityGranted) * 100)
    : 0
  const consumedPct = 100 - pct

  const openItems = detail.workItems.filter(w => w.status === 'open' || w.status === 'in-progress')
  const doneItems = detail.workItems.filter(w => w.status === 'done')

  // Look up the parent intent for the link to its detail.
  const { db, schema } = await import('@/db')
  const { eq } = await import('drizzle-orm')
  const holderIntentRow = db.select().from(schema.intents)
    .where(eq(schema.intents.id, detail.holderIntentId)).get()
  const outcomeRow = detail.linkedOutcomeId
    ? db.select().from(schema.outcomes).where(eq(schema.outcomes.id, detail.linkedOutcomeId)).get()
    : null
  const outcomeMetric = outcomeRow ? safeJsonParse<{ kind: string; target?: unknown; observed?: unknown }>(outcomeRow.metric) : null

  // First user-org address — needed by QuickActivityModal as the activity scope.
  const { getUserOrgs } = await import('@/lib/get-user-orgs')
  const userOrgs = await getUserOrgs(user.id)
  const firstOrgAddr = userOrgs[0]?.address ?? null

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* Hero / header card */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Engagement
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.4rem' }}>{icon}</span>
          {detail.terms.topic ?? detail.terms.scope ?? detail.terms.object.split(':').pop()}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: 999, background: status.bg, color: status.fg, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {detail.status}
          </span>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: 999, background: '#fafaf6', color: C.text, border: `1px solid ${C.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {role === 'holder' ? '📥 you receive' : role === 'provider' ? '📤 you provide' : '👁️ observing'}
          </span>
          <span style={{ fontSize: '0.78rem', color: C.textMuted }}>
            with <Link href={`/agents/${counterAgent}`} style={{ color: C.accent }}>{counterName}</Link>
          </span>
          {holderIntentRow && (
            <span style={{ fontSize: '0.78rem', color: C.textMuted }}>
              · from <Link href={`/h/${slug}/intents/${holderIntentRow.id}`} style={{ color: C.accent }}>parent intent</Link>
            </span>
          )}
        </div>
      </div>

      {/* Capacity + outcome row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.75rem', marginBottom: '1rem' }} className="catalyst-work-grid">
        {/* Capacity */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
            Capacity
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: C.accent }}>
            {detail.capacityRemaining}
            <span style={{ fontSize: '0.85rem', color: C.textMuted, fontWeight: 600 }}>{unitLabel ? ` ${unitLabel}` : ''} remaining</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: C.textMuted, marginTop: '0.25rem' }}>
            of {detail.capacityGranted}{unitLabel ? ` ${unitLabel}` : ''} granted · {detail.cadence} cadence
          </div>
          <div style={{ height: 8, background: '#fafaf6', borderRadius: 999, marginTop: '0.6rem', overflow: 'hidden' }}>
            <div style={{ width: `${consumedPct}%`, height: '100%', background: consumedPct < 50 ? '#10b981' : consumedPct < 80 ? '#f59e0b' : '#ef4444' }} />
          </div>
          <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.3rem' }}>
            {consumedPct}% consumed
          </div>
        </div>

        {/* Outcome */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
            Expected outcome
          </div>
          {outcomeRow ? (
            <>
              <div style={{ fontSize: '0.92rem', color: C.text, fontWeight: 600 }}>{outcomeRow.description}</div>
              <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.3rem' }}>
                {outcomeMetric ? <>Metric: {outcomeMetric.kind}{outcomeMetric.target !== undefined && <> · target: {String(outcomeMetric.target)}</>}</> : 'No metric defined'}
                <span style={{ marginLeft: '0.5rem', padding: '0.1rem 0.45rem', borderRadius: 999, background: '#fafaf6', border: `1px solid ${C.border}` }}>
                  {outcomeRow.status}
                </span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>
              No explicit outcome — capacity reaching zero will mark this entitlement fulfilled.
            </div>
          )}
        </div>
      </div>

      {/* Work items */}
      <section style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Work items ({openItems.length} open · {doneItems.length} done)
          </h2>
          {(role === 'holder' || role === 'provider') && firstOrgAddr && detail.status !== 'fulfilled' && detail.status !== 'revoked' && detail.status !== 'expired' && (
            <LogFulfillmentForEntitlementButton
              entitlementId={detail.id}
              entitlementTitle={detail.terms.topic ?? 'this engagement'}
              orgAddress={firstOrgAddr}
              hubId={internalHubId}
            />
          )}
        </div>
        {openItems.length === 0 && doneItems.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: C.textMuted, padding: '0.8rem 1rem', background: C.card, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            No work items yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {openItems.map(w => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.55rem 0.85rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {w.taskKind.split(':').pop()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text }}>{w.title}</div>
                  {w.detail && <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>{w.detail}</div>}
                </div>
                <span style={{ fontSize: '0.7rem', color: C.textMuted, flexShrink: 0 }}>
                  {w.dueAt ? `due ${new Date(w.dueAt).toLocaleDateString()}` : 'no date'}
                </span>
              </div>
            ))}
            {doneItems.length > 0 && (
              <details style={{ marginTop: '0.4rem' }}>
                <summary style={{ fontSize: '0.72rem', color: C.textMuted, cursor: 'pointer' }}>{doneItems.length} resolved item{doneItems.length === 1 ? '' : 's'}</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.4rem' }}>
                  {doneItems.map(w => (
                    <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.65rem', background: '#fafaf6', border: `1px solid ${C.border}`, borderRadius: 8, opacity: 0.75 }}>
                      <span style={{ fontSize: '0.7rem' }}>✓</span>
                      <span style={{ fontSize: '0.78rem', color: C.text, textDecoration: 'line-through' }}>{w.title}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* Activity feed */}
      <section style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
          Fulfillment activity ({detail.recentActivities.length})
        </h2>
        {detail.recentActivities.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: C.textMuted, padding: '0.8rem 1rem', background: C.card, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            No activity logged against this entitlement yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {detail.recentActivities.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.4rem 0.6rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.82rem' }}>
                <span style={{ fontSize: '0.95rem' }}>{ACTIVITY_ICON[a.activityType] ?? '📝'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.text, fontWeight: 600 }}>{a.title}</div>
                  <div style={{ fontSize: '0.7rem', color: C.textMuted, textTransform: 'capitalize' }}>{a.activityType}</div>
                </div>
                <span style={{ fontSize: '0.7rem', color: C.textMuted, flexShrink: 0 }}>{a.activityDate}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Status actions (holder / provider only) */}
      {(role === 'holder' || role === 'provider') && (
        <EntitlementStatusActions entitlementId={detail.id} status={detail.status} />
      )}
    </div>
  )
}

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}
