/**
 * Spec 004 — register on-chain ontology predicates for the four new
 * marketplace registries. The catalyst Deploy.s.sol seeds ontology
 * for PoolRegistry / FundRegistry / ProposalRegistry but NOT for the
 * new spec-004 registries (VoteRegistry, GrantProposalRegistry,
 * PledgeRegistry, MatchInitiationRegistry). Without these predicates
 * registered as "active" in OntologyTermRegistry, AttributeStorage
 * reverts every write with `PredicateNotActive()`.
 *
 * This one-off backfill walks each registry's predicate list (sourced
 * from the contracts themselves) and registers each curie + uri + label
 * + datatype against the deployer EOA (governor). Safe to re-run — the
 * underlying call no-ops on already-registered terms.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

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

const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8545'
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex
const ONTOLOGY = process.env.ONTOLOGY_REGISTRY_ADDRESS as Address
const SHAPES = process.env.SHAPE_REGISTRY_ADDRESS as Address

if (!DEPLOYER_KEY || !ONTOLOGY || !SHAPES) {
  console.error('seed-spec004-ontology: DEPLOYER_PRIVATE_KEY + ONTOLOGY_REGISTRY_ADDRESS + SHAPE_REGISTRY_ADDRESS required in apps/web/.env')
  process.exit(1)
}

const account = privateKeyToAccount(DEPLOYER_KEY)
const wallet = createWalletClient({ account, chain: foundry, transport: http(RPC_URL) })
const pub = createPublicClient({ chain: foundry, transport: http(RPC_URL) })

const registerTermAbi = [
  {
    type: 'function',
    name: 'registerTerm',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'curie', type: 'string' },
      { name: 'uri', type: 'string' },
      { name: 'label', type: 'string' },
      { name: 'datatype', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isTermRegistered',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const

/** Walks each registry's predicate curies. Datatype is informational —
 *  AttributeStorage only checks `term.active`, not the type string. */
