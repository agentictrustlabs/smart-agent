'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

interface MapAgent {
  address: string
  name: string
  latitude: number
  longitude: number
  generation?: number
  isEstablished?: boolean
  healthScore?: number
  status?: string
}

interface Props {
  agents: MapAgent[]
}

const GEN_COLORS = ['#1565c0', '#0d9488', '#2e7d32', '#7c3aed', '#ea580c', '#b91c1c']

export function GeoMapView({ agents }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<MapAgent | null>(null)

  const handleSelect = useCallback((a: MapAgent | null) => setSelectedAgent(a), [])

  useEffect(() => {
    if (!mapRef.current || mapInstance.current || agents.length === 0) return

    // Guard against double-init in React Strict Mode / HMR
    const container = mapRef.current as HTMLDivElement & { _leaflet_id?: number }
    if (container._leaflet_id) return

    import('leaflet').then((L) => {
      const lats = agents.map(a => a.latitude)
      const lons = agents.map(a => a.longitude)
      const center: [number, number] = [
        (Math.min(...lats) + Math.max(...lats)) / 2,
        (Math.min(...lons) + Math.max(...lons)) / 2,
      ]

      const map = L.map(mapRef.current!, { center, zoom: 13, scrollWheelZoom: true })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      if (agents.length > 1) {
        const bounds = L.latLngBounds(agents.map(a => [a.latitude, a.longitude] as [number, number]))
        map.fitBounds(bounds, { padding: [40, 40] })
      }

      map.on('click', () => handleSelect(null))

      // Lines between nearby agents
      for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
          const a = agents[i], b = agents[j]
          const dist = Math.sqrt(Math.pow(a.latitude - b.latitude, 2) + Math.pow(a.longitude - b.longitude, 2))
          if (dist > 0.1) continue
          L.polyline([[a.latitude, a.longitude], [b.latitude, b.longitude]], {
            color: '#b0bec5', weight: 1.5, dashArray: '4 3', opacity: 0.4,
          }).addTo(map)
        }
      }

      // Agent markers
      for (const agent of agents) {
        const gen = agent.generation ?? 0
        const color = agent.isEstablished ? '#2e7d32' : (GEN_COLORS[gen] ?? '#1565c0')
        const r = agent.isEstablished ? 14 : 11
        const dash = agent.isEstablished ? '' : 'stroke-dasharray="4 2"'

        const icon = L.divIcon({
          className: 'map-agent-pin',
          html: `<div style="display:flex;flex-direction:column;align-items:center;">
            <svg width="${r * 2 + 8}" height="${r * 2 + 8}" viewBox="0 0 ${r * 2 + 8} ${r * 2 + 8}">
              <circle cx="${r + 4}" cy="${r + 4}" r="${r}" fill="white" stroke="${color}" stroke-width="2.5" ${dash} />
              <text x="${r + 4}" y="${r + 8}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}">G${gen}</text>
            </svg>
            <div style="background:white;border:1px solid #e0e0e0;border-radius:4px;padding:1px 6px;margin-top:-2px;font-size:11px;font-weight:600;color:#1a1a2e;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.1);">${agent.name}</div>
          </div>`,
          iconSize: [0, 0],
          iconAnchor: [r + 4, r + 4],
        })

        const marker = L.marker([agent.latitude, agent.longitude], { icon }).addTo(map)

        // Hover tooltip
        marker.bindTooltip(
          `<strong>${agent.name}</strong><br/>G${gen} · ${agent.isEstablished ? 'Established' : 'Group'}${agent.healthScore ? ` · Health: ${agent.healthScore}` : ''}`,
          { direction: 'top', offset: L.point(0, -r - 8) }
        )

        // Click → select (don't navigate)
        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e)
          handleSelect(agent)
        })
      }

      mapInstance.current = map
    })

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
    }
  }, [agents, handleSelect])

  if (agents.length === 0) {
    return <p data-component="text-muted">No agents with location data.</p>
  }

  return (
    <div style={{ position: 'relative' }}>
      <div ref={mapRef} style={{ width: '100%', height: 450, borderRadius: 10 }} />

      {/* Agent detail panel */}
      {selectedAgent && (() => {
        const gen = selectedAgent.generation ?? 0
        const color = selectedAgent.isEstablished ? '#2e7d32' : (GEN_COLORS[gen] ?? '#1565c0')
        return (
          <div style={{
            position: 'absolute', top: 12, right: 12, width: 280, zIndex: 1000,
            background: 'white', borderRadius: 10, padding: '1rem',
            border: `2px solid ${color}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <div>
                <strong style={{ fontSize: '1rem', color: '#1a1a2e' }}>{selectedAgent.name}</strong>
                <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                  <span data-component="role-badge" style={{ fontSize: '0.6rem' }}>G{gen}</span>
                  {selectedAgent.isEstablished && <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>Established</span>}
                  {selectedAgent.status && <span data-component="role-badge" data-status={selectedAgent.status === 'active' ? 'active' : 'proposed'} style={{ fontSize: '0.6rem' }}>{selectedAgent.status}</span>}
                </div>
              </div>
              <button onClick={() => setSelectedAgent(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#616161', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ fontSize: '0.75rem', color: '#616161', marginBottom: '0.5rem' }}>
              {selectedAgent.latitude.toFixed(4)}, {selectedAgent.longitude.toFixed(4)}
            </div>

            {selectedAgent.healthScore !== undefined && selectedAgent.healthScore > 0 && (
              <div style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                <span style={{ color: '#616161' }}>Health Score: </span>
                <strong style={{ color }}>{selectedAgent.healthScore}</strong>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', paddingTop: '0.5rem', borderTop: '1px solid #f0f1f3' }}>
              <Link href={`/agents/${selectedAgent.address}`} style={{ color: '#1565c0', fontWeight: 600 }}>Trust Profile</Link>
              <Link href={`/agents/${selectedAgent.address}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
