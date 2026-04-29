import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getMatch } from '@/lib/actions/discover.action'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { MatchActions } from './MatchActions'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db', accentLight: 'rgba(139,94,60,0.10)' }

function scoreColor(score: number): { bg: string; fg: string; label: string } {
  if (score >= 8000) return { bg: '#dcfce7', fg: '#166534', label: 'Strong fit' }
  if (score >= 6000) return { bg: '#dbeafe', fg: '#1d4ed8', label: 'Good fit' }
  if (score >= 4000) return { bg: '#fef3c7', fg: '#92400e', label: 'Partial fit' }
  return { bg: '#f3f4f6', fg: '#6b7280', label: 'Weak fit' }
}

const REQ_LABELS: Record<string, string> = {
  resourceType: 'Resource type',
  role: 'Role',
  skill: 'Skill',
  geo: 'Location',
  availability: 'Availability',
  capacity: 'Capacity',
  credential: 'Credential',
}

export default async function MatchDetailPage({ params }: { params: Promise<{ hubId: string; id: string }> }) {
  const { hubId: slug, id } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const match = await getMatch(id, true)
  if (!match) notFound()
  const profile = getHubProfile(internalHubId)
  const sc = scoreColor(match.score)

  let agentName = match.matchedAgent.slice(0, 6) + '…' + match.matchedAgent.slice(-4)
  try {
    const meta = await getAgentMetadata(match.matchedAgent as `0x${string}`)
    if (meta?.displayName) agentName = meta.displayName
  } catch { /* */ }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Match
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          Match details
        </h1>
      </div>

      {/* Score chip */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, padding: '0.35rem 0.75rem', borderRadius: 999, background: sc.bg, color: sc.fg, minWidth: 80, textAlign: 'center' }}>
            {match.scorePct}%
          </span>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text }}>{sc.label}</div>
            <div style={{ fontSize: '0.72rem', color: C.textMuted }}>
              Reason: {match.reason.split(':').pop()}
            </div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {match.status}
          </span>
        </div>

        {/* Need + Offering side-by-side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }} className="catalyst-work-grid">
          <div>
            <div style={{ fontSize: '0.62rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>NEED</div>
            <Link href={`/h/${slug}/needs/${match.needId}`} style={{ fontSize: '0.92rem', fontWeight: 700, color: C.text, textDecoration: 'none' }}>
              {match.need?.title ?? 'Need'}
            </Link>
            <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
              {match.need?.needTypeLabel}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.62rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>OFFERING</div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: C.text }}>{match.offering?.title ?? 'Offering'}</div>
            <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
              from <Link href={`/agents/${match.matchedAgent}`} style={{ color: C.accent }}>{agentName}</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Why does this fit */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.5rem' }}>
          Why does this fit?
        </h2>
        {match.satisfies.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>No requirements met.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem', color: C.text }}>
            {match.satisfies.map(req => (
              <li key={req} style={{ marginBottom: '0.2rem' }}>
                <strong style={{ color: '#166534' }}>✓ {REQ_LABELS[req] ?? req}</strong> — covered by the offering
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* What's missing */}
      {match.misses.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.5rem' }}>
            What&apos;s missing?
          </h2>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem', color: C.text }}>
            {match.misses.map(req => (
              <li key={req} style={{ marginBottom: '0.2rem', color: '#92400e' }}>
                <strong>⚠ {REQ_LABELS[req] ?? req}</strong> — not provided by the offering
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Accept / Reject — only if proposed */}
      {match.status === 'proposed' && <MatchActions matchId={id} hubSlug={slug} />}

      {/* Provenance footer */}
      <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '1rem' }}>
        Generated {new Date(match.createdAt).toLocaleString()}
        {match.updatedAt !== match.createdAt && <> · Updated {new Date(match.updatedAt).toLocaleString()}</>}
      </div>
    </div>
  )
}
