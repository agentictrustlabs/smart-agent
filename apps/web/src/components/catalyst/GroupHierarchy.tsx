'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChurchCircle, parseHealth } from './ChurchCircle'
import { GroupEditor, type GroupData } from './GroupEditor'
import { createGenMapNode } from '@/lib/actions/genmap.action'
import { updateGroupHealth } from '@/lib/actions/update-group.action'

export interface GroupNode {
  id: string
  address: string
  name: string
  /** .agent primary name (e.g., "wellington.catalyst.agent") */
  primaryName: string
  description: string
  parentAddress: string | null
  depth: number
  leaderName: string | null
  location: string | null
  isEstablished: boolean
  healthData: string | null
  status: string
  metadata: Record<string, unknown>
}

interface Props {
  groups: GroupNode[]
  orgAddress: string
}

const DEPTH_COLORS = ['#1565c0', '#0d9488', '#2e7d32', '#7c3aed', '#ea580c', '#b91c1c']
function dColor(d: number) { return DEPTH_COLORS[Math.min(d, DEPTH_COLORS.length - 1)] }

export function GroupHierarchy({ groups, orgAddress }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; parentAddr?: string; group?: GroupNode } | null>(null)
  const [focusAddr, setFocusAddr] = useState<string | null>(null)

  // Build parent→children map
  const childrenOf = new Map<string | null, GroupNode[]>()
  for (const g of groups) {
    const key = g.parentAddress
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(g)
  }
  const roots = childrenOf.get(null) ?? []

  function getDescendants(addr: string): GroupNode[] {
    const result: GroupNode[] = []
    for (const c of (childrenOf.get(addr.toLowerCase()) ?? [])) {
      result.push(c)
      result.push(...getDescendants(c.address.toLowerCase()))
    }
    return result
  }

  const visibleGroups = focusAddr
    ? [groups.find(g => g.address.toLowerCase() === focusAddr)!, ...getDescendants(focusAddr)].filter(Boolean)
    : groups
  const baseDepth = focusAddr ? (groups.find(g => g.address.toLowerCase() === focusAddr)?.depth ?? 0) : 0

  function toggle(addr: string) {
    const next = new Set(collapsed)
    if (next.has(addr)) next.delete(addr); else next.add(addr)
    setCollapsed(next)
  }

  async function handleSave(data: GroupData) {
    if (editor?.mode === 'create') {
      const parentGen = editor.parentAddr
        ? (groups.find(g => g.address.toLowerCase() === editor.parentAddr)?.depth ?? -1)
        : -1
      await createGenMapNode({
        networkAddress: orgAddress,
        parentId: editor.parentAddr ?? null,
        generation: parentGen + 1,
        name: data.name,
        leaderName: data.leaderName || undefined,
        location: data.location || undefined,
        healthData: { ...data.health } as Record<string, unknown>,
        startedAt: data.startDate,
      })
    } else if (editor?.mode === 'edit' && editor.group) {
      await updateGroupHealth({
        address: editor.group.address,
        name: data.name,
        leaderName: data.leaderName || undefined,
        location: data.location || undefined,
        healthData: { ...data.health } as Record<string, unknown>,
        status: data.status,
      })
    }
    setEditor(null)
    window.location.reload()
  }

  // Stats
  const orgCount = visibleGroups.length
  const established = visibleGroups.filter(g => g.isEstablished).length
  const maxDepth = visibleGroups.length > 0 ? Math.max(...visibleGroups.map(g => g.depth)) : 0

  function renderGroup(group: GroupNode): React.ReactNode {
    const relDepth = group.depth - baseDepth
    const color = dColor(relDepth)
    const children = (childrenOf.get(group.address.toLowerCase()) ?? [])
      .filter(c => visibleGroups.some(v => v.address === c.address))
    const isCollapsed = collapsed.has(group.address.toLowerCase())
    const health = parseHealth(group.healthData)
    const hasChildren = children.length > 0

    return (
      <div key={group.address} style={{ marginBottom: '0.4rem' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.5rem 0.6rem', borderRadius: 8, background: '#fff',
          border: `1px solid ${group.isEstablished ? '#2e7d3230' : '#e2e4e8'}`,
          borderLeft: `4px solid ${color}`, cursor: 'pointer',
        }}
          onClick={() => setEditor({ mode: 'edit', group })}
        >
          {/* Collapse toggle */}
          {hasChildren ? (
            <button onClick={e => { e.stopPropagation(); toggle(group.address.toLowerCase()) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', padding: 0, width: 14, color: '#9e9e9e' }}>
              {isCollapsed ? '▶' : '▼'}
            </button>
          ) : <div style={{ width: 14 }} />}

          {/* Church circle */}
          <ChurchCircle health={health} size={44} />

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.85rem', color: '#1a1a2e' }}>{group.name}</strong>
              {group.primaryName && (
                <span style={{ fontFamily: 'monospace', fontSize: '0.62rem', color: '#8b5e3c', background: 'rgba(139,94,60,0.06)', padding: '0.05rem 0.3rem', borderRadius: 5, border: '1px solid rgba(139,94,60,0.12)' }}>
                  {group.primaryName}
                </span>
              )}
              {group.isEstablished && <span style={{ fontSize: '0.55rem', padding: '0.1rem 0.3rem', background: '#2e7d3215', color: '#2e7d32', borderRadius: 3, fontWeight: 600 }}>established</span>}
              {children.length > 0 && <span style={{ fontSize: '0.6rem', color: '#9e9e9e' }}>{children.length} sub</span>}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#616161', display: 'flex', gap: '0.5rem' }}>
              {group.leaderName && <span>{group.leaderName}</span>}
              {group.location && <span>{group.location}</span>}
              {health.peoplGroup && <span style={{ fontStyle: 'italic' }}>{health.peoplGroup}</span>}
            </div>
          </div>

          {/* Quick stats */}
          <div style={{ display: 'flex', gap: '0.3rem', fontSize: '0.6rem', color: '#616161', flexShrink: 0 }}>
            <span style={{ color: '#1565c0', fontWeight: 700 }}>{health.attenders || health.seekers || 0}</span>
            <span style={{ color: '#ea580c', fontWeight: 700 }}>{health.believers}</span>
            <span style={{ color: '#2e7d32', fontWeight: 700 }}>{health.baptized}</span>
            <span style={{ color: '#7c3aed', fontWeight: 700 }}>{health.leaders}</span>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.2rem', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setEditor({ mode: 'create', parentAddr: group.address.toLowerCase() })}
              title="Add child circle"
              style={{ fontSize: '0.65rem', padding: '0.15rem 0.35rem', background: `${color}10`, border: `1px solid ${color}30`, borderRadius: 4, cursor: 'pointer', color }}>
              +
            </button>
            {hasChildren && (
              <button onClick={() => setFocusAddr(focusAddr === group.address.toLowerCase() ? null : group.address.toLowerCase())}
                style={{ fontSize: '0.6rem', padding: '0.15rem 0.35rem', background: focusAddr === group.address.toLowerCase() ? color : '#f5f5f5', color: focusAddr === group.address.toLowerCase() ? '#fff' : '#616161', border: `1px solid ${focusAddr === group.address.toLowerCase() ? color : '#e0e0e0'}`, borderRadius: 4, cursor: 'pointer' }}>
                {focusAddr === group.address.toLowerCase() ? 'All' : 'Focus'}
              </button>
            )}
            <Link href={`/agents/${group.address}`} onClick={e => e.stopPropagation()}
              style={{ fontSize: '0.6rem', padding: '0.15rem 0.35rem', color: '#1565c0', textDecoration: 'none' }}>
              Profile
            </Link>
          </div>
        </div>

        {/* Children */}
        {!isCollapsed && children.length > 0 && (
          <div style={{ marginLeft: '1.25rem', borderLeft: `2px solid ${color}20`, paddingLeft: '0.5rem', marginTop: '0.2rem' }}>
            {children.map(child => renderGroup(child))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {Array.from({ length: maxDepth - baseDepth + 1 }, (_, i) => (
            <div key={i} style={{
              padding: '0.3rem 0.6rem', borderRadius: 4, textAlign: 'center',
              background: `${dColor(i)}10`, border: `1px solid ${dColor(i)}25`,
              fontSize: '0.75rem', fontWeight: 600, color: dColor(i),
            }}>
              L{i}: {visibleGroups.filter(g => g.depth - baseDepth === i).length}
            </div>
          ))}
        </div>
        <span style={{ fontSize: '0.8rem', color: '#616161' }}>{orgCount} circles · {established} established</span>
        <button onClick={() => setEditor({ mode: 'create' })}
          style={{ marginLeft: 'auto', padding: '0.4rem 0.8rem', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
          + New Root Circle
        </button>
      </div>

      {focusAddr && (
        <div style={{ padding: '0.35rem 0.75rem', background: '#e0f2f1', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.8rem', color: '#0d9488', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Focused on <strong>{groups.find(g => g.address.toLowerCase() === focusAddr)?.name}</strong></span>
          <button onClick={() => setFocusAddr(null)} style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', background: '#fff', border: '1px solid #0d9488', borderRadius: 4, cursor: 'pointer', color: '#0d9488' }}>Show All</button>
        </div>
      )}

      {/* Tree */}
      {roots.filter(r => visibleGroups.some(v => v.address === r.address)).map(root => renderGroup(root))}

      {groups.length === 0 && !editor && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#616161' }}>
          <p>No circles yet. Start by creating your first circle.</p>
          <button onClick={() => setEditor({ mode: 'create' })}
            style={{ marginTop: '0.5rem', padding: '0.5rem 1.5rem', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
            Create First Circle
          </button>
        </div>
      )}

      {/* Editor panel */}
      {editor && (
        <GroupEditor
          mode={editor.mode}
          parentName={editor.parentAddr ? groups.find(g => g.address.toLowerCase() === editor.parentAddr)?.name : undefined}
          parentAgentName={editor.parentAddr ? groups.find(g => g.address.toLowerCase() === editor.parentAddr)?.primaryName : (groups[0]?.primaryName || undefined)}
          initial={editor.group ? {
            id: editor.group.id,
            name: editor.group.name,
            nameLabel: editor.group.primaryName ? editor.group.primaryName.split('.')[0] : undefined,
            location: editor.group.location ?? '',
            leaderName: editor.group.leaderName ?? '',
            startDate: '',
            peoplGroup: parseHealth(editor.group.healthData).peoplGroup ?? '',
            health: parseHealth(editor.group.healthData),
            status: editor.group.status,
          } : undefined}
          onSave={handleSave}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
