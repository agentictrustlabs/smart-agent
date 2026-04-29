import Link from 'next/link'
import { listMyEntitlements } from '@/lib/actions/entitlements.action'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { CAPACITY_UNIT_LABEL, type CapacityUnit } from '@/lib/discover/capacity-defaults'
import { db, schema } from '@/db'
import { and, eq, inArray } from 'drizzle-orm'

const C = {
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  bandBg: 'rgba(139,94,60,0.05)',
  bandBorder: 'rgba(139,94,60,0.20)',
  bandFg: '#8b5e3c',
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

/**
 * `<ActiveFulfillmentsStrip>` — the third primary band on the catalyst
 * home, between the work zone and the field zone. Visually distinct from
 * "On your plate" (amber, personal triage) and "Open intents" (teal,
 * marketplace) — uses the warmer brown band that anchors the catalyst
 * palette so it reads as "your committed work."
 *
 * Per the marketplace-lifecycle alignment, what we previously called an
 * "Entitlement" / "fulfillment" is more correctly an **Engagement** in
 * user-facing copy — the operational projection of an ExchangeAgreement +
 * ClaimRight + FulfillmentCase. Routes stay stable (`/entitlements/*`);
 * only the headings, strip title, and inline language change.
 *
 * Hidden when the user has no live engagements.
 */
export async function ActiveFulfillmentsStrip({ userId, hubSlug }: {
  userId: string
  hubSlug: string
}) {
  const myAgent = await getPersonAgentForUser(userId)
  if (!myAgent) return null

  const ents = await listMyEntitlements({
    status: ['granted', 'active', 'paused'],
    limit: 10,
  })
  if (ents.length === 0) return null

  // Per-entitlement: oldest open work item assigned to ME or to my
  // counterparty (we surface anything I should look at).
  const entIds = ents.map(e => e.id)
  const openWorkItems = entIds.length > 0 ? db.select().from(schema.fulfillmentWorkItems)
    .where(and(
      inArray(schema.fulfillmentWorkItems.entitlementId, entIds),
      eq(schema.fulfillmentWorkItems.status, 'open'),
    ))
    .all() : []
  const nextItemFor = new Map<string, typeof openWorkItems[number]>()
  for (const w of openWorkItems) {
    const existing = nextItemFor.get(w.entitlementId)
    if (!existing || w.createdAt < existing.createdAt) {
      nextItemFor.set(w.entitlementId, w)
    }
  }

  const myAgentLower = myAgent.toLowerCase()
  const myActionCount = openWorkItems.filter(w => w.assigneeAgent === myAgentLower).length

  // Top 3 by recency.
  const top = ents.slice(0, 3)

  return (
    <div
      style={{
        background: C.bandBg,
        border: `1px solid ${C.bandBorder}`,
        borderRadius: 12,
        padding: '0.85rem 1rem',
        marginBottom: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '0.6rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.bandFg, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
              Active engagements
            </h2>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: C.bandFg }}>{ents.length}</span>
            {myActionCount > 0 && (
              <span style={{ fontSize: '0.7rem', color: C.textMuted }}>
                · {myActionCount} need{myActionCount === 1 ? 's' : ''} your action
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
            Reciprocal commitments you&apos;re receiving or providing — the marketplace turned into work
          </div>
        </div>
        <Link
          href={`/h/${hubSlug}/entitlements`}
          style={{
            flexShrink: 0,
            fontSize: '0.7rem',
            color: '#fff',
            background: C.bandFg,
            textDecoration: 'none',
            fontWeight: 600,
            padding: '0.3rem 0.7rem',
            borderRadius: 999,
          }}
        >
          All →
        </Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {top.map(e => {
          const role = e.holderAgent === myAgentLower ? 'holder' : 'provider'
          const icon = TYPE_ICON[e.terms.object] ?? '📦'
          const unitLabel = CAPACITY_UNIT_LABEL[e.capacityUnit as CapacityUnit] ?? ''
          const next = nextItemFor.get(e.id)
          const nextIsMine = next?.assigneeAgent === myAgentLower
          return (
            <Link
              key={e.id}
              href={`/h/${hubSlug}/entitlements/${e.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.55rem 0.7rem',
                background: '#fff',
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              <span style={{ fontSize: '1.05rem', flexShrink: 0 }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {role === 'holder' ? 'Receiving: ' : 'Providing: '}
                  {e.terms.topic ?? e.terms.scope ?? e.terms.object.split(':').pop()}
                </div>
                <div style={{ fontSize: '0.7rem', color: C.textMuted }}>
                  {e.capacityRemaining}/{e.capacityGranted}{unitLabel ? ` ${unitLabel}` : ''} · {e.cadence} · {e.status}
                  {next && (
                    <> · next: <span style={{ color: nextIsMine ? '#92400e' : C.textMuted, fontWeight: nextIsMine ? 700 : 400 }}>
                      {next.title}
                    </span></>
                  )}
                </div>
              </div>
              {nextIsMine && (
                <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.15rem 0.4rem', borderRadius: 999, background: '#fef3c7', color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
                  Your move
                </span>
              )}
            </Link>
          )
        })}
        {ents.length > 3 && (
          <Link href={`/h/${hubSlug}/entitlements`} style={{ fontSize: '0.72rem', color: C.bandFg, textDecoration: 'none', fontWeight: 600, padding: '0.2rem 0.4rem' }}>
            +{ents.length - 3} more →
          </Link>
        )}
      </div>
    </div>
  )
}
