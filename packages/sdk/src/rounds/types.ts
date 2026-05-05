/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Round types (T026).
 *
 * These mirror `specs/003-intent-marketplace-proposal/contracts/round.ts`
 * and re-export from `@smart-agent/discovery` (which is the canonical home
 * for the same shapes per T020) — sdk consumers shouldn't need to depend
 * on discovery just to spell `Round`. Keeping this file as a thin
 * re-export prevents drift between the discovery surface and the sdk
 * surface.
 */

export type {
  Round,
  RoundListItem,
  RoundListFilters,
  RoundMandate,
  RoundMilestoneTemplate,
  RoundValidatorRequirements,
  RoundPriorStats,
  ReportingCadence,
} from '@smart-agent/discovery'
