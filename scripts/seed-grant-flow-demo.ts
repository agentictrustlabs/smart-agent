#!/usr/bin/env tsx
/**
 * End-to-end grant-flow demo seed — Maria + Pastor David.
 *
 * Walks the entire spec-002/003/004/006 happy path with the deployer key
 * as a "demo god mode" signer:
 *
 *   1. Deploy pool agent + open it on PoolRegistry
 *   2. Mint USDC to the pool (skips the donor→pool pledge/honor dance — same
 *      end state as if Maria had pledged + honored $30k into the pool)
 *   3. Open a round under that pool with voting window NOW
 *   4. Submit a proposal from David's org with 2 milestones (40/60 bps)
 *   5. Cast votes (Maria + David) — permissionless after spec-006
 *   6. Set round status → 'review' → 'decided'
 *   7. ProposalRegistry.announceAward + GrantProposalRegistry.setStatus('awarded')
 *   8. CommitmentRegistry.commit — donor=pool, recipient=David's person agent
 *   9. Release milestone-1 (40% = $12k) via the delegation rail
 *  10. Record outcome attestation for milestone-1
 *  11. Release milestone-2 (60% = $18k) → commitment.status flips to Completed
 *  12. Record outcome attestation for milestone-2
 *
 * Idempotent at the contract level — re-running computes the same subjects
 * and most calls revert with "already set". Run after a fresh-start:
 *
 *   pnpm tsx scripts/seed-grant-flow-demo.ts
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createWalletClient, createPublicClient, http,
  keccak256, toBytes, toHex, encodeFunctionData, toFunctionSelector,
  type Address, type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// ─── env load ────────────────────────────────────────────────────────
const envFile = path.join(repoRoot, 'apps/web/.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

const RPC = process.env.RPC_URL!
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex
const FACTORY    = process.env.AGENT_FACTORY_ADDRESS as Address
const RESOLVER   = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address
const POOL_REG   = process.env.POOL_REGISTRY_ADDRESS as Address
const FUND_REG   = process.env.FUND_REGISTRY_ADDRESS as Address
const PROP_REG   = process.env.PROPOSAL_REGISTRY_ADDRESS as Address
const VOTE_REG   = process.env.VOTE_REGISTRY_ADDRESS as Address
const GP_REG     = process.env.GRANT_PROPOSAL_REGISTRY_ADDRESS as Address
const COMMIT_REG = process.env.COMMITMENT_REGISTRY_ADDRESS as Address
const USDC       = (process.env.USDC_ADDRESS ?? process.env.MOCK_USDC_ADDRESS) as Address
const DM         = process.env.DELEGATION_MANAGER_ADDRESS as Address
const ENF = {
  allowedTargets: process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address,
  allowedMethods: process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address,
  callDataHash:   process.env.CALLDATA_HASH_ENFORCER_ADDRESS as Address,
  timestamp:      process.env.TIMESTAMP_ENFORCER_ADDRESS as Address,
  value:          process.env.VALUE_ENFORCER_ADDRESS as Address,
}

for (const [k, v] of Object.entries({
  RPC, DEPLOYER_KEY, FACTORY, RESOLVER, POOL_REG, FUND_REG, PROP_REG, VOTE_REG,
  GP_REG, COMMIT_REG, USDC, DM,
})) {
  if (!v) throw new Error(`[seed-grant-flow-demo] missing env: ${k}`)
}

const deployerAccount = privateKeyToAccount(DEPLOYER_KEY)
const wallet = createWalletClient({ account: deployerAccount, chain: foundry, transport: http(RPC) })
const pub = createPublicClient({ chain: foundry, transport: http(RPC) })

// ─── SDK imports ─────────────────────────────────────────────────────
async function loadSdk() {
  return await import(path.join(repoRoot, 'packages/sdk/src/index.ts')) as typeof import('../packages/sdk/src/index.js')
}

// ─── helpers ─────────────────────────────────────────────────────────

async function findAgentByName(target: string): Promise<Address | null> {
  const sdk = await loadSdk()
  const display = keccak256(toBytes('atl:displayName'))
  const count = await pub.readContract({
    address: RESOLVER, abi: sdk.agentAccountResolverAbi, functionName: 'agentCount',
  }) as bigint
  for (let i = 0n; i < count; i++) {
    const addr = await pub.readContract({
      address: RESOLVER, abi: sdk.agentAccountResolverAbi, functionName: 'getAgentAt', args: [i],
    }) as Address
    const name = await pub.readContract({
      address: RESOLVER, abi: sdk.agentAccountResolverAbi, functionName: 'getStringProperty', args: [addr, display],
    }).catch(() => '') as string
    if (name === target) return addr
  }
  return null
}

async function deployAgent(salt: bigint): Promise<Address> {
  const sdk = await loadSdk()
  const tx = await wallet.writeContract({
    address: FACTORY, abi: sdk.agentAccountFactoryAbi,
    functionName: 'createAccount', args: [deployerAccount.address, salt],
  })
  await pub.waitForTransactionReceipt({ hash: tx })
  return await pub.readContract({
    address: FACTORY, abi: sdk.agentAccountFactoryAbi,
    functionName: 'getAddress', args: [deployerAccount.address, salt],
  }) as Address
}

/**
 * Redeem a 1-hop calldata-hash-pinned delegation. Used when we need to
 * call `donor.execute(...)` / `donor.executeBatch(...)` for arbitrary
 * targets — AgentAccount's _requireForExecute gate only accepts
 * EntryPoint, self, or DelegationManager, so we must go through DM.
 */
