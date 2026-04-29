import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { listOfferings, listMyOfferings } from '@/lib/actions/needs.action'
import { OfferResourceButton } from '@/components/discover/OfferResourceButton'
import { getPersonAgentForUser } from '@/lib/agent-registry'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db', accentLight: 'rgba(139,94,60,0.10)' }

const TYPE_ICON: Record<string, string> = {
  'resourceType:Skill': '🎯',
  'resourceType:Money': '💰',
  'resourceType:Data': '📊',
  'resourceType:Prayer': '🙏',
  'resourceType:Worker': '👷',
  'resourceType:Scripture': '📖',
  'resourceType:Church': '⛪',
  'resourceType:Organization': '🏛️',
  'resourceType:Connector': '🤝',
  'resourceType:Venue': '🏠',
  'resourceType:Curriculum': '📚',
  'resourceType:Credential': '🎓',
}

export default async function OfferingsPage({ params, searchParams }: {
  params: Promise<{ hubId: string }>
  searchParams: Promise<{ scope?: string }>
}) {
  const { hubId: slug } = await params
  const { scope } = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const profile = getHubProfile(internalHubId)

  const isMine = scope !== 'hub'
  const offerings = isMine
    ? await listMyOfferings()
    : await listOfferings({ hubId: internalHubId, status: 'available', limit: 100 })
  const myAgent = await getPersonAgentForUser(user.id)

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Offerings
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          {isMine ? 'My offerings' : 'Hub offerings'}
        </h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <ScopeTab href={`/h/${slug}/offerings`} active={isMine}>Mine</ScopeTab>
          <ScopeTab href={`/h/${slug}/offerings?scope=hub`} active={!isMine}>Whole hub</ScopeTab>
        </div>
        <OfferResourceButton hubId={internalHubId} myAgent={myAgent} />
      </div>
      {offerings.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1.5rem', textAlign: 'center', color: C.textMuted, fontSize: '0.88rem' }}>
          {isMine ? (
            <>You haven&apos;t made any offerings yet. <Link href={`/h/${slug}/discover`} style={{ color: C.accent, fontWeight: 600 }}>Discover →</Link></>
          ) : (
            <>No active offerings in this hub yet.</>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {offerings.map(o => (
            <div key={o.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '0.85rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                <span style={{ fontSize: '1.1rem' }}>{TYPE_ICON[o.resourceType] ?? '📦'}</span>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999, background: C.accentLight, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {o.resourceTypeLabel}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{o.status}</span>
              </div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: C.text }}>{o.title}</div>
              {o.detail && (
                <div style={{ fontSize: '0.78rem', color: C.text, marginTop: '0.3rem' }}>{o.detail}</div>
              )}
              <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.3rem' }}>
                {o.geo && <>📍 {o.geo.split('/').slice(-1)[0]} · </>}
                {o.capacity && <>capacity: {o.capacity.amount} {o.capacity.unit} · </>}
                {o.capabilities.length > 0 && <>{o.capabilities.length} capability{o.capabilities.length === 1 ? '' : 'ies'}</>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ScopeTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
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
        border: `1px solid ${active ? C.accent : '#ece6db'}`,
      }}
    >
      {children}
    </Link>
  )
}
