/**
 * resolveShape — pick the engagement layout shape from resource type + cadence.
 *
 * The single source of truth for which `<*Workspace>` renders. Adding a 5th
 * shape requires written justification in this docblock and PM signoff.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §2 (taxonomy + edge-case rules).
 *
 * Edge-case rules (pre-decided, NOT deferred):
 *   • Venue follows the offering cadence — recurring → Cadence, one-time → One-Shot.
 *   • Curriculum is Cadence (finite-term, auto-suggest close-out on last session).
 *   • Money is always Tranche, even single-tranche gifts (n=1).
 *   • Connector is always One-Shot — follow-ups are new engagements.
 *   • Prayer is Cadence in quiet mode (defaults flipped, thread + evidence hidden).
 *   • Sensitive Worker (Rosa's trauma counseling) is Cadence + quietMode flag.
 */

export type EngagementShape = 'cadence' | 'tranche' | 'oneshot' | 'governance' | 'matching'

export interface ShapeInputs {
  /** SKOS URI from cbox/resource-types.ttl, e.g. 'resourceType:Worker'. */
  resourceType: string
  /** Engagement cadence as stored on the entitlement (drives Venue routing). */
  cadence: 'one-shot' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'on-demand'
  /** Optional opt-in flag: holder/provider asked for quiet mode (Rosa-style sensitive work). */
  quietMode?: boolean
  /** R16 — engagement kind. 'matching' takes precedence and short-circuits.
   *  'delivery' (default) falls through to the resource-type rules. */
  engagementKind?: 'matching' | 'delivery'
}

export interface ShapeResolution {
  shape: EngagementShape
  /** Subtype hints used by R14 to pick defaults inside a shape (e.g. 'prayer', 'curriculum', 'sensitive-worker'). */
  subtype?: 'prayer' | 'curriculum' | 'sensitive-worker' | 'sister-network' | 'standard'
  /** True if the shape should hide thread composer, evidence prompts, witness UI by default. */
  quiet: boolean
  /** Display reason — useful for /api/dev probes and the Records tab footer. */
  reason: string
}

export function resolveShape(input: ShapeInputs): ShapeResolution {
  const { resourceType, cadence, quietMode, engagementKind } = input

  // ── R16: Matching engagements always render the matching shape. ──
  // The kind takes precedence over resource type — a matching engagement is
  // *about* the assignment, not the resource being assigned.
  if (engagementKind === 'matching') {
    return {
      shape: 'matching',
      subtype: 'standard',
      quiet: false,
      reason: 'engagementKind=matching → Matching (closes at accept; spawns delivery)',
    }
  }

  // ── Money is always Tranche. ─────────────────────────────────────
  if (resourceType === 'resourceType:Money') {
    return {
      shape: 'tranche',
      subtype: 'standard',
      quiet: false,
      reason: 'Money resource → Tranche (always; single-tranche grants are n=1)',
    }
  }

  // ── Heavy governance resources. ──────────────────────────────────
  // Credential, Organization, Church-as-org. We treat ALL of them as Governance
  // in v0 — even lightweight cases will render with mostly-empty PolicyPanel.
  if (
    resourceType === 'resourceType:Credential' ||
    resourceType === 'resourceType:Organization' ||
    resourceType === 'resourceType:Church'
  ) {
    return {
      shape: 'governance',
      subtype: 'standard',
      quiet: false,
      reason: `${resourceType.split(':').pop()} resource → Governance (policy + multi-signer)`,
    }
  }

  // ── Connector is always One-Shot — follow-ups are new engagements. ──
  if (resourceType === 'resourceType:Connector') {
    return {
      shape: 'oneshot',
      subtype: 'standard',
      quiet: false,
      reason: 'Connector resource → One-Shot (a single warm intro)',
    }
  }

  // ── Information-shaped one-shots: Data, Scripture (translation deliverables). ──
  if (
    resourceType === 'resourceType:Data' ||
    resourceType === 'resourceType:Scripture'
  ) {
    return {
      shape: 'oneshot',
      subtype: 'standard',
      quiet: false,
      reason: `${resourceType.split(':').pop()} resource → One-Shot (single delivery)`,
    }
  }

  // ── Venue: cadence determines shape. ────────────────────────────
  if (resourceType === 'resourceType:Venue') {
    if (cadence === 'one-shot') {
      return {
        shape: 'oneshot',
        subtype: 'standard',
        quiet: false,
        reason: 'Venue + one-shot cadence → One-Shot (single gathering)',
      }
    }
    return {
      shape: 'cadence',
      subtype: 'standard',
      quiet: false,
      reason: `Venue + ${cadence} cadence → Cadence (recurring use)`,
    }
  }

  // ── Prayer is always Cadence in quiet mode. ─────────────────────
  if (resourceType === 'resourceType:Prayer') {
    return {
      shape: 'cadence',
      subtype: 'prayer',
      quiet: true,
      reason: 'Prayer resource → Cadence quiet (no thread / no evidence prompts)',
    }
  }

  // ── Curriculum is Cadence with finite-term auto-close hint. ─────
  if (resourceType === 'resourceType:Curriculum') {
    return {
      shape: 'cadence',
      subtype: 'curriculum',
      quiet: false,
      reason: 'Curriculum resource → Cadence (finite term, auto-suggest close on last session)',
    }
  }

  // ── Worker / Skill — the catalyst-coaching default. ────────────
  if (
    resourceType === 'resourceType:Worker' ||
    resourceType === 'resourceType:Skill'
  ) {
    return {
      shape: 'cadence',
      subtype: quietMode ? 'sensitive-worker' : 'standard',
      quiet: !!quietMode,
      reason: quietMode
        ? 'Worker/Skill + quiet mode flag → Cadence quiet (sensitive engagement)'
        : 'Worker/Skill resource → Cadence (recurring sessions)',
    }
  }

  // ── Default fallback — unknown resource types render as Cadence. ──
  // We bias toward Cadence because it has the richest UI and degrades gracefully.
  // Loud diagnostic so missing rules surface in dev.
  return {
    shape: 'cadence',
    subtype: 'standard',
    quiet: false,
    reason: `Unknown resource type "${resourceType}" → Cadence (fallback; add explicit rule in resolveShape.ts)`,
  }
}