const TERMS: Array<{ curie: string; datatype: string }> = [
  // VoteRegistry
  { curie: 'sa:voteRound',        datatype: 'bytes32' },
  { curie: 'sa:voteProposal',     datatype: 'bytes32' },
  { curie: 'sa:voteBallot',       datatype: 'bytes32' },
  { curie: 'sa:voteNullifier',    datatype: 'bytes32' },
  { curie: 'sa:voteWeight',       datatype: 'uint256' },
  { curie: 'sa:voteCastAt',       datatype: 'uint256' },
  { curie: 'sa:voteUpdatedAt',    datatype: 'uint256' },
  { curie: 'sa:voteRationale',    datatype: 'string' },
  // GrantProposalRegistry
  { curie: 'sa:gpRound',          datatype: 'bytes32' },
  { curie: 'sa:gpNullifier',      datatype: 'bytes32' },
  { curie: 'sa:gpDisplayName',    datatype: 'string' },
  { curie: 'sa:gpBasedOn',        datatype: 'string' },
  { curie: 'sa:gpLastEdited',     datatype: 'uint256' },
  { curie: 'sa:gpClonedFrom',     datatype: 'bytes32' },
  { curie: 'sa:gpBudget',         datatype: 'string' },
  { curie: 'sa:gpPlan',           datatype: 'string' },
  { curie: 'sa:gpMilestones',     datatype: 'string' },
  { curie: 'sa:gpOutcomes',       datatype: 'string' },
  { curie: 'sa:gpReporting',      datatype: 'string' },
  { curie: 'sa:gpOrgBackground',  datatype: 'string' },
  { curie: 'sa:gpBasis',          datatype: 'string' },
  { curie: 'sa:gpStatus',         datatype: 'bytes32' },
  { curie: 'sa:gpVersion',        datatype: 'uint256' },
  { curie: 'sa:gpSubmittedAt',    datatype: 'uint256' },
  { curie: 'sa:gpWithdrawnAt',    datatype: 'uint256' },
  // Spec 005 / Rail-A — recipient AgentAccount receiving funds at award
  // time. GrantProposalRegistry.submit() writes `_setAddress(... SA_GP_RECIPIENT ...)`
  // so the predicate must be active in OntologyTermRegistry; otherwise
  // AttributeStorage reverts with PredicateNotActive() (selector 0x898efc7c).
  { curie: 'sa:gpRecipient',      datatype: 'address' },
  // PledgeRegistry
  { curie: 'sa:pledgePool',          datatype: 'address' },
  { curie: 'sa:pledgeNullifier',     datatype: 'bytes32' },
  { curie: 'sa:pledgeAmount',        datatype: 'uint256' },
  { curie: 'sa:pledgeUnit',          datatype: 'bytes32' },
  { curie: 'sa:pledgeCadence',       datatype: 'bytes32' },
  { curie: 'sa:pledgeDuration',      datatype: 'uint256' },
  { curie: 'sa:pledgeRestrictions',  datatype: 'string' },
  { curie: 'sa:pledgeStoryPermissions', datatype: 'string' },
  { curie: 'sa:pledgePledgedAt',     datatype: 'uint256' },
  { curie: 'sa:pledgeStoppedAt',     datatype: 'uint256' },
  { curie: 'sa:pledgeStatus',        datatype: 'bytes32' },
  { curie: 'sa:pledgeDonor',         datatype: 'address' },
  // FundRegistry R10 — voting config attrs moved on chain.
  { curie: 'sa:roundVotingStrategy',         datatype: 'bytes32' },
  { curie: 'sa:roundVotingThreshold',        datatype: 'uint256' },
  { curie: 'sa:roundVotingWindowStartsAt',   datatype: 'uint256' },
  { curie: 'sa:roundVotingWindowEndsAt',     datatype: 'uint256' },
  // MatchInitiationRegistry
  { curie: 'sa:miViewedIntent',         datatype: 'string' },
  { curie: 'sa:miCandidateIntent',      datatype: 'string' },
  { curie: 'sa:miInitiatorNullifier',   datatype: 'bytes32' },
  { curie: 'sa:miInitiationKind',       datatype: 'bytes32' },
  { curie: 'sa:miVisibility',           datatype: 'bytes32' },
  { curie: 'sa:miStatus',               datatype: 'bytes32' },
  { curie: 'sa:miBasis',                datatype: 'string' },
  { curie: 'sa:miProposedAt',           datatype: 'uint256' },
  { curie: 'sa:miUpdatedAt',            datatype: 'uint256' },
  // Spec 005 — Pledge Honor (per SPEC005_PLEDGE_HONOR_AUDIT § 5).
  // AgentAccountResolver predicate linking person agent → personal treasury account.
  { curie: 'sa:hasPersonalTreasury',         datatype: 'address' },
  // PledgeRegistry — settlement extensions. Composite-subject pattern; see audit § 1.2.
  { curie: 'sa:pledgeHonoredAmount',         datatype: 'uint256' },
  { curie: 'sa:pledgeExternallyPaidAmount',  datatype: 'uint256' },
  { curie: 'sa:pledgeHonorTokenList',        datatype: 'bytes32-array' },
  { curie: 'sa:pledgeLastHonoredAt',         datatype: 'uint256' },
  { curie: 'sa:pledgeLastMarkedAt',          datatype: 'uint256' },
  { curie: 'sa:pledgePaymentRail',           datatype: 'bytes32' },
  { curie: 'sa:pledgeEvidenceHash',          datatype: 'bytes32' },
  { curie: 'sa:pledgeMarkedByAgent',         datatype: 'address' },
  // Spec 006 — CommitmentRegistry. Universal match-fulfillment artifact.
  // Lineage / context predicates.
  { curie: 'sa:commitmentSourceKind',     datatype: 'bytes32' },
  { curie: 'sa:commitmentSourceSubject',  datatype: 'bytes32' },
  { curie: 'sa:commitmentRound',          datatype: 'bytes32' },
  { curie: 'sa:commitmentNeedIntent',     datatype: 'string'  },
  { curie: 'sa:commitmentOfferIntent',    datatype: 'string'  },
  // Parties.
  { curie: 'sa:commitmentDonor',          datatype: 'address' },
  { curie: 'sa:commitmentRecipient',      datatype: 'address' },
  // Terms.
  { curie: 'sa:commitmentToken',          datatype: 'address' },
  { curie: 'sa:commitmentTotalAmount',    datatype: 'uint256' },
  { curie: 'sa:commitmentMilestonesJson', datatype: 'string'  },
  // State.
  { curie: 'sa:commitmentReleasedAmount', datatype: 'uint256' },
  { curie: 'sa:commitmentStatus',         datatype: 'bytes32' },
  { curie: 'sa:commitmentCommittedAt',    datatype: 'uint256' },
  { curie: 'sa:commitmentUpdatedAt',      datatype: 'uint256' },
  { curie: 'sa:commitmentCancelReason',   datatype: 'bytes32' },
  // Per-milestone release + per-outcome attestation (composite subjects).
  { curie: 'sa:milestoneReleased',        datatype: 'uint256' },
  { curie: 'sa:milestoneReleasedAt',      datatype: 'uint256' },
  { curie: 'sa:outcomeEvidenceHash',      datatype: 'bytes32' },
  { curie: 'sa:outcomeRecordedAt',        datatype: 'uint256' },
  { curie: 'sa:outcomeRecordedBy',        datatype: 'address' },
  // AgentAccount predicate — generic treasury pointer (org + person).
  // Spec 006 resolveRecipientTreasury reads this first, then falls back
  // to sa:hasPersonalTreasury, then self.
  { curie: 'sa:hasTreasury',              datatype: 'address' },
  // Spec 006 — ProposalRegistry.announceAward extension. Stores the
  // originating NeedIntent IRI as a string so the commit-from-award path
  // can populate sa:commitmentNeedIntent without re-walking the proposal.
  { curie: 'sa:awardNeedIntent',          datatype: 'string'  },
]

