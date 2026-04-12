'use client'

interface ActivitySummary {
  date: string
  count: number
  participants: number
  type: string
}

interface Props {
  activities: ActivitySummary[]
  genMapStats: { totalGroups: number; maxGen: number; established: number; multiplyRate: number }
  recentActivities: Array<{ title: string; type: string; date: string; userName: string; location: string | null }>
}

const TYPE_COLORS: Record<string, string> = {
  meeting: '#1565c0', visit: '#0d9488', training: '#7c3aed', outreach: '#ea580c',
  'follow-up': '#d97706', assessment: '#b91c1c', coaching: '#059669',
  prayer: '#6366f1', service: '#ec4899', other: '#616161',
}

export function DashboardAnalytics({ activities, genMapStats, recentActivities }: Props) {
  // Group activities by week for the bar chart
  const weeklyData = new Map<string, { count: number; participants: number }>()
  for (const a of activities) {
    const d = new Date(a.date)
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay())
    const key = weekStart.toISOString().split('T')[0]
    const existing = weeklyData.get(key) ?? { count: 0, participants: 0 }
    weeklyData.set(key, { count: existing.count + a.count, participants: existing.participants + a.participants })
  }
  const weeks = [...weeklyData.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-8)
  const maxCount = Math.max(...weeks.map(([, v]) => v.count), 1)

  // Activity type breakdown
  const typeCounts = new Map<string, number>()
  for (const a of activities) {
    typeCounts.set(a.type, (typeCounts.get(a.type) ?? 0) + a.count)
  }
  const typeBreakdown = [...typeCounts.entries()].sort(([, a], [, b]) => b - a)
  const totalActivities = activities.reduce((s, a) => s + a.count, 0)

  return (
    <div data-component="analytics-stack">
      <section data-component="graph-section">
        <h2>Activity Trend (Last 8 Weeks)</h2>
        <div data-component="analytics-chart">
          {weeks.map(([week, data]) => (
            <div key={week} data-component="analytics-bar-col">
              <div data-component="analytics-bar-value">{data.count}</div>
              <div
                data-component="analytics-bar-shell"
                style={{ height: `${(data.count / maxCount) * 80}px`, minHeight: 4 }}
              >
                <div
                  data-component="analytics-bar-fill"
                  style={{
                    height: `${(data.participants / Math.max(...weeks.map(([, v]) => v.participants), 1)) * 80}px`,
                    minHeight: data.participants > 0 ? 2 : 0,
                  }}
                />
              </div>
              <div data-component="analytics-bar-label">
                {new Date(week).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </div>
            </div>
          ))}
        </div>
        <div data-component="analytics-legend">
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#1565c030', borderRadius: 2, marginRight: 4 }} />Activities</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#1565c0', borderRadius: 2, marginRight: 4 }} />Participants</span>
        </div>
      </section>

      <div data-component="analytics-grid">
        <section data-component="graph-section">
          <h2>By Type</h2>
          <div data-component="analytics-breakdown">
            {typeBreakdown.map(([type, count]) => (
              <div key={type} data-component="analytics-breakdown-row">
                <span
                  data-component="analytics-breakdown-label"
                  style={{ color: TYPE_COLORS[type] ?? '#616161' }}
                >
                  {type}
                </span>
                <div data-component="analytics-breakdown-track">
                  <div
                    data-component="analytics-breakdown-fill"
                    style={{
                      width: `${(count / totalActivities) * 100}%`,
                      background: TYPE_COLORS[type] ?? '#616161',
                    }}
                  />
                </div>
                <span data-component="analytics-breakdown-value">{count}</span>
              </div>
            ))}
          </div>
        </section>

        <section data-component="graph-section">
          <h2>Multiplication</h2>
          <div data-component="analytics-stat-grid">
            <div data-component="analytics-stat" style={{ background: '#f0f7ff' }}>
              <div data-component="analytics-stat-value" style={{ color: '#1565c0' }}>{genMapStats.totalGroups}</div>
              <div data-component="analytics-stat-label">Total Groups</div>
            </div>
            <div data-component="analytics-stat" style={{ background: '#f0fdf4' }}>
              <div data-component="analytics-stat-value" style={{ color: '#2e7d32' }}>G{genMapStats.maxGen}</div>
              <div data-component="analytics-stat-label">Deepest Generation</div>
            </div>
            <div data-component="analytics-stat" style={{ background: '#faf5ff' }}>
              <div data-component="analytics-stat-value" style={{ color: '#7c3aed' }}>{genMapStats.established}</div>
              <div data-component="analytics-stat-label">Established</div>
            </div>
            <div data-component="analytics-stat" style={{ background: '#fff7ed' }}>
              <div data-component="analytics-stat-value" style={{ color: '#ea580c' }}>{Math.round(genMapStats.multiplyRate * 100)}%</div>
              <div data-component="analytics-stat-label">Multiplying</div>
            </div>
          </div>
        </section>
      </div>

      <section data-component="graph-section">
        <h2>Recent Field Activity</h2>
        {recentActivities.length === 0 ? (
          <p data-component="text-muted">No recent activities.</p>
        ) : (
          <div data-component="activity-feed">
            {recentActivities.slice(0, 6).map((a, i) => (
              <div key={i} data-component="activity-feed-item">
                <span
                  style={{
                    fontSize: '0.6rem',
                    padding: '0.1rem 0.4rem',
                    borderRadius: 3,
                    fontWeight: 600,
                    background: `${TYPE_COLORS[a.type] ?? '#616161'}15`,
                    color: TYPE_COLORS[a.type] ?? '#616161',
                  }}
                >
                  {a.type}
                </span>
                <span data-component="activity-feed-title">{a.title}</span>
                <span data-component="activity-feed-meta">{a.userName}</span>
                {a.location && <span data-component="activity-feed-meta">{a.location}</span>}
                <span data-component="activity-feed-meta">{new Date(a.date).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