async function redeemThroughDonor(opts: {
  donor: Address
  calldata: Hex
}) {
  const sdk = await loadSdk()
  const calldataHash = keccak256(opts.calldata)
  const now = Math.floor(Date.now() / 1000)
  const validAfter = now - 60
  const validUntil = now + 600

  // executeBatch selector for AllowedMethods caveat.
  const aaAbi = sdk.agentAccountAbi as readonly { type: string; name?: string; inputs?: unknown[] }[]
  const fnExecuteBatch = aaAbi.find((f) => f.type === 'function' && f.name === 'executeBatch')
  if (!fnExecuteBatch) throw new Error('agentAccountAbi missing executeBatch')
  const ebSelector = toFunctionSelector(fnExecuteBatch as Parameters<typeof toFunctionSelector>[0])

  const caveats = [
    sdk.buildCaveat(ENF.allowedTargets, sdk.encodeAllowedTargetsTerms([opts.donor])),
    sdk.buildCaveat(ENF.allowedMethods, sdk.encodeAllowedMethodsTerms([ebSelector])),
    sdk.buildCaveat(ENF.callDataHash,   sdk.encodeCallDataHashTerms(calldataHash)),
    sdk.buildCaveat(ENF.value,          sdk.encodeValueTerms(0n)),
    sdk.buildCaveat(ENF.timestamp,      sdk.encodeTimestampTerms(validAfter, validUntil)),
  ]
  const salt = BigInt('0x' + crypto.randomUUID().replace(/-/g, ''))
  const chainId = await pub.getChainId()
  const dHash = sdk.hashDelegation(
    {
      delegator: opts.donor,
      delegate: deployerAccount.address,
      authority: sdk.ROOT_AUTHORITY as Hex,
      caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt,
    },
    chainId,
    DM,
  )
  const signature = await deployerAccount.sign({ hash: dHash })
  const tx = await wallet.writeContract({
    address: DM, abi: sdk.delegationManagerAbi,
    functionName: 'redeemDelegation',
    args: [
      [{
        delegator: opts.donor,
        delegate: deployerAccount.address,
        authority: sdk.ROOT_AUTHORITY as Hex,
        caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: (c.args ?? '0x') as Hex })),
        salt,
        signature,
      }],
      opts.donor,
      0n,
      opts.calldata,
    ],
  })
  const receipt = await pub.waitForTransactionReceipt({ hash: tx })
  if (receipt.status !== 'success') throw new Error(`redeemThroughDonor reverted: ${tx}`)
  return tx
}

// ─── main ────────────────────────────────────────────────────────────

