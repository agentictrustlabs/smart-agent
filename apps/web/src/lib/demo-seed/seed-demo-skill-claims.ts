/**
 * Demo skill-claim seed.
 *
 * Mints public skill claims for every demo user against ~30 hand-curated
 * skills published by `seed-skills-onchain.ts`. The pattern mirrors
 * `mintGeoClaim` in `seed-catalyst-onchain.ts` — deterministic nonces +
 * idempotent at the contract level (`ClaimExists`).
 *
 * Each demo user gets 2–3 claims chosen to mirror their real role
 * (e.g. Maria = grant_writing + community_organizing; Luis = grant_writing
 * + community_organizing — same locale + similar work, so trust-search
 * skill column reflects that overlap).
 *
 * Runs after the per-hub seeds because demo person-agent addresses must
 * already exist (we look them up via `getPersonAgentForUser`).
 */

import { getPublicClient, getWalletClient } from '@/lib/contracts'
import {
  agentSkillRegistryAbi,
  skillDefinitionRegistryAbi,
  SkillDefinitionClient,
  type SkillRelationLabel,
  SKILL_REL_HAS_SKILL,
  SKILL_REL_PRACTICES_SKILL,
  SKILL_VISIBILITY,
  SKILL_OVERLAP_POLICY_ID,
} from '@smart-agent/sdk'
import { keccak256, toBytes, type Hex } from 'viem'
import { getPersonAgentForUser } from '@/lib/agent-registry'

const ZERO32: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

const REL_HASH: Partial<Record<SkillRelationLabel, Hex>> = {
  hasSkill:       SKILL_REL_HAS_SKILL,
  practicesSkill: SKILL_REL_PRACTICES_SKILL,
  // certifiedIn / endorsesSkill / mentorsIn / canTrainOthersIn are
  // cross-issuance only — demo seed uses self-attest, so this map
  // covers the self-attestable subset only.
}

interface DemoSkillBinding {
  /** Demo user id (matches `users.id` and DemoUserMeta key). */
  userId: string
  /** Skill conceptId in the same shape as `seed-skills-onchain.ts`. */
  conceptId: string
  relation: SkillRelationLabel
  /** 0..6000 (self-attest cap). UI displays as 0..60%. */
  proficiencyScore: number
  /** 0..100. */
  confidence: number
}

