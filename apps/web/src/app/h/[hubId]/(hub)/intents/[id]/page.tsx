import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getIntent } from '@/lib/actions/intents.action'
import { listMatches, runDiscoverMatch } from '@/lib/actions/discover.action'
import { MatchRowCard } from '@/components/discover/MatchRow'
import { getAgentMetadata } from '@/lib/agent-metadata'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  card: '#ffffff', border: '#ece6db',
  receiveBg: 'rgba(13,148,136,0.06)',  receiveFg: '#0f766e', receiveBorder: 'rgba(13,148,136,0.20)',
  giveBg:    'rgba(217,119,6,0.06)',    giveFg:    '#92400e', giveBorder:    'rgba(217,119,6,0.25)',
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  drafted:      { bg: '#f3f4f6', fg: '#6b7280' },
  expressed:    { bg: '#dcfce7', fg: '#166534' },
  acknowledged: { bg: '#dbeafe', fg: '#1d4ed8' },
  'in-progress': { bg: '#fef3c7', fg: '#92400e' },
  fulfilled:    { bg: '#dcfce7', fg: '#166534' },
  withdrawn:    { bg: '#f3f4f6', fg: '#6b7280' },
  abandoned:    { bg: '#f3f4f6', fg: '#6b7280' },
}

export default async function IntentDetailPage({ params, searchParams }: {
  params: Promise<{ hubId: string; id: string }>
  searchParams: Promise<{ run?: string }>
}) {
  const { hubId: slug, id } = await params
  const { run } = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const intent = await getIntent(id)
  if (!intent) notFound()
  const profile = getHubProfile(internalHubId)

  // For receive-shaped intents we have a legacy needs row — match against it.
  if (run === '1' && intent.direction === 'receive' && intent.projectionRef) {
    await runDiscoverMatch(intent.projectionRef)
  }
  const matches = (intent.direction === 'receive' && intent.projectionRef)
    ? await listMatches({ needId: intent.projectionRef, hydrate: true, minScore: 0, limit: 50 })
    : []
  const proposed = matches.filter(m => m.status === 'proposed')
  const decided = matches.filter(m => m.status !== 'proposed')

  let expresserName = intent.expressedByAgent.slice(0, 6) + '…' + intent.expressedByAgent.slice(-4)
  try {
    const meta = await getAgentMetadata(intent.expressedByAgent as `0x${string}`)
    if (meta?.displayName) expresserName = meta.displayName
  } catch { /* */ }

  const dirIsReceive = intent.direction === 'receive'
  const dirChip = dirIsReceive
    ? { bg: C.receiveBg, fg: C.receiveFg, border: C.receiveBorder, icon: '📥', label: 'Receive' }
    : { bg: C.giveBg, fg: C.giveFg, border: C.giveBorder, icon: '📤', label: 'Give' }
  const status = STATUS_COLORS[intent.status] ?? STATUS_COLORS.expressed

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Intent
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.4rem' }}>
          {intent.title}
        </h1>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: 999, background: dirChip.bg, color: dirChip.fg, border: `1px solid ${dirChip.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {dirChip.icon} {dirChip.label}
          </span>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: 999, background: status.bg, color: status.fg, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {intent.status}
          </span>
          <span style={{ fontSize: '0.78rem', color: C.textMuted }}>
            {intent.intentTypeLabel} · object: {intent.object.split(':').pop()}
          </span>
        </div>
        <div style={{ fontSize: '0.78rem', color: C.textMuted }}>
          Expressed by <Link href={`/agents/${intent.expressedByAgent}`} style={{ color: C.accent }}>{expresserName}</Link>
          {intent.addressedTo && intent.addressedTo !== `hub:${internalHubId}` && (
            <> · addressed to {intent.addressedTo}</>
          )}
        </div>
      </div>

      {/* Detail card */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        {intent.detail && (
          <div style={{ fontSize: '0.88rem', color: C.text, marginBottom: '0.75rem', lineHeight: 1.5 }}>{intent.detail}</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', fontSize: '0.8rem' }}>
          <Field label="Direction" value={intent.direction} />
          <Field label="Object" value={intent.object.split(':').pop() ?? intent.object} />
          {intent.topic && <Field label="Topic" value={intent.topic} />}
          <Field label="Priority" value={intent.priority} />
          <Field label="Visibility" value={intent.visibility} />
          {intent.payload?.role && <Field label="Role" value={String(intent.payload.role).split(':').pop() ?? String(intent.payload.role)} />}
          {intent.payload?.skill && <Field label="Skill" value={String(intent.payload.skill).split(':').pop() ?? String(intent.payload.skill)} />}
          {intent.payload?.geo && <Field label="Location" value={String(intent.payload.geo).split('/').pop() ?? String(intent.payload.geo)} />}
          {intent.validUntil && <Field label="Valid until" value={new Date(intent.validUntil).toLocaleDateString()} />}
        </div>
      </div>

      {/* Outcome */}
      {intent.outcome && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
            Expected outcome
          </div>
          <div style={{ fontSize: '0.92rem', color: C.text, fontWeight: 600 }}>{intent.outcome.description}</div>
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.3rem' }}>
            Metric: {intent.outcome.metric.kind}
            {intent.outcome.metric.target !== undefined && <> · target: {String(intent.outcome.metric.target)}</>}
            {intent.outcome.metric.observed !== undefined && <> · observed: {String(intent.outcome.metric.observed)}</>}
            <span style={{ marginLeft: '0.4rem', padding: '0.1rem 0.4rem', borderRadius: 999, background: '#fafaf6', border: `1px solid ${C.border}` }}>
              {intent.outcome.status}
            </span>
          </div>
        </div>
      )}

      {/* Re-run match (receive-only) */}
      {dirIsReceive && intent.projectionRef && (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link
            href={`/h/${slug}/intents/${id}?run=1`}
            style={{ display: 'inline-block', padding: '0.5rem 0.9rem', background: '#fff', color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 8, fontWeight: 600, fontSize: '0.8rem', textDecoration: 'none' }}
          >
            ↻ Re-run match
          </Link>
        </div>
      )}

      {/* Matches (receive-only — give-shaped intents are *targets*, not askers) */}
      {dirIsReceive && proposed.length > 0 && (
        <section style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            Proposed matches ({proposed.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {proposed.map(m => <MatchRowCard key={m.id} match={m} hubSlug={slug} />)}
          </div>
        </section>
      )}

      {dirIsReceive && decided.length > 0 && (
        <section>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            Decisions ({decided.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {decided.map(m => <MatchRowCard key={m.id} match={m} hubSlug={slug} />)}
          </div>
        </section>
      )}

      {dirIsReceive && proposed.length === 0 && decided.length === 0 && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: C.textMuted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
          No matches yet. Try clicking <span style={{ color: C.accent, fontWeight: 600 }}>Re-run match</span> above.
        </div>
      )}

      {/* Give-shaped intents: this is the offering side; show what
          requests it could match. Lightweight teaser — full reverse-search lives later. */}
      {!dirIsReceive && (
        <div style={{ padding: '1.25rem', textAlign: 'center', color: C.textMuted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
          This is a give-shaped intent. <Link href={`/h/${slug}/discover`} style={{ color: C.accent, fontWeight: 600 }}>Browse open requests</Link> that could be a fit.
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#5c4a3a', textTransform: 'capitalize' }}>{value}</div>
    </div>
  )
}
