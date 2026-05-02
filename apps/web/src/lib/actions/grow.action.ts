'use server'

import { requireSession } from '@/lib/auth/session'
import { callMcp } from '@/lib/clients/mcp-client'

// ─── Training Progress (now in person-mcp) ─────────────────────────

interface TrainingRow {
  id: string
  principal: string
  moduleKey: string
  programKey: string | null
  track: string | null
  status: string
  completedAt: string | null
  hoursLogged: number
  updatedAt: string
}

export async function getTrainingProgress(_userId?: string): Promise<TrainingRow[]> {
  await requireSession()
  const { progress } = await callMcp<{ progress: TrainingRow[] }>(
    'person', 'list_training_progress', {},
  )
  return progress ?? []
}

export async function toggleModule(moduleKey: string, program: string, track?: string): Promise<{ completed: boolean }> {
  await requireSession()
  const result = await callMcp<{ toggled: 'completed' | 'not-started' }>(
    'person', 'toggle_training_module',
    { moduleKey, programKey: program, track },
  )
  return { completed: result.toggled === 'completed' }
}

// ─── Coach Relationships (on-chain edges, unchanged) ───────────────

export async function getCoachRelationship(userId: string) {
  const { getPersonAgentForUser } = await import('@/lib/agent-registry')
  const { getEdgesByObject, getEdge, getEdgeRoles } = await import('@/lib/contracts')
  const { COACHING_MENTORSHIP, roleName } = await import('@smart-agent/sdk')
  const { getAgentMetadata } = await import('@/lib/agent-metadata')

  const personAddr = await getPersonAgentForUser(userId)
  if (!personAddr) return null

  try {
    const edgeIds = await getEdgesByObject(personAddr as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      if (edge.relationshipType !== COACHING_MENTORSHIP) continue

      const roles = await getEdgeRoles(edgeId)
      const hasCoachRole = roles.some(r => roleName(r) === 'coach')
      if (!hasCoachRole) continue

      const coachMeta = await getAgentMetadata(edge.subject)
      return {
        id: edgeId,
        coachId: edge.subject,
        coachName: coachMeta.displayName,
        sharePermissions: '',
        status: 'active' as const,
      }
    }
  } catch { /* ignored */ }
  return null
}

export async function getDisciples(userId: string) {
  const { getPersonAgentForUser } = await import('@/lib/agent-registry')
  const { getEdgesBySubject, getEdge, getEdgeRoles } = await import('@/lib/contracts')
  const { COACHING_MENTORSHIP, roleName } = await import('@smart-agent/sdk')
  const { getAgentMetadata } = await import('@/lib/agent-metadata')

  const personAddr = await getPersonAgentForUser(userId)
  if (!personAddr) return []

  const disciples: Array<{ id: string; discipleId: string; discipleName: string; sharePermissions: string }> = []

  try {
    const edgeIds = await getEdgesBySubject(personAddr as `0x${string}`)
    for (const edgeId of edgeIds) {
      const edge = await getEdge(edgeId)
      if (edge.status < 2) continue
      if (edge.relationshipType !== COACHING_MENTORSHIP) continue

      const roles = await getEdgeRoles(edgeId)
      const hasCoachRole = roles.some(r => roleName(r) === 'coach')
      if (!hasCoachRole) continue

      const discipleMeta = await getAgentMetadata(edge.object_)
      disciples.push({
        id: edgeId,
        discipleId: edge.object_,
        discipleName: discipleMeta.displayName,
        sharePermissions: '',
      })
    }
  } catch { /* ignored */ }
  return disciples
}

// ─── Disciple Details (Coach Dashboard) ─────────────────────────────
// Cross-delegation flow: a coach calls person-mcp's get_delegated_training_progress
// with the disciple's signed cross-delegation. For now the dashboard returns
// only the on-chain coach-edge metadata until cross-delegation flows ship.

interface DiscipleActivity {
  id: string
  activityType: string
  title: string
  activityDate: string
}

export async function getDiscipleDetails(_discipleId: string): Promise<{
  recentActivities: DiscipleActivity[]
  prayerCount: number
  trainingPct: number
  lastActivityDate: string | null
  needsAttention: boolean
}> {
  return {
    recentActivities: [],
    prayerCount: 0,
    trainingPct: 0,
    lastActivityDate: null,
    needsAttention: false,
  }
}

// ─── User Preferences (now in person-mcp) ──────────────────────────

interface PreferencesRow {
  principal: string
  language: string | null
  homeChurch: string | null
  location: string | null
  theme: string | null
  notifications: string | null
  extras: string | null
  updatedAt: string
}

export async function getUserPreferences(_userId?: string): Promise<PreferencesRow | null> {
  await requireSession()
  const { preferences } = await callMcp<{ preferences: PreferencesRow | null }>(
    'person', 'get_user_preferences', {},
  )
  return preferences
}

export async function updateUserPreferences(
  _userId: string | undefined,
  data: { language?: string; homeChurch?: string; location?: string }
): Promise<{ success: true }> {
  await requireSession()
  await callMcp('person', 'update_user_preferences', data)
  return { success: true }
}
