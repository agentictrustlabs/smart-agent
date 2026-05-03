'use server'

/**
 * AI matcher — autonomous match-acceptance for the catalyst hub.
 *
 * Operated by an AI agent (e.g. NoCo Growth Analytics) on behalf of its
 * controller (Maria). The agent reads proposed matches, applies simple
 * deterministic reasoning (best-scored, beneficiary set, no obvious
 * exclusion), and calls acceptMatch on the winners.
 *
 * Reasoning trace is captured per-decision so the matching engagement's
 * thread shows *why* the AI made each call. This is the demo's "AI agent
 * with a real reasoning engine taking on work items."
 *
 * Spec: docs/specs/engagement-shapes-plan.md (R17/R18 follow-on).
 *
 * SCOPE NOTE: This v0 ships the deterministic core + one-shot trigger.
 * A future R-phase wires the agent into the a2a-agent runtime so it polls
 * autonomously instead of waiting on a button click.
 */

import { db, schema } from '@/db'
import { and, eq, inArray } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export interface AiMatchDecision {
  intentId: string
  intentTitle: string
  selectedMatchId: string
  selectedScore: number
  rejectedMatchIds: string[]
  reasoning: string
  /** Set to a brief reason when the matcher chose to skip rather than accept. */
  skippedReason?: string
}

export interface AiMatchRoundResult {
  matcherAgentName: string
  considered: number
  accepted: number
  skipped: number
  decisions: AiMatchDecision[]
  errors: Array<{ matchId: string; error: string }>
}

/** Minimum score (0..10000 bps) for the AI to accept without human review. */
const MIN_AUTO_ACCEPT_SCORE = 5000

/**
 * Run one round of AI matching for a hub. The current user acts as the
 * AI agent's operator (the agent is operated-by them on-chain), so
 * acceptMatch authorizes against the user's session.
 */
