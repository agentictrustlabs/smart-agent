/**
 * Church Planting Movement (CPM) — Extension Entry Point
 *
 * Re-exports all CPM-specific modules:
 *   import { isCpmTemplate, buildGenTree, computeGroupHealth } from '@/lib/cpm'
 */

export { computeGroupHealth, parseHealthData, DEFAULT_HEALTH, HEALTH_STATUS_COLORS } from './group-health'
export type { GroupHealthData, GroupHealthScore } from './group-health'

export { buildGenTree, computeMovementMetrics, isCpmTemplate } from './generations'
export type { GenMapNode, MovementMetrics } from './generations'
