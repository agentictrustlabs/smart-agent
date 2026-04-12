'use client'


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
  centerLat?: number
  centerLon?: number
}

// Da Nang bounding box (with padding)
const DEFAULT_BOUNDS = {
  minLat: 15.95, maxLat: 16.12,
  minLon: 108.10, maxLon: 108.32,
}

const STATUS_COLORS: Record<string, string> = {
  established: '#2e7d32',
  active: '#1565c0',
  multiplied: '#0d9488',
  inactive: '#9e9e9e',
  closed: '#b91c1c',
}

export function GeoMapView({ agents, centerLat: _centerLat, centerLon: _centerLon }: Props) {
  if (agents.length === 0) {
    return <p data-component="text-muted">No agents with location data.</p>
  }

  // Compute bounds from agent positions (with padding)
  const lats = agents.map(a => a.latitude)
  const lons = agents.map(a => a.longitude)
  const padding = 0.015
  const bounds = {
    minLat: Math.min(...lats, DEFAULT_BOUNDS.minLat) - padding,
    maxLat: Math.max(...lats, DEFAULT_BOUNDS.maxLat) + padding,
    minLon: Math.min(...lons, DEFAULT_BOUNDS.minLon) - padding,
    maxLon: Math.max(...lons, DEFAULT_BOUNDS.maxLon) + padding,
  }

  const W = 800
  const H = 500

  function project(lat: number, lon: number): { x: number; y: number } {
    const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * W
    const y = H - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * H
    return { x, y }
  }

  return (
    <div style={{ background: '#f0f4f8', borderRadius: 10, padding: '1rem', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', minHeight: 350 }}>
        {/* Background grid */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e0e4e8" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" rx="8" />

        {/* Water bodies (simplified Da Nang coastline hint) */}
        <path d={`M ${W * 0.75} 0 Q ${W * 0.85} ${H * 0.3} ${W} ${H * 0.5}`}
          fill="none" stroke="#bbd4e8" strokeWidth="3" opacity="0.4" />

        {/* Connection lines between agents */}
        {agents.map((a, i) => {
          // Draw lines to agents that are geographically close (within ~0.05 degrees)
          return agents.slice(i + 1).map((b, j) => {
            const dist = Math.sqrt(Math.pow(a.latitude - b.latitude, 2) + Math.pow(a.longitude - b.longitude, 2))
            if (dist > 0.08) return null
            const p1 = project(a.latitude, a.longitude)
            const p2 = project(b.latitude, b.longitude)
            return (
              <line key={`${i}-${j}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke="#c0cad4" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
            )
          })
        })}

        {/* Agent pins */}
        {agents.map((agent) => {
          const { x, y } = project(agent.latitude, agent.longitude)
          const color = agent.isEstablished
            ? STATUS_COLORS.established
            : STATUS_COLORS[agent.status ?? 'active'] ?? STATUS_COLORS.active
          const r = agent.isEstablished ? 14 : 10

          return (
            <g key={agent.address}>
              {/* Drop shadow */}
              <circle cx={x} cy={y + 2} r={r + 2} fill="rgba(0,0,0,0.1)" />

              {/* Pin circle — solid if established, dashed if group */}
              <circle cx={x} cy={y} r={r} fill="white" stroke={color} strokeWidth={2.5}
                strokeDasharray={agent.isEstablished ? 'none' : '3 2'} />

              {/* Generation number inside */}
              {agent.generation !== undefined && (
                <text x={x} y={y + 4} textAnchor="middle" fontSize={agent.isEstablished ? 10 : 8}
                  fontWeight="700" fill={color}>
                  G{agent.generation}
                </text>
              )}

              {/* Label below pin */}
              <text x={x} y={y + r + 14} textAnchor="middle" fontSize="9" fontWeight="600" fill="#1a1a2e">
                {agent.name.length > 18 ? agent.name.slice(0, 17) + '...' : agent.name}
              </text>

              {/* Health score badge */}
              {agent.healthScore !== undefined && agent.healthScore > 0 && (
                <g>
                  <rect x={x + r - 2} y={y - r - 2} width="18" height="12" rx="3" fill={color} />
                  <text x={x + r + 7} y={y - r + 7} textAnchor="middle" fontSize="7" fontWeight="700" fill="white">
                    {agent.healthScore}
                  </text>
                </g>
              )}

              {/* Clickable overlay */}
              <a href={`/agents/${agent.address}`}>
                <circle cx={x} cy={y} r={r + 8} fill="transparent" style={{ cursor: 'pointer' }} />
              </a>
            </g>
          )
        })}

        {/* Legend */}
        <g transform={`translate(${W - 160}, ${H - 60})`}>
          <rect width="150" height="50" rx="6" fill="white" opacity="0.9" stroke="#e0e0e0" />
          <circle cx={15} cy={15} r={6} fill="none" stroke="#2e7d32" strokeWidth="2" />
          <text x={28} y={19} fontSize="8" fill="#424242">Established</text>
          <circle cx={15} cy={35} r={6} fill="none" stroke="#1565c0" strokeWidth="2" strokeDasharray="3 2" />
          <text x={28} y={39} fontSize="8" fill="#424242">Group (gathering)</text>
          <text x={90} y={19} fontSize="7" fill="#9e9e9e">EPSG:4326</text>
        </g>
      </svg>
    </div>
  )
}
