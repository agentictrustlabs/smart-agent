import Link from 'next/link'

/**
 * GettingStartedChecklist — role-aware first-run guide shown on the hub
 * dashboard when the user has zero activity or is a new member.
 *
 * Members see: Express an intent, Browse open rounds, Pledge to a pool.
 * Owners additionally see: Register your organization, Create a giving pool.
 *
 * Server Component — no client state needed.
 */

interface ChecklistItem {
  label: string
  href: string
  description: string
  done?: boolean
}

interface GettingStartedChecklistProps {
  hubSlug: string
  isOwner: boolean
  hasOrg: boolean
  hasExpressedIntent: boolean
}

const C = {
  card: '#ffffff',
  border: '#ece6db',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
  accentBorder: 'rgba(139,94,60,0.20)',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  green: '#166534',
  greenLight: 'rgba(22,101,52,0.08)',
  greenBorder: 'rgba(22,101,52,0.20)',
}

export function GettingStartedChecklist({
  hubSlug,
  isOwner,
  hasOrg,
  hasExpressedIntent,
}: GettingStartedChecklistProps) {
  const memberItems: ChecklistItem[] = [
    {
      label: 'Express an intent',
      href: `/h/${hubSlug}/intents`,
      description: 'Tell the community what you need or what you can offer.',
      done: hasExpressedIntent,
    },
    {
      label: 'Browse open rounds',
      href: `/h/${hubSlug}/rounds`,
      description: 'Explore active funding rounds you can apply to.',
    },
    {
      label: 'Pledge to a giving pool',
      href: `/h/${hubSlug}/pools`,
      description: 'Support community goals by pledging to a shared fund.',
    },
  ]

  const ownerItems: ChecklistItem[] = [
    {
      label: 'Register your organization',
      href: `/h/${hubSlug}/home`,
      description: 'Create your organization profile to access admin tools.',
      done: hasOrg,
    },
    {
      label: 'Create a giving pool',
      href: `/h/${hubSlug}/pools/new`,
      description: 'Set up a pool to receive pledges from your community.',
    },
  ]

  const items = isOwner ? [...ownerItems, ...memberItems] : memberItems
  const completedCount = items.filter(i => i.done).length

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h2
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            color: C.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            margin: 0,
          }}
        >
          Getting started
        </h2>
        <span
          style={{
            fontSize: '0.72rem',
            color: C.textMuted,
            fontWeight: 500,
          }}
        >
          {completedCount} of {items.length} done
        </span>
      </div>

      {/* Checklist rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {items.map((item, i) => (
          <Link
            key={i}
            href={item.href}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.65rem',
              padding: '0.6rem 0.75rem',
              background: item.done ? C.greenLight : C.accentLight,
              border: `1px solid ${item.done ? C.greenBorder : C.accentBorder}`,
              borderRadius: 8,
              textDecoration: 'none',
              color: 'inherit',
              opacity: item.done ? 0.75 : 1,
            }}
          >
            {/* Done indicator */}
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: item.done ? C.green : C.accent,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.65rem',
                fontWeight: 700,
                marginTop: 2,
              }}
            >
              {item.done ? '✓' : (i + 1)}
            </span>

            {/* Label + description */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: item.done ? C.green : C.text,
                  textDecoration: item.done ? 'line-through' : 'none',
                  textDecorationColor: 'rgba(22,101,52,0.4)',
                }}
              >
                {item.label}
              </div>
              {!item.done && (
                <div style={{ fontSize: '0.75rem', color: C.textMuted, marginTop: '0.1rem' }}>
                  {item.description}
                </div>
              )}
            </div>

            {!item.done && (
              <span aria-hidden="true" style={{ fontSize: '0.9rem', color: C.textMuted, alignSelf: 'center' }}>›</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}

/**
 * RegisterOrgCard — surfaces "Register your organization" prominently when
 * the viewer is logged in but has no org. Previously buried in dropdown.
 */
export function RegisterOrgCard({ hubSlug, hubAddress, hubName, hubId }: {
  hubSlug: string
  hubAddress: string
  hubName: string
  hubId: 'catalyst' | 'cil' | 'global-church' | 'generic'
}) {
  // Import is here to keep the client boundary in CreateOrgButton, not here.
  // We render a link instead of the dialog trigger for SSR.
  return (
    <div
      style={{
        background: C.card,
        border: `2px dashed ${C.accentBorder}`,
        borderRadius: 14,
        padding: '1.5rem',
        textAlign: 'center',
        marginBottom: '1rem',
      }}
    >
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }} aria-hidden="true">{'🏛'}</div>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, color: C.text, margin: '0 0 0.4rem' }}>
        Register your organization
      </h2>
      <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0 0 1rem', lineHeight: 1.5 }}>
        Create an organization profile to manage members, access admin tools, and participate in funding rounds.
      </p>
      {/* Client button lives in CreateOrgButton — this link navigates to hub home where it's available */}
      <Link
        href={`/h/${hubSlug}/home`}
        style={{
          display: 'inline-block',
          padding: '0.55rem 1.1rem',
          borderRadius: 8,
          background: C.accent,
          color: '#fff',
          fontWeight: 600,
          fontSize: '0.88rem',
          textDecoration: 'none',
        }}
      >
        Register organization
      </Link>
    </div>
  )
}
