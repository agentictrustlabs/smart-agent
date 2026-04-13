'use client'

export interface HealthData {
  seekers: number; believers: number; baptized: number; leaders: number
  giving: boolean; isChurch: boolean; groupsStarted: number
  meetingFrequency?: string
  baptismSelf: boolean; teachingSelf: boolean; givingSelf: boolean
  peoplGroup?: string; attenders?: number
}

export const DEFAULT_HEALTH: HealthData = {
  seekers: 0, believers: 0, baptized: 0, leaders: 0,
  giving: false, isChurch: false, groupsStarted: 0,
  meetingFrequency: 'weekly', baptismSelf: false, teachingSelf: false, givingSelf: false,
  peoplGroup: '', attenders: 0,
}

export function parseHealth(json: string | null | undefined): HealthData {
  if (!json) return { ...DEFAULT_HEALTH }
  try { return { ...DEFAULT_HEALTH, ...JSON.parse(json) } } catch { return { ...DEFAULT_HEALTH } }
}

interface Props {
  health: HealthData
  size?: number
}

export function ChurchCircle({ health, size = 64 }: Props) {
  const r = size / 2 - 3
  const cx = size / 2
  const cy = size / 2
  const isDashed = !health.isChurch
  const strokeColor = health.isChurch ? '#2e7d32' : '#9e9e9e'

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Main circle */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={strokeColor}
        strokeWidth={2} strokeDasharray={isDashed ? '4 3' : 'none'} />

      {/* Quadrant dividers */}
      <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="#e0e0e0" strokeWidth={0.5} />
      <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="#e0e0e0" strokeWidth={0.5} />

      {/* TL: attenders/seekers, TR: baptized, BR: leaders, BL: believers */}
      <text x={cx - r / 2} y={cy - r / 3} textAnchor="middle" fontSize={size > 50 ? 10 : 8}
        fill="#1565c0" fontWeight="bold">{health.attenders || health.seekers || 0}</text>
      <text x={cx + r / 2} y={cy - r / 3} textAnchor="middle" fontSize={size > 50 ? 10 : 8}
        fill="#2e7d32" fontWeight="bold">{health.baptized || 0}</text>
      <text x={cx + r / 2} y={cy + r / 2} textAnchor="middle" fontSize={size > 50 ? 10 : 8}
        fill="#7c3aed" fontWeight="bold">{health.leaders || 0}</text>
      <text x={cx - r / 2} y={cy + r / 2} textAnchor="middle" fontSize={size > 50 ? 10 : 8}
        fill="#ea580c" fontWeight="bold">{health.believers || 0}</text>

      {/* Center: groups started */}
      {health.groupsStarted > 0 && (
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize={size > 50 ? 11 : 9}
          fill="#0d9488" fontWeight="bold">{health.groupsStarted}</text>
      )}

      {/* Self-functioning dots */}
      {health.baptismSelf && <circle cx={cx + r - 4} cy={cy - r + 4} r={3} fill="#2e7d32" />}
      {!health.baptismSelf && health.baptized > 0 && <circle cx={cx + r - 1} cy={cy - r + 1} r={3} fill="#2e7d32" opacity={0.3} />}
      {health.teachingSelf && <circle cx={cx - r + 4} cy={cy - r + 4} r={3} fill="#1565c0" />}
      {health.givingSelf && health.giving && <circle cx={cx - r + 4} cy={cy + r - 4} r={3} fill="#ea580c" />}
    </svg>
  )
}
