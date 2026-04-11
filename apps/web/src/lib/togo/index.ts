/**
 * Togo Revenue-Sharing Pilot — Extension Entry Point
 *
 * Re-exports all Togo-specific modules for convenient importing:
 *   import { isTogoTemplate, WAVES, BDC_MODULES, computeHealthScore } from '@/lib/togo'
 */

export { TOGO_DELEGATION_CONFIGS, getTogoDelegationConfig, isTogoTemplate } from './roles'
export type { TogoDelegationConfig } from './roles'

export { WAVES, getWaveStatus, WAVE_COLORS, WAVE_LABELS } from './waves'
export type { WaveDefinition, WaveStatus } from './waves'

export { BDC_MODULES, REQUIRED_HOURS, TOTAL_HOURS } from './bdc-modules'
export type { BdcModule } from './bdc-modules'

export { computeHealthScore, HEALTH_COLORS } from './health'
export type { HealthInput, HealthScore } from './health'
