'use client'

import { useEffect, useState } from 'react'

interface GraphNode {
  id: string
  label: string
  type: 'person' | 'org'
  did: string
  address: string
  x?: number
  y?: number
}

interface GraphEdge {
  source: string
  target: string
  roles: string[]
  relationshipType: string
  status: string
  edgeId: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const NODE_COLORS: Record<string, string> = {
  person: '#6366f1',
  org: '#22c55e',
}

const EDGE_COLORS: Record<string, string> = {
  Governance: '#f59e0b',
  Membership: '#6366f1',
  Alliance: '#ec4899',
  Validation: '#06b6d4',
  Insurance: '#8b5cf6',
  'Economic Security': '#14b8a6',
  Service: '#f97316',
  Delegation: '#64748b',
}

function layoutNodes(nodes: GraphNode[], width: number, height: number): GraphNode[] {
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.35
  return nodes.map((node, i) => ({
    ...node,
    x: cx + radius * Math.cos((2 * Math.PI * i) / nodes.length - Math.PI / 2),
    y: cy + radius * Math.sin((2 * Math.PI * i) / nodes.length - Math.PI / 2),
  }))
}

export function TrustGraphView() {
  const [data, setData] = useState<GraphData | null>(null)
  const [selected, setSelected] = useState<GraphEdge | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/graph')
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
  }, [])

  if (!data || data.nodes.length === 0) {
    return (
      <div data-component="graph-empty">
        <p>No graph data. Deploy agents and create relationships first.</p>
      </div>
    )
  }

  const W = 900
  const H = 600
  const nodes = layoutNodes(data.nodes, W, H)
  const nodeMap = new Map(nodes.map((n) => [n.id.toLowerCase(), n]))

  return (
    <div data-component="trust-graph-container">
      <div data-component="graph-legend">
        <h4>Legend</h4>
        <div data-component="legend-items">
          <span data-component="legend-item"><span style={{ background: NODE_COLORS.person }} data-component="legend-dot" /> Person Agent</span>
          <span data-component="legend-item"><span style={{ background: NODE_COLORS.org }} data-component="legend-dot" /> Organization Agent</span>
          {Object.entries(EDGE_COLORS).map(([type, color]) => (
            <span key={type} data-component="legend-item"><span style={{ background: color }} data-component="legend-line" /> {type}</span>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} data-component="graph-svg">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" fill="#888">
            <polygon points="0 0, 10 3.5, 0 7" />
          </marker>
        </defs>

        {/* Edges */}
        {data.edges.map((edge, i) => {
          const src = nodeMap.get(edge.source.toLowerCase())
          const tgt = nodeMap.get(edge.target.toLowerCase())
          if (!src || !tgt || !src.x || !src.y || !tgt.x || !tgt.y) return null

          const color = EDGE_COLORS[edge.relationshipType] ?? '#666'
          const dx = tgt.x - src.x
          const dy = tgt.y - src.y
          const len = Math.sqrt(dx * dx + dy * dy)
          const offsetX = (dx / len) * 30
          const offsetY = (dy / len) * 30

          // Curve offset for multiple edges between same nodes
          const midX = (src.x + tgt.x) / 2
          const midY = (src.y + tgt.y) / 2
          const perpX = -dy / len * 20 * (i % 3 - 1)
          const perpY = dx / len * 20 * (i % 3 - 1)

          const isHighlighted = hoveredNode === null ||
            edge.source.toLowerCase() === hoveredNode ||
            edge.target.toLowerCase() === hoveredNode

          return (
            <g key={i} opacity={isHighlighted ? 1 : 0.15}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelected(edge)}>
              <path
                d={`M ${src.x + offsetX} ${src.y + offsetY} Q ${midX + perpX} ${midY + perpY} ${tgt.x - offsetX} ${tgt.y - offsetY}`}
                fill="none"
                stroke={color}
                strokeWidth={edge.status === 'active' ? 2.5 : 1.5}
                strokeDasharray={edge.status === 'active' ? 'none' : '5,5'}
                markerEnd="url(#arrowhead)"
              />
              <text
                x={midX + perpX}
                y={midY + perpY - 6}
                fill={color}
                fontSize="9"
                textAnchor="middle"
                fontWeight="600"
              >
                {edge.roles.join(', ')}
              </text>
            </g>
          )
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isHighlighted = hoveredNode === null || hoveredNode === node.id.toLowerCase()
          const r = node.type === 'org' ? 28 : 22
          return (
            <g key={node.id}
              opacity={isHighlighted ? 1 : 0.2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredNode(node.id.toLowerCase())}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {node.type === 'org' ? (
                <rect
                  x={(node.x ?? 0) - r}
                  y={(node.y ?? 0) - r}
                  width={r * 2}
                  height={r * 2}
                  rx={8}
                  fill={NODE_COLORS[node.type]}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ) : (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  fill={NODE_COLORS[node.type]}
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
              <text
                x={node.x}
                y={(node.y ?? 0) + r + 16}
                fill="#e4e4ef"
                fontSize="11"
                textAnchor="middle"
                fontWeight="600"
              >
                {node.label}
              </text>
              <text
                x={node.x}
                y={(node.y ?? 0) + r + 28}
                fill="#8888a0"
                fontSize="8"
                textAnchor="middle"
              >
                {node.address.slice(0, 6)}...{node.address.slice(-4)}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Edge detail panel */}
      {selected && (
        <div data-component="edge-detail">
          <button onClick={() => setSelected(null)} data-component="close-btn">x</button>
          <h4>Edge Detail</h4>
          <dl>
            <dt>Type</dt>
            <dd><span data-component="role-badge">{selected.relationshipType}</span></dd>
            <dt>Roles</dt>
            <dd data-component="role-list">
              {selected.roles.map((r, i) => (
                <span key={i} data-component="role-badge">{r}</span>
              ))}
            </dd>
            <dt>Subject</dt>
            <dd data-component="address">{selected.source.slice(0, 10)}...{selected.source.slice(-6)}</dd>
            <dt>Object</dt>
            <dd data-component="address">{selected.target.slice(0, 10)}...{selected.target.slice(-6)}</dd>
            <dt>Status</dt>
            <dd><span data-component="role-badge" data-status={selected.status}>{selected.status}</span></dd>
          </dl>
        </div>
      )}
    </div>
  )
}
