/**
 * EngagementWorkspaceProps — the props bag every per-shape Workspace
 * consumes. Populated once by `entitlements/[id]/page.tsx`, then handed to
 * `<{Shape}Workspace>` based on the result of `resolveShape()`.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §6
 */

import type { EntitlementDetail } from '@/lib/actions/entitlements.action'
import type { AgreementParty } from '@/components/engagements/AgreementCard'
import type { ThreadEntryRow } from '@/lib/actions/engagements/thread.action'
import type { NextStep } from '@/components/engagements/next-step'
import type { PhaseDerivation } from '@/components/engagements/PhaseRibbon'
import type { ShapeResolution } from '@/lib/engagements/resolveShape'

export type WorkspaceRole = 'holder' | 'provider' | 'observer'

export interface OutcomeView {
  id: string
  description: string
  status: 'pending' | 'partial' | 'achieved' | 'not-achieved'
}

export interface EngagementWorkspaceProps {
  /** The engagement row + work items + recent activities. */
  detail: EntitlementDetail
  /** Typed thread entries for the engagement (intent_ref through trust_deposit). */
  threadEntries: ThreadEntryRow[]
  /** Resolved shape (governs which Workspace renders + subtype defaults). */
  resolvedShape: ShapeResolution

  // ── Routing ──────────────────────────────────────────────────────
  hubSlug: string
  hubName: string
  internalHubId: string
  firstOrgAddr: string | null

  // ── Identity ─────────────────────────────────────────────────────
  /** Current viewer's person agent (lowercased) or null. */
  myAgent: string | null
  role: WorkspaceRole
  /** True if the viewer is the named witness (separate from holder/provider). */
  isWitness: boolean

  // ── Bilateral parties ────────────────────────────────────────────
  holderParty: AgreementParty
  providerParty: AgreementParty
  holderName: string
  providerName: string
  holderOutcome: OutcomeView | null
  providerOutcome: OutcomeView | null

  // ── Display helpers ──────────────────────────────────────────────
  topic: string
  resourceLeaf: string
  icon: string
  unitLabel: string
  consumedPct: number

  // ── Action prompts ───────────────────────────────────────────────
  nextStep: NextStep
  phaseDerivation: PhaseDerivation
}