const BINDINGS: DemoSkillBinding[] = [
  // ─── Catalyst NoCo Network ────────────────────────────────────────
  // Maria — Program Director: grant work + community organizing
  { userId: 'cat-user-001', conceptId: 'custom:grant-writing',         relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cat-user-001', conceptId: 'custom:community-organizing',  relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'cat-user-001', conceptId: 'custom:program-evaluation',    relation: 'hasSkill',       proficiencyScore: 4200, confidence: 70 },
  // David — Network Lead: pastoral care + church planting
  { userId: 'cat-user-002', conceptId: 'custom:pastoral-care',         relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cat-user-002', conceptId: 'custom:church-planting',       relation: 'practicesSkill', proficiencyScore: 5000, confidence: 80 },
  // Rosa — Outreach: community organizing + ESL
  { userId: 'cat-user-003', conceptId: 'custom:community-organizing',  relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'cat-user-003', conceptId: 'custom:esl-instruction',       relation: 'practicesSkill', proficiencyScore: 5200, confidence: 80 },
  // Carlos — Community Partner: ESL + translation
  { userId: 'cat-user-004', conceptId: 'custom:esl-instruction',       relation: 'practicesSkill', proficiencyScore: 5000, confidence: 80 },
  { userId: 'cat-user-004', conceptId: 'custom:translation-spanish-english', relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  // Sarah — Regional Lead: program evaluation + grant writing
  { userId: 'cat-user-005', conceptId: 'custom:program-evaluation',    relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cat-user-005', conceptId: 'custom:grant-writing',         relation: 'hasSkill',       proficiencyScore: 4500, confidence: 70 },
  // Ana — Wellington Circle Leader: youth mentorship + community organizing
  { userId: 'cat-user-006', conceptId: 'custom:youth-mentorship',      relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cat-user-006', conceptId: 'custom:community-organizing',  relation: 'hasSkill',       proficiencyScore: 4200, confidence: 70 },
  // Miguel — Laporte Circle Leader: case management + community organizing
  { userId: 'cat-user-007', conceptId: 'custom:case-management',       relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cat-user-007', conceptId: 'custom:community-organizing',  relation: 'hasSkill',       proficiencyScore: 4500, confidence: 75 },
  // Elena — Timnath Circle Leader: counselling + trauma-informed care
  { userId: 'cat-user-008', conceptId: 'custom:counselling',           relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'cat-user-008', conceptId: 'custom:trauma-informed-care',  relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  // Luis — Loveland Circle Leader: grant writing + community organizing (overlaps Maria!)
  { userId: 'cat-user-009', conceptId: 'custom:grant-writing',         relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cat-user-009', conceptId: 'custom:community-organizing',  relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  // Sofia — Berthoud Circle Leader: youth mentorship + pastoral care
  { userId: 'cat-user-010', conceptId: 'custom:youth-mentorship',      relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cat-user-010', conceptId: 'custom:pastoral-care',         relation: 'hasSkill',       proficiencyScore: 4200, confidence: 70 },
  // Diego — Johnstown Circle Leader: case management + bookkeeping
  { userId: 'cat-user-011', conceptId: 'custom:case-management',       relation: 'practicesSkill', proficiencyScore: 5000, confidence: 80 },
  { userId: 'cat-user-011', conceptId: 'custom:bookkeeping',           relation: 'hasSkill',       proficiencyScore: 4500, confidence: 75 },
  // Isabel — Red Feather Circle Leader: community organizing + volunteer coordination
  { userId: 'cat-user-012', conceptId: 'custom:community-organizing',  relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cat-user-012', conceptId: 'custom:volunteer-coordination', relation: 'practicesSkill', proficiencyScore: 5200, confidence: 80 },

  // ─── Global.Church ────────────────────────────────────────────────
  // Pastor James — Senior Pastor: pastoral care + discipleship
  { userId: 'gc-user-001', conceptId: 'custom:pastoral-care',          relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'gc-user-001', conceptId: 'custom:discipleship',           relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  // Sarah Mitchell — SBC Exec Director: board governance + program evaluation
  { userId: 'gc-user-002', conceptId: 'custom:board-governance',       relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'gc-user-002', conceptId: 'custom:program-evaluation',     relation: 'practicesSkill', proficiencyScore: 5200, confidence: 80 },
  // Dan Busby — ECFA: board governance + bookkeeping
  { userId: 'gc-user-003', conceptId: 'custom:board-governance',       relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'gc-user-003', conceptId: 'custom:bookkeeping',            relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  // John Chesnut — Wycliffe Director: missions logistics + translation
  { userId: 'gc-user-004', conceptId: 'custom:missions-logistics',     relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'gc-user-004', conceptId: 'custom:translation-spanish-english', relation: 'hasSkill',  proficiencyScore: 4500, confidence: 75 },
  // David Wills — NCF President: board governance + microfinance
  { userId: 'gc-user-005', conceptId: 'custom:board-governance',       relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'gc-user-005', conceptId: 'custom:microfinance',           relation: 'hasSkill',       proficiencyScore: 4500, confidence: 75 },
  // Mike Thompson — Youth Pastor: youth mentorship + pastoral care
  { userId: 'gc-user-006', conceptId: 'custom:youth-mentorship',       relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'gc-user-006', conceptId: 'custom:pastoral-care',          relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  // Janet Wilson — Small Groups Director: discipleship + volunteer coordination
  { userId: 'gc-user-007', conceptId: 'custom:discipleship',           relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'gc-user-007', conceptId: 'custom:volunteer-coordination', relation: 'practicesSkill', proficiencyScore: 5200, confidence: 80 },
  // Marcus Lee — Missions Director: missions logistics + church planting
  { userId: 'gc-user-008', conceptId: 'custom:missions-logistics',     relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'gc-user-008', conceptId: 'custom:church-planting',        relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },

  // ─── Collective Impact Labs ───────────────────────────────────────
  // Cameron — ILAD Operations: business coaching + microfinance
  { userId: 'cil-user-001', conceptId: 'custom:business-coaching',     relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cil-user-001', conceptId: 'custom:microfinance',          relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  // Nick — ILAD Reviewer: program evaluation + bookkeeping
  { userId: 'cil-user-002', conceptId: 'custom:program-evaluation',    relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'cil-user-002', conceptId: 'custom:bookkeeping',           relation: 'practicesSkill', proficiencyScore: 5200, confidence: 80 },
  // Afia — Business Owner: business coaching + bookkeeping
  { userId: 'cil-user-003', conceptId: 'custom:business-coaching',     relation: 'hasSkill',       proficiencyScore: 4500, confidence: 75 },
  { userId: 'cil-user-003', conceptId: 'custom:bookkeeping',           relation: 'practicesSkill', proficiencyScore: 5000, confidence: 80 },
  // Kossi — Business Owner: technical-writing + microfinance
  { userId: 'cil-user-004', conceptId: 'custom:technical-writing',     relation: 'hasSkill',       proficiencyScore: 4200, confidence: 70 },
  { userId: 'cil-user-004', conceptId: 'custom:microfinance',          relation: 'hasSkill',       proficiencyScore: 4500, confidence: 75 },
  // Yaw — Cluster Manager: business coaching + revenue-share modelling
  { userId: 'cil-user-005', conceptId: 'custom:business-coaching',     relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cil-user-005', conceptId: 'custom:revenue-share-modelling', relation: 'practicesSkill', proficiencyScore: 5200, confidence: 80 },
  // John F. Kim — CIL Admin: operations management + board governance
  { userId: 'cil-user-006', conceptId: 'custom:operations-management', relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  { userId: 'cil-user-006', conceptId: 'custom:board-governance',      relation: 'practicesSkill', proficiencyScore: 5200, confidence: 80 },
  // Paul — Funder: board governance + microfinance
  { userId: 'cil-user-007', conceptId: 'custom:board-governance',      relation: 'practicesSkill', proficiencyScore: 5500, confidence: 85 },
  { userId: 'cil-user-007', conceptId: 'custom:microfinance',          relation: 'practicesSkill', proficiencyScore: 5800, confidence: 90 },
  // Akosua — Wave 1 Cohort: business coaching + community organizing
  { userId: 'cil-user-008', conceptId: 'custom:business-coaching',     relation: 'practicesSkill', proficiencyScore: 5200, confidence: 80 },
  { userId: 'cil-user-008', conceptId: 'custom:community-organizing',  relation: 'hasSkill',       proficiencyScore: 4500, confidence: 75 },
  // Kwame — Wave 2 Cohort: business coaching + revenue-share modelling
  { userId: 'cil-user-009', conceptId: 'custom:business-coaching',     relation: 'practicesSkill', proficiencyScore: 5200, confidence: 80 },
  { userId: 'cil-user-009', conceptId: 'custom:revenue-share-modelling', relation: 'hasSkill',     proficiencyScore: 4500, confidence: 75 },
]

export async function seedDemoSkillClaimsOnChain(): Promise<void> {
  const skillReg = process.env.SKILL_DEFINITION_REGISTRY_ADDRESS as `0x${string}` | undefined
  const claimReg = process.env.AGENT_SKILL_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!skillReg || !claimReg) {
    console.log('[skill-claims-seed] registries not configured — skipping')
    return
  }

  const pc = getPublicClient()
  const wc = getWalletClient()

  let minted = 0
  let skipped = 0
  let missingPersonAgent = 0

  for (const b of BINDINGS) {
    const personAgent = await getPersonAgentForUser(b.userId) as `0x${string}` | null
    if (!personAgent) { missingPersonAgent++; continue }

    // Compute skillId the same way seed-skills-onchain does.
    const [scheme, ...rest] = b.conceptId.split(':')
    const conceptId = `${scheme}:${rest.join(':')}`
    const skillId = SkillDefinitionClient.skillIdFor({
      scheme: scheme as 'oasf' | 'custom' | 'skos',
      conceptId,
    })

    // Skill version pin = latest published version (almost always 1).
    let version: bigint
    try {
      version = await pc.readContract({
        address: skillReg, abi: skillDefinitionRegistryAbi,
        functionName: 'latestVersion', args: [skillId],
      }) as bigint
    } catch {
      console.warn(`[skill-claims-seed] skill ${conceptId} not published yet — skipping ${b.userId}`)
      continue
    }
    if (version === 0n) continue

    // Deterministic nonce so re-runs hit ClaimExists.
    const nonceLabel = `seed:${personAgent.toLowerCase()}|${conceptId}|${b.relation}|v1`
    const nonce = keccak256(toBytes(nonceLabel)) as Hex
    const evidenceCommit = keccak256(toBytes(`evidence:skill:${nonceLabel}`)) as Hex

    try {
      const hash = await wc.writeContract({
        address: claimReg,
        abi: agentSkillRegistryAbi,
        functionName: 'mintSelf',
        args: [{
          subjectAgent: personAgent,
          issuer: personAgent,
          skillId,
          skillVersion: version,
          relation: REL_HASH[b.relation]!,  // BINDINGS only use self-attestable relations
          visibility: SKILL_VISIBILITY.Public,
          proficiencyScore: b.proficiencyScore,
          confidence: b.confidence,
          evidenceCommit,
          edgeId: ZERO32,
          assertionId: ZERO32,
          policyId: SKILL_OVERLAP_POLICY_ID,
          validAfter: 0n,
          validUntil: 0n,
          nonce,
        }],
      })
      await pc.waitForTransactionReceipt({ hash })
      minted++
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (/ClaimExists|RateLimited/i.test(msg)) {
        skipped++
      } else {
        console.warn(`[skill-claims-seed] mint failed for ${b.userId} ${conceptId}: ${msg.slice(0, 200)}`)
      }
    }
  }
  console.log(`[skill-claims-seed] minted ${minted}, skipped ${skipped} (already claimed), missing person-agent ${missingPersonAgent}`)
}
