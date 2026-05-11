/**
 * Demo seed — multiple GrantProposals (drafts + submitted) for Maria and
 * Pastor David across all three faith-themed rounds. Gives the proposals
 * index page enough variety to demo the full lifecycle (draft, submitted,
 * different rounds, different proposers).
 *
 *   pnpm exec tsx scripts/seed-test-proposal.ts
 *
 * Idempotent: INSERT OR REPLACE on stable ids. The proposal bodies live
 * in person-mcp.db (each principal owns their own proposal records).
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const envFile = path.join(repoRoot, 'apps/web/.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = value
  }
}

const FUND_AGENT_ID = '0x0F669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()
const NOW = new Date().toISOString()

interface ProposalSeed {
  id: string
  /** person-mcp principal: 'person_<demo-user-id>' */
  principal: string
  roundId: string
  basedOnIntentId: string
  status: 'draft' | 'submitted'
  budget: { lineItems: Array<{ name: string; amount: number; unit: string; justification?: string }>; total: number }
  planNarrative: string
  milestones: Array<{ name: string; dueDate: string; evidenceRequired: string; trancheAmount: number }>
  outcomes: Array<{ statement: string; measurable: string }>
  reportingCadence: 'monthly' | 'quarterly' | 'annual'
  orgBackground: string
}

