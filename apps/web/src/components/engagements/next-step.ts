/**
 * NextStep — picks the single, concrete, action-oriented prompt for the
 * user staring at this engagement.
 *
 * The 8-stop round trip is a meta-model of *any* engagement. End users don't
 * want a meta-model — they want "what do I do next?" in their own language,
 * specific to the resource they're exchanging and the role they're playing.
 *
 * Strategy: keyed on (resourceType, role, phase + signals). Returns a
 * headline, optional subline, and a primary CTA pointing at whichever
 * downstream surface (work item, log activity, pin evidence, confirm).
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §3 (rephrased for end users)
 */

import type { EntitlementRow } from '@/lib/actions/entitlements.action'

export type NextStepRole = 'holder' | 'provider' | 'observer' | 'witness'

export interface NextStepSignals {
  hasActivities: boolean
  capacityFraction: number          // 0..1; 1 = brand-new, 0 = exhausted
  evidencePinned: boolean
  witnessNamed: boolean
  witnessSigned: boolean
  iConfirmed: boolean
  otherConfirmed: boolean
  deposited: boolean
}

export interface NextStep {
  /** Lead text — one sentence, action-oriented, in plain language. */
  headline: string
  /** Optional context — why this step matters. */
  subline?: string
  /** Primary call-to-action label, or null when no CTA fires (e.g. "waiting on the other party"). */
  ctaLabel: string | null
  /** Where the CTA scrolls/jumps to, expressed as a section anchor on this page. */
  ctaAnchor?: 'log-activity' | 'pin-evidence' | 'determination' | 'thread' | null
  /** Tone affects the card's visual treatment. */
  tone: 'action' | 'waiting' | 'celebration' | 'caution'
}

const RESOURCE_LEAF: Record<string, string> = {
  'resourceType:Worker': 'session',
  'resourceType:Skill': 'session',
  'resourceType:Money': 'disbursement',
  'resourceType:Prayer': 'prayer time',
  'resourceType:Connector': 'introduction',
  'resourceType:Data': 'data exchange',
  'resourceType:Scripture': 'translation step',
  'resourceType:Venue': 'gathering',
  'resourceType:Curriculum': 'training',
  'resourceType:Credential': 'credential review',
  'resourceType:Organization': 'organizational step',
  'resourceType:Church': 'church step',
}

const ROLE_VERB_PROVIDER: Record<string, string> = {
  'resourceType:Worker': 'coach',
  'resourceType:Skill': 'mentor',
  'resourceType:Money': 'fund',
  'resourceType:Prayer': 'pray for',
  'resourceType:Connector': 'connect',
  'resourceType:Data': 'share with',
  'resourceType:Scripture': 'translate for',
  'resourceType:Venue': 'host',
  'resourceType:Curriculum': 'train',
  'resourceType:Credential': 'credential',
}

