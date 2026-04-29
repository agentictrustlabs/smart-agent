import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { listNeeds } from '@/lib/actions/needs.action'
import { NeedCard } from '@/components/discover/NeedCard'
import { db, schema } from '@/db'
import { and, eq, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c' }

export default async function NeedsListPage({ params, searchParams }: {
  params: Promise<{ hubId: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { hubId: slug } = await params
  const { status } = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const filter = (status as 'open' | 'in-progress' | 'met' | 'cancelled' | 'expired' | undefined) ?? undefined
  const needs = await listNeeds({ hubId: internalHubId, status: filter, limit: 200 })

  // Per-need match counts.
  const counts = new Map<string, number>()
  if (needs.length > 0) {
    const rows = db.select().from(schema.needResourceMatches)
      .where(and(
        inArray(schema.needResourceMatches.needId, needs.map(n => n.id)),
        eq(schema.needResourceMatches.status, 'proposed'),
      )).all()
    for (const r of rows) counts.set(r.needId, (counts.get(r.needId) ?? 0) + 1)
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Needs
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          Open needs in the hub
        </h1>
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {(['open', 'in-progress', 'met', undefined] as const).map(s => {
          const active = filter === s
          const label = s ?? 'all'
          return (
            <Link
              key={String(s)}
              href={`/h/${slug}/needs${s ? `?status=${s}` : ''}`}
              style={{
                padding: '0.3rem 0.7rem',
                fontSize: '0.72rem',
                fontWeight: 600,
                borderRadius: 999,
                textDecoration: 'none',
                background: active ? C.accent : '#fff',
                color: active ? '#fff' : C.text,
                border: `1px solid ${active ? C.accent : '#ece6db'}`,
                textTransform: 'capitalize',
              }}
            >
              {label}
            </Link>
          )
        })}
      </div>
      {needs.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: C.textMuted }}>
          No needs in this filter.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {needs.map(n => (
            <NeedCard key={n.id} need={n} hubSlug={slug} matchCount={counts.get(n.id) ?? 0} />
          ))}
        </div>
      )}
    </div>
  )
}
