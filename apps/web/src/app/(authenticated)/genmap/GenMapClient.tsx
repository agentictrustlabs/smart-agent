'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createGenMapNode, updateGenMapNode, deleteGenMapNode, moveGenMapNode } from '@/lib/actions/genmap.action'
import { pinItem, unpinItem } from '@/lib/actions/members.action'
import { GeoMapView } from '@/components/graph/GeoMapView'
const HEALTH_STATUS_COLORS: Record<string, string> = {
  thriving: '#2e7d32', growing: '#0d9488', emerging: '#d97706', stalled: '#b91c1c',
}

interface NodeView {
  id: string; parentId: string | null; generation: number
  name: string; leaderName: string | null; location: string | null
  healthData: string | null; status: string; startedAt: string | null
  healthScore: number; healthStatus: string
  /** Org agent address if this circle is a deployed org agent */
  groupAddress: string | null
}

interface GeoAgent {
  address: string; name: string; latitude: number; longitude: number
  generation?: number; isEstablished?: boolean; healthScore?: number; status?: string
}

interface Props {
  nodes: NodeView[]
  orgAddress: string
  orgName: string
  pinnedNodeIds?: string[]
  geoAgents?: GeoAgent[]
}

interface HealthForm {
  seekers: number; believers: number; baptized: number; leaders: number
  giving: boolean; isChurch: boolean; groupsStarted: number
  meetingFrequency?: string
  // Inside/outside markers (self-functioning vs external leader)
  baptismSelf: boolean; teachingSelf: boolean; givingSelf: boolean
  peoplGroup?: string; attenders?: number
}

const DEFAULT_HEALTH: HealthForm = {
  seekers: 0, believers: 0, baptized: 0, leaders: 0,
  giving: false, isChurch: false, groupsStarted: 0,
  meetingFrequency: 'weekly', baptismSelf: false, teachingSelf: false, givingSelf: false,
  peoplGroup: '', attenders: 0,
}

function parseHealth(json: string | null): HealthForm {
  if (!json) return { ...DEFAULT_HEALTH }
  try { return { ...DEFAULT_HEALTH, ...JSON.parse(json) } } catch { return { ...DEFAULT_HEALTH } }
}