export function deriveNextStep(args: {
  ent: EntitlementRow
  role: NextStepRole
  signals: NextStepSignals
  counterpartyName: string
  topic: string
}): NextStep {
  const { ent, role, signals, counterpartyName, topic } = args
  const resourceLeaf = RESOURCE_LEAF[ent.terms.object] ?? 'engagement step'
  const verb = ROLE_VERB_PROVIDER[ent.terms.object] ?? 'support'

  // ── Terminal: deposited (closed). ─────────────────────────────────
  if (signals.deposited) {
    return {
      headline: `This engagement is closed and on your trust profile.`,
      subline: `A skill claim, a peer review, and a validation profile bump have been written. Ready to take on the next one.`,
      ctaLabel: null,
      tone: 'celebration',
    }
  }

  // ── Stage 7 — both confirmed but deposit hasn't fired (rare). ─────
  if (signals.iConfirmed && signals.otherConfirmed) {
    return {
      headline: `Both confirmed — closing now…`,
      subline: `The trust deposit is being minted to both profiles.`,
      ctaLabel: null,
      tone: 'celebration',
    }
  }

  // ── Stage 7 — I confirmed, waiting on the other party. ────────────
  if (signals.iConfirmed && !signals.otherConfirmed) {
    return {
      headline: `Waiting on ${counterpartyName} to confirm the outcome.`,
      subline: `Once they confirm, this engagement closes and the trust deposit fires for both of you. A nudge in the thread can help.`,
      ctaLabel: 'Send a nudge',
      ctaAnchor: 'thread',
      tone: 'waiting',
    }
  }

  // ── Stage 7 — evidence is pinned, witness signed (or not needed):
  //    confirm now. ────────────────────────────────────────────────
  if (signals.evidencePinned && (!signals.witnessNamed || signals.witnessSigned) && !signals.iConfirmed) {
    return {
      headline: `Time to confirm the outcome.`,
      subline: role === 'holder'
        ? `Did ${counterpartyName} deliver what was agreed? Confirming closes the loop and stamps your peer review on her profile.`
        : `Did the ${resourceLeaf} land for ${counterpartyName}? Confirming closes the loop and stamps the skill claim on your profile.`,
      ctaLabel: `Confirm outcome (${role})`,
      ctaAnchor: 'determination',
      tone: 'action',
    }
  }

  // ── Stage 6 — witness named but not yet signed. ───────────────────
  if (signals.evidencePinned && signals.witnessNamed && !signals.witnessSigned) {
    if (role === 'witness') {
      return {
        headline: `${counterpartyName} asked you to witness this engagement.`,
        subline: `Review the pinned evidence in the thread and sign — your signature lifts the weight of the resulting reviews.`,
        ctaLabel: 'Sign as witness',
        ctaAnchor: 'pin-evidence',
        tone: 'action',
      }
    }
    return {
      headline: `Waiting on the witness to sign.`,
      subline: `Once the witness signs the pinned evidence, both parties can confirm the outcome.`,
      ctaLabel: null,
      tone: 'waiting',
    }
  }

  // ── Stage 6 — activities logged but evidence not yet pinned. ─────
  if (signals.hasActivities && !signals.evidencePinned && (role === 'holder' || role === 'provider')) {
    return {
      headline: `Wrap up: pin the work you've done.`,
      subline: `Pick the activities that should count toward the outcome, optionally attach a doc, and freeze the bundle. After that, both parties confirm and the engagement closes.`,
      ctaLabel: 'Pin evidence bundle',
      ctaAnchor: 'pin-evidence',
      tone: 'action',
    }
  }

  // ── Stage 5 — first activity hasn't happened yet (provider POV). ──
  if (!signals.hasActivities && role === 'provider') {
    return providerFirstActionForResource(ent.terms.object, counterpartyName, topic, resourceLeaf, verb)
  }

  // ── Stage 5 — first activity hasn't happened yet (holder POV). ────
  if (!signals.hasActivities && role === 'holder') {
    return holderFirstWaitForResource(ent.terms.object, counterpartyName, topic, resourceLeaf)
  }

  // ── Stage 5 — activities are flowing; encourage rhythm. ──────────
  if (signals.hasActivities && !signals.evidencePinned) {
    if (role === 'provider') {
      const lowCapacity = signals.capacityFraction < 0.25
      if (lowCapacity) {
        return {
          headline: `You're nearing the end of this engagement.`,
          subline: `One or two more ${resourceLeaf}s left in the budget. When you're done, pin the evidence to wrap up.`,
          ctaLabel: `Log next ${resourceLeaf}`,
          ctaAnchor: 'log-activity',
          tone: 'action',
        }
      }
      return {
        headline: `Log your next ${resourceLeaf} with ${counterpartyName}.`,
        subline: `Each one ticks down the capacity meter and shows up on the Commitment Thread for both of you.`,
        ctaLabel: `Log ${resourceLeaf}`,
        ctaAnchor: 'log-activity',
        tone: 'action',
      }
    }
    // Holder: encourage reflection / co-logging.
    return {
      headline: `Stay in the loop on what ${counterpartyName} is doing.`,
      subline: `You can add reflections or notes to the Commitment Thread anytime. Keeping it active makes the eventual outcome easier to validate.`,
      ctaLabel: 'Add a note to the thread',
      ctaAnchor: 'thread',
      tone: 'action',
    }
  }

  // ── Observer / fallback. ─────────────────────────────────────────
  return {
    headline: `Watching this engagement.`,
    subline: `You're not a party here — you can read the Commitment Thread but actions belong to the holder, provider, and (if named) witness.`,
    ctaLabel: null,
    tone: 'waiting',
  }
}

