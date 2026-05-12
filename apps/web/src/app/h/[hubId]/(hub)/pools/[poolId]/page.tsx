/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pool detail (US2).
 *
 * Server component. Implements FR-005 / FR-006 / FR-007:
 *   - Mandate block (narrative + accepted kinds)
 *   - Restriction-set block (accepted restrictions)
 *   - Capacity widgets (pledged / allocated / available — cadence-aware)
 *   - Recent allocations block (with storyPermissions-aware aggregation)
 *   - "Pledge to this pool" CTA
 *
 * Visibility:
 *   - Public pools render to anyone in the hub.
 *   - Private pools: getPoolForViewer returns null when the viewer is not
 *     in the addressedMembers list — page renders a friendly 403-style.
 */

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getPoolForViewer, getPoolRecentAllocations } from '@/lib/actions/pools.action'
import { listPoolPledges } from '@/lib/actions/poolPledges.action'
import { DiscoveryService } from '@smart-agent/discovery'
import { OrgTreasuryWidget } from '@/components/treasury/OrgTreasuryWidget'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  privateFg: '#991b1b',
  warnBg: 'rgba(217,119,6,0.08)',
  warnFg: '#92400e',
}

function formatAmount(n: number, unit = 'USD'): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (unit === 'USD') {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
    return `$${n}`
  }
  return `${n} ${unit}`
}

