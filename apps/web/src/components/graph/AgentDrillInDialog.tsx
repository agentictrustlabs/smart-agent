'use client'

/**
 * Focused single-agent detail popup, opened from the trust-graph side panel.
 *
 * Shows everything the side panel shows, plus:
 *   - full relationship list (no scroll truncation; every edge in + out)
 *   - per-relationship template inheritance
 *   - links to the agent's full profile + metadata editor
 *   - a neighborhood mini-graph (the focused agent at center + 1-hop peers)
 *
 * The dialog is a controlled modal — the parent owns `selectedNode` and the
 * `open` flag. Closing the dialog leaves the main graph's selection / pan /
 * zoom state untouched.
 */

import { useMemo } from 'react'

export interface DrillInNode {
  id: string
  label: string
  type: 'person' | 'org' | 'ai' | 'eoa' | 'treasury'
  did: string
  address: string
  description?: string
  capabilities?: string[]
  trustModels?: string[]
  a2aEndpoint?: string
  aiClass?: string
  isResolverRegistered?: boolean
}

export interface DrillInEdge {
  source: string
  target: string
  roles: string[]
  relationshipType: string
  status: string
  edgeId: string
  templates: Array<{ id: number; name: string; description: string; forRole: string; forType: string }>
}

interface Props {
  open: boolean
  onClose: () => void
  focusNode: DrillInNode | null
  /** All graph nodes (used for resolving peer labels). */
  allNodes: DrillInNode[]
  /** All graph edges (used to compute the focused agent's neighborhood). */
  allEdges: DrillInEdge[]
  /** Color palette by node type — passed from the parent so we stay in sync
   *  with the main graph's legend even when we add new types. */
  nodeColors: Record<string, string>
  /** Color palette by relationship type — same reasoning. */
  edgeColors: Record<string, string>
}

const C = {
  overlay: 'rgba(15, 23, 42, 0.6)',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
  accent: '#1565c0',
  badgeBg: '#f1f5f9',
  miniBg: '#f8fafc',
}