const PROPOSALS: ProposalSeed[] = [
  // 1. Maria — DRAFT on the trauma-care round (resumes via "your proposals").
  {
    id: 'urn:smart-agent:grant-proposal:maria-trauma-care-draft',
    principal: 'person_cat-user-001',
    roundId: 'urn:smart-agent:round:demo-trauma-care-q2',
    basedOnIntentId: 'urn:smart-agent:intent:maria-trauma-care',
    status: 'draft',
    budget: {
      lineItems: [
        { name: 'Curriculum + materials', amount: 12000, unit: 'USD', justification: '40 leaders × $300 of compassion-care training kits' },
        { name: 'Trainer compensation', amount: 18000, unit: 'USD', justification: '6 sessions × $3000' },
        { name: 'Venue + meals', amount: 8000, unit: 'USD' },
        { name: 'Coordination + travel', amount: 12000, unit: 'USD' },
      ],
      total: 50000,
    },
    planNarrative: 'Train 40 trauma-care leaders across NoCo churches and migrant-family ministries over 6 months. Practical de-escalation, listening posture, referral pathways. Outcomes via leader self-assessment + supervisor observation + 90-day follow-up survey.',
    milestones: [
      { name: 'Cohort 1 onboarded', dueDate: '2026-06-15T00:00:00Z', evidenceRequired: 'Roster + baseline self-assessments', trancheAmount: 15000 },
      { name: 'Mid-cohort checkpoint', dueDate: '2026-08-15T00:00:00Z', evidenceRequired: 'Mid-program observation reports', trancheAmount: 20000 },
      { name: 'Cohort 1 completion', dueDate: '2026-11-15T00:00:00Z', evidenceRequired: 'Completion certificates + 90-day survey', trancheAmount: 15000 },
    ],
    outcomes: [
      { statement: '40 leaders certified', measurable: 'Completion certificates issued' },
      { statement: 'Reach into 6+ congregations', measurable: 'Distinct sponsoring orgs' },
    ],
    reportingCadence: 'quarterly',
    orgBackground: 'Catalyst NoCo Network has run leadership-training cohorts since 2018 with a 92% completion rate. The trauma-care curriculum was piloted with 12 leaders in 2025 and is the basis for this scaled cohort.',
  },
  // 2. Maria — SUBMITTED on the trauma-care round.
  {
    id: 'urn:smart-agent:grant-proposal:maria-trauma-care-submitted',
    principal: 'person_cat-user-001',
    roundId: 'urn:smart-agent:round:demo-trauma-care-q2',
    basedOnIntentId: 'urn:smart-agent:intent:maria-trauma-care',
    status: 'submitted',
    budget: {
      lineItems: [
        { name: 'Curriculum + materials', amount: 12000, unit: 'USD' },
        { name: 'Trainer compensation', amount: 18000, unit: 'USD' },
        { name: 'Venue + meals', amount: 8000, unit: 'USD' },
        { name: 'Coordination + travel', amount: 12000, unit: 'USD' },
      ],
      total: 50000,
    },
    planNarrative: 'Train 40 trauma-care leaders across NoCo migrant-family ministries over 6 months. Submitted version of the draft to the right; basis snapshot recorded at submit.',
    milestones: [
      { name: 'Cohort 1 onboarded', dueDate: '2026-06-15T00:00:00Z', evidenceRequired: 'Roster + baseline self-assessments', trancheAmount: 15000 },
      { name: 'Mid-cohort checkpoint', dueDate: '2026-08-15T00:00:00Z', evidenceRequired: 'Mid-program observation reports', trancheAmount: 20000 },
      { name: 'Cohort 1 completion', dueDate: '2026-11-15T00:00:00Z', evidenceRequired: 'Completion certificates + 90-day survey', trancheAmount: 15000 },
    ],
    outcomes: [
      { statement: '40 leaders certified', measurable: 'Completion certificates issued' },
      { statement: 'Reach into 6+ congregations', measurable: 'Distinct sponsoring orgs' },
    ],
    reportingCadence: 'quarterly',
    orgBackground: 'Catalyst NoCo Network — see draft for full background.',
  },
  // 3. Maria — SUBMITTED on the Spanish heart-language scripture round.
  {
    id: 'urn:smart-agent:grant-proposal:maria-spanish-scripture-submitted',
    principal: 'person_cat-user-001',
    roundId: 'urn:smart-agent:round:demo-spanish-scripture-q2',
    basedOnIntentId: 'urn:smart-agent:intent:maria-spanish-bibles',
    status: 'submitted',
    budget: {
      lineItems: [
        { name: 'Bilingual study Bibles (200 copies)', amount: 4000, unit: 'USD', justification: '$20/copy bulk' },
        { name: 'Host-family curriculum kits', amount: 3500, unit: 'USD', justification: '70 host families × $50' },
        { name: 'Bilingual facilitator stipend', amount: 4500, unit: 'USD' },
      ],
      total: 12000,
    },
    planNarrative: 'Equip 70 first-generation Spanish-speaking host families across Wellington / Loveland / Berthoud circles with study Bibles and bilingual study kits. Facilitators run 8-week introductory cohorts in each circle.',
    milestones: [
      { name: 'Bibles + kits delivered to host families', dueDate: '2026-07-01T00:00:00Z', evidenceRequired: 'Distribution receipts + host-family acknowledgements', trancheAmount: 7500 },
      { name: 'First study cohorts launch', dueDate: '2026-08-15T00:00:00Z', evidenceRequired: 'Cohort rosters', trancheAmount: 4500 },
    ],
    outcomes: [
      { statement: '70 host families equipped', measurable: 'Distribution receipts' },
      { statement: '5+ active study cohorts', measurable: 'Cohort attendance logs' },
    ],
    reportingCadence: 'quarterly',
    orgBackground: 'Catalyst NoCo Network distributed 90 Spanish New Testaments in 2024; 60% of recipients joined a study cohort within 90 days.',
  },
  // 4. David — SUBMITTED on the trauma-care round (so Maria as steward
  //    has a non-self-award option in the close-round flow).
  {
    id: 'urn:smart-agent:grant-proposal:david-trauma-care-submitted',
    principal: 'person_cat-user-002',
    roundId: 'urn:smart-agent:round:demo-trauma-care-q2',
    basedOnIntentId: 'urn:smart-agent:intent:david-trauma-care',
    status: 'submitted',
    budget: {
      lineItems: [
        { name: 'Bilingual trauma-counselor honoraria', amount: 18000, unit: 'USD' },
        { name: 'Cohort retreat venue + meals', amount: 7000, unit: 'USD' },
        { name: 'Curriculum translation + printing', amount: 3000, unit: 'USD' },
      ],
      total: 28000,
    },
    planNarrative: 'Pastor David Chen leads a 4-month bilingual trauma-care cohort for 25 NoCo Hispanic ministry leaders. Spanish/English co-led; emphasis on faith-integration alongside the clinical de-escalation curriculum. Outcomes via leader self-assessment + supervisor observation.',
    milestones: [
      { name: 'Cohort onboarded + curriculum translated', dueDate: '2026-07-01T00:00:00Z', evidenceRequired: 'Roster + Spanish curriculum draft', trancheAmount: 12000 },
      { name: 'Mid-cohort retreat held', dueDate: '2026-09-15T00:00:00Z', evidenceRequired: 'Retreat report + planter check-ins', trancheAmount: 8000 },
      { name: 'Cohort completion', dueDate: '2026-11-30T00:00:00Z', evidenceRequired: 'Completion certificates + supervisor reviews', trancheAmount: 8000 },
    ],
    outcomes: [
      { statement: '25 bilingual leaders certified', measurable: 'Completion certificates issued' },
      { statement: 'Spanish curriculum reusable', measurable: 'Translated kit published' },
    ],
    reportingCadence: 'quarterly',
    orgBackground: 'Pastor David Chen has coached 14 NoCo bilingual leaders since 2019; this cohort scales the bilingual-curriculum work alongside Catalyst NoCo Network.',
  },
  // 5. David — DRAFT on the pastoral-coaching round.
  {
    id: 'urn:smart-agent:grant-proposal:david-pastoral-coaching-draft',
    principal: 'person_cat-user-002',
    roundId: 'urn:smart-agent:round:demo-pastoral-coaching-q2',
    basedOnIntentId: 'urn:smart-agent:intent:david-pastoral-coaching',
    status: 'draft',
    budget: {
      lineItems: [
        { name: 'Cohort coaching honoraria (3 coaches × 12 mo)', amount: 18000, unit: 'USD' },
        { name: 'Quarterly retreat venue + meals', amount: 4500, unit: 'USD' },
        { name: 'Resource library + assessments', amount: 2500, unit: 'USD' },
      ],
      total: 25000,
    },
    planNarrative: 'Form a 12-month coaching cohort for 9 NoCo church planters. Each planter paired with a senior coach; quarterly all-cohort retreats; monthly 1:1 sessions. Outcomes measured via planter self-assessment + cohort peer review + 6-month church-plant health survey.',
    milestones: [
      { name: 'Cohort matched (planter ↔ coach)', dueDate: '2026-06-30T00:00:00Z', evidenceRequired: 'Pairing roster + signed coaching covenants', trancheAmount: 6250 },
      { name: 'Q1 retreat held', dueDate: '2026-09-30T00:00:00Z', evidenceRequired: 'Retreat report + planter check-ins', trancheAmount: 6250 },
      { name: 'Q2 retreat held', dueDate: '2026-12-31T00:00:00Z', evidenceRequired: 'Retreat report + mid-cohort planter survey', trancheAmount: 6250 },
      { name: 'Cohort completion', dueDate: '2027-05-31T00:00:00Z', evidenceRequired: 'Final assessments + 6-mo health survey', trancheAmount: 6250 },
    ],
    outcomes: [
      { statement: '9 planters complete the cohort', measurable: 'Final assessments' },
      { statement: '6+ church plants reach steady-state activity by month 12', measurable: 'Plant health survey' },
    ],
    reportingCadence: 'monthly',
    orgBackground: 'Pastor David Chen has coached 14 NoCo bilingual planters since 2019; this cohort scales the existing pairing model with formal validators.',
  },
]

