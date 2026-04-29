import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { listIntents, type IntentRow, type IntentDirection } from '@/lib/actions/intents.action'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  card: '#ffffff', border: '#ece6db',
  receiveBg: 'rgba(13,148,136,0.06)', receiveFg: '#0f766e', receiveBorder: 'rgba(13,148,136,0.20)',
  giveBg:    'rgba(217,119,6,0.06)',   giveFg:    '#92400e', giveBorder:    'rgba(217,119,6,0.25)',
}

const STATUS_BG: Record<string, { bg: string; fg: string }> = {
  drafted:      { bg: '#f3f4f6', fg: '#6b7280' },
  expressed:    { bg: '#dcfce7', fg: '#166534' },
  acknowledged: { bg: '#dbeafe', fg: '#1d4ed8' },
  'in-progress': { bg: '#fef3c7', fg: '#92400e' },
  fulfilled:    { bg: '#dcfce7', fg: '#166534' },
  withdrawn:    { bg: '#f3f4f6', fg: '#6b7280' },
  abandoned:    { bg: '#f3f4f6', fg: '#6b7280' },
}

const PRIORITY_FG: Record<string, string> = {
  critical: '#991b1b',
  high:     '#92400e',
  normal:   '#3730a3',
  low:      '#5b21b6',
}

/**
 * `/h/{slug}/intents` — index page.
 *
 * Three sections, ordered by what the user typically wants first:
 *   1. Addressed to me (inbox) — intents directly addressed at the user
 *   2. My intents (outbox)     — intents the user has expressed
 *   3. Hub-wide open intents    — what else is open across the hub
 *
 * Filter pills above re-scope the page by direction (Receive / Give /
 * All) without changing the section split. Replaces the 404 the user
 * hit when clicking `/intents` with no id.
 */
