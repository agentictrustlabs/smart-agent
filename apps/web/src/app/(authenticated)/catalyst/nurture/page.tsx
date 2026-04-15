import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import Link from 'next/link'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getMCRole } from '@/lib/mc-roles'
import TrainingPageClient from '@/components/mc/TrainingPageClient'
import type { TrainingModule, UserProgress } from '@/components/mc/TrainingPageClient'

export default async function NurturePage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const isCIL = currentUser.id.startsWith('cil-')

  if (isCIL) {
    // ── CIL Training View ────────────────────────────────────────────
    const role = getMCRole(currentUser.id)

    let modules: TrainingModule[] = []
    let userProgress: UserProgress[] = []

    try {
      // Get BDC training modules
      const allModules = await db.select().from(schema.trainingModules)
      modules = allModules
        .filter((m) => m.program === 'bdc')
        .map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          hours: m.hours,
          sortOrder: m.sortOrder,
        }))

      // Get all users for name lookup
      const allUsers = await db.select().from(schema.users)
      const nameMap = new Map(allUsers.map((u) => [u.id, u.name]))

      // Get progress data
      const allProgress = await db.select().from(schema.trainingProgress)
      const bdcProgress = allProgress.filter((p) => p.program === 'bdc')

      if (role === 'business-owner') {
        // Single user progress
        const myCompleted = bdcProgress
          .filter((p) => p.userId === currentUser.id && p.completed === 1)
          .map((p) => p.moduleKey)
        const pct = modules.length > 0 ? Math.round((myCompleted.length / modules.length) * 100) : 0
        userProgress = [{
          userId: currentUser.id,
          userName: nameMap.get(currentUser.id) ?? currentUser.name,
          completedModules: myCompleted,
          completionPct: pct,
        }]
      } else {
        // All business owners
        const businessOwnerIds = ['cil-user-003', 'cil-user-004']
        userProgress = businessOwnerIds.map((uid) => {
          const completed = bdcProgress
            .filter((p) => p.userId === uid && p.completed === 1)
            .map((p) => p.moduleKey)
          const pct = modules.length > 0 ? Math.round((completed.length / modules.length) * 100) : 0
          return {
            userId: uid,
            userName: nameMap.get(uid) ?? uid,
            completedModules: completed,
            completionPct: pct,
          }
        })
      }
    } catch { /* tables may not exist */ }

    return (
      <TrainingPageClient
        modules={modules}
        userProgress={userProgress}
        role={role}
      />
    )
  }

  // ── Catalyst Nurture View (unchanged) ──────────────────────────────

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
          Your personal walk with Jesus — prayer, growth, and investing in others.
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
            Deepen your prayer life — daily focuses, scheduled reminders, and celebrating answered prayers.
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
            Your personal development — 411 Training, Commands of Christ, and walking in obedience.
          </p>
        </Link>

        <Link href="/catalyst/coach" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🤝</div>
          <strong style={{ fontSize: '0.95rem' }}>Coaching Others</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Invest in others — walk alongside disciples, track their progress, and celebrate their growth.
          </p>
        </Link>
      </div>
    </div>
  )
}
