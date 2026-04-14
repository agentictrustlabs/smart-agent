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

interface PeopleGroupEntry {
  name: string
  language?: string
  background?: string
  attenders: number
  believers: number
  baptized: number
}

interface HealthForm {
  // Counts (aggregated from peopleGroups)
  seekers: number; believers: number; baptized: number; leaders: number
  attenders: number
  // 10 Acts 2 markers — each has practiced + self-directed flags
  hasLeaders: boolean; leadersTrained: boolean
  hasBaptism: boolean; baptismSelf: boolean
  lordsSupper: boolean; lordsSupperSelf: boolean
  makingDisciples: boolean
  giving: boolean; givingSelf: boolean
  teaching: boolean; teachingSelf: boolean
  serviceAndLove: boolean
  accountability: boolean
  prayer: boolean
  praise: boolean
  // Meta
  isChurch: boolean; groupsStarted: number
  meetingFrequency?: string
  peoplGroup?: string
  leaderName?: string; leaderGender?: string
  // Per-group breakdowns (GAPP-style)
  peopleGroups?: PeopleGroupEntry[]
}

const DEFAULT_HEALTH: HealthForm = {
  seekers: 0, believers: 0, baptized: 0, leaders: 0, attenders: 0,
  hasLeaders: false, leadersTrained: false,
  hasBaptism: false, baptismSelf: false,
  lordsSupper: false, lordsSupperSelf: false,
  makingDisciples: false,
  giving: false, givingSelf: false,
  teaching: false, teachingSelf: false,
  serviceAndLove: false,
  accountability: false,
  prayer: false,
  praise: false,
  isChurch: false, groupsStarted: 0,
  meetingFrequency: 'weekly',
  peoplGroup: '',
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
  const [restructureMode, setRestructureMode] = useState(false)
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [rootDropActive, setRootDropActive] = useState(false)

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
    try { await moveGenMapNode({ id: nodeId, newParentId, newGeneration: newGen, networkAddress: orgAddress }); window.location.reload() }
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

  /** Check if candidateChildId is a descendant of ancestorId (prevents circular drops) */
  function isDescendantOf(candidateChildId: string, ancestorId: string): boolean {
    const children = childMap.get(ancestorId) ?? []
    for (const child of children) {
      if (child.id === candidateChildId) return true
      if (isDescendantOf(candidateChildId, child.id)) return true
    }
    return false
  }

  function handleDragStart(e: React.DragEvent, nodeId: string) {
    setDraggedNodeId(nodeId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', nodeId)
  }

  function handleDragOver(e: React.DragEvent, nodeId: string) {
    e.preventDefault()
    if (!draggedNodeId || draggedNodeId === nodeId) return
    if (isDescendantOf(nodeId, draggedNodeId)) return
    e.dataTransfer.dropEffect = 'move'
    setDropTargetId(nodeId)
  }

  function handleDragLeave(_e: React.DragEvent, nodeId: string) {
    if (dropTargetId === nodeId) setDropTargetId(null)
  }

  async function handleDrop(e: React.DragEvent, targetNodeId: string | null) {
    e.preventDefault()
    setDropTargetId(null)
    setRootDropActive(false)
    if (!draggedNodeId || draggedNodeId === targetNodeId) {
      setDraggedNodeId(null)
      return
    }
    if (targetNodeId && isDescendantOf(targetNodeId, draggedNodeId)) {
      setDraggedNodeId(null)
      return
    }
    setLoading(true)
    try {
      await handleMove(draggedNodeId, targetNodeId)
    } finally {
      setDraggedNodeId(null)
      setRestructureMode(false)
      setLoading(false)
    }
  }

  function handleDragEnd() {
    setDraggedNodeId(null)
    setDropTargetId(null)
    setRootDropActive(false)
  }

  // Church Circle SVG — 10 GAPP Acts 2 Health Markers
  // Gray = not practiced, colored outside circle = practiced by outside leader,
  // colored inside circle = self-directed / indigenous.
  function ChurchCircle({ health, size = 60 }: { health: HealthForm; size?: number }) {
    const r = size / 2 - 2; const cx = size / 2; const cy = size / 2
    const isDashed = !health.isChurch

    const markers: { label: string; practiced: boolean; self: boolean; color: string }[] = [
      { label: 'L',  practiced: health.hasLeaders,      self: health.leadersTrained,   color: '#7c3aed' },
      { label: 'B',  practiced: health.hasBaptism,       self: health.baptismSelf,      color: '#2e7d32' },
      { label: 'S',  practiced: health.lordsSupper,      self: health.lordsSupperSelf,  color: '#b91c1c' },
      { label: 'D',  practiced: health.makingDisciples,  self: health.makingDisciples,  color: '#0d9488' },
      { label: 'G',  practiced: health.giving,           self: health.givingSelf,       color: '#ea580c' },
      { label: 'T',  practiced: health.teaching,         self: health.teachingSelf,     color: '#1565c0' },
      { label: 'Lv', practiced: health.serviceAndLove,   self: health.serviceAndLove,   color: '#d63384' },
      { label: 'A',  practiced: health.accountability,   self: health.accountability,   color: '#6d4c41' },
      { label: 'P',  practiced: health.prayer,           self: health.prayer,           color: '#ff8f00' },
      { label: 'Pr', practiced: health.praise,           self: health.praise,           color: '#5e35b1' },
    ]

    const markerFontSize = size <= 60 ? 6.5 : 8
    const offsetDist = size <= 60 ? 6 : 8

    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="#fafafa" stroke={health.isChurch ? '#2e7d32' : '#9e9e9e'}
          strokeWidth={2} strokeDasharray={isDashed ? '4 3' : 'none'} />

        {/* Counts in center: Att / Blvr / Bap */}
        <text x={cx} y={cy - 3} textAnchor="middle" fontSize={size <= 60 ? 7 : 9} fill="#424242" fontWeight="bold">
          {health.attenders || health.seekers || 0}/{health.believers || 0}/{health.baptized || 0}
        </text>
        <text x={cx} y={cy + (size <= 60 ? 5 : 7)} textAnchor="middle" fontSize={size <= 60 ? 5 : 6.5} fill="#9e9e9e">
          att/blvr/bap
        </text>

        {/* 10 health markers around the perimeter */}
        {markers.map((m, i) => {
          const angle = ((2 * Math.PI) / markers.length) * i - Math.PI / 2
          let dist: number
          if (!m.practiced) {
            dist = r
          } else if (m.self) {
            dist = r - offsetDist
          } else {
            dist = r + offsetDist
          }
          const mx = cx + dist * Math.cos(angle)
          const my = cy + dist * Math.sin(angle)
          const fill = !m.practiced ? '#bdbdbd' : m.color
          const opacity = !m.practiced ? 0.5 : 1

          return (
            <text key={m.label} x={mx} y={my + (markerFontSize / 3)}
              textAnchor="middle" fontSize={markerFontSize}
              fontWeight={m.practiced ? 'bold' : 'normal'}
              fill={fill} opacity={opacity}>
              {m.label}
            </text>
          )
        })}

        {/* Groups started badge */}
        {health.groupsStarted > 0 && (
          <g>
            <circle cx={size - 8} cy={8} r={6} fill="#0d9488" />
            <text x={size - 8} y={10.5} textAnchor="middle" fontSize={7} fill="#fff" fontWeight="bold">{health.groupsStarted}</text>
          </g>
        )}
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

    const isDragging = restructureMode && draggedNodeId === node.id
    const isDropTarget = restructureMode && dropTargetId === node.id
    const canDrop = restructureMode && draggedNodeId && draggedNodeId !== node.id && !isDescendantOf(node.id, draggedNodeId)

    return (
      <div key={node.id} style={{ marginLeft: depth > 0 ? '2.5rem' : 0 }}>
        <div
          draggable={restructureMode}
          onDragStart={restructureMode ? (e) => handleDragStart(e, node.id) : undefined}
          onDragOver={restructureMode ? (e) => { e.preventDefault(); if (canDrop) handleDragOver(e, node.id) } : undefined}
          onDragLeave={restructureMode ? (e) => handleDragLeave(e, node.id) : undefined}
          onDrop={restructureMode ? (e) => handleDrop(e, node.id) : undefined}
          onDragEnd={restructureMode ? handleDragEnd : undefined}
          style={{
          padding: '0.6rem 0.75rem', margin: '0.3rem 0', borderRadius: 10,
          background: isDropTarget ? '#e3f2fd' : isDragging ? '#f5f5f5' : isEditing ? '#f0f7ff' : isPinned ? '#fffbeb' : '#fff',
          borderTop: `2px solid ${isDropTarget ? '#1565c0' : isEditing ? '#1565c0' : isPinned ? '#d97706' : statusColor + '25'}`,
          borderRight: `2px solid ${isDropTarget ? '#1565c0' : isEditing ? '#1565c0' : isPinned ? '#d97706' : statusColor + '25'}`,
          borderBottom: `2px solid ${isDropTarget ? '#1565c0' : isEditing ? '#1565c0' : isPinned ? '#d97706' : statusColor + '25'}`,
          borderLeft: `4px solid ${isDropTarget ? '#1565c0' : statusColor}`,
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          opacity: isDragging ? 0.5 : 1,
          cursor: restructureMode ? 'grab' : undefined,
          transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
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
          {viewMode === 'tree' && (
            <button
              onClick={() => { setRestructureMode(!restructureMode); setDraggedNodeId(null); setDropTargetId(null) }}
              style={{
                ...ctrlBtn,
                background: restructureMode ? '#1565c0' : '#fff',
                color: restructureMode ? '#fff' : '#424242',
                border: restructureMode ? '1px solid #1565c0' : '1px solid #e2e4e8',
              }}
              title={restructureMode ? 'Exit restructure mode' : 'Enter restructure mode — drag groups to reparent'}
            >
              {restructureMode ? 'Done Restructuring' : 'Restructure'}
            </button>
          )}
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

            {/* Health Metrics — Counts */}
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#fafafa', borderRadius: 8, border: '1px solid #e2e4e8' }}>
              <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>Counts</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem' }}>
                <label><span style={{ ...lbl, color: '#1565c0' }}>Attenders</span>
                  <input type="number" min="0" value={formHealth.attenders || formHealth.seekers} onChange={e => setFormHealth({ ...formHealth, attenders: parseInt(e.target.value) || 0, seekers: parseInt(e.target.value) || 0 })} style={inp} /></label>
                <label><span style={{ ...lbl, color: '#ea580c' }}>Believers</span>
                  <input type="number" min="0" value={formHealth.believers} onChange={e => setFormHealth({ ...formHealth, believers: parseInt(e.target.value) || 0 })} style={inp} /></label>
                <label><span style={{ ...lbl, color: '#2e7d32' }}>Baptized</span>
                  <input type="number" min="0" value={formHealth.baptized} onChange={e => setFormHealth({ ...formHealth, baptized: parseInt(e.target.value) || 0 })} style={inp} /></label>
                <label><span style={{ ...lbl, color: '#7c3aed' }}>Leaders</span>
                  <input type="number" min="0" value={formHealth.leaders} onChange={e => setFormHealth({ ...formHealth, leaders: parseInt(e.target.value) || 0 })} style={inp} /></label>
                <label><span style={lbl}>Groups Started</span>
                  <input type="number" min="0" value={formHealth.groupsStarted} onChange={e => setFormHealth({ ...formHealth, groupsStarted: parseInt(e.target.value) || 0 })} style={inp} /></label>
              </div>

              {/* 10 Acts 2 Health Markers */}
              <div style={{ marginTop: '1rem' }}>
                <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>Acts 2 Health Markers</strong>
                <p style={{ fontSize: '0.75rem', color: '#616161', margin: '0 0 0.5rem 0' }}>
                  Check &quot;Practiced&quot; if the group does this activity. Check &quot;Self-directed&quot; if the group does it on their own (not dependent on an outside leader).
                  Self-directed markers appear <strong>inside</strong> the circle; practiced-only markers appear <strong>outside</strong>.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem 1.5rem' }}>
                  {/* 1. Leaders */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#7c3aed' }}>L - Leaders</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.hasLeaders} onChange={e => setFormHealth({ ...formHealth, hasLeaders: e.target.checked })} /> Appointed</label>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.leadersTrained} onChange={e => setFormHealth({ ...formHealth, leadersTrained: e.target.checked })} /> Trained (self)</label>
                  </div>
                  {/* 2. Baptism */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#2e7d32' }}>B - Baptism</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.hasBaptism} onChange={e => setFormHealth({ ...formHealth, hasBaptism: e.target.checked })} /> Practiced</label>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.baptismSelf} onChange={e => setFormHealth({ ...formHealth, baptismSelf: e.target.checked })} /> Self-administered</label>
                  </div>
                  {/* 3. Lord's Supper */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#b91c1c' }}>S - Lord&apos;s Supper</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.lordsSupper} onChange={e => setFormHealth({ ...formHealth, lordsSupper: e.target.checked })} /> Practiced</label>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.lordsSupperSelf} onChange={e => setFormHealth({ ...formHealth, lordsSupperSelf: e.target.checked })} /> Self-administered</label>
                  </div>
                  {/* 4. Making Disciples */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#0d9488' }}>D - Making Disciples</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.makingDisciples} onChange={e => setFormHealth({ ...formHealth, makingDisciples: e.target.checked })} /> Active</label>
                  </div>
                  {/* 5. Giving */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#ea580c' }}>G - Giving</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.giving} onChange={e => setFormHealth({ ...formHealth, giving: e.target.checked })} /> Practiced</label>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.givingSelf} onChange={e => setFormHealth({ ...formHealth, givingSelf: e.target.checked })} /> Self-directed</label>
                  </div>
                  {/* 6. Teaching */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#1565c0' }}>T - Teaching</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.teaching} onChange={e => setFormHealth({ ...formHealth, teaching: e.target.checked })} /> Practiced</label>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.teachingSelf} onChange={e => setFormHealth({ ...formHealth, teachingSelf: e.target.checked })} /> Self-directed</label>
                  </div>
                  {/* 7. Service / Loving One Another */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#d63384' }}>Lv - Service / Love</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.serviceAndLove} onChange={e => setFormHealth({ ...formHealth, serviceAndLove: e.target.checked })} /> Active</label>
                  </div>
                  {/* 8. Accountability */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#6d4c41' }}>A - Accountability</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.accountability} onChange={e => setFormHealth({ ...formHealth, accountability: e.target.checked })} /> Active</label>
                  </div>
                  {/* 9. Prayer */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#ff8f00' }}>P - Prayer</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.prayer} onChange={e => setFormHealth({ ...formHealth, prayer: e.target.checked })} /> Active</label>
                  </div>
                  {/* 10. Praising God */}
                  <div style={markerRow}>
                    <span style={{ ...markerLabel, color: '#5e35b1' }}>Pr - Praising God</span>
                    <label style={chkStyle}><input type="checkbox" checked={formHealth.praise} onChange={e => setFormHealth({ ...formHealth, praise: e.target.checked })} /> Active</label>
                  </div>
                </div>
              </div>
            </div>

            {/* People Group Breakdown */}
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#fafafa', borderRadius: 8, border: '1px solid #e2e4e8' }}>
              <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>People Groups</strong>
              <p style={{ fontSize: '0.75rem', color: '#616161', margin: '0 0 0.5rem 0' }}>
                Track attenders, believers, and baptized per people group. Totals auto-aggregate into the counts above.
              </p>
              {(formHealth.peopleGroups ?? []).map((pg, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto', gap: '0.5rem', marginBottom: '0.35rem', alignItems: 'end' }}>
                  <label><span style={lbl}>People Group</span>
                    <input value={pg.name} onChange={e => {
                      const pgs = [...(formHealth.peopleGroups ?? [])]; pgs[i] = { ...pgs[i], name: e.target.value }; setFormHealth({ ...formHealth, peopleGroups: pgs })
                    }} placeholder="e.g. Arab Sunni" style={inp} /></label>
                  <label><span style={lbl}>Language</span>
                    <input value={pg.language ?? ''} onChange={e => {
                      const pgs = [...(formHealth.peopleGroups ?? [])]; pgs[i] = { ...pgs[i], language: e.target.value }; setFormHealth({ ...formHealth, peopleGroups: pgs })
                    }} placeholder="Arabic" style={inp} /></label>
                  <label><span style={lbl}>Background</span>
                    <input value={pg.background ?? ''} onChange={e => {
                      const pgs = [...(formHealth.peopleGroups ?? [])]; pgs[i] = { ...pgs[i], background: e.target.value }; setFormHealth({ ...formHealth, peopleGroups: pgs })
                    }} placeholder="Muslim" style={inp} /></label>
                  <label><span style={{ ...lbl, color: '#1565c0' }}>Attenders</span>
                    <input type="number" min="0" value={pg.attenders} onChange={e => {
                      const pgs = [...(formHealth.peopleGroups ?? [])]; pgs[i] = { ...pgs[i], attenders: parseInt(e.target.value) || 0 }
                      const totA = pgs.reduce((s, p) => s + p.attenders, 0); const totB = pgs.reduce((s, p) => s + p.believers, 0); const totBp = pgs.reduce((s, p) => s + p.baptized, 0)
                      setFormHealth({ ...formHealth, peopleGroups: pgs, attenders: totA, seekers: totA, believers: totB, baptized: totBp })
                    }} style={inp} /></label>
                  <label><span style={{ ...lbl, color: '#ea580c' }}>Believers</span>
                    <input type="number" min="0" value={pg.believers} onChange={e => {
                      const pgs = [...(formHealth.peopleGroups ?? [])]; pgs[i] = { ...pgs[i], believers: parseInt(e.target.value) || 0 }
                      const totA = pgs.reduce((s, p) => s + p.attenders, 0); const totB = pgs.reduce((s, p) => s + p.believers, 0); const totBp = pgs.reduce((s, p) => s + p.baptized, 0)
                      setFormHealth({ ...formHealth, peopleGroups: pgs, attenders: totA, seekers: totA, believers: totB, baptized: totBp })
                    }} style={inp} /></label>
                  <label><span style={{ ...lbl, color: '#2e7d32' }}>Baptized</span>
                    <input type="number" min="0" value={pg.baptized} onChange={e => {
                      const pgs = [...(formHealth.peopleGroups ?? [])]; pgs[i] = { ...pgs[i], baptized: parseInt(e.target.value) || 0 }
                      const totA = pgs.reduce((s, p) => s + p.attenders, 0); const totB = pgs.reduce((s, p) => s + p.believers, 0); const totBp = pgs.reduce((s, p) => s + p.baptized, 0)
                      setFormHealth({ ...formHealth, peopleGroups: pgs, attenders: totA, seekers: totA, believers: totB, baptized: totBp })
                    }} style={inp} /></label>
                  <button type="button" onClick={() => {
                    const pgs = (formHealth.peopleGroups ?? []).filter((_, j) => j !== i)
                    const totA = pgs.reduce((s, p) => s + p.attenders, 0); const totB = pgs.reduce((s, p) => s + p.believers, 0); const totBp = pgs.reduce((s, p) => s + p.baptized, 0)
                    setFormHealth({ ...formHealth, peopleGroups: pgs, attenders: totA, seekers: totA, believers: totB, baptized: totBp })
                  }} style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}>Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => {
                const pgs = [...(formHealth.peopleGroups ?? []), { name: '', language: '', background: '', attenders: 0, believers: 0, baptized: 0 }]
                setFormHealth({ ...formHealth, peopleGroups: pgs })
              }} style={{ marginTop: '0.35rem', fontSize: '0.8rem', padding: '0.3rem 0.75rem', background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9', borderRadius: 4, cursor: 'pointer' }}>
                + Add People Group
              </button>
            </div>

            {/* Preview */}
            <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <ChurchCircle health={formHealth} size={100} />
              <div style={{ fontSize: '0.8rem', color: '#616161' }}>
                <div>{formHealth.isChurch ? '● Solid border = established church' : '◌ Dashed border = group (not yet church)'}</div>
                <div style={{ marginTop: '0.25rem' }}>Center: Attenders / Believers / Baptized</div>
                <div style={{ marginTop: '0.25rem' }}>Letters around circle: 10 Acts 2 health markers</div>
                <div style={{ marginTop: '0.15rem', fontSize: '0.75rem' }}>
                  <span style={{ color: '#bdbdbd' }}>Gray</span> = not practiced &middot;
                  <strong> Outside</strong> circle = practiced (external leader) &middot;
                  <strong> Inside</strong> circle = self-directed
                </div>
                <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: '#9e9e9e' }}>
                  L=Leaders B=Baptism S=Supper D=Disciples G=Giving T=Teaching Lv=Love A=Accountability P=Prayer Pr=Praise
                </div>
              </div>
            </div>

            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button onClick={handleSave} disabled={loading || !formName}>{loading ? 'Saving...' : editingId ? 'Update' : 'Create'}</button>
              <button onClick={cancel} style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Restructure mode banner */}
        {restructureMode && viewMode === 'tree' && (
          <div style={{
            padding: '0.5rem 1rem', background: '#fff3e0', borderRadius: 6, marginBottom: '0.75rem',
            fontSize: '0.85rem', color: '#e65100', border: '1px solid #ffcc80',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <span style={{ fontSize: '1.1rem' }}>&#9998;</span>
            <span><strong>Restructure mode</strong> — drag a group and drop it onto another group to reparent it, or drop on the zone below to make it a root node.</span>
          </div>
        )}

        {/* Root drop zone — visible when dragging in restructure mode */}
        {restructureMode && viewMode === 'tree' && draggedNodeId && (
          <div
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setRootDropActive(true) }}
            onDragLeave={() => setRootDropActive(false)}
            onDrop={(e) => handleDrop(e, null)}
            style={{
              padding: '0.75rem', marginBottom: '0.5rem', borderRadius: 8,
              border: `2px dashed ${rootDropActive ? '#1565c0' : '#bdbdbd'}`,
              background: rootDropActive ? '#e3f2fd' : '#fafafa',
              textAlign: 'center', fontSize: '0.85rem',
              color: rootDropActive ? '#1565c0' : '#9e9e9e',
              fontWeight: 600, transition: 'all 0.15s',
            }}
          >
            Drop here to make root (G0)
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
const markerRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.3rem 0.5rem', background: '#fff', borderRadius: 6, border: '1px solid #e8e8e8' }
const markerLabel: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 700, minWidth: '8rem' }