export default async function IntentsIndexPage({ params, searchParams }: {
  params: Promise<{ hubId: string }>
  searchParams: Promise<{ direction?: string; scope?: string }>
}) {
  const { hubId: slug } = await params
  const sp = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const myAgent = await getPersonAgentForUser(user.id)
  const direction: IntentDirection | undefined =
    sp.direction === 'receive' || sp.direction === 'give' ? sp.direction : undefined
  const scope = sp.scope ?? 'all'   // all | inbox | outbox | hub

  // Three queries in parallel.
  const [inbox, outbox, hubOpen] = await Promise.all([
    myAgent
      ? listIntents({ hubId: internalHubId, addressedTo: `agent:${myAgent.toLowerCase()}`, direction, limit: 50 })
      : Promise.resolve([]),
    myAgent
      ? listIntents({ hubId: internalHubId, expressedBy: myAgent, direction, limit: 50 })
      : Promise.resolve([]),
    listIntents({ hubId: internalHubId, status: 'expressed', direction, limit: 50 }),
  ])

  // De-dupe hub-wide list against the inbox/outbox so a user's own intent
  // doesn't render twice.
  const myIds = new Set([...inbox.map(i => i.id), ...outbox.map(i => i.id)])
  const hubFiltered = hubOpen.filter(i => !myIds.has(i.id))

  const sections: Array<{ key: string; title: string; items: IntentRow[]; emptyHint?: string }> = []
  if (scope === 'all' || scope === 'inbox') {
    sections.push({
      key: 'inbox',
      title: 'Addressed to you',
      items: inbox,
      emptyHint: 'Nothing addressed to you specifically right now. Hub-wide intents below.',
    })
  }
  if (scope === 'all' || scope === 'outbox') {
    sections.push({
      key: 'outbox',
      title: 'You expressed',
      items: outbox,
      emptyHint: scope === 'outbox' ? 'You haven\'t expressed any intents yet.' : undefined,
    })
  }
  if (scope === 'all' || scope === 'hub') {
    sections.push({
      key: 'hub',
      title: 'Open in the hub',
      items: hubFiltered,
    })
  }

  const total = inbox.length + outbox.length + hubFiltered.length

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Intents
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
            Intents
          </h1>
          <Link href={`/h/${slug}/intents/new`} style={{ padding: '0.4rem 0.8rem', background: C.accent, color: '#fff', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none' }}>
            + Express an intent
          </Link>
        </div>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          Receive-shaped (📥 needs) and give-shaped (📤 offerings) intents in the hub. Match the directions to find compatible counter-intents.
        </p>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <FilterPill href={`/h/${slug}/intents${qs({ direction: undefined, scope })}`} active={!direction}>All directions</FilterPill>
        <FilterPill href={`/h/${slug}/intents${qs({ direction: 'receive', scope })}`} active={direction === 'receive'}>📥 Receive</FilterPill>
        <FilterPill href={`/h/${slug}/intents${qs({ direction: 'give', scope })}`} active={direction === 'give'}>📤 Give</FilterPill>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <FilterPill href={`/h/${slug}/intents${qs({ direction, scope: undefined })}`} active={scope === 'all'}>Everything</FilterPill>
        <FilterPill href={`/h/${slug}/intents${qs({ direction, scope: 'inbox' })}`}  active={scope === 'inbox'}  count={inbox.length}>Addressed to me</FilterPill>
        <FilterPill href={`/h/${slug}/intents${qs({ direction, scope: 'outbox' })}`} active={scope === 'outbox'} count={outbox.length}>I expressed</FilterPill>
        <FilterPill href={`/h/${slug}/intents${qs({ direction, scope: 'hub' })}`}    active={scope === 'hub'}    count={hubFiltered.length}>Hub-wide</FilterPill>
      </div>

      {/* Sections */}
      {total === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text, marginBottom: '0.4rem' }}>No intents in this view</div>
          <div style={{ fontSize: '0.82rem', color: C.textMuted, marginBottom: '0.85rem' }}>
            Try a different filter, or express your first intent.
          </div>
          <Link href={`/h/${slug}/intents/new`} style={{ display: 'inline-block', padding: '0.5rem 0.9rem', background: C.accent, color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
            + Express an intent
          </Link>
        </div>
      ) : (
        sections.map(s => (
          <section key={s.key} style={{ marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
              {s.title} ({s.items.length})
            </h2>
            {s.items.length === 0 ? (
              <div style={{ fontSize: '0.78rem', color: C.textMuted, padding: '0.6rem 0.85rem', background: C.card, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
                {s.emptyHint ?? 'Nothing here yet.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {s.items.map(i => <IntentRowCard key={i.id} intent={i} hubSlug={slug} />)}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  )
}

function qs(obj: { direction?: string; scope?: string }): string {
  const parts: string[] = []
  if (obj.direction) parts.push(`direction=${obj.direction}`)
  if (obj.scope && obj.scope !== 'all') parts.push(`scope=${obj.scope}`)
  return parts.length === 0 ? '' : `?${parts.join('&')}`
}

function FilterPill({ href, active, count, children }: { href: string; active: boolean; count?: number; children: React.ReactNode }) {
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

function IntentRowCard({ intent, hubSlug }: { intent: IntentRow; hubSlug: string }) {
  const isRecv = intent.direction === 'receive'
  const dirChip = isRecv
    ? { bg: C.receiveBg, fg: C.receiveFg, border: C.receiveBorder, icon: '📥', label: 'Receive' }
    : { bg: C.giveBg, fg: C.giveFg, border: C.giveBorder, icon: '📤', label: 'Give' }
  const status = STATUS_BG[intent.status] ?? STATUS_BG.expressed
  return (
    <Link
      href={`/h/${hubSlug}/intents/${intent.id}`}
      style={{
        display: 'block',
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '0.7rem 0.85rem',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999, background: dirChip.bg, color: dirChip.fg, border: `1px solid ${dirChip.border}`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {dirChip.icon} {dirChip.label}
        </span>
        <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: 999, background: '#fafaf6', color: PRIORITY_FG[intent.priority] ?? C.textMuted, border: `1px solid ${PRIORITY_FG[intent.priority] ?? C.textMuted}30`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {intent.priority}
        </span>
        <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 999, background: status.bg, color: status.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {intent.status}
        </span>
        {intent.visibility !== 'public' && (
          <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{intent.visibility}</span>
        )}
      </div>
      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: C.text, marginBottom: '0.15rem' }}>{intent.title}</div>
      <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
        {intent.intentTypeLabel}
        {intent.topic && <> · {intent.topic}</>}
      </div>
      {intent.detail && (
        <div style={{ fontSize: '0.78rem', color: C.text, marginTop: '0.35rem', lineHeight: 1.4 }}>
          {intent.detail.length > 160 ? intent.detail.slice(0, 160) + '…' : intent.detail}
        </div>
      )}
    </Link>
  )
}
