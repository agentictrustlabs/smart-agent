'use client'

import { useState } from 'react'
import { recordTrainingCompletion } from '@/lib/actions/training.action'

interface Module {
  id: string; name: string; description: string | null; hours: number; sortOrder: number
}
interface Completion {
  id: string; userId: string; moduleId: string; assessedBy: string | null; score: number | null; completedAt: string
}
interface Trainee {
  userId: string; name: string; completions: Completion[]
}

interface Props {
  modules: Module[]
  trainees: Trainee[]
  canAssess: boolean
  userNames: Record<string, string>
  requiredHours: number
  totalHours: number
}

export function TrainingClient({ modules, trainees, canAssess, userNames, requiredHours, totalHours }: Props) {
  const [assessUserId, setAssessUserId] = useState<string | null>(null)
  const [assessModuleId, setAssessModuleId] = useState('')
  const [assessScore, setAssessScore] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleAssess(e: React.FormEvent) {
    e.preventDefault()
    if (!assessUserId || !assessModuleId) return
    setLoading(true)
    try {
      await recordTrainingCompletion({
        userId: assessUserId,
        moduleId: assessModuleId,
        score: assessScore ? parseInt(assessScore) : undefined,
      })
      window.location.reload()
    } catch {
      alert('Failed to record completion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1565c0' }}>{trainees.length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Trainees</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#2e7d32' }}>{modules.length}</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Modules ({totalHours}h total)</div>
        </div>
        <div data-component="protocol-info" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#7c3aed' }}>{requiredHours}h</div>
          <div style={{ fontSize: '0.8rem', color: '#616161' }}>Required Hours</div>
        </div>
      </div>

      {/* Training Matrix */}
      <section data-component="graph-section">
        <h2>Training Progress</h2>
        {trainees.length === 0 ? (
          <p data-component="text-muted">No trainees found for this organization.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table data-component="graph-table">
              <thead>
                <tr>
                  <th>Trainee</th>
                  {modules.map(m => (
                    <th key={m.id} title={m.description ?? m.name} style={{ fontSize: '0.7rem', maxWidth: 80, textAlign: 'center' }}>
                      {m.name.length > 15 ? m.name.slice(0, 14) + '...' : m.name}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center' }}>Progress</th>
                </tr>
              </thead>
              <tbody>
                {trainees.map(t => {
                  const completedIds = new Set(t.completions.map(c => c.moduleId))
                  const completionRate = modules.length > 0 ? completedIds.size / modules.length : 0
                  return (
                    <tr key={t.userId}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{t.name}</td>
                      {modules.map(m => {
                        const completion = t.completions.find(c => c.moduleId === m.id)
                        return (
                          <td key={m.id} style={{ textAlign: 'center' }}>
                            {completion ? (
                              <span title={`Score: ${completion.score ?? 'N/A'} | Assessed by: ${completion.assessedBy ? userNames[completion.assessedBy] ?? 'Unknown' : 'Self'}`}
                                style={{ display: 'inline-block', width: 20, height: 20, borderRadius: '50%', background: '#2e7d32', color: '#fff', fontSize: '0.65rem', lineHeight: '20px' }}>
                                {completion.score ?? '✓'}
                              </span>
                            ) : canAssess ? (
                              <button onClick={() => { setAssessUserId(t.userId); setAssessModuleId(m.id) }}
                                style={{ width: 20, height: 20, borderRadius: '50%', background: '#f5f5f5', border: '1px dashed #bdbdbd', cursor: 'pointer', fontSize: '0.6rem', color: '#9e9e9e' }}>
                                +
                              </button>
                            ) : (
                              <span style={{ display: 'inline-block', width: 20, height: 20, borderRadius: '50%', background: '#f5f5f5', border: '1px solid #e0e0e0' }} />
                            )}
                          </td>
                        )
                      })}
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                          <div style={{ width: 60, height: 6, background: '#e0e0e0', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${completionRate * 100}%`, height: '100%', background: completionRate >= 0.8 ? '#2e7d32' : completionRate >= 0.5 ? '#d97706' : '#b91c1c', borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{Math.round(completionRate * 100)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Assess Form */}
      {canAssess && assessUserId && (
        <section data-component="graph-section">
          <h2>Record Completion</h2>
          <form onSubmit={handleAssess} data-component="protocol-info">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#616161' }}>Trainee</span>
                <div style={{ fontWeight: 600 }}>{trainees.find(t => t.userId === assessUserId)?.name}</div>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#616161' }}>Module</span>
                <div style={{ fontWeight: 600 }}>{modules.find(m => m.id === assessModuleId)?.name}</div>
              </div>
              <label>
                <span style={{ fontSize: '0.8rem', color: '#616161' }}>Score (0-100)</span>
                <input type="number" min="0" max="100" value={assessScore} onChange={e => setAssessScore(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
              </label>
            </div>
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={loading}>{loading ? 'Recording...' : 'Record Completion'}</button>
              <button type="button" onClick={() => setAssessUserId(null)} style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      {/* Module Descriptions */}
      <section data-component="graph-section">
        <h2>BDC Curriculum ({modules.length} modules)</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          {modules.map(m => (
            <div key={m.id} data-component="protocol-info" style={{ padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.85rem' }}>{m.name}</strong>
                <span style={{ fontSize: '0.7rem', color: '#616161' }}>{m.hours}h</span>
              </div>
              {m.description && <p style={{ fontSize: '0.8rem', color: '#616161', margin: '0.25rem 0 0' }}>{m.description}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
