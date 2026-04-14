'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

interface GraphNode {
  id: string
  label: string
  type: 'person' | 'org' | 'ai' | 'eoa'
  did: string
  address: string
  description?: string
  capabilities?: string[]
  trustModels?: string[]
  a2aEndpoint?: string
  aiClass?: string
  isResolverRegistered?: boolean
  x?: number
  y?: number
}

interface TemplateInfo {
  id: number
  name: string
  description: string
  forRole: string
  forType: string
  active: boolean
}

interface GraphEdge {
  source: string
  target: string
  roles: string[]
  relationshipType: string
  status: string
  edgeId: string
  templates: TemplateInfo[]
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const NODE_COLORS: Record<string, string> = { person: '#1565c0', org: '#2e7d32', ai: '#f59e0b', eoa: '#94a3b8' }

const EDGE_COLORS: Record<string, string> = {
  Governance: '#f59e0b', Membership: '#1565c0', Alliance: '#ec4899', 'Church Lineage': '#ec4899',
  'Generational Lineage': '#8b5cf6',
  Validation: '#06b6d4', Insurance: '#8b5cf6', 'Economic Security': '#14b8a6',
  Service: '#f97316', Delegation: '#ef4444', Compliance: '#a3e635',
  'Runtime/TEE': '#22d3ee', 'Build Provenance': '#94a3b8',
  'Org Control': '#fb923c', 'Activity Validation': '#a3e635', Review: '#f472b6',
  Controller: '#94a3b8',
}

function layoutNodes(nodes: GraphNode[], w: number, h: number): GraphNode[] {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.35
  return nodes.map((node, i) => ({
    ...node,
    x: cx + r * Math.cos((2 * Math.PI * i) / nodes.length - Math.PI / 2),
    y: cy + r * Math.sin((2 * Math.PI * i) / nodes.length - Math.PI / 2),
  }))
}

export function TrustGraphView({ orgAddress }: { orgAddress?: string }) {
  const [rawData, setRawData] = useState<(GraphData & { currentUserAddresses?: string[] }) | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null)
  const [filter, setFilter] = useState<'all' | 'mine'>('mine')
  const [showLegend, setShowLegend] = useState(false)

