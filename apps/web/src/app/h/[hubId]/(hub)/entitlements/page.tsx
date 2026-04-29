import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { listEntitlements, listMyEntitlements, type EntitlementRow } from '@/lib/actions/entitlements.action'
import { EntitlementCard } from '@/components/entitlements/EntitlementCard'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db' }

const STATUS_LABELS: Record<EntitlementRow['status'], string> = {
  granted:   'Granted — first activity hasn\'t been logged',
  active:    'Active — work in progress',
  paused:    'Paused',
  suspended: 'Suspended (under dispute)',
  fulfilled: 'Fulfilled',
  revoked:   'Revoked',
  expired:   'Expired',
}

export default async function EntitlementsIndexPage({ params, searchParams }: {
  params: Promise<{ hubId: string }>
  searchParams: Promise<{ scope?: string; status?: string }>
}) {
  const { hubId: slug } = await params
  const sp = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  const scope = sp.scope ?? 'mine'
  const statusFilter = sp.status as EntitlementRow['status'] | undefined

  const all = scope === 'hub'
    ? await listEntitlements({ hubId: internalHubId, status: statusFilter, limit: 100 })
    : await listMyEntitlements({ hubId: internalHubId, status: statusFilter, limit: 100 })

  // Per-status counts for the pills.
  const myAll = await listMyEntitlements({ hubId: internalHubId, limit: 200 })
  const counts: Record<string, number> = {
    all: myAll.length,
    granted:   myAll.filter(e => e.status === 'granted').length,
    active:    myAll.filter(e => e.status === 'active').length,
    paused:    myAll.filter(e => e.status === 'paused').length,
    fulfilled: myAll.filter(e => e.status === 'fulfilled').length,
    revoked:   myAll.filter(e => e.status === 'revoked').length,
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Engagements
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.3rem' }}>
          {scope === 'hub' ? 'Hub engagements' : 'My engagements'}
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: 0 }}>
          A reciprocal agreement created when a match is accepted — work proceeds here until the outcome is achieved.
        </p>
      </div>

      {/* Scope */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <Pill href={`/h/${slug}/entitlements`} active={scope === 'mine'}>Mine</Pill>
        <Pill href={`/h/${slug}/entitlements?scope=hub`} active={scope === 'hub'}>Whole hub</Pill>
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Pill href={`/h/${slug}/entitlements${scope === 'hub' ? '?scope=hub' : ''}`} active={!statusFilter} count={counts.all}>All</Pill>
        <Pill href={qs(slug, scope, 'granted')}    active={statusFilter === 'granted'}    count={counts.granted}>Granted</Pill>
        <Pill href={qs(slug, scope, 'active')}     active={statusFilter === 'active'}     count={counts.active}>Active</Pill>
        <Pill href={qs(slug, scope, 'paused')}     active={statusFilter === 'paused'}     count={counts.paused}>Paused</Pill>
        <Pill href={qs(slug, scope, 'fulfilled')}  active={statusFilter === 'fulfilled'}  count={counts.fulfilled}>Fulfilled</Pill>
        <Pill href={qs(slug, scope, 'revoked')}    active={statusFilter === 'revoked'}    count={counts.revoked}>Revoked</Pill>
      </div>

      {/* Status hint */}
      {statusFilter && (
        <div style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.85rem' }}>
          {STATUS_LABELS[statusFilter]}
        </div>
      )}

      {all.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>No engagements in this view</div>
          <div style={{ fontSize: '0.82rem', color: C.textMuted, marginBottom: '0.85rem' }}>
            Engagements are opened when an intent match is accepted. Browse open intents to find a match.
          </div>
          <Link href={`/h/${slug}/discover`} style={{ display: 'inline-block', padding: '0.5rem 0.9rem', background: C.accent, color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
            Discover →
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {all.map(e => <EntitlementCard key={e.id} entitlement={e} hubSlug={slug} viewerAgent={myAgent ?? null} />)}
        </div>
      )}
    </div>
  )
}

function qs(slug: string, scope: string, status: string): string {
  const parts = []
  if (scope === 'hub') parts.push('scope=hub')
  parts.push(`status=${status}`)
  return `/h/${slug}/entitlements?${parts.join('&')}`
}

function Pill({ href, active, count, children }: { href: string; active: boolean; count?: number; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        padding: '0.3rem 0.7rem',
        fontSize: '0.72rem',
        fontWeight: 600,
        borderRadius: 999,
        textDecoration: 'none',
        background: active ? C.accent : '#fff',
        color: active ? '#fff' : C.text,
        border: `1px solid ${active ? C.accent : C.border}`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
      }}
    >
      {children}
      {count !== undefined && <span style={{ fontSize: '0.65rem', opacity: 0.75 }}>{count}</span>}
    </Link>
  )
}