const BASIS_SNAPSHOT = JSON.stringify({
  proximityHops: 1,
  proximityScore: 0.5,
  priorOutcomes: { fulfilled: 4, abandoned: 0 },
  outcomeScore: 5 / 6,
  composite: 0.6 * 0.5 + 0.4 * (5 / 6),
  isColdStart: false,
})

async function seedSql(): Promise<void> {
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => {
    prepare: (sql: string) => { run: (params: Record<string, unknown>) => void }
    close: () => void
  } }).default

  const insertSql = `
    INSERT OR REPLACE INTO proposal_submissions (
      id, principal, round_id, fund_mandate_id, based_on_intent_id,
      budget, plan, milestones, desired_outcomes, reporting_obligations,
      organisational_background, submitted_at, version, last_edited_at,
      status, withdrawn_at, cloned_from_proposal_id, basis,
      visibility, created_at
    ) VALUES (
      @id, @principal, @round_id, @fund_mandate_id, @based_on_intent_id,
      @budget, @plan, @milestones, @desired_outcomes, @reporting_obligations,
      @organisational_background, @submitted_at, @version, @last_edited_at,
      @status, @withdrawn_at, @cloned_from_proposal_id, @basis,
      @visibility, @created_at
    )
  `

  // Spec 004 v2 — org-mcp's proposal_submissions is gone (submitted
  // proposals live on chain in GrantProposalRegistry). Only person-mcp
  // keeps a `proposal_submissions` table — for DRAFTS (pre-submission
  // state). Demo proposals seeded here populate person-mcp drafts; the
  // submitted on-chain rows come from real user flow through
  // grant_proposal:submit.
  const targets = [
    { dbPath: path.join(repoRoot, 'apps/person-mcp/person-mcp.db'), label: 'person-mcp' },
  ]
  for (const { dbPath, label } of targets) {
    if (!fs.existsSync(dbPath)) {
      console.warn(`[seed-test-proposal] ${dbPath} does not exist — skipping ${label}`)
      continue
    }
    const db = new Database(dbPath)
    try {
      const stmt = db.prepare(insertSql)
      for (const p of PROPOSALS) {
        const isDraft = p.status === 'draft'
        stmt.run({
          id: p.id,
          principal: p.principal,
          round_id: p.roundId,
          fund_mandate_id: null,
          based_on_intent_id: p.basedOnIntentId,
          budget: JSON.stringify(p.budget),
          plan: JSON.stringify({ narrative: p.planNarrative }),
          milestones: JSON.stringify(p.milestones),
          desired_outcomes: JSON.stringify(p.outcomes.map(o => ({ ...o, validators: [FUND_AGENT_ID] }))),
          reporting_obligations: JSON.stringify({ cadence: p.reportingCadence, format: 'written+financial' }),
          organisational_background: JSON.stringify({ narrative: p.orgBackground }),
          submitted_at: isDraft ? null : NOW,
          version: 0,
          last_edited_at: NOW,
          status: p.status,
          withdrawn_at: null,
          cloned_from_proposal_id: null,
          basis: isDraft ? null : BASIS_SNAPSHOT,
          visibility: 'private',
          created_at: NOW,
        })
      }
      console.log(`[seed-test-proposal] wrote ${PROPOSALS.length} proposals to ${label}`)
    } finally {
      db.close()
    }
  }
}

async function main(): Promise<void> {
  await seedSql()
  console.log(`\n✓ Seeded ${PROPOSALS.length} GrantProposals across the catalyst rounds:`)
  for (const p of PROPOSALS) {
    console.log(`    · ${p.status.padEnd(9)} ${p.principal} → ${p.roundId.split(':').pop()}`)
  }
  console.log('  Visit: http://localhost:3000/h/catalyst/proposals (after Maria signs in)')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