export async function runAiMatchRound(input: {
  hubId: string
}): Promise<{ ok: true; result: AiMatchRoundResult } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }

  // Fetch the operator's owned AI agent — by convention the first active
  // agent of TYPE_AI operated by the user. For the demo, Maria operates
  // NoCo Growth Analytics; we display its name in the round summary.
  const matcherAgentName = await resolveOperatorAiAgent(me.id) ?? 'AI matcher'

  // Pull proposed matches in this hub. We group by holder intent so the AI
  // picks ONE coach per ask, even if multiple offerings score well.
  let proposedRows: any = [] as any[]
  try { proposedRows = await db.select().from(schema.needResourceMatches)
    .where(eq(schema.needResourceMatches.status, 'proposed'))
    .all()

   } catch { /* needResourceMatches table dropped */ }// Filter to this hub via the joined need.
  const filtered: typeof proposedRows = []
  for (const m of proposedRows) {
    let need: any = [] as any[]
    try { need = db.select().from(schema.needs)
      .where(eq(schema.needs.id, m.needId)).get()
     } catch { /* needs table dropped */ }if (need?.hubId === input.hubId) filtered.push(m)
  }

  // Group by needId.
  const byNeed = new Map<string, typeof filtered>()
  for (const m of filtered) {
    const arr = byNeed.get(m.needId) ?? []
    arr.push(m)
    byNeed.set(m.needId, arr)
  }

  const decisions: AiMatchDecision[] = []
  const errors: Array<{ matchId: string; error: string }> = []
  let accepted = 0
  let skipped = 0

  for (const [needId, matches] of byNeed) {
    let need: any = [] as any[]
    try { need = db.select().from(schema.needs).where(eq(schema.needs.id, needId)).get()
     } catch { /* needs table dropped */ }if (!need) continue

    // Sort by score desc; pick the top.
    const ranked = [...matches].sort((a, b) => b.score - a.score)
    const winner = ranked[0]
    const rejected = ranked.slice(1).map(m => m.id)

    const decision: AiMatchDecision = {
      intentId: needId,
      intentTitle: need.title,
      selectedMatchId: winner.id,
      selectedScore: winner.score,
      rejectedMatchIds: rejected,
      reasoning: '',
    }

    // Reasoning: explicit, no fallbacks. Each guard names what it checked.
    if (winner.score < MIN_AUTO_ACCEPT_SCORE) {
      decision.skippedReason = `top score ${winner.score / 100}% below auto-accept threshold ${MIN_AUTO_ACCEPT_SCORE / 100}%`
      decision.reasoning = `Looked at ${matches.length} proposed match${matches.length === 1 ? '' : 'es'}; top scored ${winner.score / 100}%. Below ${MIN_AUTO_ACCEPT_SCORE / 100}% confidence — escalated to human matcher.`
      skipped++
      decisions.push(decision)
      continue
    }

    // Verify the holder intent has an explicit beneficiary. R16 contract.
    const reqJson = need.requirements ? safeParse<Record<string, unknown>>(need.requirements) : {}
    const beneficiary = typeof reqJson?.beneficiaryAgent === 'string' ? reqJson.beneficiaryAgent : null
    if (!beneficiary) {
      decision.skippedReason = 'intent missing payload.beneficiaryAgent (no fallback)'
      decision.reasoning = `Top match scored ${winner.score / 100}% but the holder intent has no declared beneficiary. Refusing to guess — flagged for human review.`
      skipped++
      decisions.push(decision)
      continue
    }

    // Compose the reasoning narrative. Keep it short, declarative, useful.
    const satisfiesList = safeParse<string[]>(winner.satisfies) ?? []
    const missesList = safeParse<string[]>(winner.misses) ?? []
    decision.reasoning = [
      `Selected highest-scored offering (${winner.score / 100}%) out of ${matches.length}.`,
      satisfiesList.length > 0 ? `Satisfied: ${satisfiesList.join(', ')}.` : null,
      missesList.length > 0 ? `Trade-offs: ${missesList.join(', ')}.` : null,
      `Beneficiary on file: ${shortAddr(beneficiary)}. Will be holder of the delivery engagement.`,
    ].filter(Boolean).join(' ')

    // Accept the match. acceptMatch enforces beneficiary explicitness too.
    try {
      const { acceptMatch } = await import('@/lib/actions/discover.action')
      const r = await acceptMatch(winner.id)
      if ('error' in r) {
        errors.push({ matchId: winner.id, error: r.error })
        decision.skippedReason = `acceptMatch failed: ${r.error}`
        skipped++
      } else {
        accepted++
        // Annotate the matching engagement's thread with the reasoning.
        if (r.matchingEngagementId) {
          try {
            const { emitMessage } = await import('./thread.action')
            await emitMessage({
              engagementId: r.matchingEngagementId,
              fromAgent: '0x0',  // system author
              text: `🤖 ${matcherAgentName} reasoning: ${decision.reasoning}`,
            })
          } catch { /* non-fatal */ }
        }
      }
    } catch (err) {
      errors.push({ matchId: winner.id, error: (err as Error).message })
      skipped++
    }

    decisions.push(decision)
  }

  return {
    ok: true,
    result: {
      matcherAgentName,
      considered: filtered.length,
      accepted,
      skipped,
      decisions,
      errors,
    },
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

async function resolveOperatorAiAgent(userId: string): Promise<string | null> {
  // For the demo, surface the AI agent name from the on-chain resolver where
  // it exists. The agent is "operated by" the user (Maria → NoCo Growth Analytics).
  // If we can't resolve, we still run — the matcher just calls itself "AI matcher".
  try {
    const { getOrgsForPersonAgent, getPersonAgentForUser } = await import('@/lib/agent-registry')
    const { getAgentMetadata } = await import('@/lib/agent-metadata')
    const personAgent = await getPersonAgentForUser(userId)
    if (!personAgent) return null
    const orgs = await getOrgsForPersonAgent(personAgent as `0x${string}`).catch(() => [])
    // Heuristic: hydrate metadata for each org and pick the first whose
    // display name reads as an AI agent. If none, return null and the round
    // runs anonymously.
    for (const o of orgs) {
      const meta = await getAgentMetadata(o.address as `0x${string}`).catch(() => null)
      if (meta?.displayName && /analytics|ai|matcher|coach/i.test(meta.displayName)) {
        return meta.displayName
      }
    }
    return null
  } catch { return null }
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

void inArray  // kept for future signal extensions
