/**
 * One-shot demo seed — creates a draft + a submitted GrantProposal for Maria
 * so /h/catalyst/proposals shows something.
 *
 *   pnpm exec tsx scripts/seed-test-proposal.ts
 *
 * Uses person-mcp's `proposal_submissions` table (Maria as solo applicant
 * — she's the Program Director but still drafts proposals from her own
 * MCP for v1 demo purposes). The submitted proposal targets the round
 * that scripts/seed-test-round.ts created.
 *
 * Round body validation in submit is skipped here (we INSERT directly into
 * the SQLite table) — that's intentional for demo seeding. The real
 * grant_proposal:submit MCP tool runs full validation.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// Load env from apps/web/.env (for any GRAPHDB_ vars — not strictly needed here).
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

// Maria's person-mcp principal is `person_<userId>` per /api/demo-login flow
// (line 100 in apps/web/src/app/api/demo-login/route.ts). Person-MCP's
// `principal` column is keyed off this — NOT the on-chain agent address.
const MARIA_PRINCIPAL = 'person_cat-user-001'
const ROUND_IRI = 'urn:smart-agent:round:demo-trauma-care-q2'
const FUND_AGENT_ID = '0x0F669E6851A15FD0E5904EB197c369C2ab578D9b'.toLowerCase()
const NOW = new Date().toISOString()

const DRAFT_ID = 'urn:smart-agent:grant-proposal:maria-draft-2026q2'
const SUBMITTED_ID = 'urn:smart-agent:grant-proposal:maria-submitted-2026q2'
const BASED_ON_INTENT = 'urn:smart-agent:intent:maria-trauma-care'

// Same body for both — distinguishes by status.
const BUDGET = JSON.stringify({
  lineItems: [
    { name: 'Curriculum + materials', amount: 12000, unit: 'USD', justification: '40 leaders × $300 of training kits' },
    { name: 'Trainer compensation', amount: 18000, unit: 'USD', justification: '6 sessions × $3000' },
    { name: 'Venue + meals', amount: 8000, unit: 'USD' },
    { name: 'Coordination + travel', amount: 12000, unit: 'USD' },
  ],
  total: 50000,
})

const PLAN = JSON.stringify({
  narrative:
    'Train 40 trauma-care leaders across Northern Colorado churches and community-based organisations over 6 months. Emphasis on practical de-escalation, listening posture, and referral pathways. Outcomes measured via leader self-assessment + supervisor observation + 90-day follow-up survey.',
})

const MILESTONES = JSON.stringify([
  { name: 'Cohort 1 onboarded', dueDate: '2026-06-15T00:00:00Z', evidenceRequired: 'Roster + baseline self-assessments', trancheAmount: 15000 },
  { name: 'Mid-cohort checkpoint', dueDate: '2026-08-15T00:00:00Z', evidenceRequired: 'Mid-program observation reports', trancheAmount: 20000 },
  { name: 'Cohort 1 completion', dueDate: '2026-11-15T00:00:00Z', evidenceRequired: 'Completion certificates + 90-day follow-up survey', trancheAmount: 15000 },
])

const DESIRED_OUTCOMES = JSON.stringify([
  { statement: '40 leaders certified', measurable: 'Completion certificates issued', validators: [FUND_AGENT_ID] },
  { statement: 'Reach into 6+ congregations', measurable: 'Distinct sponsoring orgs', validators: [FUND_AGENT_ID] },
])

const REPORTING_OBLIGATIONS = JSON.stringify({ cadence: 'quarterly', format: 'written+financial' })

const ORG_BACKGROUND = JSON.stringify({
  narrative:
    'Catalyst NoCo Network has run leadership-training cohorts since 2018 with a 92% completion rate. The trauma-care curriculum was piloted with 12 leaders in 2025 and is the basis for this scaled cohort.',
})

const BASIS_PLACEHOLDER = JSON.stringify({
  proximityHops: 1,
  proximityScore: 0.5,
  priorOutcomes: { fulfilled: 4, abandoned: 0 },
  outcomeScore: 5 / 6,
  composite: 0.6 * 0.5 + 0.4 * (5 / 6),
  isColdStart: false,
})

async function seedSql(): Promise<void> {
  const dbPath = path.join(repoRoot, 'apps/person-mcp/person-mcp.db')
  if (!fs.existsSync(dbPath)) {
    throw new Error(`person-mcp db not found at ${dbPath}`)
  }

  // Pull better-sqlite3 from pnpm store directly — no direct repo-root dep.
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (path: string) => {
    prepare: (sql: string) => { run: (params: Record<string, unknown>) => void }
    close: () => void
  } }).default

  const db = new Database(dbPath)
  try {
    const stmt = db.prepare(`
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
    `)

    // Draft — no submittedAt, no basis. Resumed via "your proposals".
    stmt.run({
      id: DRAFT_ID,
      principal: MARIA_PRINCIPAL,
      round_id: ROUND_IRI,
      fund_mandate_id: null,
      based_on_intent_id: BASED_ON_INTENT,
      budget: BUDGET,
      plan: PLAN,
      milestones: MILESTONES,
      desired_outcomes: DESIRED_OUTCOMES,
      reporting_obligations: REPORTING_OBLIGATIONS,
      organisational_background: ORG_BACKGROUND,
      submitted_at: null,
      version: 0,
      last_edited_at: NOW,
      status: 'draft',
      withdrawn_at: null,
      cloned_from_proposal_id: null,
      basis: null,
      visibility: 'private',
      created_at: NOW,
    })

    // Submitted — with basis snapshot, version 0 (initial submit).
    stmt.run({
      id: SUBMITTED_ID,
      principal: MARIA_PRINCIPAL,
      round_id: ROUND_IRI,
      fund_mandate_id: null,
      based_on_intent_id: BASED_ON_INTENT,
      budget: BUDGET,
      plan: PLAN,
      milestones: MILESTONES,
      desired_outcomes: DESIRED_OUTCOMES,
      reporting_obligations: REPORTING_OBLIGATIONS,
      organisational_background: ORG_BACKGROUND,
      submitted_at: NOW,
      version: 0,
      last_edited_at: NOW,
      status: 'submitted',
      withdrawn_at: null,
      cloned_from_proposal_id: null,
      basis: BASIS_PLACEHOLDER,
      visibility: 'private',
      created_at: NOW,
    })
    console.log(`[seed-test-proposal] inserted draft + submitted into person-mcp.db for ${MARIA_PRINCIPAL}`)
  } finally {
    db.close()
  }
}

async function main(): Promise<void> {
  await seedSql()
  console.log('\n✓ Seeded two GrantProposals for Maria (draft + submitted).')
  console.log('  Visit: http://localhost:3000/h/catalyst/proposals (after Maria signs in)')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
