/**
 * Intent presets — the pre-baked shortcut chips on /people/discover and
 * in the Cmd+K palette. Each preset maps to a `searchPeople` query +
 * (optional) capability filter.
 *
 * Phase 3 keeps these hand-curated. Phase 6 will replace this list with
 * an LLM-backed parser that derives the same shape from free-form text.
 */

export interface IntentPreset {
  id: string
  /** Chip label, sentence-case (≤ 20 chars). */
  label: string
  /** Longer hint shown beside results. */
  description: string
  /** Free-text query to feed `searchPeople({ query })`. */
  query?: string
  /** Capability filter. */
  capability?: string
}

export const INTENT_PRESETS: IntentPreset[] = [
  {
    id: 'coaches',
    label: 'Coaches',
    description: 'People who coach church planters and multipliers.',
    query: 'coach',
  },
  {
    id: 'multipliers',
    label: 'Multipliers',
    description: 'Movement multipliers running multi-generational discipleship.',
    query: 'multiplier',
  },
  {
    id: 'treasurers',
    label: 'Treasurers',
    description: 'People with treasurer / financial-officer authority in your orgs.',
    query: 'treasurer',
  },
  {
    id: 'spanish-case-managers',
    label: 'Spanish-speaking case managers',
    description: 'Bilingual case workers around Loveland / NoCo.',
    query: 'spanish case manager',
  },
  {
    id: 'planters',
    label: 'Church planters',
    description: 'Active church planters in the Catalyst sister networks.',
    query: 'planter',
  },
  {
    id: 'dispatchers',
    label: 'Dispatchers',
    description: 'Network dispatchers who route incoming requests.',
    query: 'dispatcher',
  },
]