async function main() {
  const sdk = await loadSdk()

  console.log('STEP 1 — locate seeded actors')
  const network = await findAgentByName('Catalyst NoCo Network')
  const maria   = await findAgentByName('Maria Gonzalez')
  const david   = await findAgentByName('Pastor David Chen')
  if (!network || !maria || !david) {
    throw new Error(`actors missing: network=${network} maria=${maria} david=${david}`)
  }
  console.log('  Catalyst NoCo Network:', network)
  console.log('  Maria Gonzalez:       ', maria)
  console.log('  Pastor David Chen:    ', david)

  const POOL_SLUG = 'demo-grant-flow-pool'
  const ROUND_SLUG = 'demo-grant-flow-round'

  console.log('\nSTEP 2 — deploy pool agent + open pool')
  const pool = await deployAgent(BigInt(keccak256(toBytes(`pool:${POOL_SLUG}`))))
  console.log('  pool agent:', pool)
  // open pool. Deployer is initial owner of pool → onlyPoolOwner passes.
  try {
    await wallet.writeContract({
      address: POOL_REG, abi: sdk.poolRegistryAbi,
      functionName: 'open',
      args: [{
        poolAgent: pool,
        domain: keccak256(toBytes('demo')),
        governanceModel: keccak256(toBytes('sa:GovFund')),
        mandateHash: keccak256(toBytes('demo-mandate')),
        mandateURI: '',
        acceptedUnits: [keccak256(toBytes('USD'))],
        acceptedKinds: [keccak256(toBytes('CompassionMinistry'))],
        ceilingPolicy: keccak256(toBytes('sa:CeilingAccept')),
        capacityCeiling: 100_000n * 10n ** 6n,
        stewards: [network],
        visibility: keccak256(toBytes('sa:VisibilityPublic')),
        acceptedRestrictions: '{"kinds":["CompassionMinistry"],"geoRoots":["us/colorado"]}',
        slug: POOL_SLUG,
      }],
    })
    console.log('  PoolRegistry.open ✓')
  } catch (e) {
    console.warn('  PoolRegistry.open warning (likely idempotent):', (e as Error).message.slice(0, 120))
  }

  console.log('\nSTEP 3 — fund pool with 30k MockUSDC')
  const TOTAL = 30_000n * 10n ** 6n
  await wallet.writeContract({
    address: USDC, abi: sdk.mockUsdcAbi,
    functionName: 'mint', args: [pool, TOTAL],
  })
  const poolBal = await pub.readContract({
    address: USDC, abi: sdk.mockUsdcAbi, functionName: 'balanceOf', args: [pool],
  }) as bigint
  console.log('  pool USDC balance:', poolBal.toString())

  console.log('\nSTEP 4 — open round (voting window NOW)')
  const roundSubject = keccak256(toBytes(`sa:round:${ROUND_SLUG}`)) as Hex
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  // 30 days out — keeps the round in the default `deadline >= NOW()` list
  // filter while we walk the rest of the lifecycle (vote → decided →
  // committed → released → completed) all in one seed pass.
  const deadline = nowSec + 30n * 86400n
  const decisionDate = nowSec + 31n * 86400n
  try {
    await wallet.writeContract({
      address: FUND_REG, abi: sdk.fundRegistryAbi,
      functionName: 'openRound',
      args: [{
        roundSubject,
        fundAgent: pool,
        poolAgent: pool,
        deadline,
        decisionDate,
        reportingCadence: keccak256(toBytes('sa:CadenceQuarterly')),
        requiredCredentials: [],
        visibility: keccak256(toBytes('sa:VisibilityPublic')),
        initialStatus: keccak256(toBytes('sa:RoundOpen')),
        mandate: '{"acceptedKinds":["CompassionMinistry"],"acceptedGeo":["us/colorado"],"budgetCeiling":30000,"expectedAwards":1,"displayName":"Demo Grant Flow Round"}',
        milestoneTemplate: '{"minMilestones":2,"maxMilestones":2,"trancheHints":{"atKickoff":40,"completion":60}}',
        validatorRequirements: '{}',
        slug: ROUND_SLUG,
      }],
    })
    console.log('  FundRegistry.openRound ✓')
  } catch (e) {
    console.warn('  openRound warning:', (e as Error).message.slice(0, 160))
  }

  // Open voting window immediately. setRoundVotingConfig also bumps to
  // 'review' if needed.
  try {
    await wallet.writeContract({
      address: FUND_REG, abi: sdk.fundRegistryAbi,
      functionName: 'setRoundVotingConfig',
      args: [
        roundSubject,
        keccak256(toBytes('sa:VotingStrategyStewardQuorum')),
        2n, // threshold = 2 approvals
        nowSec, // window starts now
        nowSec + 86400n, // window ends in 24h
      ],
    })
    console.log('  setRoundVotingConfig ✓')
  } catch (e) {
    console.warn('  voting-config warning:', (e as Error).message.slice(0, 160))
  }

  // Bump round to 'review' so vote-cast is allowed semantically.
  try {
    await wallet.writeContract({
      address: FUND_REG, abi: sdk.fundRegistryAbi,
      functionName: 'setRoundStatus',
      args: [roundSubject, keccak256(toBytes('sa:RoundReview'))],
    })
    console.log("  setRoundStatus → 'review' ✓")
  } catch (e) {
    console.warn('  setRoundStatus(review) warning:', (e as Error).message.slice(0, 160))
  }

  console.log('\nSTEP 5 — submit proposal (David as proposer)')
  const proposerNullifier = keccak256(toBytes(`demo-grant-flow:proposer:${david}`)) as Hex
  try {
    await wallet.writeContract({
      address: GP_REG, abi: sdk.grantProposalRegistryAbi,
      functionName: 'submit',
      args: [{
        roundSubject,
        nullifier: proposerNullifier,
        displayName: 'Trauma-care training for Fort Collins families',
        basedOnIntentId: 'urn:smart-agent:need-intent:demo-trauma-care',
        budgetJson: '{"total":30000,"unit":"USD","lineItems":[{"label":"materials","amount":12000,"unit":"USD"},{"label":"trainer time","amount":18000,"unit":"USD"}]}',
        planJson: '{"narrative":"3 month rollout, 4 trauma-informed sessions per month, in partnership with Wellington + Berthoud circles."}',
        milestonesJson: JSON.stringify([
          { id: 'm1', name: 'Kickoff + first cohort', trancheBps: 4000 },
          { id: 'm2', name: 'Final report + outcomes', trancheBps: 6000 },
        ]),
        outcomesJson: '{"desired":["12 caregivers trained","8 community sessions delivered","trauma-informed peer network seeded"]}',
        reportingJson: '{"cadence":"quarterly"}',
        orgBackgroundJson: '{"narrative":"Pastor David has led Fort Collins Network outreach for 6 years."}',
        basisJson: '{"proximityHops":1,"composite":0.82}',
      }],
    })
    console.log('  GrantProposalRegistry.submit ✓')
  } catch (e) {
    console.warn('  submit warning:', (e as Error).message.slice(0, 200))
  }

  // Compute the proposalSubject for the new spec-003 GrantProposalRegistry.
  const gpSubject = keccak256(
    new Uint8Array([
      ...toBytes('sa:grantProposal:'),
      ...toBytes(roundSubject),
      ...toBytes(proposerNullifier),
    ]),
  ) as Hex
  console.log('  gp subject:', gpSubject)

  // Also compute the spec-001 ProposalRegistry's proposalSubject (used by
  // announceAward). It's keccak256("sa:proposal:" || slug); we use the
  // gpSubject hex (no slug) here, which mirrors the close-route handler's
  // fallback path. For the demo we just reuse a synthetic slug.
  const proposalSlug = `${ROUND_SLUG}-david`
  const proposalSubject = await pub.readContract({
    address: PROP_REG, abi: sdk.proposalRegistryAbi,
    functionName: 'proposalSubject', args: [proposalSlug],
  }) as Hex
  console.log('  proposal subject (spec-001):', proposalSubject)

  console.log('\nSTEP 6 — cast votes (Maria + David, both Approve)')
  for (const [name, voter] of [['Maria', maria], ['David', david]] as const) {
    const voterNullifier = keccak256(toBytes(`demo-grant-flow:vote:${voter}`)) as Hex
    try {
      await wallet.writeContract({
        address: VOTE_REG, abi: sdk.voteRegistryAbi,
        functionName: 'castVote',
        args: [{
          roundSubject,
          nullifier: voterNullifier,
          proposalSubject: gpSubject,
          ballot: keccak256(toBytes('sa:Approve')),
          weight: 1n,
          rationale: `${name} approves — strong fit with the trauma-care need.`,
        }],
      })
      console.log(`  ${name} vote ✓`)
    } catch (e) {
      console.warn(`  ${name} vote warning:`, (e as Error).message.slice(0, 160))
    }
  }

  console.log("\nSTEP 7 — set round status → 'decided'")
  try {
    await wallet.writeContract({
      address: FUND_REG, abi: sdk.fundRegistryAbi,
      functionName: 'setRoundStatus',
      args: [roundSubject, keccak256(toBytes('sa:RoundDecided'))],
    })
    console.log('  status decided ✓')
  } catch (e) {
    console.warn('  decided warning:', (e as Error).message.slice(0, 160))
  }

  console.log('\nSTEP 8 — announceAward + flip grant proposal status')
  try {
    await wallet.writeContract({
      address: PROP_REG, abi: sdk.proposalRegistryAbi,
      functionName: 'announceAward',
      args: [{
        proposalSubject,
        kind: keccak256(toBytes('sa:GivingKind')),
        basedOnIntentId: keccak256(toBytes('urn:smart-agent:need-intent:demo-trauma-care')),
        round: roundSubject,
        proposer: david,
        recipient: david,
        totalAwarded: TOTAL,
        bodyHash: keccak256(toBytes(proposalSlug)),
        awardingFund: pool,
        status: keccak256(toBytes('sa:ProposalAwarded')),
        needIntentIdString: 'urn:smart-agent:need-intent:demo-trauma-care',
      }],
    })
    console.log('  announceAward ✓')
  } catch (e) {
    console.warn('  announceAward warning:', (e as Error).message.slice(0, 200))
  }
  try {
    await wallet.writeContract({
      address: GP_REG, abi: sdk.grantProposalRegistryAbi,
      functionName: 'setStatus',
      args: [gpSubject, keccak256(toBytes('sa:GpAwarded'))],
    })
    console.log('  GP status → awarded ✓')
  } catch (e) {
    console.warn('  GP setStatus warning:', (e as Error).message.slice(0, 160))
  }

  console.log('\nSTEP 9 — commit on CommitmentRegistry (donor=pool, recipient=David)')
  const sourceKind = keccak256(toBytes('sa:CommitmentSourceAward'))
  try {
    await wallet.writeContract({
      address: COMMIT_REG, abi: sdk.commitmentRegistryAbi,
      functionName: 'commit',
      args: [{
        sourceKind,
        sourceSubject: proposalSubject,
        round: roundSubject,
        donor: pool,
        recipient: david,
        token: USDC,
        totalAmount: TOTAL,
        needIntentId: 'urn:smart-agent:need-intent:demo-trauma-care',
        offerIntentId: 'urn:smart-agent:offer-intent:demo-grant-flow-pool',
        milestonesJson: '[{"id":"m1","label":"Kickoff","trancheBps":4000},{"id":"m2","label":"Final","trancheBps":6000}]',
      }],
    })
    console.log('  commit ✓')
  } catch (e) {
    console.warn('  commit warning:', (e as Error).message.slice(0, 200))
  }
  const commitmentSubject = keccak256(
    new Uint8Array([
      ...toBytes('sa:commitment:'),
      ...toBytes(sourceKind),
      ...toBytes(proposalSubject),
      ...toBytes(pool.toLowerCase() as `0x${string}`),
    ]),
  ) as Hex
  console.log('  commitment subject:', commitmentSubject)

  console.log('\nSTEP 10 — release milestone-1 (40% = $12k) via delegation rail')
  const m1Amount = (TOTAL * 4000n) / 10000n
  const m1Id = keccak256(toBytes('m1'))
  await releaseTranche({
    pool, recipient: david, amount: m1Amount,
    milestoneId: m1Id, commitmentSubject, sdk,
  })
  console.log('  m1 released; recipient USDC:', (await pub.readContract({
    address: USDC, abi: sdk.mockUsdcAbi, functionName: 'balanceOf', args: [david],
  }) as bigint).toString())

  console.log('\nSTEP 11 — record outcome for milestone-1')
  try {
    await wallet.writeContract({
      address: COMMIT_REG, abi: sdk.commitmentRegistryAbi,
      functionName: 'recordOutcome',
      args: [commitmentSubject, keccak256(toBytes('outcome:m1:cohort-1-trained')), keccak256(toBytes('evidence:m1:cohort1-report.pdf'))],
    })
    console.log('  outcome m1 ✓')
  } catch (e) {
    console.warn('  outcome m1 warning:', (e as Error).message.slice(0, 160))
  }

  console.log('\nSTEP 12 — release milestone-2 (60% = $18k)')
  const m2Amount = TOTAL - m1Amount
  const m2Id = keccak256(toBytes('m2'))
  await releaseTranche({
    pool, recipient: david, amount: m2Amount,
    milestoneId: m2Id, commitmentSubject, sdk,
  })

  console.log('\nSTEP 13 — record outcome for milestone-2 (completion)')
  try {
    await wallet.writeContract({
      address: COMMIT_REG, abi: sdk.commitmentRegistryAbi,
      functionName: 'recordOutcome',
      args: [commitmentSubject, keccak256(toBytes('outcome:m2:final-report-published')), keccak256(toBytes('evidence:m2:final-report.pdf'))],
    })
    console.log('  outcome m2 ✓')
  } catch (e) {
    console.warn('  outcome m2 warning:', (e as Error).message.slice(0, 160))
  }

  // ─── Final state ────────────────────────────────────────────────
  const c = await pub.readContract({
    address: COMMIT_REG, abi: sdk.commitmentRegistryAbi,
    functionName: 'getCommitment', args: [commitmentSubject],
  }) as readonly [Hex, Hex, Address, Address, Address, bigint, bigint, Hex]
  const rBal = await pub.readContract({
    address: USDC, abi: sdk.mockUsdcAbi, functionName: 'balanceOf', args: [david],
  }) as bigint
  const pBal = await pub.readContract({
    address: USDC, abi: sdk.mockUsdcAbi, functionName: 'balanceOf', args: [pool],
  }) as bigint

  console.log('\n══════ FINAL STATE ══════')
  console.log(`commitment status hash: ${c[7]}`)
  const completedHash = keccak256(toBytes('sa:CommitmentCompleted'))
  console.log(`commitment Completed?   ${c[7].toLowerCase() === completedHash.toLowerCase() ? '✓ YES' : '✗ NO'}`)
  console.log(`commitment total:       ${c[5].toString()}`)
  console.log(`commitment released:    ${c[6].toString()}`)
  console.log(`recipient (David) USDC: ${rBal.toString()}  (expected ${TOTAL.toString()})`)
  console.log(`pool USDC remaining:    ${pBal.toString()}  (expected 0)`)
  console.log()
  console.log('Web URLs to visit:')
  console.log(`  Round detail:      http://localhost:3000/h/catalyst/rounds/${ROUND_SLUG}`)
  console.log(`  Pool detail:       http://localhost:3000/h/catalyst/pools/${POOL_SLUG}`)
  console.log(`  Network graph:     http://localhost:3000/agents`)

  // Trigger GraphDB sync so the UI reflects the new round/pool/commitment.
  try {
    await fetch('http://localhost:3000/api/ontology-sync', { method: 'POST' })
    console.log('  GraphDB sync kicked')
  } catch { /* dev-server may not be up */ }
}

async function releaseTranche(opts: {
  pool: Address
  recipient: Address
  amount: bigint
  milestoneId: Hex
  commitmentSubject: Hex
  sdk: Awaited<ReturnType<typeof loadSdk>>
}) {
  const { sdk } = opts
  const transferData = encodeFunctionData({
    abi: sdk.mockUsdcAbi, functionName: 'transfer', args: [opts.recipient, opts.amount],
  })
  const recordData = encodeFunctionData({
    abi: sdk.commitmentRegistryAbi, functionName: 'recordRelease',
    args: [opts.commitmentSubject, opts.milestoneId, opts.amount],
  })
  const callData = encodeFunctionData({
    abi: sdk.agentAccountAbi, functionName: 'executeBatch',
    args: [[
      { target: USDC,       value: 0n, data: transferData },
      { target: COMMIT_REG, value: 0n, data: recordData },
    ]],
  })
  try {
    await redeemThroughDonor({ donor: opts.pool, calldata: callData })
    console.log('  release ✓')
  } catch (e) {
    console.warn('  release error:', (e as Error).message.slice(0, 240))
  }
}

main().catch((e) => { console.error('demo seed failed:', e); process.exit(1) })
