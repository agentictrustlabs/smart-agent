'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { AgentCardData } from '@/lib/actions/list-all-agents.action'

type SortField = 'name' | 'type' | 'relationships'
type SortDir = 'asc' | 'desc'
type AgentTypeFilter = 'all' | 'person' | 'org' | 'ai' | 'hub'

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  person: { bg: '#e8f5e9', text: '#2e7d32', border: '#a5d6a7' },
  org: { bg: '#e3f2fd', text: '#1565c0', border: '#90caf9' },
  ai: { bg: '#f3e5f5', text: '#7b1fa2', border: '#ce93d8' },
  hub: { bg: '#fff3e0', text: '#e65100', border: '#ffcc80' },
  unknown: { bg: '#f5f5f5', text: '#616161', border: '#e0e0e0' },
}

function truncAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function AgentRegistryList({ agents }: { agents: AgentCardData[] }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<AgentTypeFilter>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  const toggleExpand = (addr: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev)
      if (next.has(addr)) next.delete(addr)
      else next.add(addr)
      return next
    })
  }

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    let list = agents

    if (typeFilter !== 'all') {
      list = list.filter(a => a.agentType === typeFilter)
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        a.displayName.toLowerCase().includes(q) ||
        a.primaryName.toLowerCase().includes(q) ||
        a.address.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.aiAgentClass.toLowerCase().includes(q) ||
        a.capabilities.some(c => c.toLowerCase().includes(q)),
      )
    }

    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.displayName.localeCompare(b.displayName)
          break
        case 'type':
          cmp = a.agentType.localeCompare(b.agentType) || a.displayName.localeCompare(b.displayName)
          break
        case 'relationships':
          cmp = (b.outEdges.length + b.inEdges.length) - (a.outEdges.length + a.inEdges.length)
          break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return sorted
  }, [agents, typeFilter, search, sortField, sortDir])

  // Type counts for filter badges
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: agents.length, person: 0, org: 0, ai: 0, hub: 0 }
    for (const a of agents) c[a.agentType] = (c[a.agentType] ?? 0) + 1
    return c
  }, [agents])

  return (
    <div>
      {/* ── Toolbar: search + filters + sort ── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.75rem',
        alignItems: 'center', marginBottom: '1rem',
      }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search agents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: '1 1 220px',
            padding: '0.5rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: '0.85rem',
            background: 'var(--bg-card)',
            color: 'var(--text)',
          }}
        />

        {/* Type filter pills */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {(['all', 'person', 'org', 'ai', 'hub'] as AgentTypeFilter[]).map(t => {
            const active = typeFilter === t
            const color = t === 'all' ? { bg: '#f5f5f5', text: '#333', border: '#ccc' } : TYPE_COLORS[t]
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                style={{
                  padding: '0.3rem 0.6rem',
                  border: `1px solid ${active ? color.border : 'var(--border)'}`,
                  borderRadius: 16,
                  fontSize: '0.75rem',
                  fontWeight: active ? 600 : 400,
                  background: active ? color.bg : 'transparent',
                  color: active ? color.text : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                <span style={{ marginLeft: 4, opacity: 0.7 }}>({counts[t] ?? 0})</span>
              </button>
            )
          })}
        </div>

        {/* Sort */}
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          {([
            { field: 'name' as SortField, label: 'Name' },
            { field: 'type' as SortField, label: 'Type' },
            { field: 'relationships' as SortField, label: 'Relationships' },
          ]).map(s => {
            const active = sortField === s.field
            return (
              <button
                key={s.field}
                onClick={() => toggleSort(s.field)}
                style={{
                  padding: '0.3rem 0.5rem',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 6,
                  fontSize: '0.72rem',
                  fontWeight: active ? 600 : 400,
                  background: active ? 'var(--accent-light)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {s.label} {active ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Results count ── */}
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Showing {filtered.length} of {agents.length} agent{agents.length !== 1 ? 's' : ''}
      </p>

      {/* ── Agent cards grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
        gap: '0.75rem',
      }}>
        {filtered.map(agent => {
          const tc = TYPE_COLORS[agent.agentType] ?? TYPE_COLORS.unknown
          const totalEdges = agent.outEdges.length + agent.inEdges.length
          const expanded = expandedCards.has(agent.address)

          return (
            <div key={agent.address} style={{
              background: 'var(--bg-card)',
              border: `1px solid var(--border)`,
              borderRadius: 12,
              overflow: 'hidden',
              transition: 'box-shadow 0.15s',
              boxShadow: expanded ? 'var(--shadow-md)' : 'var(--shadow-sm)',
            }}>
              {/* Card header with type accent */}
              <div style={{
                borderLeft: `4px solid ${tc.border}`,
                padding: '0.85rem 1rem 0.65rem',
              }}>
                {/* Top row: name + type badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <Link
                    href={`/agents/${agent.address}`}
                    style={{
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      color: 'var(--text)',
                      textDecoration: 'none',
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.displayName}
                  </Link>
                  <span style={{
                    padding: '0.15rem 0.45rem',
                    borderRadius: 10,
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    background: tc.bg,
                    color: tc.text,
                    border: `1px solid ${tc.border}`,
                    flexShrink: 0,
                    textTransform: 'capitalize',
                  }}>
                    {agent.agentTypeLabel}
                  </span>
                </div>
                {/* .agent name */}
                {agent.primaryName && (
                  <div style={{ marginBottom: '0.3rem' }}>
                    <span style={{
                      fontFamily: 'monospace', fontSize: '0.72rem', color: '#8b5e3c',
                      background: 'rgba(139,94,60,0.06)', padding: '0.1rem 0.4rem',
                      borderRadius: 6, border: '1px solid rgba(139,94,60,0.12)',
                    }}>
                      {agent.primaryName}
                    </span>
                  </div>
                )}

                {/* Sub-badges row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                  {agent.aiAgentClass && (
                    <span style={{
                      padding: '0.15rem 0.45rem',
                      borderRadius: 10,
                      fontSize: '0.68rem',
                      fontWeight: 500,
                      background: '#f3e5f5',
                      color: '#7b1fa2',
                      flexShrink: 0,
                    }}>
                      {agent.aiAgentClass}
                    </span>
                  )}
                  {!agent.isActive && (
                    <span style={{
                      padding: '0.15rem 0.45rem',
                      borderRadius: 10,
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      background: '#ffebee',
                      color: '#c62828',
                      flexShrink: 0,
                    }}>
                      Inactive
                    </span>
                  )}
                </div>

                {/* Address */}
                <div style={{
                  fontSize: '0.72rem',
                  fontFamily: 'monospace',
                  color: 'var(--text-muted)',
                  marginBottom: '0.35rem',
                }}>
                  {agent.address}
                </div>

                {/* Description */}
                {agent.description && (
                  <p style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.4,
                    marginBottom: '0.5rem',
                    display: '-webkit-box',
                    WebkitLineClamp: expanded ? 999 : 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {agent.description}
                  </p>
                )}

                {/* Summary stats row */}
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  <span>{agent.controllers.length} controller{agent.controllers.length !== 1 ? 's' : ''}</span>
                  <span>{totalEdges} relationship{totalEdges !== 1 ? 's' : ''}</span>
                  {agent.capabilities.length > 0 && (
                    <span>{agent.capabilities.length} capabilit{agent.capabilities.length !== 1 ? 'ies' : 'y'}</span>
                  )}
                </div>

                {/* Capabilities pills (compact) */}
                {agent.capabilities.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                    {agent.capabilities.slice(0, expanded ? undefined : 5).map(c => (
                      <span key={c} style={{
                        padding: '0.1rem 0.35rem',
                        borderRadius: 4,
                        fontSize: '0.65rem',
                        background: '#f5f5f5',
                        color: '#616161',
                        border: '1px solid #e0e0e0',
                      }}>
                        {c}
                      </span>
                    ))}
                    {!expanded && agent.capabilities.length > 5 && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        +{agent.capabilities.length - 5} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Expand/collapse toggle */}
              <button
                onClick={() => toggleExpand(agent.address)}
                style={{
                  width: '100%',
                  padding: '0.35rem',
                  border: 'none',
                  borderTop: '1px solid var(--border)',
                  background: expanded ? 'var(--accent-light)' : 'var(--bg-hover)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'background 0.15s',
                }}
              >
                {expanded ? 'Show less \u25B2' : 'Show details \u25BC'}
              </button>

              {/* ── Expanded details ── */}
              {expanded && (
                <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)' }}>
                  {/* Controllers */}
                  <DetailSection title="Controllers">
                    {agent.controllers.length === 0 ? (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>None registered</span>
                    ) : (
                      agent.controllers.map(c => (
                        <div key={c} style={{
                          fontFamily: 'monospace',
                          fontSize: '0.72rem',
                          color: 'var(--text)',
                          padding: '0.2rem 0',
                        }}>
                          {c}
                        </div>
                      ))
                    )}
                  </DetailSection>

                  {/* Trust models */}
                  {agent.trustModels.length > 0 && (
                    <DetailSection title="Trust Models">
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        {agent.trustModels.map(t => (
                          <span key={t} style={{
                            padding: '0.1rem 0.35rem',
                            borderRadius: 4,
                            fontSize: '0.65rem',
                            background: '#e8f5e9',
                            color: '#2e7d32',
                            border: '1px solid #a5d6a7',
                          }}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </DetailSection>
                  )}

                  {/* Endpoints */}
                  {(agent.a2aEndpoint || agent.mcpServer) && (
                    <DetailSection title="Endpoints">
                      {agent.a2aEndpoint && (
                        <div style={{ fontSize: '0.75rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>A2A: </span>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{agent.a2aEndpoint}</span>
                        </div>
                      )}
                      {agent.mcpServer && (
                        <div style={{ fontSize: '0.75rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>MCP: </span>
                          <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{agent.mcpServer}</span>
                        </div>
                      )}
                    </DetailSection>
                  )}

                  {/* Outgoing relationships */}
                  {agent.outEdges.length > 0 && (
                    <DetailSection title={`Outgoing Relationships (${agent.outEdges.length})`}>
                      {agent.outEdges.map((e, i) => (
                        <EdgeRow key={i} direction="out" edge={e} />
                      ))}
                    </DetailSection>
                  )}

                  {/* Incoming relationships */}
                  {agent.inEdges.length > 0 && (
                    <DetailSection title={`Incoming Relationships (${agent.inEdges.length})`}>
                      {agent.inEdges.map((e, i) => (
                        <EdgeRow key={i} direction="in" edge={e} />
                      ))}
                    </DetailSection>
                  )}

                  {/* Action links */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.8rem' }}>
                    <Link href={`/agents/${agent.address}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      Trust Profile
                    </Link>
                    <Link href={`/agents/${agent.address}/metadata`} style={{ color: 'var(--accent)' }}>
                      Metadata
                    </Link>
                    <Link href={`/agents/${agent.address}/communicate`} style={{ color: 'var(--accent)' }}>
                      Communicate
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          color: 'var(--text-muted)',
          fontSize: '0.9rem',
        }}>
          No agents match your filters.
        </div>
      )}
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.65rem' }}>
      <div style={{
        fontSize: '0.68rem',
        fontWeight: 700,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginBottom: '0.3rem',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function EdgeRow({
  direction,
  edge,
}: {
  direction: 'in' | 'out'
  edge: {
    sourceAddress?: string
    sourceName?: string
    targetAddress?: string
    targetName?: string
    roles: string[]
    relType: string
    status: string
  }
}) {
  const addr = direction === 'out' ? edge.targetAddress! : edge.sourceAddress!
  const name = direction === 'out' ? edge.targetName! : edge.sourceName!
  const arrow = direction === 'out' ? '\u2192' : '\u2190'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.25rem 0',
      fontSize: '0.75rem',
      borderBottom: '1px solid #f5f5f5',
    }}>
      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{arrow}</span>
      <Link
        href={`/agents/${addr}`}
        style={{
          color: 'var(--accent)',
          fontWeight: 500,
          textDecoration: 'none',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </Link>
      <span style={{
        padding: '0.1rem 0.3rem',
        borderRadius: 4,
        fontSize: '0.62rem',
        background: '#f5f5f5',
        color: '#616161',
      }}>
        {edge.relType}
      </span>
      {edge.roles.map(r => (
        <span key={r} style={{
          padding: '0.1rem 0.3rem',
          borderRadius: 4,
          fontSize: '0.62rem',
          background: '#e3f2fd',
          color: '#1565c0',
        }}>
          {r}
        </span>
      ))}
      <span style={{
        marginLeft: 'auto',
        fontSize: '0.62rem',
        color: edge.status === 'Active' ? '#2e7d32' : 'var(--text-muted)',
        fontWeight: 500,
      }}>
        {edge.status}
      </span>
    </div>
  )
}
