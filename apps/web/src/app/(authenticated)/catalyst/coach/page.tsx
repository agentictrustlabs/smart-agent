import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getCoachRelationship, getDisciples, getDiscipleDetails } from '@/lib/actions/grow.action'

const TYPE_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  meeting: { label: 'Meeting', bg: '#0d948818', color: '#0d9488' },
  visit: { label: 'Visit', bg: '#6366f118', color: '#6366f1' },
  training: { label: 'Training', bg: '#8b5e3c18', color: '#8b5e3c' },
  outreach: { label: 'Outreach', bg: '#d9770618', color: '#d97706' },
  'follow-up': { label: 'Follow-up', bg: '#2563eb18', color: '#2563eb' },
  coaching: { label: 'Coaching', bg: '#7c3aed18', color: '#7c3aed' },
  prayer: { label: 'Prayer', bg: '#ec489918', color: '#ec4899' },
  service: { label: 'Service', bg: '#16a34a18', color: '#16a34a' },
  other: { label: 'Other', bg: '#78716c18', color: '#78716c' },
}

function statusColor(lastDate: string | null): { dot: string; label: string } {
  if (!lastDate) return { dot: '#dc2626', label: 'No activity' }
  const days = Math.floor((Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24))
  if (days <= 7) return { dot: '#16a34a', label: `Active ${days}d ago` }
  if (days <= 14) return { dot: '#d97706', label: `${days}d ago` }
  return { dot: '#dc2626', label: `${days}d ago` }
}

export default async function CoachPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const coachRel = await getCoachRelationship(currentUser.id)
  const disciples = await getDisciples(currentUser.id)

  // Enrich each disciple with details
  const enrichedDisciples = await Promise.all(
    disciples.map(async (d) => {
      const details = await getDiscipleDetails(d.discipleId)
      return { ...d, ...details }
    })
  )

  const isCoach = disciples.length > 0
  const hasCoach = coachRel !== null

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: '#5c4a3a' }}>Coaching</h1>
        <p style={{ fontSize: '0.85rem', color: '#9a8c7e', margin: 0 }}>
          Discipleship relationships and shared progress.
        </p>
      </div>

      {hasCoach && (
        <div style={{
          background: '#fff',
          border: '1px solid #ece6db',
          borderRadius: 10,
          padding: '1.25rem',
          marginBottom: '1rem',
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
            My Coach
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'rgba(139,94,60,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem',
            }}>
              🤝
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#5c4a3a', fontSize: '0.95rem' }}>
                {coachRel.coachName}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#9a8c7e' }}>
                Sharing: {coachRel.sharePermissions || 'basic progress'}
              </div>
            </div>
          </div>
        </div>
      )}

      {isCoach && (
        <div style={{
          background: '#fff',
          border: '1px solid #ece6db',
          borderRadius: 10,
          padding: '1.25rem',
          marginBottom: '1rem',
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
            My Disciples ({enrichedDisciples.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {enrichedDisciples.map((d) => {
              const status = statusColor(d.lastActivityDate)
              return (
                <div key={d.id} style={{
                  padding: '0.85rem',
                  borderRadius: 10,
                  border: d.needsAttention ? '1px solid #fca5a5' : '1px solid #f0ebe3',
                  background: d.needsAttention ? '#fef2f208' : '#fff',
                }}>
                  {/* Top row: avatar, name, status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.6rem' }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'rgba(139,94,60,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.95rem', fontWeight: 600, color: '#8b5e3c',
                    }}>
                      {d.discipleName.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, color: '#5c4a3a', fontSize: '0.95rem' }}>
                          {d.discipleName}
                        </span>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: status.dot, display: 'inline-block', flexShrink: 0,
                        }} />
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#9a8c7e' }}>
                        Last active: {status.label}
                      </div>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <div style={{
                      flex: 1, padding: '0.4rem 0.6rem', borderRadius: 8,
                      background: '#faf8f3', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#5c4a3a' }}>{d.prayerCount}</div>
                      <div style={{ fontSize: '0.68rem', color: '#9a8c7e', fontWeight: 600 }}>Prayers</div>
                    </div>
                    <div style={{
                      flex: 1, padding: '0.4rem 0.6rem', borderRadius: 8,
                      background: '#faf8f3', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#5c4a3a' }}>{d.trainingPct}%</div>
                      <div style={{ fontSize: '0.68rem', color: '#9a8c7e', fontWeight: 600 }}>Training</div>
                    </div>
                    <div style={{
                      flex: 1, padding: '0.4rem 0.6rem', borderRadius: 8,
                      background: '#faf8f3', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#5c4a3a' }}>{d.recentActivities.length}</div>
                      <div style={{ fontSize: '0.68rem', color: '#9a8c7e', fontWeight: 600 }}>Recent</div>
                    </div>
                  </div>

                  {/* Recent activities (last 3) */}
                  {d.recentActivities.length > 0 && (
                    <div style={{ borderTop: '1px solid #f0ebe3', paddingTop: '0.4rem' }}>
                      {d.recentActivities.slice(0, 3).map((act) => {
                        const badge = TYPE_BADGES[act.activityType ?? 'other'] ?? TYPE_BADGES.other
                        return (
                          <div key={act.id} style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.25rem 0', fontSize: '0.78rem',
                          }}>
                            <span style={{
                              padding: '0.1rem 0.4rem', borderRadius: 999,
                              background: badge.bg, color: badge.color,
                              fontSize: '0.68rem', fontWeight: 600, flexShrink: 0,
                            }}>
                              {badge.label}
                            </span>
                            <span style={{ color: '#5c4a3a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {act.title}
                            </span>
                            <span style={{ color: '#9a8c7e', fontSize: '0.72rem', flexShrink: 0 }}>
                              {act.activityDate?.split('T')[0] ?? ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!isCoach && !hasCoach && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#9a8c7e' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🤝</div>
          <p style={{ fontSize: '0.9rem', fontWeight: 500, margin: '0 0 0.25rem' }}>No coaching relationships yet</p>
          <p style={{ fontSize: '0.8rem', margin: 0 }}>
            Coaching connects you with a mentor for accountability, encouragement, and guided growth in your discipleship journey.
          </p>
        </div>
      )}
    </div>
  )
}
