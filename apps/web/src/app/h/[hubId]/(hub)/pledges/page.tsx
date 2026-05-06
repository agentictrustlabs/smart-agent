/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pledges management (US5).
 *
 * Server component. "Your pledges" view listing the viewer's pledges
 * grouped by status. State-aware affordances:
 *   - amend (active only)
 *   - stop (active or waitlisted)
 *   - view (all statuses)
 *
 * Implements FR-018 (your pledges view) + FR-019 (amend) + FR-020 (stop).
 */

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { listMemberPledges } from '@/lib/actions/poolPledges.action'
import { cadenceAwareTotal } from '@smart-agent/sdk'
import type { PoolPledge, PledgeStatus } from '@smart-agent/sdk'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  active: '#0f766e',
  waitlisted: '#a16207',
  stopped: '#6b7280',
  fulfilled: '#3b82f6',
}

const STATUS_LABEL: Record<PledgeStatus, string> = {
  active: 'Active',
  waitlisted: 'Waitlisted',
  stopped: 'Stopped',
  'auto-stopped': 'Auto-stopped',
  fulfilled: 'Fulfilled',
}

const STATUS_COLOR: Record<PledgeStatus, string> = {
  active: C.active,
  waitlisted: C.waitlisted,
  stopped: C.stopped,
  'auto-stopped': C.stopped,
  fulfilled: C.fulfilled,
}

function groupByStatus(pledges: PoolPledge[]): Record<PledgeStatus, PoolPledge[]> {
  const groups: Record<PledgeStatus, PoolPledge[]> = {
    active: [],
    waitlisted: [],
    stopped: [],
    'auto-stopped': [],
    fulfilled: [],
  }
  for (const p of pledges) {
    groups[p.status].push(p)
  }
  return groups
}

export default async function PledgesPage({
  params,
}: {
  params: Promise<{ hubId: string }>
}) {
  const { hubId: slug } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text }}>Sign-in required</h2>
        <p style={{ color: C.textMuted }}>You need a person agent to view your pledges.</p>
      </div>
    )
  }

  const { pledges } = await listMemberPledges()
  const groups = groupByStatus(pledges)
  const totalCount = pledges.length

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Pledges
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          Your pledges {totalCount > 0 && <span style={{ color: C.textMuted, fontSize: '0.95rem', fontWeight: 500 }}>({totalCount})</span>}
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          Active recurring pledges, one-time pledges, and history. Stopping a
          recurring pledge cancels future obligations; already-allocated capacity
          is not recalled.
        </p>
      </div>

      {totalCount === 0 ? (
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '1.5rem 1.25rem',
          textAlign: 'center',
        }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>No pledges yet</h2>
          <p style={{ fontSize: '0.85rem', color: C.textMuted, marginBottom: '0.85rem' }}>
            Browse open pools and pledge into one to see it here.
          </p>
          <Link
            href={`/h/${slug}/pools`}
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
            Browse pools
          </Link>
        </div>
      ) : (
        <>
          <Group title="Active" pledges={groups.active} hubSlug={slug} />
          <Group title="Waitlisted" pledges={groups.waitlisted} hubSlug={slug} />
          <Group title="Stopped" pledges={[...groups.stopped, ...groups['auto-stopped']]} hubSlug={slug} />
          <Group title="Fulfilled" pledges={groups.fulfilled} hubSlug={slug} />
        </>
      )}
    </div>
  )
}

function Group({
  title,
  pledges,
  hubSlug,
}: {
  title: string
  pledges: PoolPledge[]
  hubSlug: string
}) {
  if (pledges.length === 0) return null
  return (
    <section style={{ marginBottom: '1.25rem' }}>
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.5rem' }}>
        {title} ({pledges.length})
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {pledges.map((p) => (
          <PledgeRow key={p.id} pledge={p} hubSlug={hubSlug} />
        ))}
      </div>
    </section>
  )
}

function PledgeRow({ pledge, hubSlug }: { pledge: PoolPledge; hubSlug: string }) {
  const total = cadenceAwareTotal(pledge)
  return (
    <Link
      href={`/h/${hubSlug}/pledges/${encodeURIComponent(pledge.id)}`}
      style={{
        display: 'block',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '0.7rem 0.85rem',
        textDecoration: 'none',
        color: C.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '0.12rem 0.5rem',
          borderRadius: 999,
          background: STATUS_COLOR[pledge.status] + '15',
          color: STATUS_COLOR[pledge.status],
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {STATUS_LABEL[pledge.status]}
        </span>
        <span style={{
          fontSize: '0.6rem',
          fontWeight: 700,
          padding: '0.12rem 0.5rem',
          borderRadius: 999,
          background: '#fafaf6',
          color: C.textMuted,
          border: `1px solid ${C.border}`,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {pledge.cadence}
        </span>
        {pledge.history.length > 0 && (
          <span style={{ fontSize: '0.7rem', color: C.textMuted }}>
            {pledge.history.length} amendment{pledge.history.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: C.text, marginBottom: '0.15rem' }}>
        {pledge.amount} {pledge.unit}
        {pledge.cadence !== 'one-time' && pledge.duration ? (
          <> · {pledge.duration} {pledge.cadence === 'monthly' ? 'months' : 'years'}</>
        ) : null}
      </div>
      <div style={{ fontSize: '0.72rem', color: C.textMuted, display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span>Total: {total} {pledge.unit}</span>
        <span>Pledged {pledge.pledgedAt.slice(0, 10)}</span>
        {pledge.stoppedAt && <span>Stopped {pledge.stoppedAt.slice(0, 10)}</span>}
      </div>
    </Link>
  )
}