export default async function PoolDetailPage({
  params,
}: {
  params: Promise<{ hubId: string; poolId: string }>
}) {
  const { hubId: slug, poolId: rawPoolId } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return <NotAuthorizedSurface hubSlug={slug} reason="no-agent" />
  }

  const poolId = decodeURIComponent(rawPoolId)
  const { pool } = await getPoolForViewer(poolId, myAgent)
  if (!pool) {
    return <NotAuthorizedSurface hubSlug={slug} reason="not-found-or-private" />
  }

  const allocations = await getPoolRecentAllocations(poolId, myAgent, 5)
  const primaryUnit = pool.acceptedUnits[0] ?? 'USD'
  // Recent pledges — read from org-mcp via `pool_pledge:list_for_pool` (the
  // tool applies story_permissions before returning, so it's safe to
  // render on the public detail surface). The pledger field stored by
  // `pool_pledge:submit` is sometimes the pool's URN and sometimes its
  // treasury hex — try both forms so existing rows from either path
  // surface. Limit 10 keeps the section compact.
  const recentPledges = [
    ...await listPoolPledges(pool.id, 10),
    ...await listPoolPledges((pool.treasuryAddress ?? '').toLowerCase(), 10),
  ]
    .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i)
    .slice(0, 10)

  // Rounds operated by this pool's stewardship agent. We hit
  // DiscoveryService.listRounds directly instead of going through the
  // listRoundsForViewer action, because that action does an N+1
  // proposerSideSignals fetch per round (5 rounds × ~15s GraphDB query
  // = up to 75s page-render time). On the pool detail surface we just
  // need the round list — no ranking — so a single SPARQL call suffices.
  //
  // Wrapped in try/catch — a slow / 524-ing GraphDB shouldn't block the
  // whole pool detail page render. The "no rounds yet" empty state is
  // friendlier than a 500.
  let roundsForPool: Array<{ id: string; displayName?: string; fundAgentId: string; poolAgentId?: string; deadline: string; mandate: { acceptedKinds: string[] } }> = []
  try {
    const discovery = DiscoveryService.fromEnv()
    const allHubRounds = await discovery.listRounds({
      hubId: internalHubId,
      viewerAgentId: myAgent,
      includeClosed: true,
    })
    const poolAddr = (pool.treasuryAddress ?? '').toLowerCase()
    const stewardshipAddr = (pool.stewardshipAgent ?? '').toLowerCase()
    // Prefer the canonical sa:operatedByPool link (set on rounds opened
    // after the field existed). Fall back to the legacy inference
    // (round.fundAgentId === pool.stewardshipAgent) for rounds opened
    // before the field landed.
    roundsForPool = allHubRounds.filter(r => {
      const rPool = (r.poolAgentId ?? '').toLowerCase()
      if (rPool) return rPool === poolAddr
      return (r.fundAgentId ?? '').toLowerCase() === stewardshipAddr
    })
  } catch (err) {
    console.warn('[pool-detail] listRounds failed (showing empty state):', err instanceof Error ? err.message : err)
  }
  const ratio = pool.capacityCeiling && pool.capacityCeiling > 0
    ? Math.min(1, pool.pledgedTotal / pool.capacityCeiling)
    : 0
  const nearCeiling = ratio >= 0.9 && ratio < 1
  const reachedCeiling = ratio >= 1

  // Encode the pool id once for downstream pledge link.
  const safeId = encodeURIComponent(poolId)

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Pool
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          {pool.name || 'Unnamed pool'}
        </h1>
        <div style={{ fontSize: '0.78rem', color: C.textMuted, display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            {pool.domain}
          </span>
          <span>·</span>
          <span>{pool.governanceModel}</span>
          {pool.visibility === 'private' && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, color: C.privateFg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Private
            </span>
          )}
        </div>
      </div>

      {/* Mandate */}
      <Section title="What this pool funds">
        <div style={{ fontSize: '0.85rem', color: C.text, lineHeight: 1.5 }}>
          {pool.mandate || 'Open mandate'}
        </div>
      </Section>

      {/* Accepted restrictions */}
      <Section title="Accepted restrictions">
        {pool.acceptedRestrictions.kinds && pool.acceptedRestrictions.kinds.length > 0 && (
          <Row label="Kinds">
            {pool.acceptedRestrictions.kinds.join(', ')}
          </Row>
        )}
        {pool.acceptedRestrictions.geoRoots && pool.acceptedRestrictions.geoRoots.length > 0 && (
          <Row label="Geo">
            {pool.acceptedRestrictions.geoRoots.join(', ')}
          </Row>
        )}
        {pool.acceptedRestrictions.notForAdmin && (
          <Row label="Admin">
            <em>Pledges accept &quot;not for admin overhead&quot; restriction</em>
          </Row>
        )}
        {pool.acceptedRestrictions.notForDiscretionary && (
          <Row label="Discretionary">
            <em>Pledges accept &quot;not for discretionary&quot; restriction</em>
          </Row>
        )}
        {(!pool.acceptedRestrictions.kinds || pool.acceptedRestrictions.kinds.length === 0) &&
          (!pool.acceptedRestrictions.geoRoots || pool.acceptedRestrictions.geoRoots.length === 0) &&
          !pool.acceptedRestrictions.notForAdmin && !pool.acceptedRestrictions.notForDiscretionary && (
            <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>
              No restrictions declared — donors may pledge unrestricted.
            </div>
          )}
      </Section>

      {/* Accepted units */}
      <Section title="Accepted units">
        <div style={{ fontSize: '0.85rem', color: C.text }}>
          {pool.acceptedUnits.length === 0
            ? <em style={{ color: C.textMuted }}>No units declared.</em>
            : pool.acceptedUnits.join(', ')}
        </div>
      </Section>

      {/* On-chain USDC balance held by the pool's AgentAccount. Distinct
          from "Pledged total" — pledged is the sum of donor commitments
          (intentions), treasury balance is what's actually arrived via Rail A
          honoring + any direct transfers. */}
      {pool.treasuryAddress && (
        <OrgTreasuryWidget
          address={pool.treasuryAddress as `0x${string}`}
          label="Pool treasury (on-chain USDC)"
        />
      )}

      {/* Capacity widgets */}
      <Section title="Capacity">
        <Row label="Pledged">{formatAmount(pool.pledgedTotal, primaryUnit)}</Row>
        <Row label="Allocated">{formatAmount(pool.allocatedTotal, primaryUnit)}</Row>
        <Row label="Available">{formatAmount(pool.availableTotal, primaryUnit)}</Row>
        {pool.capacityCeiling && pool.capacityCeiling > 0 && (
          <Row label="Ceiling">
            {formatAmount(pool.capacityCeiling, primaryUnit)}{' '}
            <span style={{ color: C.textMuted }}>
              ({Math.round(ratio * 100)}% · policy: {pool.ceilingPolicy})
            </span>
          </Row>
        )}
        {nearCeiling && (
          <div style={{
            marginTop: '0.55rem',
            padding: '0.45rem 0.7rem',
            background: C.warnBg,
            color: C.warnFg,
            border: `1px solid ${C.warnBg}`,
            borderRadius: 8,
            fontSize: '0.78rem',
          }}>
            Near ceiling. Per the pool&rsquo;s <strong>{pool.ceilingPolicy}</strong> policy,
            new pledges may be {pool.ceilingPolicy === 'block' ? 'blocked' : pool.ceilingPolicy === 'waitlist' ? 'waitlisted' : 'accepted as overage'}.
          </div>
        )}
        {reachedCeiling && pool.ceilingPolicy === 'block' && (
          <div style={{
            marginTop: '0.55rem',
            padding: '0.45rem 0.7rem',
            background: '#f3f4f6',
            color: '#6b7280',
            borderRadius: 8,
            fontSize: '0.78rem',
          }}>
            Ceiling reached. New pledges are blocked by the pool&rsquo;s policy.
          </div>
        )}
      </Section>

      {/* Recent pledges — surfaces individual pledges that backed the pool's
          capacity. Story-permissions are applied server-side, so the
          principal label may be `anon:<prefix>…` for donors who opted to
          anonymize. */}
      <Section title={`Recent pledges (${recentPledges.length})`}>
        {recentPledges.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>
            No pledges yet — be the first to back this pool.
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.85rem', color: C.text }}>
            {recentPledges.map(p => {
              const principalShort = p.principalDisplay.startsWith('0x')
                ? `${p.principalDisplay.slice(0, 8)}…${p.principalDisplay.slice(-4)}`
                : p.principalDisplay
              return (
                <li key={p.id} style={{ marginBottom: '0.35rem' }}>
                  {formatAmount(p.amount, p.unit)} —{' '}
                  <span style={{ fontWeight: 600 }}>{principalShort}</span>
                  <span style={{ color: C.textMuted, marginLeft: '0.4rem' }}>· {p.cadence}</span>
                  {p.pledgedAt && (
                    <span style={{ color: C.textMuted, marginLeft: '0.4rem' }}>· {p.pledgedAt.slice(0, 10)}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {/* Recent allocations */}
      <Section title="Recent allocations">
        {allocations.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>
            No completed allocations yet — this pool is new or its stewards
            have not yet allocated capacity.
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.85rem', color: C.text }}>
            {allocations.map((a, i) => (
              <li key={i} style={{ marginBottom: '0.35rem' }}>
                {formatAmount(a.amount, a.unit)} —{' '}
                {typeof a.awardedTo === 'string'
                  ? (a.awardedTo === 'anonymized' ? 'anonymized recipient' : a.awardedTo)
                  : `${a.awardedTo.count} aggregated recipient${a.awardedTo.count === 1 ? '' : 's'}`}
                {a.outcomeStatus && (
                  <span style={{ color: C.textMuted, marginLeft: '0.4rem' }}>· {a.outcomeStatus}</span>
                )}
                {a.awardedAt && (
                  <span style={{ color: C.textMuted, marginLeft: '0.4rem' }}>· {a.awardedAt.slice(0, 10)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Rounds operated by this pool — surfaces the pool→round linkage so
          a steward can see what rounds draw from this pool's treasury and a
          proposer can see what they can apply against. */}
      <Section title={`Rounds operated by this pool (${roundsForPool.length})`}>
        {roundsForPool.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>
            No rounds yet — stewards open them via the rounds index.
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '0.6rem', listStyle: 'none' }}>
            {roundsForPool.map(r => {
              const slugId = r.id.replace(/^urn:smart-agent:round:/, '')
              const deadlineRel = r.deadline ? new Date(r.deadline).toISOString().slice(0, 10) : '—'
              return (
                <li key={r.id} style={{ marginBottom: '0.45rem' }}>
                  <Link
                    href={`/h/${slug}/rounds/${encodeURIComponent(slugId)}`}
                    style={{ color: C.accent, fontSize: '0.88rem', fontWeight: 600, textDecoration: 'none' }}
                  >
                    {r.displayName ?? slugId}
                  </Link>
                  <span style={{ fontSize: '0.75rem', color: C.textMuted, marginLeft: '0.5rem' }}>
                    deadline {deadlineRel}
                    {r.mandate.acceptedKinds?.length ? ` · ${r.mandate.acceptedKinds.slice(0, 3).join(', ')}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {/* Pledge CTA + steward affordances */}
      <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Link
          href={`/h/${slug}/pools/${safeId}/admin`}
          style={{ padding: '0.55rem 0.95rem', background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.82rem', fontWeight: 600, textDecoration: 'none' }}
        >
          Admin →
        </Link>
        {reachedCeiling && pool.ceilingPolicy === 'block' ? (
          <span style={{ fontSize: '0.85rem', color: C.textMuted, padding: '0.65rem 1.1rem', fontStyle: 'italic' }}>
            This pool is closed to new pledges (ceiling reached, block policy).
          </span>
        ) : (
          <Link
            href={`/h/${slug}/pools/${safeId}/pledge`}
            style={{
              padding: '0.65rem 1.1rem',
              background: C.accent,
              color: '#fff',
              borderRadius: 10,
              fontSize: '0.9rem',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Pledge to this pool →
          </Link>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.95rem 1rem',
        marginBottom: '0.85rem',
      }}
    >
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.85rem', marginBottom: '0.4rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
      <div style={{ flex: '0 0 130px', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: C.text }}>
        {children}
      </div>
    </div>
  )
}

function NotAuthorizedSurface({ hubSlug, reason }: { hubSlug: string; reason: 'no-agent' | 'not-found-or-private' }) {
  const title = reason === 'no-agent' ? 'Sign in required' : 'Pool not available'
  const body = reason === 'no-agent'
    ? 'This page needs a person agent.'
    : 'This pool either does not exist or is private and not addressed to you.'
  return (
    <div style={{ padding: '2rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>{title}</h2>
      <p style={{ fontSize: '0.85rem', color: C.textMuted, marginBottom: '0.85rem' }}>{body}</p>
      <Link
        href={`/h/${hubSlug}/pools`}
        style={{
          display: 'inline-block',
          padding: '0.5rem 0.9rem',
          background: C.accent,
          color: '#fff',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: '0.85rem',
          textDecoration: 'none',
        }}
      >
        Back to pools
      </Link>
    </div>
  )
}
