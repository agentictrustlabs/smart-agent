import type { WorkMode } from './types'

/**
 * Role → default work mode + secondary modes the user can pin.
 *
 * Derived from the use-case analysis: every actor's "primary" daily
 * activity selects their default mode; secondaries cover the
 * cross-archetype edges (Marcus coaches Priya, Kenji governs his
 * mentees, etc.). The user can override via `<ModePicker>` and the
 * choice sticks per session.
 *
 * Role strings here match the freeform `role` field in DEMO_USER_META
 * and the `roleName(roleHash)` output for on-chain edges. Comparison
 * is case-insensitive and we match on substring containment so
 * "Network Admin", "Network Lead", and "Program Director" all
 * resolve to govern without listing every variant.
 *
 * `null` from `defaultModeForRole` means we couldn't classify — the
 * UI falls back to whatever `inferDefaultMode` returns from
 * UserContext (which may use orgs / capabilities as a backup).
 */

interface RoleSpec {
  patterns: string[]   // case-insensitive substring matches
  primary: WorkMode
  secondaries: WorkMode[]
}

// Patterns match BOTH:
//   • on-chain role taxonomy hash names (`owner`, `operator`, `member`,
//     `auditor`, `reviewer`, `coach`, `disciple`, `strategic-partner`)
//     — these are what `useUserContext().primaryRole` returns
//   • freeform DEMO_USER_META role strings ("Program Director",
//     "Network Lead", "Multiplier", "Dispatcher", etc.) — these are
//     surfaced via the role string we surface in profile cards
//
// Substring containment + lowercase, so a single pattern catches
// both "owner" (on-chain) and "Business Owner" (freeform). Order
// matters — first matching spec wins, so the disciple-flavoured
// patterns ('coach', 'disciple') must come BEFORE generic
// govern patterns that might overlap (none today, but a guard
// against future drift).
const ROLE_SPECS: RoleSpec[] = [
  // Disciple roles — relational work with named people. Listed first
  // so 'coach' / 'disciple' on-chain role names don't accidentally
  // match against the govern patterns.
  {
    patterns: [
      'circle leader', 'multiplier', 'multi-gen coach', 'coach',
      'outreach', 'community partner', 'cohort coordinator',
      'youth pastor', 'small groups', 'pastoral',
      // on-chain role names that imply relational work
      'role_coach',
    ],
    primary: 'disciple',
    secondaries: ['walk', 'discover'],
  },

  // Route roles — triage + assign flow. Stubbed in v1 (no inbound-lead source).
  {
    patterns: ['dispatcher', 'digital responder'],
    primary: 'route',
    secondaries: ['discover', 'disciple'],
  },

  // Govern roles — read state, decide, approve.
  {
    patterns: [
      // freeform titles
      'admin', 'director', 'network lead', 'regional lead',
      'ceo', 'treasurer', 'board', 'governance', 'authorized-signer',
      'strategist', 'funder',
      // on-chain role taxonomy
      'owner', 'operator', 'board-member', 'strategic-partner',
    ],
    primary: 'govern',
    secondaries: ['discover', 'walk', 'disciple'],
  },

  // Walk-default — auditors / reviewers / generic members.
  {
    patterns: [
      'member', 'business owner', 'reviewer', 'auditor',
      'role_disciple',
    ],
    primary: 'walk',
    secondaries: ['discover'],
  },
]

/** Find the mode spec for a freeform role label. Returns null if no rule matches. */
export function roleSpec(role: string | null | undefined): { primary: WorkMode; secondaries: WorkMode[] } | null {
  if (!role) return null
  const r = role.toLowerCase()
  for (const spec of ROLE_SPECS) {
    if (spec.patterns.some(p => r.includes(p))) {
      return { primary: spec.primary, secondaries: spec.secondaries }
    }
  }
  return null
}

/**
 * Default mode for a user given their role string. Falls back to
 * 'walk' (everyone has a personal walk; safe non-empty default).
 */
export function defaultModeForRole(role: string | null | undefined): WorkMode {
  return roleSpec(role)?.primary ?? 'walk'
}

/**
 * Modes a user can pin alongside their default. The default is
 * always available; secondaries are role-specific. Discover is
 * always reachable but uses its own surface — listed here for
 * completeness so the picker can offer "switch to Discover".
 */
export function availableModesForRole(role: string | null | undefined): WorkMode[] {
  const spec = roleSpec(role) ?? { primary: 'walk' as WorkMode, secondaries: ['discover'] as WorkMode[] }
  return Array.from(new Set([spec.primary, ...spec.secondaries]))
}