function providerFirstActionForResource(
  resourceType: string, counterparty: string, topic: string,
  resourceLeaf: string, verb: string,
): NextStep {
  switch (resourceType) {
    case 'resourceType:Money':
      return {
        headline: `Send the disbursement plan to ${counterparty}.`,
        subline: `Outline tranches, milestones, and reporting cadence. Once they acknowledge, log the first disbursement here.`,
        ctaLabel: 'Log the first disbursement',
        ctaAnchor: 'log-activity',
        tone: 'action',
      }
    case 'resourceType:Worker':
    case 'resourceType:Skill':
    case 'resourceType:Curriculum':
      return {
        headline: `Schedule your first ${resourceLeaf} with ${counterparty}.`,
        subline: `Reach out, pick a time, then log the ${resourceLeaf} here once it happens. That's how the engagement starts moving.`,
        ctaLabel: `Log the first ${resourceLeaf}`,
        ctaAnchor: 'log-activity',
        tone: 'action',
      }
    case 'resourceType:Prayer':
      return {
        headline: `Commit to your prayer rhythm for ${counterparty}.`,
        subline: `Log each prayer time here so ${counterparty} can see the support showing up. Quality over quantity.`,
        ctaLabel: 'Log a prayer time',
        ctaAnchor: 'log-activity',
        tone: 'action',
      }
    case 'resourceType:Connector':
      return {
        headline: `Make the introduction for ${counterparty}.`,
        subline: `When the intro happens (warm email, three-way call, in-person), log it here so both sides see it landed.`,
        ctaLabel: 'Log the introduction',
        ctaAnchor: 'log-activity',
        tone: 'action',
      }
    case 'resourceType:Data':
    case 'resourceType:Scripture':
      return {
        headline: `Share the requested ${topic ? `"${topic}"` : 'information'} with ${counterparty}.`,
        subline: `Once delivered, log it here and ${counterparty} can confirm receipt. The engagement closes one-shot on first delivery.`,
        ctaLabel: 'Log the delivery',
        ctaAnchor: 'log-activity',
        tone: 'action',
      }
    case 'resourceType:Venue':
      return {
        headline: `Confirm the venue with ${counterparty}.`,
        subline: `Once the gathering happens, log it here so the engagement reflects the actual use of the space.`,
        ctaLabel: 'Log the gathering',
        ctaAnchor: 'log-activity',
        tone: 'action',
      }
    default:
      return {
        headline: `Take the first step to ${verb} ${counterparty}.`,
        subline: `When you do, log it here so the engagement starts tracking. Each entry keeps the record honest for both sides.`,
        ctaLabel: 'Log the first step',
        ctaAnchor: 'log-activity',
        tone: 'action',
      }
  }
}

function holderFirstWaitForResource(
  resourceType: string, counterparty: string, _topic: string, resourceLeaf: string,
): NextStep {
  switch (resourceType) {
    case 'resourceType:Money':
      return {
        headline: `Waiting on ${counterparty}'s disbursement plan.`,
        subline: `Once funds arrive, you'll see it logged here. You can add a note to the thread to coordinate timing.`,
        ctaLabel: 'Send a note to the thread',
        ctaAnchor: 'thread',
        tone: 'waiting',
      }
    case 'resourceType:Worker':
    case 'resourceType:Skill':
      return {
        headline: `${counterparty} is reaching out to schedule your first session.`,
        subline: `Watch this thread — when the session happens, it'll show up here. You can ping ${counterparty} if it's been a while.`,
        ctaLabel: 'Send a note to the thread',
        ctaAnchor: 'thread',
        tone: 'waiting',
      }
    case 'resourceType:Connector':
      return {
        headline: `${counterparty} is working on your introduction.`,
        subline: `When the intro happens, it'll show up in the thread. Reply with how it landed once you've connected.`,
        ctaLabel: 'Add context for the intro',
        ctaAnchor: 'thread',
        tone: 'waiting',
      }
    default:
      return {
        headline: `${counterparty} is preparing to deliver — watch the thread.`,
        subline: `You can add reflections, questions, or context here anytime. When the first ${resourceLeaf} happens, it lands at the top.`,
        ctaLabel: 'Add a note to the thread',
        ctaAnchor: 'thread',
        tone: 'waiting',
      }
  }
}
