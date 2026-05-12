import Link from 'next/link'
import { listMemberPledges } from '@/lib/actions/poolPledges.action'
import { listMemberProposals } from '@/lib/actions/grantProposals.action'
import { listIntents } from '@/lib/actions/intents.action'
import { getPersonAgentForUser } from '@/lib/agent-registry'

const C = {
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
}

interface Props {
  userId: string
  hubSlug: string
  hubId: string
}

interface Tile {
  count: number
  label: string
  href: string
  caption: string
}

/**
 * "Your active marketplace items" — surfaces the viewer's open pledges,
 * proposals, and expressed intents from one place on the home page so a
 * user who pledged or drafted a proposal yesterday can find their way back.
 *
 * Renders nothing if the viewer has zero open items across all three lanes —
 * the hub home stays calm when there's nothing to act on. Each tile links
 * to that lane's "my X" index page.
 */
export async function ActiveMarketplaceStrip({ userId, hubSlug, hubId }: Props) {
  // Three independent reads — fan out and let any single failure shrug.
  const myAgent = await getPersonAgentForUser(userId).catch(() => null)
  const [pledges, proposals, intents] = await Promise.all([
    listMemberPledges().then(r => r.pledges).catch(() => []),
    listMemberProposals().then(r => r.proposals).catch(() => []),
    myAgent
      ? listIntents({ hubId, expressedBy: myAgent, status: 'expressed', limit: 20 }).catch(() => [])
      : Promise.resolve([] as unknown[]),
  ])

  const tiles: Tile[] = []
  if (pledges.length > 0) {
    tiles.push({
      count: pledges.length,
      label: pledges.length === 1 ? 'Active pledge' : 'Active pledges',
      href: `/h/${hubSlug}/pledges`,
      caption: 'Manage cadence, restrictions, history',
    })
  }
  const draftCount = proposals.filter(p => p.status === 'draft').length
  if (proposals.length > 0) {
    tiles.push({
      count: proposals.length,
      label: proposals.length === 1 ? 'Grant proposal' : 'Grant proposals',
      href: `/h/${hubSlug}/proposals`,
      caption: draftCount > 0
        ? `${draftCount} draft${draftCount === 1 ? '' : 's'} in progress`
        : `${proposals.length} submitted`,
    })
  }
  if (intents.length > 0) {
    tiles.push({
      count: intents.length,
      label: intents.length === 1 ? 'Open intent' : 'Open intents',
      href: `/h/${hubSlug}/intents`,
      caption: 'Awaiting acknowledgement or match',
    })
  }
  if (tiles.length === 0) return null

  return (
    <section
      aria-label="Your active marketplace items"
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.85rem 1rem',
        marginBottom: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Your marketplace activity
          </div>
          <div style={{ fontSize: '0.85rem', color: C.text, marginTop: 2 }}>
            Pick up where you left off across the three lanes.
          </div>
        </div>
        <Link
          href={`/h/${hubSlug}/intents`}
          style={{ fontSize: '0.75rem', fontWeight: 600, color: C.accent, textDecoration: 'none' }}
        >
          Discover →
        </Link>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`,
          gap: '0.6rem',
        }}
      >
        {tiles.map(t => (
          <Link
            key={t.href}
            href={t.href}
            style={{
              display: 'block',
              background: C.accentLight,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: '0.7rem 0.9rem',
              textDecoration: 'none',
              color: C.text,
            }}
          >
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: C.text, lineHeight: 1 }}>
              {t.count}
            </div>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, marginTop: '0.2rem' }}>
              {t.label}
            </div>
            <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.15rem' }}>
              {t.caption}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
