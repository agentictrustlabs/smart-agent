'use client'

import { useState } from 'react'
import Link from 'next/link'

export interface HierarchyAgent {
  address: string
  name: string
  description: string
  kind: 'person' | 'org' | 'ai' | 'hub' | 'unknown'
  parentAddress: string | null
  depth: number
  roles: string[]
  isEstablished: boolean
  leaderName: string | null
  location: string | null
  metadata: Record<string, unknown>
}

interface Props {
  agents: HierarchyAgent[]
}

// Consistent color per depth level
const DEPTH_COLORS = ['#1565c0', '#0d9488', '#2e7d32', '#7c3aed', '#ea580c', '#b91c1c']
function depthColor(d: number) { return DEPTH_COLORS[Math.min(d, DEPTH_COLORS.length - 1)] }

export function HierarchyView({ agents }: Props) {
  const [focusedOrg, setFocusedOrg] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Build parent→children map
  const childrenOf = new Map<string | null, HierarchyAgent[]>()
  for (const a of agents) {
    const key = a.parentAddress
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(a)
  }

  // Roots: agents with no parent
  const roots = childrenOf.get(null) ?? []

  // Get all descendants of an address
  function getDescendants(addr: string): HierarchyAgent[] {
    const result: HierarchyAgent[] = []
    const children = childrenOf.get(addr.toLowerCase()) ?? []
    for (const c of children) {
      result.push(c)
      result.push(...getDescendants(c.address.toLowerCase()))
    }
    return result
  }

  // Depth summary counts
  const depthGroups = new Map<number, HierarchyAgent[]>()
  const visibleAgents = focusedOrg ? [
    agents.find(a => a.address.toLowerCase() === focusedOrg)!,
    ...getDescendants(focusedOrg),
  ].filter(Boolean) : agents
  for (const a of visibleAgents) {
    if (!depthGroups.has(a.depth)) depthGroups.set(a.depth, [])
    depthGroups.get(a.depth)!.push(a)
  }
  const maxDepth = visibleAgents.length > 0 ? Math.max(...visibleAgents.map(a => a.depth)) : 0
  // When focused, rebase depths relative to the focused org
  const baseDepth = focusedOrg ? (agents.find(a => a.address.toLowerCase() === focusedOrg)?.depth ?? 0) : 0

  function toggleCollapse(addr: string) {
    const next = new Set(collapsed)
    if (next.has(addr)) next.delete(addr)
    else next.add(addr)
    setCollapsed(next)
  }

  function renderAgent(agent: HierarchyAgent): React.ReactNode {
    const relDepth = agent.depth - baseDepth
    const color = depthColor(relDepth)
    const children = (childrenOf.get(agent.address.toLowerCase()) ?? [])
      .filter(c => visibleAgents.some(v => v.address.toLowerCase() === c.address.toLowerCase()))
    const hasChildren = children.length > 0
    const isCollapsed = collapsed.has(agent.address.toLowerCase())
    const isOrg = agent.kind === 'org'
    const meta = agent.metadata

    if (!isOrg) return null // persons/AI rendered inline under their org

    // Collect person/AI members at this org
    const memberAgents = (childrenOf.get(agent.address.toLowerCase()) ?? [])
      .filter(c => c.kind !== 'org' && visibleAgents.some(v => v.address.toLowerCase() === c.address.toLowerCase()))
    const childOrgs = children.filter(c => c.kind === 'org')

    return (
      <div key={agent.address} style={{ marginBottom: '0.5rem' }}>
        {/* Org card */}
        <div style={{
          padding: '0.65rem 0.75rem', borderRadius: 8, background: '#fff',
          border: `2px solid ${agent.isEstablished ? '#2e7d3230' : `${color}25`}`,
          borderLeft: `4px solid ${color}`,
          display: 'flex', alignItems: 'center', gap: '0.6rem',
        }}>
          {/* Expand/collapse */}
          {hasChildren ? (
            <button onClick={() => toggleCollapse(agent.address.toLowerCase())}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', padding: 0, width: 16, color: '#616161' }}>
              {isCollapsed ? '▶' : '▼'}
            </button>
          ) : <div style={{ width: 16 }} />}

          {/* Depth badge */}
          <div style={{
            width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '0.65rem', flexShrink: 0,
            background: `${color}15`, color, border: `2px solid ${color}`,
          }}>L{relDepth}</div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Link href={`/agents/${agent.address}`} style={{ fontWeight: 700, color: '#1565c0', fontSize: '0.85rem' }}>{agent.name}</Link>
              {agent.isEstablished && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.5rem' }}>established</span>}
              {relDepth === 0 && <span data-component="role-badge" style={{ fontSize: '0.5rem' }}>root</span>}
              {childOrgs.length > 0 && <span style={{ fontSize: '0.65rem', color: '#616161' }}>{childOrgs.length} sub-org{childOrgs.length !== 1 ? 's' : ''}</span>}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#616161', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {agent.leaderName && <span>Led by {agent.leaderName}</span>}
              {agent.location && <span>{agent.location}</span>}
              {agent.parentAddress && (() => {
                const parent = agents.find(a => a.address.toLowerCase() === agent.parentAddress)
                return parent ? <span>under <strong>{parent.name}</strong></span> : null
              })()}
            </div>
            {/* Health metrics */}
            {typeof meta.attenders === 'number' && (
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.2rem', fontSize: '0.6rem', color: '#616161' }}>
                <span><strong style={{ color: '#1565c0' }}>{meta.attenders as number}</strong> att</span>
                {typeof meta.believers === 'number' && <span><strong style={{ color: '#ea580c' }}>{meta.believers as number}</strong> blvr</span>}
                {typeof meta.baptized === 'number' && <span><strong style={{ color: '#2e7d32' }}>{meta.baptized as number}</strong> bap</span>}
                {typeof meta.leaders === 'number' && <span><strong style={{ color: '#7c3aed' }}>{meta.leaders as number}</strong> ldr</span>}
              </div>
            )}
          </div>

          {/* Focus button */}
          {hasChildren && (
            <button onClick={() => setFocusedOrg(focusedOrg === agent.address.toLowerCase() ? null : agent.address.toLowerCase())}
              style={{
                fontSize: '0.65rem', padding: '0.2rem 0.5rem', borderRadius: 4, cursor: 'pointer',
                background: focusedOrg === agent.address.toLowerCase() ? color : '#f5f5f5',
                color: focusedOrg === agent.address.toLowerCase() ? '#fff' : '#616161',
                border: `1px solid ${focusedOrg === agent.address.toLowerCase() ? color : '#e0e0e0'}`,
              }}>
              {focusedOrg === agent.address.toLowerCase() ? 'Show All' : 'Focus'}
            </button>
          )}

          {/* Member count */}
          {memberAgents.length > 0 && (
            <span style={{ fontSize: '0.65rem', color: '#616161', flexShrink: 0 }}>
              {memberAgents.length} member{memberAgents.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Member agents inline */}
        {!isCollapsed && memberAgents.length > 0 && (
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.25rem', marginLeft: '3rem' }}>
            {memberAgents.map(m => (
              <div key={m.address} style={{
                padding: '0.25rem 0.5rem', borderRadius: 4, background: '#fafafa',
                border: '1px solid #e2e4e8', display: 'flex', alignItems: 'center', gap: '0.3rem',
                fontSize: '0.75rem',
              }}>
                <Link href={`/agents/${m.address}`} style={{ color: '#1565c0', fontWeight: 600 }}>{m.name}</Link>
                <span style={{ fontSize: '0.5rem', color: m.kind === 'ai' ? '#f59e0b' : '#1565c0', fontWeight: 600 }}>
                  {m.kind === 'ai' ? 'AI' : 'P'}
                </span>
                {m.roles.length > 0 && <span style={{ fontSize: '0.55rem', color: '#9e9e9e' }}>{m.roles[0]}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Child orgs (indented, with connecting line) */}
        {!isCollapsed && childOrgs.length > 0 && (
          <div style={{ marginLeft: '1.5rem', borderLeft: `2px solid ${color}20`, paddingLeft: '0.75rem', marginTop: '0.25rem' }}>
            {childOrgs.map(child => renderAgent(child))}
          </div>
        )}
      </div>
    )
  }

  // Summary bar
  const orgCount = visibleAgents.filter(a => a.kind === 'org').length
  const personCount = visibleAgents.filter(a => a.kind === 'person').length
  const aiCount = visibleAgents.filter(a => a.kind === 'ai').length

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Depth summary */}
      <section data-component="graph-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h2>Hierarchy Levels</h2>
          <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', color: '#616161' }}>
            <span>{orgCount} org{orgCount !== 1 ? 's' : ''}</span>
            {personCount > 0 && <span>· {personCount} person{personCount !== 1 ? 's' : ''}</span>}
            {aiCount > 0 && <span>· {aiCount} AI</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {Array.from({ length: maxDepth - baseDepth + 1 }, (_, i) => {
            const d = baseDepth + i
            const count = (depthGroups.get(d) ?? []).filter(a => a.kind === 'org').length
            const color = depthColor(i)
            return (
              <div key={d} style={{
                flex: 1, padding: '0.5rem', borderRadius: 6, textAlign: 'center',
                background: `${color}10`, border: `2px solid ${color}30`,
              }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{count}</div>
                <div style={{ fontSize: '0.7rem', color: '#616161' }}>Level {i}</div>
              </div>
            )
          })}
        </div>
        {focusedOrg && (
          <div style={{
            padding: '0.4rem 0.75rem', background: '#e3f2fd', borderRadius: 6, marginBottom: '0.75rem',
            fontSize: '0.8rem', color: '#1565c0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>Focused on <strong>{agents.find(a => a.address.toLowerCase() === focusedOrg)?.name}</strong> and its subordinates</span>
            <button onClick={() => setFocusedOrg(null)} style={{
              fontSize: '0.75rem', padding: '0.2rem 0.6rem', background: '#fff', border: '1px solid #1565c0',
              borderRadius: 4, cursor: 'pointer', color: '#1565c0',
            }}>Show All</button>
          </div>
        )}
      </section>

      {/* Tree */}
      <section data-component="graph-section">
        {roots.filter(r => visibleAgents.some(v => v.address === r.address)).map(root => renderAgent(root))}
      </section>
    </div>
  )
}