const shapeRegistryAbi = [
  {
    type: 'function',
    name: 'defineShape',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'classId', type: 'bytes32' },
      {
        name: 'props',
        type: 'tuple[]',
        components: [
          { name: 'predicate', type: 'bytes32' },
          { name: 'expectedDatatype', type: 'uint8' },
          { name: 'cardinality', type: 'uint8' },
          { name: 'enumSetId', type: 'bytes32' },
          { name: 'expectedClass', type: 'bytes32' },
        ],
      },
      { name: 'shapeURI', type: 'string' },
      { name: 'shapeHash', type: 'bytes32' },
    ],
    outputs: [{ type: 'uint16' }],
  },
  {
    type: 'function',
    name: 'shapeExists',
    stateMutability: 'view',
    inputs: [{ name: 'classId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const

const SHAPE_CLASSES: string[] = [
  'sa:Vote',
  'sa:GrantProposal',
  'sa:Pledge',
  'sa:MatchInitiation',
  'sa:Commitment',
]

async function defineSpec004Shapes() {
  console.log(`[seed-spec004-ontology] defining ${SHAPE_CLASSES.length} shapes in ${SHAPES}`)
  let defined = 0
  let skipped = 0
  for (const curie of SHAPE_CLASSES) {
    const classId = keccak256(toBytes(curie))
    try {
      const exists = await pub.readContract({
        address: SHAPES,
        abi: shapeRegistryAbi,
        functionName: 'shapeExists',
        args: [classId],
      })
      if (exists) { skipped++; continue }
    } catch { /* not present; try define */ }
    try {
      // Empty property list — validateSubject becomes a no-op for these
      // classes (no required keys). Predicate-level ACL still enforced by
      // OntologyTermRegistry. Demo-only shortcut; production would
      // require fully shaped constraints (see Deploy.s.sol patterns).
      await wallet.writeContract({
        address: SHAPES,
        abi: shapeRegistryAbi,
        functionName: 'defineShape',
        args: [
          classId,
          [],
          `https://agentictrust.io/ontology/tbox/shacl/${curie.replace(':', '-')}.ttl`,
          keccak256(toBytes(`${curie}.v1`)),
        ],
        account,
        chain: foundry,
      })
      defined++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('ShapeAlreadyDefined')) {
        skipped++
      } else {
        console.error(`  ✗ shape ${curie}: ${msg.slice(0, 200)}`)
      }
    }
  }
  console.log(`[seed-spec004-ontology] shapes done — defined=${defined} skipped=${skipped}`)
}

async function main() {
  console.log(`[seed-spec004-ontology] registering ${TERMS.length} terms in ${ONTOLOGY}`)
  let registered = 0
  let skipped = 0
  for (const t of TERMS) {
    const id = keccak256(toBytes(t.curie))
    try {
      const exists = await pub.readContract({
        address: ONTOLOGY,
        abi: registerTermAbi,
        functionName: 'isTermRegistered',
        args: [id],
      })
      if (exists) {
        skipped++
        continue
      }
    } catch {
      // isTermRegistered might not be present; fall through to attempt registration
    }
    try {
      await wallet.writeContract({
        address: ONTOLOGY,
        abi: registerTermAbi,
        functionName: 'registerTerm',
        args: [
          id,
          t.curie,
          `https://agentictrust.io/ontology/sa#${t.curie}`,
          t.curie,
          t.datatype,
        ],
        account,
        chain: foundry,
      })
      registered++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('TermExists')) {
        skipped++
      } else {
        console.error(`  ✗ ${t.curie}: ${msg.slice(0, 200)}`)
      }
    }
  }
  console.log(`[seed-spec004-ontology] terms done — registered=${registered} skipped=${skipped}`)
  await defineSpec004Shapes()
}

main().catch((err) => {
  console.error('[seed-spec004-ontology] fatal:', err)
  process.exit(1)
})
