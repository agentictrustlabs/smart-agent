/**
 * CPM Extensions — Four Fields / Church Circle Health Model
 *
 * Tracks health markers for each group in the generational map.
 * Based on the "Four Fields" model commonly used in CPM/DMM:
 * - Field 1: Empty field (seekers being reached)
 * - Field 2: Seeding (gospel shared, people responding)
 * - Field 3: Growing (discipleship, baptisms)
 * - Field 4: Harvesting (leaders emerging, new groups started)
 */

export interface GroupHealthData {
  /** Number of seekers / non-believers engaging */
  seekers: number
  /** Number of believers in the group */
  believers: number
  /** Number of baptized members */
  baptized: number
  /** Number of emerging leaders being trained */
  leaders: number
  /** Whether the group collects offerings */
  giving: boolean
  /** Whether the group functions as a church (meets all basic markers) */
  isChurch: boolean
  /** Number of new groups started from this group */
  groupsStarted: number
}

export const DEFAULT_HEALTH: GroupHealthData = {
  seekers: 0, believers: 0, baptized: 0, leaders: 0,
  giving: false, isChurch: false, groupsStarted: 0,
}

export function parseHealthData(json: string | null): GroupHealthData {
  if (!json) return DEFAULT_HEALTH
  try { return { ...DEFAULT_HEALTH, ...JSON.parse(json) } }
  catch { return DEFAULT_HEALTH }
}

export interface GroupHealthScore {
  total: number
  engagementScore: number
  discipleshipScore: number
  leadershipScore: number
  multiplicationScore: number
  status: 'thriving' | 'growing' | 'emerging' | 'stalled'
}

/**
 * Compute health score for a group (0-100).
 * - Engagement (25): seekers present and growing
 * - Discipleship (25): believers + baptisms
 * - Leadership (25): leaders emerging, giving, church function
 * - Multiplication (25): new groups started
 */
export function computeGroupHealth(data: GroupHealthData): GroupHealthScore {
  const engagementScore = Math.min(25, Math.round(
    (data.seekers > 0 ? 10 : 0) +
    (data.believers > 0 ? 10 : 0) +
    (Math.min(data.seekers + data.believers, 10) / 10) * 5
  ))

  const discipleshipScore = Math.min(25, Math.round(
    (data.baptized > 0 ? 10 : 0) +
    (data.believers >= 3 ? 10 : data.believers * 3) +
    (data.baptized >= 3 ? 5 : data.baptized * 1.5)
  ))

  const leadershipScore = Math.min(25, Math.round(
    (data.leaders > 0 ? 10 : 0) +
    (data.giving ? 5 : 0) +
    (data.isChurch ? 10 : 0)
  ))

  const multiplicationScore = Math.min(25, Math.round(
    data.groupsStarted * 8
  ))

  const total = engagementScore + discipleshipScore + leadershipScore + multiplicationScore

  let status: GroupHealthScore['status'] = 'stalled'
  if (total >= 75) status = 'thriving'
  else if (total >= 50) status = 'growing'
  else if (total >= 25) status = 'emerging'

  return { total, engagementScore, discipleshipScore, leadershipScore, multiplicationScore, status }
}

export const HEALTH_STATUS_COLORS: Record<GroupHealthScore['status'], string> = {
  thriving: '#2e7d32',
  growing: '#0d9488',
  emerging: '#d97706',
  stalled: '#b91c1c',
}
