/**
 * CPM Extensions — Generational Tree Computation
 *
 * A generational map is a tree where:
 * - G0: The missionary or initial planter
 * - G1: First groups planted directly by G0
 * - G2: Groups planted by G1 groups (not by the original planter)
 * - G3+: Each subsequent generation
 *
 * A healthy movement shows multiplication beyond G3 (2 Timothy 2:2 pattern).
 */

import type { GroupHealthData } from './group-health'
import { parseHealthData } from './group-health'

export interface GenMapNode {
  id: string
  parentId: string | null
  generation: number
  name: string
  leaderName: string | null
  location: string | null
  healthData: GroupHealthData
  status: 'active' | 'inactive' | 'multiplied' | 'closed'
  startedAt: string | null
  children: GenMapNode[]
}

/** Build tree from flat list of DB rows */
export function buildGenTree(rows: Array<{
  id: string; parentId: string | null; generation: number
  name: string; leaderName: string | null; location: string | null
  healthData: string | null; status: string; startedAt: string | null
}>): GenMapNode[] {
  const nodes: GenMapNode[] = rows.map(r => ({
    id: r.id,
    parentId: r.parentId,
    generation: r.generation,
    name: r.name,
    leaderName: r.leaderName,
    location: r.location,
    healthData: parseHealthData(r.healthData),
    status: r.status as GenMapNode['status'],
    startedAt: r.startedAt,
    children: [],
  }))

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const roots: GenMapNode[] = []

  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

/** Movement-level metrics computed from the gen tree */
export interface MovementMetrics {
  totalGroups: number
  activeGroups: number
  totalBelievers: number
  totalBaptized: number
  totalLeaders: number
  maxGeneration: number
  churchCount: number
  multiplicationRate: number // groups that started new groups / total groups
  streamCount: number // number of independent root streams
  generationBreakdown: Record<number, number> // gen number → count
}

export function computeMovementMetrics(roots: GenMapNode[]): MovementMetrics {
  const all: GenMapNode[] = []
  function collect(node: GenMapNode) {
    all.push(node)
    node.children.forEach(collect)
  }
  roots.forEach(collect)

  const active = all.filter(n => n.status === 'active' || n.status === 'multiplied')
  const totalBelievers = all.reduce((s, n) => s + n.healthData.believers, 0)
  const totalBaptized = all.reduce((s, n) => s + n.healthData.baptized, 0)
  const totalLeaders = all.reduce((s, n) => s + n.healthData.leaders, 0)
  const churchCount = all.filter(n => n.healthData.isChurch).length
  const multiplied = all.filter(n => n.children.length > 0).length
  const maxGen = all.reduce((max, n) => Math.max(max, n.generation), 0)

  const genBreakdown: Record<number, number> = {}
  for (const n of all) {
    genBreakdown[n.generation] = (genBreakdown[n.generation] ?? 0) + 1
  }

  return {
    totalGroups: all.length,
    activeGroups: active.length,
    totalBelievers,
    totalBaptized,
    totalLeaders,
    maxGeneration: maxGen,
    churchCount,
    multiplicationRate: all.length > 0 ? multiplied / all.length : 0,
    streamCount: roots.length,
    generationBreakdown: genBreakdown,
  }
}

/** Check if a template is a CPM/Catalyst template (shows gen map + activities nav) */
export function isCpmTemplate(templateId: string | null | undefined): boolean {
  return [
    'movement-network', 'church-planting-team', 'local-group',
    'catalyst-network', 'facilitator-hub', 'local-group',
  ].includes(templateId ?? '')
}
