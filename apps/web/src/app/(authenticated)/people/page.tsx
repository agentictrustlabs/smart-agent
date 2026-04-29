import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { PrincipalContextChip } from '@/components/shell/PrincipalContextChip'
import { NetworkChipBar } from '@/components/shell/NetworkChipBar'

/**
 * /people — top-level People surface. New IA from Phase 2 of the
 * hub redesign.
 *
 * Phase 2 — a navigator into existing surfaces:
 *   • My People → /oikos     (Oikos / contacts / mentees)
 *   • Members   → /members   (aggregate roster across orgs you steward)
 *   • Discover  → /people/discover (Phase 3 — intent-driven search +
 *                  relational-distance scoring)
 *
 * The chip bar at the top is a placeholder for cross-network
 * filtering (Catalyst NoCo / Front Range / Plains / Denver Metro).
 * It writes `?network=<slug>` to the URL; consumer surfaces read it
 * to scope their lists. v1: chip state is decorative — wired to
 * filter actions in Phase 3.
 */
export default async function PeoplePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '1rem' }}>
      <PrincipalContextChip />

      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>People</h1>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 4 }}>
          The people you know, the people in your orgs, and the people
          you don&apos;t yet know but might want to.
        </p>
      </header>

      <NetworkChipBar />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <PeopleNavCard
          href="/oikos"
          title="My People"
          tagline="Oikos · contacts · mentees"
          body="People you're tracking by name — proximity rings, planned conversations, last-touch state. Today's Oikos surface lives here."
          cta="Open My People →"
        />
        <PeopleNavCard
          href="/members"
          title="Members"
          tagline="Roster across your orgs"
          body="Everyone with a role in an org you steward. Filterable by role, capability, and (Phase 3) skill."
          cta="Open Members →"
        />
        <PeopleNavCard
          href="/people/discover"
          title="Discover"
          tagline="Intent-driven search"
          body="Find a coach, a multiplier, a treasurer, a Spanish-speaking case manager near Loveland — sorted by who's closest in the trust graph."
          cta="Open Discover →"
        />
      </div>
    </div>
  )
}

function PeopleNavCard(props: {
  href: string
  title: string
  tagline: string
  body: string
  cta: string
  disabled?: boolean
}) {
  const inner = (
    <div
      style={{
        background: '#fff',
        border: '1px solid #ece6db',
        borderRadius: 12,
        padding: '1rem 1.1rem',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        opacity: props.disabled ? 0.55 : 1,
      }}
    >
      <div style={{ fontSize: 11, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
        {props.tagline}
      </div>
      <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>{props.title}</h2>
      <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0, flex: 1 }}>{props.body}</p>
      <div style={{ fontSize: 13, fontWeight: 600, color: props.disabled ? '#94a3b8' : '#3f6ee8', marginTop: 6 }}>
        {props.cta}
      </div>
    </div>
  )
  if (props.disabled) return inner
  return (
    <Link href={props.href} style={{ textDecoration: 'none', color: 'inherit' }} data-testid={`people-card-${props.title.toLowerCase().replace(/\s+/g, '-')}`}>
      {inner}
    </Link>
  )
}