export function GenMapClient({ nodes, orgAddress, orgName: _orgName, pinnedNodeIds = [], geoAgents = [] }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingParentId, setAddingParentId] = useState<string | null | undefined>(undefined)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'tree' | 'map' | 'table'>('tree')
  const [formName, setFormName] = useState('')
  const [formLeader, setFormLeader] = useState('')
  const [formLocation, setFormLocation] = useState('')
  const [formStarted, setFormStarted] = useState(new Date().toISOString().split('T')[0])
  const [formHealth, setFormHealth] = useState<HealthForm>({ ...DEFAULT_HEALTH })
  const [formStatus, setFormStatus] = useState('active')
  const [loading, setLoading] = useState(false)

  const roots = nodes.filter(n => !n.parentId)
  const childMap = new Map<string, NodeView[]>()
  for (const n of nodes) {
    if (n.parentId) {
      if (!childMap.has(n.parentId)) childMap.set(n.parentId, [])
      childMap.get(n.parentId)!.push(n)
    }
  }

  function startAdd(parentId: string | null) {
    setAddingParentId(parentId); setEditingId(null); setMovingId(null)
    setFormName(''); setFormLeader(''); setFormLocation('')
    setFormStarted(new Date().toISOString().split('T')[0])
    setFormHealth({ ...DEFAULT_HEALTH }); setFormStatus('active')
  }

  function startEdit(node: NodeView) {
    setEditingId(node.id); setAddingParentId(undefined); setMovingId(null)
    setFormName(node.name); setFormLeader(node.leaderName ?? ''); setFormLocation(node.location ?? '')
    setFormStarted(node.startedAt ?? ''); setFormHealth(parseHealth(node.healthData)); setFormStatus(node.status)
  }

  async function handleSave() {
    setLoading(true)
    try {
      if (editingId) {
        await updateGenMapNode({
          id: editingId, name: formName, leaderName: formLeader,
          location: formLocation, healthData: { ...formHealth } as Record<string, unknown>, status: formStatus as 'active',
        })
      } else if (addingParentId !== undefined) {
        const parentGen = addingParentId ? (nodes.find(n => n.id === addingParentId)?.generation ?? -1) : -1
        await createGenMapNode({
          networkAddress: orgAddress, parentId: addingParentId,
          generation: parentGen + 1, name: formName,
          leaderName: formLeader || undefined, location: formLocation || undefined,
          healthData: { ...formHealth } as Record<string, unknown>, startedAt: formStarted,
        })
      }
      window.location.reload()
    } catch { alert('Failed to save') }
    finally { setLoading(false) }
  }

  async function handleMove(nodeId: string, newParentId: string | null) {
    const newGen = newParentId ? (nodes.find(n => n.id === newParentId)?.generation ?? -1) + 1 : 0
    try { await moveGenMapNode({ id: nodeId, newParentId, newGeneration: newGen }); window.location.reload() }
    catch { alert('Failed to move') }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this node and all children?')) return
    try { await deleteGenMapNode(id); window.location.reload() } catch { alert('Failed') }
  }

  async function handlePin(nodeId: string) {
    try {
      if (pinnedNodeIds.includes(nodeId)) { await unpinItem(nodeId) }
      else { await pinItem({ itemType: 'node', itemId: nodeId }) }
      window.location.reload()
    } catch { alert('Failed') }
  }

  function toggleCollapse(id: string) {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id); else next.add(id)
    setCollapsed(next)
  }

  function expandAll() { setCollapsed(new Set()) }
  function collapseAll() { setCollapsed(new Set(nodes.filter(n => (childMap.get(n.id)?.length ?? 0) > 0).map(n => n.id))) }

  function cancel() { setEditingId(null); setAddingParentId(undefined); setMovingId(null) }

  // Church Circle SVG
  function ChurchCircle({ health, size = 60 }: { health: HealthForm; size?: number }) {
    const r = size / 2 - 2; const cx = size / 2; const cy = size / 2
    const isDashed = !health.isChurch
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={health.isChurch ? '#2e7d32' : '#9e9e9e'}
          strokeWidth={2} strokeDasharray={isDashed ? '4 3' : 'none'} />
        <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="#e0e0e0" strokeWidth={0.5} />
        <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="#e0e0e0" strokeWidth={0.5} />
        {/* TL: seekers/attenders, TR: baptized, BR: leaders, BL: believers */}
        <text x={cx - r / 2} y={cy - r / 3} textAnchor="middle" fontSize={9} fill="#1565c0" fontWeight="bold">{health.attenders || health.seekers || 0}</text>
        <text x={cx + r / 2} y={cy - r / 3} textAnchor="middle" fontSize={9} fill="#2e7d32" fontWeight="bold">{health.baptized || 0}</text>
        <text x={cx + r / 2} y={cy + r / 2} textAnchor="middle" fontSize={9} fill="#7c3aed" fontWeight="bold">{health.leaders || 0}</text>
        <text x={cx - r / 2} y={cy + r / 2} textAnchor="middle" fontSize={9} fill="#ea580c" fontWeight="bold">{health.believers || 0}</text>
        {health.groupsStarted > 0 && (
          <text x={cx} y={cy + 3} textAnchor="middle" fontSize={10} fill="#0d9488" fontWeight="bold">{health.groupsStarted}</text>
        )}
        {/* Inside/outside markers — small dots */}
        {health.baptismSelf && <circle cx={cx + r - 4} cy={cy - r + 4} r={3} fill="#2e7d32" />}
        {!health.baptismSelf && health.baptized > 0 && <circle cx={cx + r + 2} cy={cy - r - 2} r={3} fill="#2e7d32" opacity={0.4} />}
        {health.teachingSelf && <circle cx={cx - r + 4} cy={cy - r + 4} r={3} fill="#1565c0" />}
        {health.givingSelf && health.giving && <circle cx={cx - r + 4} cy={cy + r - 4} r={3} fill="#ea580c" />}
      </svg>
    )
  }

  const isFormOpen = editingId !== null || addingParentId !== undefined

  function renderNode(node: NodeView, depth: number): React.ReactElement {
    const children = childMap.get(node.id) ?? []
    const health = parseHealth(node.healthData)
    const statusColor = HEALTH_STATUS_COLORS[node.healthStatus as keyof typeof HEALTH_STATUS_COLORS] ?? '#616161'
    const isEditing = editingId === node.id
    const isPinned = pinnedNodeIds.includes(node.id)
    const isCollapsed = collapsed.has(node.id)
    const hasChildren = children.length > 0

    return (
      <div key={node.id} style={{ marginLeft: depth > 0 ? '2.5rem' : 0 }}>
        <div style={{
          padding: '0.6rem 0.75rem', margin: '0.3rem 0', borderRadius: 10,
          background: isEditing ? '#f0f7ff' : isPinned ? '#fffbeb' : '#fff',
          border: `2px solid ${isEditing ? '#1565c0' : isPinned ? '#d97706' : statusColor + '25'}`,
          borderLeft: `4px solid ${statusColor}`,
          display: 'flex', alignItems: 'center', gap: '0.6rem',
        }}>
          {/* Collapse toggle */}
          {hasChildren ? (
            <button onClick={() => toggleCollapse(node.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', padding: 0, width: 16 }}>
              {isCollapsed ? '▶' : '▼'}
            </button>
          ) : <div style={{ width: 16 }} />}

          {/* Gen badge */}
          <div style={{
            width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '0.7rem', background: `${statusColor}15`, color: statusColor, border: `2px solid ${statusColor}`, flexShrink: 0,
          }}>G{node.generation}</div>

          <ChurchCircle health={health} />

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              {node.groupAddress ? (
                <Link href={`/agents/${node.groupAddress}`} style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1565c0', textDecoration: 'none' }}>{node.name}</Link>
              ) : (
                <strong style={{ fontSize: '0.85rem' }}>{node.name}</strong>
              )}
              <span data-component="role-badge" data-status={node.status === 'active' || node.status === 'multiplied' ? 'active' : 'revoked'} style={{ fontSize: '0.55rem' }}>
                {node.status}
              </span>
              {health.isChurch && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.55rem' }}>established</span>}
              {node.groupAddress && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.5rem' }}>org agent</span>}
              {isPinned && <span style={{ fontSize: '0.6rem', color: '#d97706' }}>📌</span>}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#616161', display: 'flex', gap: '0.75rem', marginTop: '0.1rem' }}>
              {node.leaderName && <span>{node.leaderName}</span>}
              {node.location && <span>{node.location}</span>}
              {health.peoplGroup && <span style={{ fontStyle: 'italic' }}>{health.peoplGroup}</span>}
            </div>
            {node.groupAddress && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.2rem', fontSize: '0.7rem' }}>
                <Link href={`/agents/${node.groupAddress}`} style={{ color: '#1565c0' }}>Trust Profile</Link>
                <Link href={`/agents/${node.groupAddress}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                <Link href={`/network?org=${node.groupAddress}`} style={{ color: '#1565c0' }}>Relationships</Link>
                <span style={{ color: '#9e9e9e', fontFamily: 'monospace', fontSize: '0.6rem' }}>{node.groupAddress.slice(0, 6)}...{node.groupAddress.slice(-4)}</span>
              </div>
            )}
          </div>

          {/* Health numbers */}
          <div style={{ display: 'flex', gap: '0.35rem', fontSize: '0.6rem', color: '#616161', flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, color: '#1565c0' }}>{health.attenders || health.seekers || 0}</div><div>Att</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, color: '#ea580c' }}>{health.believers || 0}</div><div>Blvr</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, color: '#2e7d32' }}>{health.baptized || 0}</div><div>Bap</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, color: '#7c3aed' }}>{health.leaders || 0}</div><div>Ldr</div></div>
          </div>

          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: statusColor }}>{node.healthScore || 0}</div>
            <div style={{ fontSize: '0.55rem', color: '#616161' }}>health</div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.2rem', flexShrink: 0, flexWrap: 'wrap' }}>
            <button onClick={() => handlePin(node.id)} title={isPinned ? 'Unpin' : 'Pin'} style={actBtn}>{isPinned ? 'Unpin' : 'Pin'}</button>
            <button onClick={() => startEdit(node)} style={actBtn}>Edit</button>
            <button onClick={() => startAdd(node.id)} style={actBtn}>+Child</button>
            <button onClick={() => setMovingId(movingId === node.id ? null : node.id)} style={{ ...actBtn, color: movingId === node.id ? '#1565c0' : '#616161' }}>Move</button>
            {movingId && movingId !== node.id && (
              <button onClick={() => handleMove(movingId, node.id)} style={{ ...actBtn, color: '#2e7d32', fontWeight: 600 }}>Here</button>
            )}
            <button onClick={() => handleDelete(node.id)} style={{ ...actBtn, color: '#b91c1c' }}>Del</button>
          </div>
        </div>

        {hasChildren && !isCollapsed && (
          <div style={{ borderLeft: `2px solid ${statusColor}15`, marginLeft: '1.25rem' }}>
            {children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* View switcher + controls */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {(['tree', 'map', 'table'] as const).map(v => (
          <button key={v} onClick={() => setViewMode(v)} style={{
            padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #e2e4e8', cursor: 'pointer',
            background: viewMode === v ? '#1565c0' : '#fff', color: viewMode === v ? '#fff' : '#1a1a2e', fontWeight: 600, fontSize: '0.85rem',
          }}>{v === 'tree' ? 'Gen Map' : v === 'map' ? 'Map View' : 'Table View'}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
          <button onClick={expandAll} style={ctrlBtn}>Expand All</button>
          <button onClick={collapseAll} style={ctrlBtn}>Collapse All</button>
        </div>
      </div>

      {/* Moving instruction */}
      {movingId && (
        <div style={{ padding: '0.5rem 1rem', background: '#e3f2fd', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.85rem', color: '#1565c0' }}>
          Moving <strong>{nodes.find(n => n.id === movingId)?.name}</strong> — click "Here" on the target parent, or click "Move" again to cancel.
        </div>
      )}

      <section data-component="graph-section">
        <div data-component="section-header">
          <h2>{viewMode === 'tree' ? 'Generational Tree' : viewMode === 'map' ? 'Geographic View' : 'Table View'}</h2>
          <button onClick={() => startAdd(null)} data-component="section-action">+ New Root</button>
        </div>

        {/* Add/Edit Form */}
        {isFormOpen && (
          <div data-component="protocol-info" style={{ marginBottom: '1rem', border: '2px solid #1565c0' }}>
            <h3>{editingId ? 'Edit Group' : addingParentId ? `Add under: ${nodes.find(n => n.id === addingParentId)?.name ?? 'root'}` : 'New Root Group'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem' }}>
              <label><span style={lbl}>Name</span><input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Group name" style={inp} /></label>
              <label><span style={lbl}>Leader</span><input value={formLeader} onChange={e => setFormLeader(e.target.value)} placeholder="Leader name" style={inp} /></label>
              <label><span style={lbl}>Location</span><input value={formLocation} onChange={e => setFormLocation(e.target.value)} placeholder="City or area" style={inp} /></label>
              <label><span style={lbl}>Start Date</span><input type="date" value={formStarted} onChange={e => setFormStarted(e.target.value)} style={inp} /></label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
              <label><span style={lbl}>Is it established?</span>
                <select value={formHealth.isChurch ? 'yes' : 'no'} onChange={e => setFormHealth({ ...formHealth, isChurch: e.target.value === 'yes' })} style={inp}>
                  <option value="no">No — still a gathering (dashed outline)</option>
                  <option value="yes">Yes — established organization (solid outline)</option>
                </select></label>
              <label><span style={lbl}>Meeting Frequency</span>
                <select value={formHealth.meetingFrequency ?? 'weekly'} onChange={e => setFormHealth({ ...formHealth, meetingFrequency: e.target.value })} style={inp}>
                  <option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option><option value="multiple">Multiple times/week</option>
                </select></label>
              <label><span style={lbl}>People Group</span><input value={formHealth.peoplGroup ?? ''} onChange={e => setFormHealth({ ...formHealth, peoplGroup: e.target.value })} placeholder="e.g. Vietnamese" style={inp} /></label>
            </div>

            {/* Health Metrics */}
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#fafafa', borderRadius: 8, border: '1px solid #e2e4e8' }}>
              <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>Health Metrics</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
                <label><span style={{ ...lbl, color: '#1565c0' }}>Attenders</span>
                  <input type="number" min="0" value={formHealth.attenders ?? formHealth.seekers} onChange={e => setFormHealth({ ...formHealth, attenders: parseInt(e.target.value) || 0, seekers: parseInt(e.target.value) || 0 })} style={inp} /></label>
                <label><span style={{ ...lbl, color: '#ea580c' }}>Believers</span>
                  <input type="number" min="0" value={formHealth.believers} onChange={e => setFormHealth({ ...formHealth, believers: parseInt(e.target.value) || 0 })} style={inp} /></label>
                <label><span style={{ ...lbl, color: '#2e7d32' }}>Baptized</span>
                  <input type="number" min="0" value={formHealth.baptized} onChange={e => setFormHealth({ ...formHealth, baptized: parseInt(e.target.value) || 0 })} style={inp} /></label>
                <label><span style={{ ...lbl, color: '#7c3aed' }}>Leaders</span>
                  <input type="number" min="0" value={formHealth.leaders} onChange={e => setFormHealth({ ...formHealth, leaders: parseInt(e.target.value) || 0 })} style={inp} /></label>
                <label><span style={lbl}>Groups Started</span>
                  <input type="number" min="0" value={formHealth.groupsStarted} onChange={e => setFormHealth({ ...formHealth, groupsStarted: parseInt(e.target.value) || 0 })} style={inp} /></label>
              </div>

              {/* Self-functioning markers */}
              <div style={{ marginTop: '0.75rem' }}>
                <strong style={{ fontSize: '0.8rem', color: '#616161' }}>Self-Functioning (inside = own leaders, outside = external)</strong>
                <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.35rem' }}>
                  <label style={chkStyle}><input type="checkbox" checked={formHealth.baptismSelf} onChange={e => setFormHealth({ ...formHealth, baptismSelf: e.target.checked })} /> Baptism (self)</label>
                  <label style={chkStyle}><input type="checkbox" checked={formHealth.teachingSelf} onChange={e => setFormHealth({ ...formHealth, teachingSelf: e.target.checked })} /> Teaching (self)</label>
                  <label style={chkStyle}><input type="checkbox" checked={formHealth.giving} onChange={e => setFormHealth({ ...formHealth, giving: e.target.checked })} /> Practicing giving</label>
                  <label style={chkStyle}><input type="checkbox" checked={formHealth.givingSelf} onChange={e => setFormHealth({ ...formHealth, givingSelf: e.target.checked })} /> Giving (self-directed)</label>
                </div>
              </div>
            </div>

            {/* Preview */}
            <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <ChurchCircle health={formHealth} size={80} />
              <div style={{ fontSize: '0.8rem', color: '#616161' }}>
                <div>{formHealth.isChurch ? '● Solid = established organization' : '◌ Dashed = gathering (not yet established)'}</div>
                <div style={{ marginTop: '0.25rem' }}>Quadrants: Attenders / Baptized / Leaders / Believers</div>
                <div style={{ marginTop: '0.25rem' }}>Dots: ● inside = self-functioning · ○ outside = external leader</div>
              </div>
            </div>

            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button onClick={handleSave} disabled={loading || !formName}>{loading ? 'Saving...' : editingId ? 'Update' : 'Create'}</button>
              <button onClick={cancel} style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* TREE VIEW */}
        {viewMode === 'tree' && (
          nodes.length === 0 && !isFormOpen ? (
            <p data-component="text-muted">No groups yet. Click &quot;+ New Root&quot; to start building your generational map.</p>
          ) : (
            <div>{roots.map(root => renderNode(root, 0))}</div>
          )
        )}

        {/* MAP VIEW — geographic pins from on-chain lat/lon metadata */}
        {viewMode === 'map' && (
          <GeoMapView agents={geoAgents} />
        )}

        {/* TABLE VIEW */}
        {viewMode === 'table' && (
          <div style={{ overflowX: 'auto' }}>
            <table data-component="graph-table">
              <thead>
                <tr><th>Gen</th><th>Name</th><th>Leader</th><th>Location</th><th>People Group</th><th>Att</th><th>Blvr</th><th>Bap</th><th>Ldr</th><th>Established</th><th>Status</th><th>Health</th><th>Agent</th></tr>
              </thead>
              <tbody>
                {nodes.sort((a, b) => a.generation - b.generation || a.name.localeCompare(b.name)).map(n => {
                  const h = parseHealth(n.healthData)
                  return (
                    <tr key={n.id}>
                      <td style={{ fontWeight: 700 }}>G{n.generation}</td>
                      <td>{n.groupAddress ? <Link href={`/agents/${n.groupAddress}`} style={{ color: '#1565c0', fontWeight: 700 }}>{n.name}</Link> : <strong>{n.name}</strong>}</td>
                      <td>{n.leaderName ?? '—'}</td>
                      <td>{n.location ?? '—'}</td>
                      <td style={{ fontStyle: 'italic' }}>{h.peoplGroup || '—'}</td>
                      <td>{h.attenders || h.seekers}</td><td>{h.believers}</td><td>{h.baptized}</td><td>{h.leaders}</td>
                      <td>{h.isChurch ? 'Yes' : 'No'}</td>
                      <td><span data-component="role-badge" data-status={n.status === 'active' || n.status === 'multiplied' ? 'active' : 'revoked'}>{n.status}</span></td>
                      <td style={{ fontWeight: 700 }}>{n.healthScore}</td>
                      <td>
                        {n.groupAddress ? (
                          <Link href={`/agents/${n.groupAddress}`} style={{ color: '#1565c0', fontSize: '0.75rem' }}>{n.groupAddress.slice(0, 6)}...{n.groupAddress.slice(-4)}</Link>
                        ) : <span style={{ color: '#bdbdbd', fontSize: '0.75rem' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: '0.8rem', color: '#616161', display: 'block', marginBottom: '0.15rem' }
const inp: React.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }
const actBtn: React.CSSProperties = { fontSize: '0.6rem', padding: '0.15rem 0.35rem', background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 4, cursor: 'pointer', color: '#616161' }
const ctrlBtn: React.CSSProperties = { fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#fff', border: '1px solid #e2e4e8', borderRadius: 4, cursor: 'pointer', color: '#424242' }
const chkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }
