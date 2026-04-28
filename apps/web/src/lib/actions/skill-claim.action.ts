'use server'

/**
 * Skill-claim authoring actions.
 *
 *   listSkillsAction              — read every published Skill from
 *                                   SkillDefinitionRegistry, shaped for
 *                                   a UI dropdown / autocomplete.
 *   mintPublicSkillClaimAction    — mint a Public-visibility skill claim
 *                                   for the caller's person agent.
 *   listMySkillClaimsAction       — caller's own claims with labels.
 *   listSkillsForAgentAction(addr)— public claims for any agent.
 *
 * Mirrors `geo-claim.action.ts` for the skill domain. v0 ships only the
 * direct (self-attest) mint path. Cross-issued mints (with EIP-712
 * endorsement signatures from third-party issuers) are deferred to v1.
 */

import { keccak256, stringToHex } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import {
  skillDefinitionRegistryAbi,
  agentSkillRegistryAbi,
  type SkillRelationLabel,
} from '@smart-agent/sdk'
import {
  SKILL_REL_HAS_SKILL,
  SKILL_REL_PRACTICES_SKILL,
  SKILL_REL_CERTIFIED_IN,
  SKILL_REL_ENDORSES_SKILL,
  SKILL_REL_MENTORS_IN,
  SKILL_REL_CAN_TRAIN_OTHERS,
  SKILL_VISIBILITY,
  SKILL_OVERLAP_POLICY_ID,
  SKILL_SELF_MAX_PROFICIENCY,
  skillProficiencyLabel,
} from '@smart-agent/sdk'

const REL_HASH: Record<SkillRelationLabel, `0x${string}`> = {
  hasSkill:          SKILL_REL_HAS_SKILL,
  practicesSkill:    SKILL_REL_PRACTICES_SKILL,
  certifiedIn:       SKILL_REL_CERTIFIED_IN,
  endorsesSkill:     SKILL_REL_ENDORSES_SKILL,
  mentorsIn:         SKILL_REL_MENTORS_IN,
  canTrainOthersIn:  SKILL_REL_CAN_TRAIN_OTHERS,
}

const REL_LABEL_BY_HASH: Record<string, SkillRelationLabel> = Object.fromEntries(
  Object.entries(REL_HASH).map(([k, v]) => [v.toLowerCase(), k as SkillRelationLabel]),
)

const VIS_LABELS = ['Public', 'PublicCoarse', 'PrivateCommitment', 'PrivateZk', 'OffchainOnly'] as const

const ZERO: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000000'

// ─── Types ────────────────────────────────────────────────────────────

export interface SkillRow {
  skillId: `0x${string}`
  version: string
  metadataURI: string
  /** Best-effort label: the metadataURI is expected to be a JSON-LD
   *  pointer; if it has a recognisable suffix we use that, otherwise
   *  the skillId prefix. v0 has hand-curated demo skills — labels are
   *  set in the seed step (cbox/skill-vocabulary.ttl). */
  label: string
}

export interface MySkillClaimRow {
  claimId: `0x${string}`
  skillId: `0x${string}`
  skillLabel: string
  issuer: `0x${string}`
  relation: SkillRelationLabel
  proficiencyScore: number
  proficiencyLabel: ReturnType<typeof skillProficiencyLabel>
  confidence: number
  visibility: typeof VIS_LABELS[number]
  createdAt: number
  revoked: boolean
}

export interface MintSkillClaimInput {
  skillId: `0x${string}`
  skillVersion: number
  relation: SkillRelationLabel
  /** 0..10000. Capped at 6000 in the on-chain contract for self-attest. */
  proficiencyScore: number
  /** 0..100. */
  confidence: number
}

// ─── Reads ────────────────────────────────────────────────────────────

/** Every published skill, latest version, for picker UIs. */
export async function listSkillsAction(): Promise<SkillRow[]> {
  const reg = process.env.SKILL_DEFINITION_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!reg) return []

  const client = getPublicClient()
  let ids: `0x${string}`[] = []
  try {
    ids = (await client.readContract({
      address: reg, abi: skillDefinitionRegistryAbi,
      functionName: 'allSkills',
    })) as `0x${string}`[]
  } catch { return [] }

  const out: SkillRow[] = []
  for (const id of ids) {
    try {
      const s = (await client.readContract({
        address: reg, abi: skillDefinitionRegistryAbi,
        functionName: 'getLatest', args: [id],
      })) as { skillId: `0x${string}`; version: bigint; metadataURI: string }
      out.push({
        skillId: s.skillId,
        version: s.version.toString(),
        metadataURI: s.metadataURI,
        label: labelFromMetadataURI(s.metadataURI) || s.skillId.slice(0, 10) + '…',
      })
    } catch { /* skip bad row */ }
  }
  return out
}

export async function listSkillsForAgentAction(agent: `0x${string}`): Promise<MySkillClaimRow[]> {
  return readSkillClaimsForSubject(agent)
}

export async function listMySkillClaimsAction(): Promise<MySkillClaimRow[]> {
  const me = await getCurrentUser()
  if (!me) return []
  const personAgent = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
  if (!personAgent) return []
  return readSkillClaimsForSubject(personAgent)
}