  // Zoom & pan state
  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })
  const panOrigin = useRef({ x: 0, y: 0 })

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    // Mouse position in SVG-viewBox coordinates before zoom
    const mx = ((e.clientX - rect.left) / rect.width) * W
    const my = ((e.clientY - rect.top) / rect.height) * H
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setZoom(prev => {
      const next = Math.min(Math.max(prev * factor, 0.25), 8)
      // Adjust pan so the point under the cursor stays fixed
      const scale = next / prev
      setPan(p => ({
        x: mx - scale * (mx - p.x),
        y: my - scale * (my - p.y),
      }))
      return next
    })
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    // Only pan on middle-click or when clicking the SVG background
    const target = e.target as SVGElement
    if (e.button !== 1 && target.tagName !== 'svg' && !target.closest('[data-graph-bg]')) return
    e.preventDefault()
    isPanning.current = true
    panStart.current = { x: e.clientX, y: e.clientY }
    panOrigin.current = { ...pan }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [pan])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!isPanning.current) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const dx = ((e.clientX - panStart.current.x) / rect.width) * W / zoom
    const dy = ((e.clientY - panStart.current.y) / rect.height) * H / zoom
    setPan({ x: panOrigin.current.x + dx, y: panOrigin.current.y + dy })
  }, [zoom])

  const handlePointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    const url = orgAddress ? `/api/graph?org=${encodeURIComponent(orgAddress)}` : '/api/graph'
    fetch(url).then((r) => r.json()).then(setRawData).catch(() => {})
  }, [orgAddress])

  if (!rawData || rawData.nodes.length === 0) {
    return <div data-component="graph-empty"><p>No graph data yet.</p><p><a href="/deploy/person">Deploy a Person Agent</a> or <a href="/deploy/org">Deploy an Org Agent</a> to get started.</p></div>
  }

  // Apply filter
  const myAddrs = new Set((rawData.currentUserAddresses ?? []).map((a) => a.toLowerCase()))
  const data: GraphData = filter === 'all' ? rawData : (() => {
    // "mine" = show my agents + any agents connected to mine
    const connectedAddrs = new Set<string>(myAddrs)
    rawData.edges.forEach((e) => {
      if (myAddrs.has(e.source.toLowerCase()) || myAddrs.has(e.target.toLowerCase())) {
        connectedAddrs.add(e.source.toLowerCase())
        connectedAddrs.add(e.target.toLowerCase())
      }
    })
    return {
      nodes: rawData.nodes.filter((n) => connectedAddrs.has(n.id.toLowerCase())),
      edges: rawData.edges.filter((e) =>
        connectedAddrs.has(e.source.toLowerCase()) && connectedAddrs.has(e.target.toLowerCase())
      ),
    }
  })()

  const W = 900, H = 600
  const nodes = layoutNodes(data.nodes, W, H)
  const nodeMap = new Map(nodes.map((n) => [n.id.toLowerCase(), n]))

  const connectedEdges = selectedNode
    ? data.edges.filter((e) => e.source.toLowerCase() === selectedNode || e.target.toLowerCase() === selectedNode)
    : []

  const selectedNodeData = selectedNode ? nodeMap.get(selectedNode) : null
  const nodeTemplates = connectedEdges.flatMap((e) => e.templates)
  const uniqueTemplates = nodeTemplates.filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i)

  function handleNodeClick(nodeId: string) {
    const key = nodeId.toLowerCase()
    setSelectedNode(selectedNode === key ? null : key)
    setSelectedEdge(null)
  }

  function handleEdgeClick(edge: GraphEdge) {
    setSelectedEdge(selectedEdge?.edgeId === edge.edgeId ? null : edge)
  }

  const isNodeHighlighted = (id: string) => {
    if (!selectedNode) return true
    if (id.toLowerCase() === selectedNode) return true
    return connectedEdges.some(
      (e) => e.source.toLowerCase() === id.toLowerCase() || e.target.toLowerCase() === id.toLowerCase()
    )
  }

  const isEdgeHighlighted = (edge: GraphEdge) => {
    if (!selectedNode) return true
    return edge.source.toLowerCase() === selectedNode || edge.target.toLowerCase() === selectedNode
  }

  return (
    <div data-component="trust-graph-container">
      {/* Compact floating toolbar — top-left of graph */}
      <div data-component="graph-floating-toolbar">
        <button
          onClick={() => { setFilter('mine'); setSelectedNode(null); setSelectedEdge(null) }}
          data-component="filter-btn"
          data-active={filter === 'mine' ? 'true' : 'false'}
          disabled={myAddrs.size === 0}
        >
          My Agents ({myAddrs.size})
        </button>
        <button
          onClick={() => { setFilter('all'); setSelectedNode(null); setSelectedEdge(null) }}
          data-component="filter-btn"
          data-active={filter === 'all' ? 'true' : 'false'}
        >
          All ({rawData.nodes.length})
        </button>
        <button
          onClick={() => setShowLegend(!showLegend)}
          data-component="filter-btn"
          data-active={showLegend ? 'true' : 'false'}
        >
          Legend
        </button>

        {/* Legend popover */}
        {showLegend && (
          <div data-component="graph-legend-popover">
            <div style={{ fontSize: '0.65rem', color: '#9e9e9e', marginBottom: '0.35rem', fontWeight: 600 }}>NODES</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <span data-component="legend-item"><span style={{ background: NODE_COLORS.person }} data-component="legend-dot" /> Person</span>
              <span data-component="legend-item"><span style={{ background: NODE_COLORS.org }} data-component="legend-dot" /> Org</span>
              <span data-component="legend-item"><span style={{ background: NODE_COLORS.ai }} data-component="legend-dot" /> AI</span>
              <span data-component="legend-item"><span style={{ background: NODE_COLORS.eoa }} data-component="legend-dot" /> EOA</span>
            </div>
            <div style={{ fontSize: '0.65rem', color: '#9e9e9e', marginBottom: '0.35rem', fontWeight: 600 }}>EDGES</div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {Object.entries(EDGE_COLORS).map(([t, c]) => (
                <span key={t} data-component="legend-item"><span style={{ background: c }} data-component="legend-line" /> {t}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div data-component="graph-layout">
        {/* Zoom controls */}
        <div data-component="graph-zoom-controls">
          <button onClick={() => { setZoom(z => Math.min(z * 1.3, 8)); }} title="Zoom in">+</button>
          <button onClick={() => { setZoom(z => Math.max(z / 1.3, 0.25)); }} title="Zoom out">−</button>
          <button onClick={resetView} title="Reset view">⟲</button>
          <span data-component="zoom-level">{Math.round(zoom * 100)}%</span>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          data-component="graph-svg"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{ touchAction: 'none' }}
        >
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" fill="#888">
              <polygon points="0 0, 10 3.5, 0 7" />
            </marker>
          </defs>

          {/* Invisible background rect for pan hit detection */}
          <rect data-graph-bg="true" x="0" y="0" width={W} height={H} fill="transparent" />

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`} style={{ transformOrigin: '0 0' }}>

          {data.edges.map((edge, i) => {
            const src = nodeMap.get(edge.source.toLowerCase())
            const tgt = nodeMap.get(edge.target.toLowerCase())
            if (!src?.x || !src?.y || !tgt?.x || !tgt?.y) return null
            const color = EDGE_COLORS[edge.relationshipType] ?? '#666'
            const dx = tgt.x - src.x, dy = tgt.y - src.y
            const len = Math.sqrt(dx * dx + dy * dy) || 1
            const ox = (dx / len) * 30, oy = (dy / len) * 30
            const mx = (src.x + tgt.x) / 2, my = (src.y + tgt.y) / 2
            const px = -dy / len * 15 * (i % 3 - 1), py = dx / len * 15 * (i % 3 - 1)
            const hl = isEdgeHighlighted(edge)
            const isSel = selectedEdge?.edgeId === edge.edgeId
            return (
              <g key={i} opacity={hl ? 1 : 0.08} style={{ cursor: 'pointer' }} onClick={() => handleEdgeClick(edge)}>
                <path d={`M ${src.x + ox} ${src.y + oy} Q ${mx + px} ${my + py} ${tgt.x - ox} ${tgt.y - oy}`}
                  fill="none" stroke={color} strokeWidth={isSel ? 4 : hl ? 2.5 : 1.5}
                  strokeDasharray={edge.status === 'active' ? 'none' : '5,5'} markerEnd="url(#arrow)" />
                <text x={mx + px} y={my + py - 6} fill={color} fontSize="8" textAnchor="middle" fontWeight="600">
                  {edge.roles.join(', ')}
                </text>
                {edge.templates.length > 0 && (
                  <text x={mx + px} y={my + py + 8} fill="#6b7280" fontSize="6" textAnchor="middle">
                    [{edge.templates.length} template{edge.templates.length > 1 ? 's' : ''}]
                  </text>
                )}
              </g>
            )
          })}

          {nodes.map((node) => {
            const hl = isNodeHighlighted(node.id)
            const isSel = selectedNode === node.id.toLowerCase()
            const r = node.type === 'org' ? 28 : node.type === 'ai' ? 25 : node.type === 'eoa' ? 18 : 22
            const nx = node.x ?? 0, ny = node.y ?? 0
            const stroke = isSel ? '#1a1a2e' : 'rgba(0,0,0,0.15)'
            const sw = isSel ? 3 : 1.5
            return (
              <g key={node.id} opacity={hl ? 1 : 0.12} style={{ cursor: 'pointer' }}
                onClick={() => handleNodeClick(node.id)}>
                {node.type === 'org' ? (
                  <rect x={nx - r} y={ny - r} width={r * 2} height={r * 2} rx={8}
                    fill={NODE_COLORS[node.type]} stroke={stroke} strokeWidth={sw} />
                ) : node.type === 'ai' ? (
                  <polygon
                    points={`${nx},${ny - r} ${nx + r},${ny} ${nx},${ny + r} ${nx - r},${ny}`}
                    fill={NODE_COLORS[node.type]} stroke={stroke} strokeWidth={sw} />
                ) : node.type === 'eoa' ? (
                  <polygon
                    points={(() => { const s = r; return [0,1,2,3,4,5].map(i => { const a = Math.PI/3*i - Math.PI/6; return `${nx+s*Math.cos(a)},${ny+s*Math.sin(a)}`; }).join(' '); })()}
                    fill={NODE_COLORS[node.type]} stroke={stroke} strokeWidth={sw} />
                ) : (
                  <circle cx={nx} cy={ny} r={r}
                    fill={NODE_COLORS[node.type]} stroke={stroke} strokeWidth={sw} />
                )}
                <text x={node.x} y={(node.y ?? 0) + r + 14} fill="#1a1a2e" fontSize="11" textAnchor="middle" fontWeight="600">{node.label}</text>
                <text x={node.x} y={(node.y ?? 0) + r + 25} fill="#6b7280" fontSize="7" textAnchor="middle">
                  {node.address.slice(0, 6)}...{node.address.slice(-4)}
                </text>
              </g>
            )
          })}
          </g>
        </svg>

        {/* Detail Panel */}
        <div data-component="detail-panel">
          {!selectedNode && !selectedEdge && (
            <div data-component="panel-empty">
              <h3>Agent Trust Graph</h3>
              <p>Click an agent node to see relationships, roles, and delegation templates.</p>
              <p>Click an edge for relationship details.</p>
              <div data-component="panel-stats">
                <span>{data.nodes.length} agents</span>
                <span>{data.edges.length} relationships</span>
                <span>{data.edges.reduce((a, e) => a + e.templates.length, 0)} templates</span>
              </div>
            </div>
          )}

          {selectedNodeData && !selectedEdge && (
            <div data-component="agent-detail">
              <div data-component="agent-detail-header" data-type={selectedNodeData.type}>
                <h3>{selectedNodeData.label}</h3>
                <span data-component="role-badge">{selectedNodeData.type}</span>
                {selectedNodeData.aiClass && <span data-component="role-badge">{selectedNodeData.aiClass}</span>}
                {selectedNodeData.isResolverRegistered && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.55rem' }}>on-chain</span>}
              </div>
              <code data-component="did">{selectedNodeData.did}</code>

              {selectedNodeData.description && (
                <p style={{ fontSize: '0.8rem', color: '#616161', margin: '0.5rem 0' }}>{selectedNodeData.description}</p>
              )}

              {selectedNodeData.capabilities && selectedNodeData.capabilities.length > 0 && (
                <div style={{ margin: '0.5rem 0' }}>
                  <span style={{ fontSize: '0.7rem', color: '#666' }}>Capabilities: </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', marginTop: '0.2rem' }}>
                    {selectedNodeData.capabilities.map(c => <span key={c} data-component="role-badge" style={{ fontSize: '0.6rem' }}>{c}</span>)}
                  </div>
                </div>
              )}

              {selectedNodeData.trustModels && selectedNodeData.trustModels.length > 0 && (
                <div style={{ margin: '0.25rem 0' }}>
                  <span style={{ fontSize: '0.7rem', color: '#666' }}>Trust: </span>
                  {selectedNodeData.trustModels.map(t => <span key={t} data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem', marginRight: 2 }}>{t}</span>)}
                </div>
              )}

              {selectedNodeData.a2aEndpoint && (
                <div style={{ fontSize: '0.7rem', color: '#666', margin: '0.25rem 0' }}>
                  A2A: <code style={{ fontSize: '0.65rem' }}>{selectedNodeData.a2aEndpoint}</code>
                </div>
              )}

              {selectedNodeData.type !== 'eoa' && (
                <div style={{ margin: '0.5rem 0' }}>
                  <a href={`/agents/${selectedNodeData.address}`} style={{ fontSize: '0.75rem', color: '#1565c0' }}>View Trust Profile</a>
                  {' | '}
                  <a href={`/agents/${selectedNodeData.address}/metadata`} style={{ fontSize: '0.75rem', color: '#1565c0' }}>Edit Metadata</a>
                </div>
              )}

              <h4>Relationships ({connectedEdges.length})</h4>
              {connectedEdges.map((e, i) => {
                const peer = e.source.toLowerCase() === selectedNode
                  ? nodeMap.get(e.target.toLowerCase()) : nodeMap.get(e.source.toLowerCase())
                const dir = e.source.toLowerCase() === selectedNode ? '→' : '←'
                return (
                  <div key={i} data-component="rel-card" onClick={() => handleEdgeClick(e)}>
                    <div data-component="rel-card-header">
                      <span>{dir} {peer?.label ?? 'Unknown'}</span>
                      <span data-component="role-badge" data-status={e.status}>{e.status}</span>
                    </div>
                    <div data-component="rel-card-type">{e.relationshipType}</div>
                    <div data-component="role-list">
                      {e.roles.map((r, j) => <span key={j} data-component="role-badge">{r}</span>)}
                    </div>
                    {e.templates.length > 0 && (
                      <div data-component="rel-card-templates">
                        {e.templates.map((t) => <span key={t.id} data-component="template-tag" title={t.description}>{t.name}</span>)}
                      </div>
                    )}
                  </div>
                )
              })}

              {uniqueTemplates.length > 0 && (
                <>
                  <h4>Delegation Templates ({uniqueTemplates.length})</h4>
                  {uniqueTemplates.map((t) => (
                    <div key={t.id} data-component="template-card">
                      <strong>{t.name}</strong>
                      <p>{t.description}</p>
                      <div data-component="role-list">
                        <span data-component="role-badge">{t.forRole}</span>
                        <span data-component="role-badge">{t.forType}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {selectedEdge && (
            <div data-component="edge-detail-inline">
              <button onClick={() => setSelectedEdge(null)} data-component="back-btn">← Back</button>
              <h3>Edge Detail</h3>
              <dl>
                <dt>Type</dt><dd><span data-component="role-badge">{selectedEdge.relationshipType}</span></dd>
                <dt>From</dt><dd>{nodeMap.get(selectedEdge.source.toLowerCase())?.label}</dd>
                <dt>To</dt><dd>{nodeMap.get(selectedEdge.target.toLowerCase())?.label}</dd>
                <dt>Status</dt><dd><span data-component="role-badge" data-status={selectedEdge.status}>{selectedEdge.status}</span></dd>
                <dt>Roles</dt>
                <dd data-component="role-list">{selectedEdge.roles.map((r, i) => <span key={i} data-component="role-badge">{r}</span>)}</dd>
                <dt>Edge ID</dt><dd data-component="address" style={{ fontSize: '0.6rem' }}>{selectedEdge.edgeId.slice(0, 22)}...</dd>
              </dl>
              {selectedEdge.templates.length > 0 && (
                <div data-component="template-section">
                  <h5>Delegation Templates</h5>
                  {selectedEdge.templates.map((t) => (
                    <div key={t.id} data-component="template-card">
                      <strong>{t.name}</strong>
                      <p>{t.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
