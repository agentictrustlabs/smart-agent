'use client'

// no hooks needed currently

// ─── CIL Palette ─────────────────────────────────────────────────────

const CIL = {
  bg: '#f8fafc',
  card: '#ffffff',
  accent: '#2563EB',
  accentLight: 'rgba(37,99,235,0.08)',
  accentBorder: 'rgba(37,99,235,0.20)',
  text: '#1e293b',
  textMuted: '#64748b',
  border: '#e2e8f0',
  green: '#10B981',
  greenLight: 'rgba(16,185,129,0.08)',
}

// ─── Types ───────────────────────────────────────────────────────────

export interface TrainingModule {
  id: string
  name: string
  description: string | null
  hours: number
  sortOrder: number
}

export interface UserProgress {
  userId: string
  userName: string
  completedModules: string[] // module IDs
  completionPct: number
}

interface Props {
  modules: TrainingModule[]
  userProgress: UserProgress[] // single user for business-owner, multiple for ops
  role: string
}

// ─── Component ───────────────────────────────────────────────────────

export default function TrainingPageClient({ modules, userProgress, role }: Props) {
  if (role === 'business-owner') {
    return <BusinessOwnerView modules={modules} progress={userProgress[0]} />
  }
  return <OpsAdminView modules={modules} allProgress={userProgress} />
}

// ─── Business Owner View ─────────────────────────────────────────────

function BusinessOwnerView({
  modules,
  progress,
}: {
  modules: TrainingModule[]
  progress: UserProgress | undefined
}) {
  const completed = progress?.completedModules ?? []
  const completionPct = progress?.completionPct ?? 0
  const sortedModules = [...modules].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: CIL.text, fontWeight: 700 }}>
          Your BDC Training
        </h1>
        <p style={{ fontSize: '0.85rem', color: CIL.textMuted, margin: 0 }}>
          Business Development Center modules for your growth journey
        </p>
      </div>

      {/* Overall progress */}
      <div style={{
        background: CIL.card,
        border: `1px solid ${CIL.border}`,
        borderRadius: 10,
        padding: '1rem',
        marginBottom: '1rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: CIL.text }}>
            {completed.length}/{modules.length} modules complete
          </span>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color: CIL.accent }}>
            {completionPct}%
          </span>
        </div>
        <div style={{
          height: 8,
          background: CIL.border,
          borderRadius: 4,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${completionPct}%`,
            background: CIL.accent,
            borderRadius: 4,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* Module checklist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {sortedModules.map((m) => {
          const isComplete = completed.includes(m.id)
          return (
            <div
              key={m.id}
              style={{
                background: CIL.card,
                border: `1px solid ${CIL.border}`,
                borderRadius: 8,
                padding: '0.6rem 0.75rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
              }}
            >
              <span style={{
                fontSize: '1.1rem',
                lineHeight: 1,
                flexShrink: 0,
                marginTop: '0.1rem',
              }}>
                {isComplete ? (
                  <span style={{ color: CIL.green }}>&#10003;</span>
                ) : (
                  <span style={{ color: CIL.border }}>&#9711;</span>
                )}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: isComplete ? CIL.green : CIL.text,
                }}>
                  {m.name}
                </div>
                {m.description && (
                  <div style={{ fontSize: '0.78rem', color: CIL.textMuted, marginTop: '0.15rem' }}>
                    {m.description}
                  </div>
                )}
                <div style={{ fontSize: '0.72rem', color: CIL.textMuted, marginTop: '0.15rem' }}>
                  {m.hours} hour{m.hours !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Ops/Admin View ──────────────────────────────────────────────────

function OpsAdminView({
  modules,
  allProgress,
}: {
  modules: TrainingModule[]
  allProgress: UserProgress[]
}) {
  const sortedModules = [...modules].sort((a, b) => a.sortOrder - b.sortOrder)
  const highCompletion = allProgress.filter((u) => u.completionPct >= 80).length

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem', color: CIL.text, fontWeight: 700 }}>
          BDC Training Fidelity
        </h1>
        <p style={{ fontSize: '0.85rem', color: CIL.textMuted, margin: 0 }}>
          Training completion across all business owners in the portfolio
        </p>
      </div>

      {/* Summary */}
      <div style={{
        background: CIL.accentLight,
        border: `1px solid ${CIL.accentBorder}`,
        borderRadius: 10,
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
      }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: CIL.accent, fontWeight: 600 }}>
          {highCompletion} of {allProgress.length} business owners have &gt;80% completion
        </p>
      </div>

      {/* Matrix table */}
      <div style={{
        background: CIL.card,
        border: `1px solid ${CIL.border}`,
        borderRadius: 10,
        overflow: 'auto',
        marginBottom: '1rem',
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.78rem',
        }}>
          <thead>
            <tr>
              <th style={{
                textAlign: 'left',
                padding: '0.5rem 0.75rem',
                borderBottom: `1px solid ${CIL.border}`,
                color: CIL.textMuted,
                fontWeight: 700,
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                position: 'sticky',
                left: 0,
                background: CIL.card,
              }}>
                Module
              </th>
              {allProgress.map((u) => (
                <th
                  key={u.userId}
                  style={{
                    textAlign: 'center',
                    padding: '0.5rem 0.5rem',
                    borderBottom: `1px solid ${CIL.border}`,
                    color: CIL.text,
                    fontWeight: 600,
                    fontSize: '0.72rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {u.userName.split(' ')[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedModules.map((m) => (
              <tr key={m.id}>
                <td style={{
                  padding: '0.4rem 0.75rem',
                  borderBottom: `1px solid ${CIL.border}`,
                  color: CIL.text,
                  fontWeight: 500,
                  position: 'sticky',
                  left: 0,
                  background: CIL.card,
                }}>
                  {m.name}
                </td>
                {allProgress.map((u) => (
                  <td
                    key={u.userId}
                    style={{
                      textAlign: 'center',
                      padding: '0.4rem 0.5rem',
                      borderBottom: `1px solid ${CIL.border}`,
                    }}
                  >
                    {u.completedModules.includes(m.id) ? (
                      <span style={{ color: CIL.green, fontWeight: 700 }}>&#10003;</span>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}>&mdash;</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {/* Summary row */}
            <tr>
              <td style={{
                padding: '0.5rem 0.75rem',
                fontWeight: 700,
                color: CIL.text,
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                position: 'sticky',
                left: 0,
                background: CIL.card,
              }}>
                Completion
              </td>
              {allProgress.map((u) => (
                <td
                  key={u.userId}
                  style={{
                    textAlign: 'center',
                    padding: '0.5rem 0.5rem',
                    fontWeight: 700,
                    color: u.completionPct >= 80 ? CIL.green : u.completionPct >= 50 ? '#d97706' : '#dc2626',
                  }}
                >
                  {u.completionPct}%
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Correlation callout */}
      <div style={{
        background: CIL.greenLight,
        border: `1px solid rgba(16,185,129,0.20)`,
        borderRadius: 10,
        padding: '0.75rem 1rem',
      }}>
        <p style={{ margin: 0, fontSize: '0.82rem', color: '#059669', fontWeight: 500, lineHeight: 1.4 }}>
          Businesses with &gt;80% completion earn 40% more revenue
        </p>
      </div>
    </div>
  )
}
