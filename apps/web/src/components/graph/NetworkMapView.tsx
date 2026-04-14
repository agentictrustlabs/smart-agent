'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

interface MapAgent {
  address: string
  name: string
  type: 'person' | 'org' | 'ai'
  latitude: number
  longitude: number
  generation?: number
  isEstablished?: boolean
}

interface MapEdge {
  sourceAddr: string
  targetAddr: string
  roles: string[]
  relationshipType: string
  status: string
  edgeId: string
}

interface Props {
  agents: MapAgent[]
  edges: MapEdge[]
}

const EDGE_COLORS: Record<string, string> = {
  Governance: '#f59e0b', Membership: '#1565c0', Alliance: '#ec4899',
  Validation: '#06b6d4', Service: '#f97316', Delegation: '#ef4444',
  'Org Control': '#fb923c', 'Activity Validation': '#a3e635',
  'Hub Membership': '#7c3aed',
}

const TYPE_COLORS: Record<string, string> = {
  person: '#1565c0',
  org: '#2e7d32',
  ai: '#f59e0b',
}

const TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  org: 'Organization',
  ai: 'AI Agent',
}

// SVG icon paths by type
function agentIcon(type: string, color: string, size: number): string {
  const s = size
  if (type === 'person') {
    // Person silhouette
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" fill="${color}"/>
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" fill="${color}" opacity="0.6"/>
    </svg>`
  }
  if (type === 'ai') {
    // Circuit/bot icon
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="5" width="14" height="14" rx="3" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/>
      <circle cx="9" cy="11" r="1.5" fill="${color}"/>
      <circle cx="15" cy="11" r="1.5" fill="${color}"/>
      <path d="M9 15h6" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="12" y1="2" x2="12" y2="5" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="7" y1="3" x2="7" y2="5" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
      <line x1="17" y1="3" x2="17" y2="5" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
    </svg>`
  }
  // Organization building icon
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="7" width="18" height="14" rx="1.5" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/>
    <rect x="7" y="10" width="3" height="3" rx="0.5" fill="${color}"/>
    <rect x="14" y="10" width="3" height="3" rx="0.5" fill="${color}"/>
    <rect x="7" y="15" width="3" height="3" rx="0.5" fill="${color}"/>
    <rect x="14" y="15" width="3" height="3" rx="0.5" fill="${color}"/>
    <path d="M8 7V4h8v3" stroke="${color}" stroke-width="1.5"/>
  </svg>`
}

type Selection = { kind: 'agent'; agent: MapAgent } | { kind: 'edge'; edge: MapEdge }

function LeafletMap({ agents, edges, onSelect }: Props & { onSelect: (s: Selection | null) => void }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return
    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !mapRef.current || mapInstance.current) return

      const container = mapRef.current as HTMLDivElement & { _leaflet_id?: number }
      if (container._leaflet_id) {
        delete container._leaflet_id
      }

      const lats = agents.map(a => a.latitude)
      const lons = agents.map(a => a.longitude)
      const center: [number, number] = [
        (Math.min(...lats) + Math.max(...lats)) / 2,
        (Math.min(...lons) + Math.max(...lons)) / 2,
      ]

      const map = L.map(container, { center, zoom: 13, scrollWheelZoom: true })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      if (agents.length > 1) {
        const bounds = L.latLngBounds(agents.map(a => [a.latitude, a.longitude] as [number, number]))
        map.fitBounds(bounds, { padding: [40, 40] })
      }

      const agentLookup = new Map(agents.map(a => [a.address.toLowerCase(), a]))

      map.on('click', () => onSelect(null))

      // Relationship edges
      for (const edge of edges) {
        const src = agentLookup.get(edge.sourceAddr.toLowerCase())
        const tgt = agentLookup.get(edge.targetAddr.toLowerCase())
        if (!src || !tgt) continue

        const color = EDGE_COLORS[edge.relationshipType] ?? '#94a3b8'

        const line = L.polyline(
          [[src.latitude, src.longitude], [tgt.latitude, tgt.longitude]],
          { color, weight: 2.5, opacity: 0.7, dashArray: edge.status !== 'Active' ? '8 5' : undefined }
        ).addTo(map)

        const hitLine = L.polyline(
          [[src.latitude, src.longitude], [tgt.latitude, tgt.longitude]],
          { color: 'transparent', weight: 16, opacity: 0 }
        ).addTo(map)

        line.bindTooltip(
          `<strong>${edge.relationshipType}</strong><br/>${src.name} → ${tgt.name}<br/>${edge.roles.join(', ')}`,
          { sticky: true, className: 'edge-tooltip' }
        )

        const handler = (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onSelect({ kind: 'edge', edge })
        }
        line.on('click', handler)
        hitLine.on('click', handler)
      }

      // Agent markers with type-based icons
      for (const agent of agents) {
        const color = TYPE_COLORS[agent.type] ?? '#94a3b8'
        const iconSize = agent.type === 'org' ? 28 : 24
        const iconSvg = agentIcon(agent.type, color, iconSize)

        const icon = L.divIcon({
          className: 'map-agent-pin',
          html: `<div style="display:flex;flex-direction:column;align-items:center;">
            <div style="background:white;border-radius:50%;padding:4px;box-shadow:0 2px 6px rgba(0,0,0,0.15);border:2px solid ${color};">${iconSvg}</div>
            <div style="background:white;border:1px solid ${color}40;border-radius:4px;padding:1px 6px;margin-top:2px;font-size:11px;font-weight:600;color:#1a1a2e;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.08);">${agent.name}</div>
          </div>`,
          iconSize: [0, 0],
          iconAnchor: [iconSize / 2 + 4, iconSize / 2 + 4],
        })

        const marker = L.marker([agent.latitude, agent.longitude], { icon }).addTo(map)

        const typeLabel = TYPE_LABELS[agent.type] ?? agent.type
        marker.bindTooltip(
          `<strong>${agent.name}</strong><br/>${typeLabel}`,
          { direction: 'top', offset: L.point(0, -iconSize / 2 - 8) }
        )

        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          onSelect({ kind: 'agent', agent })
        })
      }

      mapInstance.current = map
    })

    return () => {
      cancelled = true
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
    }
  }, [agents, edges, onSelect])

  return <div ref={mapRef} style={{ width: '100%', height: 500, borderRadius: 10 }} />
}

export function NetworkMapView({ agents, edges }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null)

  const handleSelect = useCallback((s: Selection | null) => setSelection(s), [])

  if (agents.length === 0) {
    return <p data-component="text-muted">No agents with location data.</p>
  }

  const agentMap = new Map(agents.map(a => [a.address.toLowerCase(), a]))

  return (
    <div style={{ position: 'relative' }}>
      <LeafletMap agents={agents} edges={edges} onSelect={handleSelect} />

      {/* Agent detail panel */}
      {selection?.kind === 'agent' && (() => {
        const agent = selection.agent
        const color = TYPE_COLORS[agent.type] ?? '#94a3b8'
        const typeLabel = TYPE_LABELS[agent.type] ?? agent.type
        const agentEdges = edges.filter(e =>
          e.sourceAddr.toLowerCase() === agent.address.toLowerCase() ||
          e.targetAddr.toLowerCase() === agent.address.toLowerCase()
        )
        return (
          <div style={{
            position: 'absolute', top: 12, right: 12, width: 300, zIndex: 1000,
            background: 'white', borderRadius: 10, padding: '1rem',
            border: `2px solid ${color}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <div>
                <strong style={{ fontSize: '1rem', color: '#1a1a2e' }}>{agent.name}</strong>
                <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                  <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>{typeLabel}</span>
                  {agent.isEstablished && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>Established</span>}
                </div>
              </div>
              <button onClick={() => setSelection(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#616161', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ fontSize: '0.75rem', color: '#616161', marginBottom: '0.5rem' }}>
              {agent.latitude.toFixed(4)}, {agent.longitude.toFixed(4)}
            </div>

            {agentEdges.length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#616161', marginBottom: '0.25rem' }}>
                  Relationships ({agentEdges.length})
                </div>
                <div style={{ display: 'grid', gap: '0.35rem', maxHeight: 140, overflowY: 'auto' }}>
                  {agentEdges.map(e => {
                    const other = e.sourceAddr.toLowerCase() === agent.address.toLowerCase()
                      ? agentMap.get(e.targetAddr.toLowerCase())
                      : agentMap.get(e.sourceAddr.toLowerCase())
                    const edgeColor = EDGE_COLORS[e.relationshipType] ?? '#94a3b8'
                    return (
                      <div key={e.edgeId} style={{
                        display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem',
                        padding: '0.25rem 0.4rem', background: '#fafafa', borderRadius: 4,
                        borderLeft: `3px solid ${edgeColor}`,
                      }}>
                        <span style={{ color: edgeColor, fontWeight: 600, fontSize: '0.65rem' }}>{e.relationshipType}</span>
                        <span style={{ color: '#1a1a2e' }}>{other?.name ?? '...'}</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: '#9e9e9e' }}>{e.roles[0]}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', paddingTop: '0.5rem', borderTop: '1px solid #f0f1f3' }}>
              <Link href={`/agents/${agent.address}`} style={{ color: '#1565c0', fontWeight: 600 }}>Trust Profile</Link>
              <Link href={`/agents/${agent.address}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
            </div>
          </div>
        )
      })()}

      {/* Edge detail panel */}
      {selection?.kind === 'edge' && (() => {
        const edge = selection.edge
        const src = agentMap.get(edge.sourceAddr.toLowerCase())
        const tgt = agentMap.get(edge.targetAddr.toLowerCase())
        const color = EDGE_COLORS[edge.relationshipType] ?? '#94a3b8'
        return (
          <div style={{
            position: 'absolute', top: 12, right: 12, width: 300, zIndex: 1000,
            background: 'white', borderRadius: 10, padding: '1rem',
            border: `2px solid ${color}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <strong style={{ color, fontSize: '0.95rem' }}>{edge.relationshipType}</strong>
              <button onClick={() => setSelection(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#616161', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ fontSize: '0.8rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.35rem' }}>
                <span style={{ color: '#616161', fontSize: '0.7rem' }}>From</span>
                <strong style={{ color: '#1a1a2e' }}>{src?.name ?? edge.sourceAddr.slice(0, 10) + '...'}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ color: '#616161', fontSize: '0.7rem' }}>To</span>
                <strong style={{ color: '#1a1a2e' }}>{tgt?.name ?? edge.targetAddr.slice(0, 10) + '...'}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              {edge.roles.map(r => (
                <span key={r} data-component="role-badge" style={{ fontSize: '0.6rem' }}>{r}</span>
              ))}
              <span data-component="role-badge"
                data-status={edge.status === 'Active' ? 'active' : edge.status === 'Proposed' ? 'proposed' : 'revoked'}
                style={{ fontSize: '0.6rem' }}>
                {edge.status}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', paddingTop: '0.5rem', borderTop: '1px solid #f0f1f3' }}>
              {src && <Link href={`/agents/${src.address}`} style={{ color: '#1565c0' }}>{src.name}</Link>}
              {tgt && <Link href={`/agents/${tgt.address}`} style={{ color: '#1565c0' }}>{tgt.name}</Link>}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
