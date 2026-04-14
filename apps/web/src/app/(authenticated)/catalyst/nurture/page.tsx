import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import Link from 'next/link'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'

export default async function NurturePage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // Get prayer count
  let prayerCount = 0
  let trainingPct = 0
  try {
    const prayers = await db.select().from(schema.prayers)
      .where(eq(schema.prayers.userId, currentUser.id))
    prayerCount = prayers.filter(p => !p.answered).length

    const progress = await db.select().from(schema.trainingProgress)
      .where(eq(schema.trainingProgress.userId, currentUser.id))
    const total411 = 6
    const completed411 = progress.filter(p => p.program === '411' && p.completed).length
    trainingPct = Math.round((completed411 / total411) * 100)
  } catch { /* tables may not exist */ }

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: '#5c4a3a' }}>Nurture</h1>
        <p style={{ fontSize: '0.85rem', color: '#9a8c7e', margin: 0 }}>
          Your prayer life, training progress, and growth journey.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
        <Link href="/catalyst/prayer" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🙏</span>
            {prayerCount > 0 && (
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8b5e3c', background: 'rgba(139,94,60,0.1)', padding: '0.15rem 0.5rem', borderRadius: 12 }}>
                {prayerCount} active
              </span>
            )}
          </div>
          <strong style={{ fontSize: '0.95rem' }}>Prayer</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Your prayer focuses, scheduled reminders, and answered prayers.
          </p>
        </Link>

        <Link href="/catalyst/grow" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🌱</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2e7d32', background: '#e8f5e9', padding: '0.15rem 0.5rem', borderRadius: 12 }}>
              {trainingPct}% complete
            </span>
          </div>
          <strong style={{ fontSize: '0.95rem' }}>Grow</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            411 Training, Commands of Christ, and personal development.
          </p>
        </Link>

        <Link href="/catalyst/coach" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🤝</div>
          <strong style={{ fontSize: '0.95rem' }}>Coaching</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Coach and disciple relationships, shared progress tracking.
          </p>
        </Link>
      </div>
    </div>
  )
}