export function AgentDrillInDialog({
  open, onClose, focusNode, allNodes, allEdges, nodeColors, edgeColors,
}: Props) {
  // Connected edges + the peer for each edge, computed once per render.
  const { connectedEdges, neighborhood } = useMemo(() => {
    if (!focusNode) return { connectedEdges: [], neighborhood: { nodes: [], edges: [] } }
    const focusKey = focusNode.address.toLowerCase()
    const myEdges = allEdges.filter(
      (e) => e.source.toLowerCase() === focusKey || e.target.toLowerCase() === focusKey,
    )
    const peerKeys = new Set<string>([focusKey])
    for (const e of myEdges) {
      peerKeys.add(e.source.toLowerCase())
      peerKeys.add(e.target.toLowerCase())
    }
    const peers = allNodes.filter((n) => peerKeys.has(n.address.toLowerCase()))
    return { connectedEdges: myEdges, neighborhood: { nodes: peers, edges: myEdges } }
  }, [focusNode, allNodes, allEdges])

  if (!open || !focusNode) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: C.overlay, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem',
      }}
      role="dialog" aria-modal="true" aria-label={`Agent detail — ${focusNode.label}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.card, borderRadius: 12, padding: '1.4rem 1.6rem',
          maxWidth: '52rem', width: '100%', maxHeight: '88vh', overflowY: 'auto',
          boxShadow: '0 18px 50px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', marginBottom: '0.7rem' }}>
          <div
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: nodeColors[focusNode.type] ?? '#94a3b8',
              flexShrink: 0,
            }}
            aria-hidden="true"
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: C.text, margin: 0 }}>
              {focusNode.label}
            </h2>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
              <Badge>{focusNode.type}</Badge>
              {focusNode.aiClass && <Badge>{focusNode.aiClass}</Badge>}
              {focusNode.isResolverRegistered && <Badge active>on-chain</Badge>}
            </div>
            <code style={{ display: 'block', fontSize: '0.7rem', color: C.textMuted, marginTop: '0.4rem', wordBreak: 'break-all' }}>
              {focusNode.did}
            </code>
            <code style={{ display: 'block', fontSize: '0.7rem', color: C.textMuted, marginTop: '0.1rem', wordBreak: 'break-all' }}>
              {focusNode.address}
            </code>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: '1.4rem', color: C.textMuted, padding: '0 0.3rem',
            }}
          >
            ×
          </button>
        </div>

        {/* Description */}
        {focusNode.description && (
          <p style={{ fontSize: '0.88rem', color: C.text, lineHeight: 1.5, margin: '0.6rem 0' }}>
            {focusNode.description}
          </p>
        )}

        {/* Capabilities / Trust / A2A */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', margin: '0.85rem 0' }}>
          {focusNode.capabilities && focusNode.capabilities.length > 0 && (
            <FactBlock label="Capabilities">
              {focusNode.capabilities.map((c) => <Badge key={c}>{c}</Badge>)}
            </FactBlock>
          )}
          {focusNode.trustModels && focusNode.trustModels.length > 0 && (
            <FactBlock label="Trust models">
              {focusNode.trustModels.map((t) => <Badge key={t} active>{t}</Badge>)}
            </FactBlock>
          )}
          {focusNode.a2aEndpoint && (
            <FactBlock label="A2A endpoint">
              <code style={{ fontSize: '0.72rem', color: C.text, wordBreak: 'break-all' }}>{focusNode.a2aEndpoint}</code>
            </FactBlock>
          )}
        </div>

        {/* Profile links */}
        {focusNode.type !== 'eoa' && (
          <div style={{ display: 'flex', gap: '0.85rem', fontSize: '0.82rem', marginBottom: '0.85rem' }}>
            <a href={`/agents/${focusNode.address}`} style={{ color: C.accent, textDecoration: 'none', fontWeight: 600 }}>
              Full trust profile →
            </a>
            <a href={`/agents/${focusNode.address}/metadata`} style={{ color: C.accent, textDecoration: 'none', fontWeight: 600 }}>
              Edit metadata →
            </a>
          </div>
        )}

        {/* Neighborhood mini-graph */}
        {neighborhood.nodes.length > 1 && (
          <FactBlock label={`Neighborhood (${neighborhood.nodes.length - 1} peer${neighborhood.nodes.length === 2 ? '' : 's'})`}>
            <NeighborhoodSVG
              focusKey={focusNode.address.toLowerCase()}
              nodes={neighborhood.nodes}
              edges={neighborhood.edges}
              nodeColors={nodeColors}
              edgeColors={edgeColors}
            />
          </FactBlock>
        )}

        {/* Relationships table */}
        <FactBlock label={`Relationships (${connectedEdges.length})`}>
          {connectedEdges.length === 0 && (
            <div style={{ color: C.textMuted, fontSize: '0.82rem', fontStyle: 'italic' }}>
              No relationships yet.
            </div>
          )}
          {connectedEdges.map((e, i) => {
            const focusKey = focusNode.address.toLowerCase()
            const peerKey = e.source.toLowerCase() === focusKey ? e.target.toLowerCase() : e.source.toLowerCase()
            const peer = allNodes.find((n) => n.address.toLowerCase() === peerKey)
            const dir = e.source.toLowerCase() === focusKey ? '→' : '←'
            const isCtrl = e.edgeId.startsWith('ctrl-')
            const color = edgeColors[e.relationshipType] ?? '#666'
            return (
              <div
                key={e.edgeId || i}
                style={{
                  borderLeft: `4px ${isCtrl ? 'dashed' : 'solid'} ${color}`,
                  paddingLeft: '0.6rem', marginBottom: '0.4rem',
                }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: C.text }}>
                  {dir} {peer?.label ?? peerKey.slice(0, 10) + '…'}
                  <span style={{ fontSize: '0.72rem', color: C.textMuted, marginLeft: '0.4rem' }}>
                    {e.relationshipType}
                  </span>
                </div>
                {e.roles.length > 0 && (
                  <div style={{ marginTop: '0.2rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {e.roles.map((r) => <Badge key={r}>{r}</Badge>)}
                  </div>
                )}
                {e.templates.length > 0 && (
                  <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.25rem' }}>
                    Templates: {e.templates.map((t) => t.name).join(', ')}
                  </div>
                )}
              </div>
            )
          })}
        </FactBlock>
      </div>
    </div>
  )
}

function Badge({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span style={{
      fontSize: '0.62rem', fontWeight: 700,
      padding: '0.15rem 0.5rem', borderRadius: 999,
      background: active ? 'rgba(15,118,110,0.10)' : C.badgeBg,
      color: active ? '#0f766e' : C.text,
      border: `1px solid ${active ? 'rgba(15,118,110,0.30)' : C.border}`,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {children}
    </span>
  )
}

function FactBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.85rem' }}>
      <div style={{
        fontSize: '0.65rem', fontWeight: 700, color: C.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem',
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>{children}</div>
    </div>
  )
}

/**
 * Tiny radial SVG: focus at center, peers around the rim. Edges go from
 * focus to each peer with the relationship-type color. Pure presentation,
 * no interactivity — clicking peers here would compete with the main graph
 * for selection state.
 */
function NeighborhoodSVG({
  focusKey, nodes, edges, nodeColors, edgeColors,
}: {
  focusKey: string
  nodes: DrillInNode[]
  edges: DrillInEdge[]
  nodeColors: Record<string, string>
  edgeColors: Record<string, string>
}) {
  const W = 480, H = 280
  const cx = W / 2, cy = H / 2
  const focus = nodes.find((n) => n.address.toLowerCase() === focusKey)
  const peers = nodes.filter((n) => n.address.toLowerCase() !== focusKey)
  const r = Math.min(W, H) * 0.36
  const placed = peers.map((p, i) => {
    const angle = (2 * Math.PI * i) / Math.max(peers.length, 1) - Math.PI / 2
    return { ...p, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  })
  const placedMap = new Map(placed.map((p) => [p.address.toLowerCase(), p]))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: '100%', height: 'auto', maxHeight: 280,
        background: C.miniBg, border: `1px solid ${C.border}`, borderRadius: 8,
      }}
    >
      {edges.map((e, i) => {
        const fromFocus = e.source.toLowerCase() === focusKey
        const peerKey = (fromFocus ? e.target : e.source).toLowerCase()
        const peer = placedMap.get(peerKey)
        if (!peer) return null
        const color = edgeColors[e.relationshipType] ?? '#666'
        const isCtrl = e.edgeId.startsWith('ctrl-')
        return (
          <line
            key={e.edgeId || i}
            x1={cx} y1={cy}
            x2={peer.x} y2={peer.y}
            stroke={color} strokeWidth={1.5}
            strokeDasharray={isCtrl ? '4,3' : undefined}
            opacity={0.7}
          />
        )
      })}
      {focus && (
        <g>
          <circle cx={cx} cy={cy} r={18} fill={nodeColors[focus.type] ?? '#94a3b8'} stroke="#fff" strokeWidth={2} />
          <text x={cx} y={cy + 32} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.text}>
            {focus.label.length > 24 ? focus.label.slice(0, 22) + '…' : focus.label}
          </text>
        </g>
      )}
      {placed.map((p) => (
        <g key={p.address}>
          <circle cx={p.x} cy={p.y} r={11} fill={nodeColors[p.type] ?? '#94a3b8'} stroke="#fff" strokeWidth={1.5} />
          <text x={p.x} y={p.y + 22} textAnchor="middle" fontSize={10} fill={C.text}>
            {p.label.length > 16 ? p.label.slice(0, 14) + '…' : p.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
