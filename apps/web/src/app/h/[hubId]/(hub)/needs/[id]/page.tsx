import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getNeed } from '@/lib/actions/needs.action'
import { listMatches, runDiscoverMatch } from '@/lib/actions/discover.action'
import { MatchRowCard } from '@/components/discover/MatchRow'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { LogFulfillmentButton } from '@/components/discover/LogFulfillmentButton'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db', accentLight: 'rgba(139,94,60,0.10)' }

export default async function NeedDetailPage({ params, searchParams }: {
  params: Promise<{ hubId: string; id: string }>
  searchParams: Promise<{ run?: string }>
}) {
  const { hubId: slug, id } = await params
  const { run } = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const need = await getNeed(id)
  if (!need) notFound()
  const profile = getHubProfile(internalHubId)
  const userOrgs = await getUserOrgs(user.id)
  const firstOrgAddr = userOrgs[0]?.address ?? null

  // If ?run=1 came in (from a "Find matches" CTA), generate fresh matches.
  if (run === '1') await runDiscoverMatch(id)

  const matches = await listMatches({ needId: id, hydrate: true, minScore: 0, limit: 50 })
  const proposed = matches.filter(m => m.status === 'proposed')
  const decided = matches.filter(m => m.status !== 'proposed')

  // Owner display
  let ownerName = need.neededByAgent.slice(0, 6) + '…' + need.neededByAgent.slice(-4)
  try {
    const meta = await getAgentMetadata(need.neededByAgent as `0x${string}`)
    if (meta?.displayName) ownerName = meta.displayName
  } catch { /* */ }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Need
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.3rem' }}>
          {need.title}
        </h1>
        <div style={{ fontSize: '0.85rem', color: C.textMuted }}>
          {need.needTypeLabel} · for <Link href={`/agents/${need.neededByAgent}`} style={{ color: C.accent }}>{ownerName}</Link>
        </div>
      </div>

      {/* Detail card */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        {need.detail && (
          <div style={{ fontSize: '0.88rem', color: C.text, marginBottom: '0.75rem', lineHeight: 1.5 }}>{need.detail}</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', fontSize: '0.8rem' }}>
          <Field label="Priority" value={need.priority} />
          <Field label="Status" value={need.status} />
          {need.requirements?.role && <Field label="Role required" value={need.requirements.role.split(':').pop() ?? need.requirements.role} />}
          {need.requirements?.skill && <Field label="Skill required" value={need.requirements.skill.split(':').pop() ?? need.requirements.skill} />}
          {need.requirements?.geo && <Field label="Location" value={need.requirements.geo.split('/').pop() ?? need.requirements.geo} />}
          {need.requirements?.credential && <Field label="Credential" value={need.requirements.credential} />}
          {need.validUntil && <Field label="Valid until" value={new Date(need.validUntil).toLocaleDateString()} />}
        </div>
      </div>

      {/* CTAs: re-run match + log fulfillment */}
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Link
          href={`/h/${slug}/needs/${id}?run=1`}
          style={{ display: 'inline-block', padding: '0.5rem 0.9rem', background: '#fff', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, fontWeight: 600, fontSize: '0.8rem', textDecoration: 'none' }}
        >
          ↻ Re-run match
        </Link>
        <LogFulfillmentButton needId={id} needTitle={need.title} hubId={internalHubId} orgAddress={firstOrgAddr} />
      </div>

      {/* Proposed matches */}
      {proposed.length > 0 && (
        <section style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            Proposed matches ({proposed.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {proposed.map(m => <MatchRowCard key={m.id} match={m} hubSlug={slug} />)}
          </div>
        </section>
      )}

      {decided.length > 0 && (
        <section>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            Decisions ({decided.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {decided.map(m => <MatchRowCard key={m.id} match={m} hubSlug={slug} />)}
          </div>
        </section>
      )}

      {proposed.length === 0 && decided.length === 0 && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: C.textMuted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
          No matches yet. Try clicking <span style={{ color: C.accent, fontWeight: 600 }}>Re-run match</span> above.
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text, textTransform: 'capitalize' }}>{value}</div>
    </div>
  )
}