async function readSkillClaimsForSubject(subject: `0x${string}`): Promise<MySkillClaimRow[]> {
  const claimReg = process.env.AGENT_SKILL_REGISTRY_ADDRESS as `0x${string}` | undefined
  const skillReg = process.env.SKILL_DEFINITION_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!claimReg || !skillReg) return []

  const client = getPublicClient()
  let claimIds: `0x${string}`[] = []
  try {
    claimIds = (await client.readContract({
      address: claimReg, abi: agentSkillRegistryAbi,
      functionName: 'claimsBySubject', args: [subject],
    })) as `0x${string}`[]
  } catch { return [] }

  const out: MySkillClaimRow[] = []
  for (const cid of claimIds) {
    try {
      const c = (await client.readContract({
        address: claimReg, abi: agentSkillRegistryAbi,
        functionName: 'getClaim', args: [cid],
      })) as {
        claimId: `0x${string}`; skillId: `0x${string}`; skillVersion: bigint
        issuer: `0x${string}`; relation: `0x${string}`; visibility: number
        proficiencyScore: number; confidence: number; revoked: boolean
        createdAt: bigint
      }

      let skillLabel = c.skillId.slice(0, 10) + '…'
      try {
        const s = (await client.readContract({
          address: skillReg, abi: skillDefinitionRegistryAbi,
          functionName: 'getSkill', args: [c.skillId, c.skillVersion],
        })) as { metadataURI: string }
        skillLabel = labelFromMetadataURI(s.metadataURI) || skillLabel
      } catch { /* keep prefix */ }

      out.push({
        claimId: c.claimId,
        skillId: c.skillId,
        skillLabel,
        issuer: c.issuer,
        relation: REL_LABEL_BY_HASH[c.relation.toLowerCase()] ?? 'hasSkill',
        proficiencyScore: c.proficiencyScore,
        proficiencyLabel: skillProficiencyLabel(c.proficiencyScore),
        confidence: c.confidence,
        visibility: VIS_LABELS[c.visibility] ?? 'Public',
        createdAt: Number(c.createdAt),
        revoked: c.revoked,
      })
    } catch { /* skip bad row */ }
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

// ─── Writes ───────────────────────────────────────────────────────────

export async function mintPublicSkillClaimAction(
  input: MintSkillClaimInput,
): Promise<{ success: boolean; claimId?: `0x${string}`; error?: string }> {
  try {
    const me = await getCurrentUser()
    if (!me) return { success: false, error: 'Not signed in' }

    const personAgent = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
    if (!personAgent) return { success: false, error: 'No person agent — finish onboarding first' }

    const claimRegistry = process.env.AGENT_SKILL_REGISTRY_ADDRESS as `0x${string}` | undefined
    if (!claimRegistry) return { success: false, error: 'AGENT_SKILL_REGISTRY_ADDRESS not set' }

    // Self-attestation invariants — the contract enforces these too,
    // but failing fast with a helpful message is friendlier than
    // letting a tx revert.
    if (input.relation === 'certifiedIn') {
      return { success: false, error: 'certifiedIn requires a third-party issuer (deferred to v1)' }
    }
    const score = Math.max(0, Math.min(SKILL_SELF_MAX_PROFICIENCY, Math.floor(input.proficiencyScore)))

    const wc = getWalletClient()
    const pc = getPublicClient()
    const issuer = personAgent  // self
    const nonce = keccak256(stringToHex(
      `${personAgent}|${input.skillId}|${input.relation}|${Date.now()}`,
    ))

    const evidenceCommit = keccak256(stringToHex(
      `evidence:skill:${personAgent}|${input.skillId}|${input.relation}`,
    )) as `0x${string}`

    const mintInput = {
      subjectAgent: personAgent,
      issuer,
      skillId: input.skillId,
      skillVersion: BigInt(input.skillVersion),
      relation: REL_HASH[input.relation],
      visibility: SKILL_VISIBILITY.Public,
      proficiencyScore: score,
      confidence: Math.max(0, Math.min(100, input.confidence)),
      evidenceCommit,
      edgeId: ZERO,
      assertionId: ZERO,
      policyId: SKILL_OVERLAP_POLICY_ID,
      validAfter: 0n,
      validUntil: 0n,
      nonce,
    }

    const hash = await wc.writeContract({
      address: claimRegistry,
      abi: agentSkillRegistryAbi,
      functionName: 'mintSelf',
      args: [mintInput],
    })
    await pc.waitForTransactionReceipt({ hash })

    const claimId = keccak256(
      `0x${personAgent.slice(2)}${input.skillId.slice(2)}${REL_HASH[input.relation].slice(2)}${nonce.slice(2)}` as `0x${string}`,
    )
    return { success: true, claimId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'mint failed' }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * v0 metadataURI shape: callers SHOULD set it to a path like
 * `https://smartagent.io/skill/custom/grant-writing` (matching the
 * skill-vocabulary.ttl IRI). We extract the trailing segment as the
 * display label.
 */
function labelFromMetadataURI(uri: string): string {
  if (!uri) return ''
  try {
    // Strip trailing slash, take last path segment.
    const cleaned = uri.replace(/\/$/, '')
    const seg = cleaned.split('/').pop() ?? ''
    return seg
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  } catch {
    return ''
  }
}
