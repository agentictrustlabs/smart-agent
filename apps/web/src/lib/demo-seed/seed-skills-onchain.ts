/**
 * Skill-definition seed.
 *
 * Publishes ~30 hand-curated skill definitions to SkillDefinitionRegistry
 * matching `docs/ontology/cbox/skill-vocabulary.ttl`. Each skill maps to
 * one IRI in the vocabulary; the on-chain skillId is keccak256 of the
 * canonical id string (`SkillDefinitionClient.skillIdFor`).
 *
 * Idempotent: if `latestVersion[skillId] > 0` the entry is left alone.
 *
 * After this lands, demo users can:
 *   • mint public skill claims via the profile panel,
 *   • see candidate skill columns light up in trust-search.
 */

import { getPublicClient, getWalletClient } from '@/lib/contracts'
import {
  skillDefinitionRegistryAbi,
  SkillDefinitionClient,
  type SkillKindLabel,
} from '@smart-agent/sdk'
import { keccak256, stringToHex, type Hex } from 'viem'

interface SkillSeed {
  /** Vocabulary IRI suffix; matches cbox/skill-vocabulary.ttl. */
  conceptId: string
  kind: SkillKindLabel
  prefLabel: string
}

const SEEDS: SkillSeed[] = [
  // Communication & writing
  { conceptId: 'custom:grant-writing',                    kind: 'Custom',   prefLabel: 'Grant writing' },
  { conceptId: 'custom:technical-writing',                kind: 'Custom',   prefLabel: 'Technical writing' },
  { conceptId: 'custom:copywriting',                      kind: 'Custom',   prefLabel: 'Copywriting' },
  { conceptId: 'custom:translation-spanish-english',      kind: 'Custom',   prefLabel: 'Spanish ↔ English translation' },
  // Nonprofit / community
  { conceptId: 'custom:nonprofit-development',            kind: 'Domain',   prefLabel: 'Nonprofit development' },
  { conceptId: 'custom:community-organizing',             kind: 'Custom',   prefLabel: 'Community organizing' },
  { conceptId: 'custom:volunteer-coordination',           kind: 'Custom',   prefLabel: 'Volunteer coordination' },
  { conceptId: 'custom:case-management',                  kind: 'Custom',   prefLabel: 'Case management' },
  { conceptId: 'custom:social-work',                      kind: 'Domain',   prefLabel: 'Social work' },
  // Care & counselling
  { conceptId: 'custom:counselling',                      kind: 'Domain',   prefLabel: 'Counselling' },
  { conceptId: 'custom:trauma-informed-care',             kind: 'Custom',   prefLabel: 'Trauma-informed care' },
  { conceptId: 'custom:youth-mentorship',                 kind: 'Custom',   prefLabel: 'Youth mentorship' },
  { conceptId: 'custom:esl-instruction',                  kind: 'Custom',   prefLabel: 'ESL instruction' },
  // Operations & finance
  { conceptId: 'custom:grant-administration',             kind: 'Custom',   prefLabel: 'Grant administration' },
  { conceptId: 'custom:bookkeeping',                      kind: 'Custom',   prefLabel: 'Bookkeeping' },
  { conceptId: 'custom:program-evaluation',               kind: 'Custom',   prefLabel: 'Program evaluation' },
  { conceptId: 'custom:operations-management',            kind: 'Custom',   prefLabel: 'Operations management' },
  // Mission & ministry
  { conceptId: 'custom:missions-logistics',               kind: 'Custom',   prefLabel: 'Missions logistics' },
  { conceptId: 'custom:church-planting',                  kind: 'Custom',   prefLabel: 'Church planting' },
  { conceptId: 'custom:discipleship',                     kind: 'Custom',   prefLabel: 'Discipleship' },
  { conceptId: 'custom:pastoral-care',                    kind: 'Custom',   prefLabel: 'Pastoral care' },
  // Software & data
  { conceptId: 'custom:software-engineering',             kind: 'Domain',   prefLabel: 'Software engineering' },
  { conceptId: 'custom:typescript',                       kind: 'Custom',   prefLabel: 'TypeScript' },
  { conceptId: 'custom:solidity',                         kind: 'Custom',   prefLabel: 'Solidity' },
  { conceptId: 'custom:data-analysis',                    kind: 'Custom',   prefLabel: 'Data analysis' },
  { conceptId: 'custom:sparql',                           kind: 'Custom',   prefLabel: 'SPARQL' },
  // Governance & legal
  { conceptId: 'custom:board-governance',                 kind: 'Custom',   prefLabel: 'Board governance' },
  { conceptId: 'custom:legal-services-immigration',       kind: 'Custom',   prefLabel: 'Immigration legal services' },
  { conceptId: 'custom:policy-advocacy',                  kind: 'Custom',   prefLabel: 'Policy advocacy' },
  // Capital & business
  { conceptId: 'custom:microfinance',                     kind: 'Custom',   prefLabel: 'Microfinance' },
  { conceptId: 'custom:business-coaching',                kind: 'Custom',   prefLabel: 'Business coaching' },
  { conceptId: 'custom:revenue-share-modelling',          kind: 'Custom',   prefLabel: 'Revenue-share modelling' },
]

const ZERO32: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

export async function seedSkillsOnChain(): Promise<void> {
  const reg = process.env.SKILL_DEFINITION_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!reg) {
    console.log('[skill-seed] SKILL_DEFINITION_REGISTRY_ADDRESS not set — skipping')
    return
  }

  const pc = getPublicClient()
  const wc = getWalletClient()
  const deployer = wc.account?.address
  if (!deployer) throw new Error('[skill-seed] wallet client missing deployer account')

  const client = new SkillDefinitionClient(pc, reg)

  let published = 0
  let skipped = 0
  for (const s of SEEDS) {
    const [scheme, ...rest] = s.conceptId.split(':')
    const conceptId = `${scheme}:${rest.join(':')}`  // pass-through scheme prefix
    const skillId = SkillDefinitionClient.skillIdFor({
      scheme: scheme as 'oasf' | 'custom' | 'skos',
      conceptId,
    })

    try {
      const v = await pc.readContract({
        address: reg, abi: skillDefinitionRegistryAbi,
        functionName: 'latestVersion', args: [skillId],
      }) as bigint
      if (v > 0n) { skipped++; continue }
    } catch { /* fall through to publish */ }

    // Anchor the SKOS subtree by the canonical conceptId hash. v0 doesn't
    // run the URDNA2015 step — for the demo, hashing the prefLabel +
    // conceptId is sufficient to detect drift.
    const conceptHash = keccak256(stringToHex(`${s.prefLabel}|${conceptId}`))
    const ontologyMerkleRoot = keccak256(stringToHex(`skos:${conceptId}`))
    const metadataURI = `https://smartagent.io/skill/${conceptId.replace(':', '/')}`

    try {
      const hash = await wc.writeContract({
        address: reg,
        abi: skillDefinitionRegistryAbi,
        functionName: 'publish',
        args: [
          skillId,
          SkillDefinitionClient.kindHash(s.kind),
          deployer,
          conceptHash,
          ontologyMerkleRoot,
          ZERO32,
          metadataURI,
          0n,
          0n,
        ],
      })
      await pc.waitForTransactionReceipt({ hash })
      published++
    } catch (err) {
      console.warn(`[skill-seed] failed to publish ${conceptId}: ${(err as Error).message}`)
    }
  }
  console.log(`[skill-seed] published ${published} skills, skipped ${skipped} (already on chain)`)
}
