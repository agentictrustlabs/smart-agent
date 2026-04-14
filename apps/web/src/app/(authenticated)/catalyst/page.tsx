import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { getCoachRelationship, getTrainingProgress } from '@/lib/actions/grow.action'
import { db, schema } from '@/db'

// ─── Colors ─────────────────────────────────────────────────────────

const C = {
  bg: '#faf8f3',
  card: '#ffffff',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
  accentBorder: 'rgba(139,94,60,0.20)',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  border: '#ece6db',
  green: '#2e7d32',
  greenLight: 'rgba(46,125,50,0.08)',
  greenBorder: 'rgba(46,125,50,0.20)',
}

export default async function CatalystDashboardPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)

  // Aggregate stats
  const orgAddresses = new Set(userOrgs.map((o) => o.address.toLowerCase()))

  for (const org of userOrgs) {
    try {
      const connected = await getConnectedOrgs(org.address)
      for (const c of connected) orgAddresses.add(c.address.toLowerCase())
    } catch {
      /* ignored */
    }
  }

  // Activities this month
  const allActivities = await db.select().from(schema.activityLogs)
  const activities = allActivities.filter((a) => orgAddresses.has(a.orgAddress.toLowerCase()))
  const thisMonth = new Date()
  thisMonth.setDate(1)
  thisMonth.setHours(0, 0, 0, 0)
  const monthActivities = activities.filter((a) => new Date(a.activityDate) >= thisMonth)

  const thisWeek = new Date()
  thisWeek.setDate(thisWeek.getDate() - 7)
  const weekCount = activities.filter((a) => new Date(a.activityDate) >= thisWeek).length

  // Count prayers and outreach this month
  const prayerCount = monthActivities.filter((a) => a.activityType === 'prayer').length
  const outreachCount = monthActivities.filter((a) => a.activityType === 'outreach').length

  // Coach info
  const coachRel = await getCoachRelationship(currentUser.id)

  // Training progress for personal walk
  const progress = await getTrainingProgress(currentUser.id)
  const completedModules = progress.filter((p) => p.completed === 1).length
  const totalModules = 6 + 20 + 2 // 411(6) + commands(10*2) + 3thirds(2)
  const walkPct = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0

  // Oikos count (circles of influence — personal relationships)
  let oikosCount = 0
  try {
    const { eq } = await import('drizzle-orm')
    const oikosRows = await db.select().from(schema.circles)
      .where(eq(schema.circles.userId, currentUser.id))
    oikosCount = oikosRows.length
  } catch { /* table may not exist */ }

  // Church circles count (gatherings/groups from on-chain)
  let totalCircles = 0
  let establishedCircles = 0
  for (const org of userOrgs) {
    try {
      const connected = await getConnectedOrgs(org.address)
      totalCircles += connected.length
      establishedCircles += connected.filter(c => Boolean(c.metadata?.isChurch)).length
    } catch { /* ignored */ }
  }
  totalCircles += userOrgs.length

  // Prayer due count
  let prayerDueCount = 0
  try {
    const { eq } = await import('drizzle-orm')
    const allPrayers = await db.select().from(schema.prayers)
      .where(eq(schema.prayers.userId, currentUser.id))
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const today = days[new Date().getDay()]
    prayerDueCount = allPrayers.filter(p => !p.answered && (p.schedule === 'daily' || p.schedule.includes(today))).length
  } catch { /* table may not exist */ }

  // Greeting
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = currentUser.name.split(' ')[0]

  // Linked names from recent activities (planned conversations)
  const recentNames = [...new Set(activities.slice(0, 5).map((a) => a.title))].slice(0, 3)

  return (
    <div>
      {/* Greeting */}
      <h1 style={{
        fontSize: '1.35rem',
        fontWeight: 700,
        color: C.text,
        margin: '0 0 0.75rem',
      }}>
        {greeting}, {firstName}
      </h1>

      {/* Encouragement banner */}
      {(prayerCount > 0 || outreachCount > 0) && (
        <div style={{
          background: C.greenLight,
          border: `1px solid ${C.greenBorder}`,
          borderRadius: 10,
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
        }}>
          <p style={{
            margin: 0,
            fontSize: '0.85rem',
            color: C.green,
            fontWeight: 500,
            lineHeight: 1.4,
          }}>
            God has been faithful &mdash;{' '}
            {prayerCount > 0 && <>{prayerCount} prayer{prayerCount !== 1 ? 's' : ''}</>}
            {prayerCount > 0 && outreachCount > 0 && ', '}
            {outreachCount > 0 && <>{outreachCount} outreach{outreachCount !== 1 ? 's' : ''}</>}
            {' '}this month
          </p>
        </div>
      )}

      {/* KPI cards - 2 column grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '0.6rem',
        marginBottom: '1.5rem',
      }}>
        {/* MY OIKOS */}
        <KpiCard label="MY OIKOS" href="/oikos">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>
            {oikosCount}
          </span>
          <span style={{ fontSize: '0.72rem', color: C.textMuted }}>people</span>
        </KpiCard>

        {/* PRAY NOW */}
        <KpiCard label="PRAY NOW" href="/nurture/prayer">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>
            {prayerDueCount}
          </span>
          <span style={{ fontSize: '0.72rem', color: C.textMuted }}>due today</span>
        </KpiCard>

        {/* PLANNED CONVERSATIONS */}
        <KpiCard label="PLANNED CONVERSATIONS" href="/activity">
          {recentNames.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              {recentNames.map((n) => (
                <span key={n} style={{ fontSize: '0.78rem', color: C.accent, fontWeight: 500 }}>{n}</span>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: '0.82rem', color: C.textMuted }}>None planned</span>
          )}
        </KpiCard>

        {/* PERSONAL WALK */}
        <KpiCard label="PERSONAL WALK" href="/nurture/grow">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>
            {walkPct}%
          </span>
        </KpiCard>

        {/* MY CIRCLES */}
        <KpiCard label="MY CIRCLES" href="/groups">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>
            {totalCircles}
          </span>
          <span style={{ fontSize: '0.72rem', color: C.textMuted }}>
            {establishedCircles > 0 ? `${establishedCircles} established` : 'gatherings'}
          </span>
        </KpiCard>

        {/* SOW THIS WEEK */}
        <KpiCard label="SOW THIS WEEK" href="/activity">
          <span style={{ fontSize: '1.75rem', fontWeight: 700, color: C.accent }}>
            {weekCount}
          </span>
          <span style={{ fontSize: '0.72rem', color: C.textMuted }}>activities</span>
        </KpiCard>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Link href="/activity" style={linkBtnStyle(true)}>Log Activity</Link>
        <Link href="/groups" style={linkBtnStyle(false)}>View Circles</Link>
        <Link href="/oikos" style={linkBtnStyle(false)}>Oikos</Link>
        <Link href="/nurture" style={linkBtnStyle(false)}>Nurture</Link>
        <Link href="/me" style={linkBtnStyle(false)}>Profile</Link>
      </div>

      {/* Coach relationship */}
      {coachRel && (
        <div style={{
          marginTop: '1rem', padding: '0.6rem 1rem',
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          fontSize: '0.82rem', color: C.text,
        }}>
          <span style={{ fontWeight: 600, color: C.accent }}>Coach:</span>{' '}
          {coachRel.coachName}
        </div>
      )}
    </div>
  )
}

// ─── KPI Card ───────────────────────────────────────────────────────

function KpiCard({
  label,
  href,
  children,
}: {
  label: string
  href: string
  children: React.ReactNode
}) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        minHeight: 80,
      }}>
        <span style={{
          fontSize: '0.6rem',
          fontWeight: 700,
          color: C.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flex: 1 }}>
          {children}
        </div>
      </div>
    </Link>
  )
}

// ─── Link Button Style ──────────────────────────────────────────────

function linkBtnStyle(primary: boolean): React.CSSProperties {
  return {
    padding: '0.5rem 1rem',
    background: primary ? C.accent : C.card,
    color: primary ? '#fff' : C.accent,
    border: primary ? 'none' : `1px solid ${C.accentBorder}`,
    borderRadius: 6,
    fontWeight: 600,
    textDecoration: 'none',
    fontSize: '0.85rem',
  }
}
