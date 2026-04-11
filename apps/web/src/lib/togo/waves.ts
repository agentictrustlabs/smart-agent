/**
 * Togo Revenue-Sharing Pilot — Investment Wave Definitions
 *
 * Businesses progress through waves of increasing capital:
 * BDC Graduate → Wave 1 (seed) → Wave 2 (growth) → Wave 3 (scale) → Graduated
 *
 * Graduation criteria are based on revenue consistency, repayment rate,
 * and training completion.
 */

export interface WaveDefinition {
  id: number
  name: string
  capitalRange: { min: number; max: number }
  /** Currency for capital amounts */
  currency: string
  /** Revenue-share percentage (e.g., 10 = 10% of net revenue) */
  sharePercent: number
  /** Months business must be in this wave before advancing */
  minMonths: number
  /** Minimum repayment rate to advance (collected / deployed) */
  minRepaymentRate: number
  /** Minimum BDC training completion % to advance */
  minTrainingCompletion: number
  description: string
}

export const WAVES: WaveDefinition[] = [
  {
    id: 1, name: 'Wave 1 — Seed',
    capitalRange: { min: 500_000, max: 2_000_000 }, currency: 'XOF',
    sharePercent: 10, minMonths: 6, minRepaymentRate: 0.5, minTrainingCompletion: 0.6,
    description: 'Initial capital for BDC graduates. Small deployment to test business viability.',
  },
  {
    id: 2, name: 'Wave 2 — Growth',
    capitalRange: { min: 2_000_000, max: 5_000_000 }, currency: 'XOF',
    sharePercent: 8, minMonths: 6, minRepaymentRate: 0.6, minTrainingCompletion: 0.8,
    description: 'Growth capital for businesses that proved viability in Wave 1.',
  },
  {
    id: 3, name: 'Wave 3 — Scale',
    capitalRange: { min: 5_000_000, max: 10_000_000 }, currency: 'XOF',
    sharePercent: 6, minMonths: 12, minRepaymentRate: 0.7, minTrainingCompletion: 1.0,
    description: 'Scale capital for high-performing businesses. Lower share rate, larger amounts.',
  },
]

export type WaveStatus = 'underwriting' | 'wave-1' | 'wave-2' | 'wave-3' | 'graduated' | 'paused'

/** Determine which wave a business is in based on data */
export function getWaveStatus(data: {
  totalDeployed: number
  totalCollected: number
  monthsActive: number
  trainingCompletion: number
  isPaused: boolean
}): WaveStatus {
  if (data.isPaused) return 'paused'
  if (data.totalDeployed === 0) return 'underwriting'

  const repaymentRate = data.totalDeployed > 0 ? data.totalCollected / data.totalDeployed : 0

  // Check if graduated from Wave 3
  if (data.totalDeployed >= 5_000_000 && repaymentRate >= 0.7 && data.trainingCompletion >= 1.0 && data.monthsActive >= 24) {
    return 'graduated'
  }
  if (data.totalDeployed >= 2_000_000 && repaymentRate >= 0.6 && data.monthsActive >= 12) {
    return 'wave-3'
  }
  if (data.totalDeployed >= 500_000 && repaymentRate >= 0.5 && data.monthsActive >= 6) {
    return 'wave-2'
  }
  return 'wave-1'
}

export const WAVE_COLORS: Record<WaveStatus, string> = {
  'underwriting': '#9e9e9e',
  'wave-1': '#ea580c',
  'wave-2': '#d97706',
  'wave-3': '#0d9488',
  'graduated': '#2e7d32',
  'paused': '#b91c1c',
}

export const WAVE_LABELS: Record<WaveStatus, string> = {
  'underwriting': 'Underwriting',
  'wave-1': 'Wave 1',
  'wave-2': 'Wave 2',
  'wave-3': 'Wave 3',
  'graduated': 'Graduated',
  'paused': 'Paused',
}
