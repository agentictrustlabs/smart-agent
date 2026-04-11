/**
 * Togo Revenue-Sharing Pilot — Business Health Score Computation
 *
 * Health score is a 0-100 composite of:
 * - Revenue consistency (40%) — are they submitting reports with growing revenue?
 * - Repayment rate (30%) — revenue-share payments vs deployed capital
 * - Training completion (20%) — BDC module completion percentage
 * - Tenure (10%) — months active (longer = more data = more confidence)
 */

export interface HealthInput {
  /** Number of months with submitted revenue reports */
  reportsSubmitted: number
  /** Total months since first capital deployment */
  monthsActive: number
  /** Revenue growth trend: positive number = growing */
  revenueGrowthPercent: number
  /** Total revenue-share collected / total capital deployed */
  repaymentRate: number
  /** BDC modules completed / total required modules */
  trainingCompletion: number
}

export interface HealthScore {
  total: number
  revenueScore: number
  repaymentScore: number
  trainingScore: number
  tenureScore: number
  status: 'healthy' | 'at-risk' | 'critical'
}

export function computeHealthScore(input: HealthInput): HealthScore {
  // Revenue consistency (40 points)
  const reportingRate = input.monthsActive > 0 ? input.reportsSubmitted / input.monthsActive : 0
  const reportingScore = Math.min(reportingRate, 1) * 25
  const growthScore = Math.min(Math.max(input.revenueGrowthPercent + 10, 0) / 20, 1) * 15
  const revenueScore = Math.round(reportingScore + growthScore)

  // Repayment rate (30 points)
  const repaymentScore = Math.round(Math.min(input.repaymentRate / 0.7, 1) * 30)

  // Training completion (20 points)
  const trainingScore = Math.round(Math.min(input.trainingCompletion, 1) * 20)

  // Tenure (10 points)
  const tenureScore = Math.round(Math.min(input.monthsActive / 12, 1) * 10)

  const total = revenueScore + repaymentScore + trainingScore + tenureScore

  let status: HealthScore['status'] = 'healthy'
  if (total < 40) status = 'critical'
  else if (total < 65) status = 'at-risk'

  return { total, revenueScore, repaymentScore, trainingScore, tenureScore, status }
}

export const HEALTH_COLORS: Record<HealthScore['status'], string> = {
  'healthy': '#2e7d32',
  'at-risk': '#d97706',
  'critical': '#b91c1c',
}
