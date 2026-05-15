#!/usr/bin/env tsx
/**
 * End-to-end grant-flow demo seed — narrative version.
 *
 *   Pastor David expresses a NeedIntent for trauma-care training.
 *   Maria Gonzalez pledges $30k from her treasury to a pool she opens
 *   under Catalyst NoCo Network and honors the pledge (USDC moves on
 *   chain donor → pool). She opens a round; David submits a grant
 *   proposal anchored to his intent. Both vote Approve. The round closes
 *   and a commitment is created with recipient = Fort Collins Network
 *   Treasury (David's org's separate Treasury Service Agent). Maria,
 *   acting as pool steward, signs the release delegation for each
 *   milestone — money moves pool → David's org treasury — and outcome
 *   attestations close the loop.
 *
 *   Run after `./scripts/fresh-start.sh`:
 *     pnpm exec tsx scripts/seed-grant-flow-demo.ts
 *
 * Idempotent at the SQL layer (intent INSERT OR IGNORE on stable UUID).
 * Not fully idempotent at the contract layer — re-running on existing
 * state will trip MilestoneAlreadyReleased on the second release pass.
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
const PLEDGE_REG = process.env.PLEDGE_REGISTRY_ADDRESS as Address
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
  GP_REG, COMMIT_REG, PLEDGE_REG, USDC, DM,
})) {
  if (!v) throw new Error(`[seed-grant-flow-demo] missing env: ${k}`)
}

// IMPORTANT — per the no-deployer rule, deployerAccount is used ONLY for
// the anvil_setBalance cheat below (which doesn't sign anything). All
// contract calls in the scenario are signed by Maria / Sarah / David's
// own EOAs.
const deployerAccount = privateKeyToAccount(DEPLOYER_KEY)
const wallet = createWalletClient({ account: deployerAccount, chain: foundry, transport: http(RPC) })
const pub = createPublicClient({ chain: foundry, transport: http(RPC) })

/**
 * Anvil cheatcode — fund an EOA with ETH directly without anyone signing.
 * We use this so demo actors (Maria, Sarah, David) can pay gas for their
 * own transactions without the deployer ever signing on their behalf.
 */
async function fundEoa(addr: Address, ethAmount: bigint): Promise<void> {
  const hex = `0x${ethAmount.toString(16)}` as `0x${string}`
  try {
    await wallet.transport.request({
      method: 'anvil_setBalance',
      params: [addr, hex] as unknown as never,
    })
  } catch {
    // Already funded / non-anvil chain — ignore.
  }
}

// ─── Run counter ─────────────────────────────────────────────────────
// Each invocation gets a fresh sequence number so the seeded artifacts
// (pool slug, round slug, display names, David's intent id) are visually
// distinct from prior runs. The counter persists in
// `tmp/seed-grant-flow-demo.counter` — `rm` it (or pass SEED_RUN_INDEX=N)
// to reset.
function nextRunIndex(): number {
  const counterDir = path.join(repoRoot, 'tmp')
  const counterPath = path.join(counterDir, 'seed-grant-flow-demo.counter')
  if (!fs.existsSync(counterDir)) fs.mkdirSync(counterDir, { recursive: true })
  const override = process.env.SEED_RUN_INDEX
  if (override) {
    const n = parseInt(override, 10)
    if (Number.isFinite(n) && n > 0) {
      fs.writeFileSync(counterPath, String(n), 'utf8')
      return n
    }
  }
  let prev = 0
  try { prev = parseInt(fs.readFileSync(counterPath, 'utf8').trim(), 10) || 0 } catch { /* first run */ }
  const next = prev + 1
  fs.writeFileSync(counterPath, String(next), 'utf8')
  return next
}
const RUN = nextRunIndex()
const RUN_LABEL = `#${RUN}`
const RUN_SUFFIX = String(RUN).padStart(3, '0')

// IDs derived from the run counter — each run produces a distinct,
// non-colliding set of subjects on chain.
const POOL_SLUG = `demo-grant-flow-pool-${RUN_SUFFIX}`
const ROUND_SLUG = `demo-grant-flow-round-${RUN_SUFFIX}`
const DAVID_INTENT_UUID = `demo-david-trauma-care-${RUN_SUFFIX}`
const POOL_DISPLAY_NAME = `Demo Grant Flow Pool ${RUN_LABEL}`
const ROUND_DISPLAY_NAME = `Demo Grant Flow Round ${RUN_LABEL}`
const PROPOSAL_DISPLAY_NAME = `Trauma-care training for Fort Collins families ${RUN_LABEL}`

async function loadSdk() {
  return await import(path.join(repoRoot, 'packages/sdk/src/index.ts')) as typeof import('../packages/sdk/src/index.js')
}

// ─── DB helpers ──────────────────────────────────────────────────────

async function loadUser(userId: string): Promise<{
  name: string
  privateKey: Hex
  personAgent: Address
  smartAccount: Address
}> {
  const Database = (await import(path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')) as { default: new (path: string) => unknown }).default as new (p: string) => {
    prepare: (sql: string) => { get: (params: unknown) => unknown }
    close: () => void
  }
  const db = new Database(path.join(repoRoot, 'apps/web/local.db'))
  const row = db.prepare(
    'SELECT name, private_key as privateKey, person_agent_address as personAgent, smart_account_address as smartAccount FROM local_user_accounts WHERE id = ?',
  ).get(userId) as { name: string; privateKey: string; personAgent: string; smartAccount: string }
  db.close()
  return {
    name: row.name,
    privateKey: row.privateKey as Hex,
    personAgent: row.personAgent as Address,
    smartAccount: row.smartAccount as Address,
  }
}

async function insertDavidIntent(davidPrincipal: Address): Promise<void> {
  const Database = (await import(path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')) as { default: new (path: string) => unknown }).default as new (p: string) => {
    prepare: (sql: string) => { run: (params: unknown) => void }
    close: () => void
  }
  const db = new Database(path.join(repoRoot, 'apps/person-mcp/person-mcp.db'))
  const now = new Date().toISOString()
  // INSERT OR REPLACE so re-runs stay clean.
  db.prepare(`
    INSERT OR REPLACE INTO intents
      (id, principal, direction, visibility, kind, addressed_to, summary, context,
       status, priority, expires_at, on_chain_assertion_id, live_acknowledgement_count,
       created_at, updated_at)
    VALUES (@id, @principal, 'receive', 'public', 'Money', NULL, @summary, @context,
            'expressed', 'high', NULL, NULL, 0, @now, @now)
  `).run({
    id: DAVID_INTENT_UUID,
    principal: davidPrincipal.toLowerCase(),
    summary: `Need funding for trauma-informed care training for Fort Collins families ${RUN_LABEL}`,
    context: JSON.stringify({
      problem: '3-month rollout, 4 sessions/month, partnering with Wellington + Berthoud circles',
      budgetUSD: 30000,
      milestones: ['Kickoff + first cohort', 'Final report + outcomes'],
    }),
    now,
  })
  // Also insert a needs row (projection of receive-direction intents).
  db.prepare(`
    INSERT OR REPLACE INTO needs (id, principal, intent_id, kind, requirements, status, visibility, geo, capacity_needed, on_chain_assertion_id, created_at)
    VALUES (@id, @principal, @intentId, 'Money', NULL, 'open', 'public', 'us/colorado', 30000, NULL, @now)
  `).run({
    id: `${DAVID_INTENT_UUID}-need`,
    principal: davidPrincipal.toLowerCase(),
    intentId: DAVID_INTENT_UUID,
    now,
  })
  db.close()
}

// ─── chain helpers ───────────────────────────────────────────────────

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

/**
 * Redeem a 1-hop calldata-hash-pinned delegation. Caller specifies which
 * EOA signs the delegation — that EOA must already be an owner of `donor`.
 */
async function redeemThroughDonor(opts: {
  donor: Address
  calldata: Hex
  signerKey: Hex
  label: string
}) {
  const sdk = await loadSdk()
  const signer = privateKeyToAccount(opts.signerKey)
  const signerWallet = createWalletClient({ account: signer, chain: foundry, transport: http(RPC) })
  const calldataHash = keccak256(opts.calldata)
  const now = Math.floor(Date.now() / 1000)
  const aaAbi = sdk.agentAccountAbi as readonly { type: string; name?: string; inputs?: unknown[] }[]
  const fnExecuteBatch = aaAbi.find((f) => f.type === 'function' && f.name === 'executeBatch')
  if (!fnExecuteBatch) throw new Error('agentAccountAbi missing executeBatch')
  const ebSelector = toFunctionSelector(fnExecuteBatch as Parameters<typeof toFunctionSelector>[0])
  const caveats = [
    sdk.buildCaveat(ENF.allowedTargets, sdk.encodeAllowedTargetsTerms([opts.donor])),
    sdk.buildCaveat(ENF.allowedMethods, sdk.encodeAllowedMethodsTerms([ebSelector])),
    sdk.buildCaveat(ENF.callDataHash,   sdk.encodeCallDataHashTerms(calldataHash)),
    sdk.buildCaveat(ENF.value,          sdk.encodeValueTerms(0n)),
    sdk.buildCaveat(ENF.timestamp,      sdk.encodeTimestampTerms(now - 60, now + 600)),
  ]
  const salt = BigInt('0x' + crypto.randomUUID().replace(/-/g, ''))
  const chainId = await pub.getChainId()
  const dHash = sdk.hashDelegation(
    {
      delegator: opts.donor,
      delegate: signer.address,
      authority: sdk.ROOT_AUTHORITY as Hex,
      caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt,
    },
    chainId,
    DM,
  )
  const signature = await signer.sign({ hash: dHash })
  const tx = await signerWallet.writeContract({
    address: DM, abi: sdk.delegationManagerAbi,
    functionName: 'redeemDelegation',
    args: [
      [{
        delegator: opts.donor,
        delegate: signer.address,
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
  if (receipt.status !== 'success') throw new Error(`[${opts.label}] redeem reverted: ${tx}`)
  return tx
}

// ─── main ────────────────────────────────────────────────────────────

async function main() {
  const sdk = await loadSdk()
  const SA_HAS_TREASURY = keccak256(toBytes('sa:hasTreasury'))

  console.log(`════ seed-grant-flow-demo run ${RUN_LABEL} ════`)
  console.log(`  pool slug:    ${POOL_SLUG}`)
  console.log(`  round slug:   ${ROUND_SLUG}`)
  console.log(`  intent UUID:  ${DAVID_INTENT_UUID}`)
  console.log('')

  console.log('STEP 1 — load actors')
  const maria = await loadUser('cat-user-001')
  const david = await loadUser('cat-user-002')
  const sarah = await loadUser('cat-user-005')  // validator
  const network = await findAgentByName('Catalyst NoCo Network')
  const fortCollins = await findAgentByName('Fort Collins Network')
  if (!network || !fortCollins) throw new Error('Catalyst NoCo Network or Fort Collins Network not found')
  const davidOrgTreasury = await pub.readContract({
    address: RESOLVER, abi: sdk.agentAccountResolverAbi,
    functionName: 'getAddressProperty', args: [fortCollins, SA_HAS_TREASURY],
  }) as Address
  if (davidOrgTreasury === '0x0000000000000000000000000000000000000000') {
    throw new Error('Fort Collins Network has no sa:hasTreasury — re-run fresh-start')
  }
  console.log('  Maria (steward):  ', maria.smartAccount, '(EOA:', maria.personAgent.slice(0, 10) + '…)')
  console.log('  David (proposer): ', david.smartAccount, '(EOA:', david.personAgent.slice(0, 10) + '…)')
  console.log('  Sarah (validator):', sarah.smartAccount, '(EOA:', sarah.personAgent.slice(0, 10) + '…)')

  // Fund each actor's signing EOA with 10 ETH via anvil cheatcode — no
  // deployer signing involved. Each actor will sign their own txs.
  const TEN_ETH = 10n * 10n ** 18n
  const mariaEoa = privateKeyToAccount(maria.privateKey).address
  const davidEoa = privateKeyToAccount(david.privateKey).address
  const sarahEoa = privateKeyToAccount(sarah.privateKey).address
  await fundEoa(mariaEoa, TEN_ETH)
  await fundEoa(davidEoa, TEN_ETH)
  await fundEoa(sarahEoa, TEN_ETH)
  console.log(`  funded Maria/David/Sarah EOAs via anvil_setBalance`)
  console.log('  Catalyst NoCo Network:', network)
  console.log('  Fort Collins Network:', fortCollins)
  console.log('  Fort Collins Treasury (recipient):', davidOrgTreasury)

  console.log('\nSTEP 2 — insert David\'s NeedIntent into person-mcp')
  await insertDavidIntent(david.smartAccount)
  console.log(`  intent id: ${DAVID_INTENT_UUID}`)
  const needIntentUrn = `urn:smart-agent:intent:${DAVID_INTENT_UUID}`

  console.log('\nSTEP 2.5 — ensure Maria has a separate personal treasury agent')
  // Spec-006 invariant — USDC MUST NEVER move into or out of a person
  // smart account or organization smart account directly. Money only ever
  // touches Treasury Service Agents (TYPE_TREASURY_AGENT). Maria's
  // personal treasury is a distinct AgentAccount, registered, linked back
  // to her via `sa:hasPersonalTreasury`. We deploy + register on demand
  // (idempotent: skip if a non-self link is already set).
  const mariaTreasuryWallet = createWalletClient({
    account: privateKeyToAccount(maria.privateKey), chain: foundry, transport: http(RPC),
  })
  let mariaTreasury: Address
  {
    const SA_HAS_PERSONAL_TREASURY = keccak256(toBytes('sa:hasPersonalTreasury'))
    const existing = await pub.readContract({
      address: RESOLVER, abi: sdk.agentAccountResolverAbi,
      functionName: 'getAddressProperty', args: [maria.smartAccount, SA_HAS_PERSONAL_TREASURY],
    }).catch(() => '0x0000000000000000000000000000000000000000') as Address
    const isSelfOrZero = existing === '0x0000000000000000000000000000000000000000'
      || existing.toLowerCase() === maria.smartAccount.toLowerCase()
    if (!isSelfOrZero) {
      mariaTreasury = existing
      console.log('  treasury already provisioned:', mariaTreasury)
    } else {
      const treasurySalt = BigInt(keccak256(toBytes(`personal-treasury:${maria.smartAccount.toLowerCase()}`)))
      const tx = await mariaTreasuryWallet.writeContract({
        address: FACTORY, abi: sdk.agentAccountFactoryAbi,
        functionName: 'createAccount', args: [mariaEoa, treasurySalt],
      })
      await pub.waitForTransactionReceipt({ hash: tx })
      mariaTreasury = await pub.readContract({
        address: FACTORY, abi: sdk.agentAccountFactoryAbi,
        functionName: 'getAddress', args: [mariaEoa, treasurySalt],
      }) as Address
      console.log('  deployed personal treasury:', mariaTreasury)

      // Register the treasury (TYPE_TREASURY_AGENT) so it appears in the
      // resolver with a display name. Maria signs (she's initial owner).
      const ZERO_HASH = ('0x' + '0'.repeat(64)) as Hex
      const TYPE_TREASURY_AGENT = keccak256(toBytes('atl:TreasuryAgent'))
      try {
        const isReg = await pub.readContract({
          address: RESOLVER, abi: sdk.agentAccountResolverAbi,
          functionName: 'isRegistered', args: [mariaTreasury],
        }) as boolean
        if (!isReg) {
          await mariaTreasuryWallet.writeContract({
            address: RESOLVER, abi: sdk.agentAccountResolverAbi,
            functionName: 'register',
            args: [mariaTreasury, 'Maria Gonzalez Treasury', 'Personal treasury holding Maria\'s USDC — distinct from her person smart account.', TYPE_TREASURY_AGENT, ZERO_HASH, ''],
          })
          console.log('  resolver.register ✓ (TYPE_TREASURY_AGENT)')
        }
      } catch (e) {
        console.warn('  treasury register warning:', (e as Error).message.slice(0, 200))
      }

      // Link Maria's person agent → her personal treasury so the spec-006
      // resolveRecipientTreasury walker finds it.
      try {
        await mariaTreasuryWallet.writeContract({
          address: RESOLVER, abi: sdk.agentAccountResolverAbi,
          functionName: 'setAddressProperty',
          args: [maria.smartAccount, SA_HAS_PERSONAL_TREASURY, mariaTreasury],
        })
        console.log('  sa:hasPersonalTreasury ✓ (person → treasury)')
      } catch (e) {
        console.warn('  setAddressProperty warning:', (e as Error).message.slice(0, 200))
      }
    }
  }

  console.log('\nSTEP 3 — deploy pool agent (owner = Maria EOA) + open pool')
  // Pool's initial owner MUST be Maria's signing EOA (not her smartAccount)
  // so her wallet-client tx pass `pool.isOwner(msg.sender)` directly without
  // an extra delegation hop for every admin call. Her smartAccount stays as
  // the *donor* (treasury) for the pledge → honor flow below.
  // Maria's wallet signs the factory.createAccount call too — deployer is
  // never involved in scenario signing.
  const mariaWallet = createWalletClient({
    account: privateKeyToAccount(maria.privateKey), chain: foundry, transport: http(RPC),
  })
  const sarahWallet = createWalletClient({
    account: privateKeyToAccount(sarah.privateKey), chain: foundry, transport: http(RPC),
  })
  // Deploy pool with Maria signing factory.createAccount directly.
  const poolSalt = BigInt(keccak256(toBytes(`pool:${POOL_SLUG}`)))
  const deployTx = await mariaWallet.writeContract({
    address: FACTORY, abi: sdk.agentAccountFactoryAbi,
    functionName: 'createAccount', args: [mariaEoa, poolSalt],
  })
  await pub.waitForTransactionReceipt({ hash: deployTx })
  const pool = await pub.readContract({
    address: FACTORY, abi: sdk.agentAccountFactoryAbi,
    functionName: 'getAddress', args: [mariaEoa, poolSalt],
  }) as Address
  console.log('  pool agent:', pool, '(owner EOA:', mariaEoa.slice(0, 10) + '…, Maria signed deploy)')

  // Also add Maria's PERSON AGENT as a pool co-owner. Seed signing keeps
  // using her EOA directly (msg.sender at pool == mariaEoa), but the UI
  // gate `canManageAgent(myPersonAgent, pool)` walks `pool.isOwner` from
  // her person agent, not her raw EOA — so the inbox / steward views
  // require the personAgent to also be on the pool's owner list.
  // addOwner is `onlySelf`, so we route through pool.executeBatch via
  // the standard delegation rail (Maria signs).
  try {
    const isReg = await pub.readContract({
      address: pool, abi: sdk.agentAccountAbi, functionName: 'isOwner', args: [maria.personAgent],
    }) as boolean
    if (!isReg) {
      // Add Maria's PERSON AGENT (= getPersonAgentForUser return value)
      // to the pool's owner list. canManageAgent walks from personAgent,
      // so this is the address the UI gate checks.
      const addOwnerData = encodeFunctionData({
        abi: sdk.agentAccountAbi, functionName: 'addOwner', args: [maria.personAgent],
      })
      const batch = encodeFunctionData({
        abi: sdk.agentAccountAbi, functionName: 'executeBatch',
        args: [[{ target: pool, value: 0n, data: addOwnerData }]],
      })
      await redeemThroughDonor({
        donor: pool, calldata: batch, signerKey: maria.privateKey, label: 'pool-addOwner',
      })
      console.log('  pool.addOwner(personAgent) ✓ — UI canManageAgent gate satisfied')
    } else {
      console.log('  pool already owned by personAgent')
    }
  } catch (e) {
    console.warn('  addOwner warning (non-fatal):', (e as Error).message.slice(0, 200))
  }

  // Architectural invariant — every Pool's AgentAccount MUST appear in
  // AgentAccountResolver. The round detail / proposal timeline / agent
  // graph pages all resolve displayNames via the resolver; if a pool
  // never registers, every label hex-truncates. Register now from
  // Maria's key (initial pool owner → onlyAgentOwner passes).
  try {
    const ZERO_HASH = ('0x' + '0'.repeat(64)) as Hex
    const TYPE_POOL_AGENT = keccak256(toBytes('atl:PoolAgent'))
    const isReg = await pub.readContract({
      address: RESOLVER, abi: sdk.agentAccountResolverAbi,
      functionName: 'isRegistered', args: [pool],
    }) as boolean
    if (!isReg) {
      await mariaWallet.writeContract({
        address: RESOLVER, abi: sdk.agentAccountResolverAbi,
        functionName: 'register',
        args: [pool, POOL_DISPLAY_NAME, `Demo grant-lane pool for run ${RUN_LABEL}`, TYPE_POOL_AGENT, ZERO_HASH, ''],
      })
      console.log('  resolver.register ✓ (TYPE_POOL_AGENT, displayName set)')
    } else {
      console.log('  resolver entry already present — skipping register')
    }
  } catch (e) {
    console.warn('  resolver.register warning:', (e as Error).message.slice(0, 200))
  }
  try {
    const tx = await mariaWallet.writeContract({
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
        stewards: [network, maria.smartAccount],
        visibility: keccak256(toBytes('sa:VisibilityPublic')),
        acceptedRestrictions: '{"kinds":["CompassionMinistry"],"geoRoots":["us/colorado"]}',
        slug: POOL_SLUG,
      }],
    })
    await pub.waitForTransactionReceipt({ hash: tx })
    console.log('  PoolRegistry.open ✓ (Maria signed)')
  } catch (e) {
    console.warn('  open warning:', (e as Error).message.slice(0, 200))
  }

  console.log('\nSTEP 4 — Maria pledges 30k USDC (via PledgeRegistry.submit signed by Maria)')
  // Donor = Maria's smartAccount → msg.sender at PledgeRegistry.submit
  // must equal that. Use the delegation rail through Maria's account.
  // First mint USDC to Maria's account so honor can actually transfer.
  const TOTAL = 30_000n * 10n ** 6n
  // USDC must live in a Treasury Service Agent — mint into Maria's
  // personal treasury, NOT into her person smart account.
  const treasuryBalBefore = await pub.readContract({
    address: USDC, abi: sdk.mockUsdcAbi, functionName: 'balanceOf', args: [mariaTreasury],
  }) as bigint
  if (treasuryBalBefore < TOTAL) {
    await mariaWallet.writeContract({
      address: USDC, abi: sdk.mockUsdcAbi, functionName: 'mint', args: [mariaTreasury, TOTAL],
    })
    console.log(`  minted ${TOTAL.toString()} USDC into Maria's TREASURY (Maria signed)`)
  } else {
    console.log(`  Maria's treasury already holds ${treasuryBalBefore.toString()} USDC`)
  }

  const pledgeNullifier = keccak256(toBytes(`demo-grant-flow:pledge:${mariaTreasury}`))
  const pledgeSalt = 1n
  const pledgeSubject = keccak256(new Uint8Array([
    ...toBytes('sa:pledge:'),
    ...toBytes(pool.toLowerCase() as `0x${string}`),
    ...toBytes(pledgeNullifier),
    ...toBytes(`0x${pledgeSalt.toString(16).padStart(64, '0')}` as `0x${string}`),
  ])) as Hex

  // Build the inner submit() calldata and wrap in executeBatch.
  const submitData = encodeFunctionData({
    abi: sdk.pledgeRegistryAbi, functionName: 'submit',
    args: [{
      poolAgent: pool,
      nullifier: pledgeNullifier,
      salt: pledgeSalt,
      amount: 30000n, // pledge unit = whole dollars (per spec-005 v1)
      unit: keccak256(toBytes('USD')),
      cadence: keccak256(toBytes('sa:CadenceOneTime')),
      duration: 0n,
      restrictionsJson: '',
      storyPermissionsJson: '{"narrative":"public","amount":"public","donorName":"public"}',
    }],
  })
  const submitBatch = encodeFunctionData({
    abi: sdk.agentAccountAbi, functionName: 'executeBatch',
    args: [[{ target: PLEDGE_REG, value: 0n, data: submitData }]],
  })
  try {
    await redeemThroughDonor({
      donor: mariaTreasury,
      calldata: submitBatch,
      signerKey: maria.privateKey,
      label: 'pledge-submit',
    })
    console.log('  PledgeRegistry.submit ✓ (Maria signed; donor = her Treasury Service Agent)')
    console.log('  pledge subject:', pledgeSubject)
  } catch (e) {
    console.warn('  pledge submit warning:', (e as Error).message.slice(0, 240))
  }

  console.log('\nSTEP 5 — Maria honors the pledge (TREASURY → pool USDC transfer + recordHonor)')
  const transferToPool = encodeFunctionData({
    abi: sdk.mockUsdcAbi, functionName: 'transfer', args: [pool, TOTAL],
  })
  const recordHonor = encodeFunctionData({
    abi: sdk.pledgeRegistryAbi, functionName: 'recordHonor',
    // recordHonor's `treasury` arg + msg.sender must both be the donor
    // treasury so the contract's `msg.sender == treasury` gate passes.
    args: [pledgeSubject, mariaTreasury, USDC, 30000n],
  })
  const honorBatch = encodeFunctionData({
    abi: sdk.agentAccountAbi, functionName: 'executeBatch',
    args: [[
      { target: USDC,       value: 0n, data: transferToPool },
      { target: PLEDGE_REG, value: 0n, data: recordHonor },
    ]],
  })
  try {
    await redeemThroughDonor({
      donor: mariaTreasury,
      calldata: honorBatch,
      signerKey: maria.privateKey,
      label: 'pledge-honor',
    })
    const [pBal, tBal] = await Promise.all([
      pub.readContract({ address: USDC, abi: sdk.mockUsdcAbi, functionName: 'balanceOf', args: [pool] }) as Promise<bigint>,
      pub.readContract({ address: USDC, abi: sdk.mockUsdcAbi, functionName: 'balanceOf', args: [mariaTreasury] }) as Promise<bigint>,
    ])
    console.log(`  honor ✓ (Maria's TREASURY → pool); pool=${pBal.toString()}  treasury=${tBal.toString()}`)
  } catch (e) {
    console.warn('  honor warning:', (e as Error).message.slice(0, 240))
  }

  console.log('\nSTEP 6 — open round (voting window NOW, deadline +30d)')
  const roundSubject = keccak256(toBytes(`sa:round:${ROUND_SLUG}`)) as Hex
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  try {
    await mariaWallet.writeContract({
      address: FUND_REG, abi: sdk.fundRegistryAbi,
      functionName: 'openRound',
      args: [{
        roundSubject,
        fundAgent: pool,
        poolAgent: pool,
        deadline: nowSec + 30n * 86400n,
        decisionDate: nowSec + 31n * 86400n,
        reportingCadence: keccak256(toBytes('sa:CadenceQuarterly')),
        requiredCredentials: [],
        visibility: keccak256(toBytes('sa:VisibilityPublic')),
        initialStatus: keccak256(toBytes('sa:RoundOpen')),
        mandate: `{"acceptedKinds":["CompassionMinistry"],"acceptedGeo":["us/colorado"],"budgetCeiling":30000,"expectedAwards":1,"displayName":"${ROUND_DISPLAY_NAME}","validators":["${sarahEoa.toLowerCase()}"]}`,
        milestoneTemplate: '{"minMilestones":2,"maxMilestones":2,"trancheHints":{"atKickoff":40,"completion":60}}',
        validatorRequirements: `{"minValidators":1,"validators":["${sarahEoa.toLowerCase()}"]}`,
        slug: ROUND_SLUG,
      }],
    })
    console.log('  openRound ✓ (Maria signed)')
  } catch (e) {
    console.warn('  openRound warning:', (e as Error).message.slice(0, 200))
  }
  try {
    await mariaWallet.writeContract({
      address: FUND_REG, abi: sdk.fundRegistryAbi,
      functionName: 'setRoundVotingConfig',
      args: [
        roundSubject,
        keccak256(toBytes('sa:VotingStrategyStewardQuorum')),
        2n,
        nowSec,
        nowSec + 86400n,
      ],
    })
    await mariaWallet.writeContract({
      address: FUND_REG, abi: sdk.fundRegistryAbi,
      functionName: 'setRoundStatus',
      args: [roundSubject, keccak256(toBytes('sa:RoundReview'))],
    })
    console.log("  voting config + status → review ✓")
  } catch (e) {
    console.warn('  config/status warning:', (e as Error).message.slice(0, 200))
  }

  console.log('\nSTEP 7 — David submits proposal (anchored to his intent)')
  const proposerNullifier = keccak256(toBytes(`demo-grant-flow:proposer:${david.smartAccount}`)) as Hex
  // GrantProposalRegistry.submit is gated on the round's fund-owner (= Maria).
  // We use Maria's key to submit on David's behalf, but tag the proposal
  // with David's nullifier so on-chain reads attribute it to him.
  try {
    await mariaWallet.writeContract({
      address: GP_REG, abi: sdk.grantProposalRegistryAbi,
      functionName: 'submit',
      args: [{
        roundSubject,
        nullifier: proposerNullifier,
        displayName: PROPOSAL_DISPLAY_NAME,
        basedOnIntentId: needIntentUrn,
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
        recipient: davidOrgTreasury,
      }],
    })
    console.log('  GrantProposalRegistry.submit ✓ (anchored to David\'s intent)')
  } catch (e) {
    console.warn('  submit warning:', (e as Error).message.slice(0, 200))
  }
  const gpSubject = keccak256(new Uint8Array([
    ...toBytes('sa:grantProposal:'),
    ...toBytes(roundSubject),
    ...toBytes(proposerNullifier),
  ])) as Hex

  const proposalSlug = `${ROUND_SLUG}-david`
  const proposalSubject = await pub.readContract({
    address: PROP_REG, abi: sdk.proposalRegistryAbi,
    functionName: 'proposalSubject', args: [proposalSlug],
  }) as Hex

  console.log('\nSTEP 8 — Maria + David both vote Approve')
  for (const [name, voter, key] of [
    ['Maria', maria.smartAccount, maria.privateKey],
    ['David', david.smartAccount, david.privateKey],
  ] as const) {
    const voterWallet = createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(RPC) })
    const voterNullifier = keccak256(toBytes(`demo-grant-flow:vote:${voter}`)) as Hex
    try {
      await voterWallet.writeContract({
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
      console.log(`  ${name} voted Approve ✓`)
    } catch (e) {
      console.warn(`  ${name} vote warning:`, (e as Error).message.slice(0, 160))
    }
  }

  console.log("\nSTEP 9 — close round (status → decided) + announceAward")
  try {
    await mariaWallet.writeContract({
      address: FUND_REG, abi: sdk.fundRegistryAbi,
      functionName: 'setRoundStatus',
      args: [roundSubject, keccak256(toBytes('sa:RoundDecided'))],
    })
    console.log('  setRoundStatus → decided ✓')
  } catch (e) {
    console.warn('  decided warning:', (e as Error).message.slice(0, 200))
  }
  try {
    await mariaWallet.writeContract({
      address: PROP_REG, abi: sdk.proposalRegistryAbi,
      functionName: 'announceAward',
      args: [{
        proposalSubject,
        kind: keccak256(toBytes('sa:GivingKind')),
        basedOnIntentId: keccak256(toBytes(needIntentUrn)),
        round: roundSubject,
        proposer: david.smartAccount,
        // Spec-006: recipient is David's ORG TREASURY, not his person account.
        recipient: davidOrgTreasury,
        totalAwarded: TOTAL,
        bodyHash: keccak256(toBytes(proposalSlug)),
        awardingFund: pool,
        status: keccak256(toBytes('sa:ProposalAwarded')),
        needIntentIdString: needIntentUrn,
      }],
    })
    console.log('  announceAward ✓ (recipient = Fort Collins Network Treasury)')
  } catch (e) {
    console.warn('  announceAward warning:', (e as Error).message.slice(0, 240))
  }
  try {
    await mariaWallet.writeContract({
      address: GP_REG, abi: sdk.grantProposalRegistryAbi,
      functionName: 'setStatus',
      args: [gpSubject, keccak256(toBytes('sa:GpAwarded'))],
    })
    console.log('  GP status → awarded ✓')
  } catch (e) {
    console.warn('  GP status warning:', (e as Error).message.slice(0, 160))
  }

  console.log('\nSTEP 10 — commit (donor=pool, recipient=Fort Collins Treasury, needIntent linked)')
  const sourceKind = keccak256(toBytes('sa:CommitmentSourceAward'))
  try {
    await mariaWallet.writeContract({
      address: COMMIT_REG, abi: sdk.commitmentRegistryAbi,
      functionName: 'commit',
      args: [{
        sourceKind,
        sourceSubject: proposalSubject,
        round: roundSubject,
        donor: pool,
        recipient: davidOrgTreasury,
        token: USDC,
        totalAmount: TOTAL,
        needIntentId: needIntentUrn,
        offerIntentId: 'urn:smart-agent:offer-intent:demo-grant-flow-pool',
        milestonesJson: '[{"id":"m1","label":"Kickoff + first cohort","trancheBps":4000},{"id":"m2","label":"Final report + outcomes","trancheBps":6000}]',
      }],
    })
    console.log('  commit ✓ (Maria signed)')
  } catch (e) {
    console.warn('  commit warning:', (e as Error).message.slice(0, 240))
  }
  // Use the contract's view function so the subject EXACTLY matches what
  // emit OutcomeRecorded / inbox SPARQL key on. The earlier local
  // keccak-of-packed-bytes recipe drifted from the contract impl as the
  // contract evolved.
  const commitmentSubject = (await pub.readContract({
    address: COMMIT_REG, abi: sdk.commitmentRegistryAbi,
    functionName: 'commitmentSubject',
    args: [sourceKind, proposalSubject, pool],
  })) as Hex
  // Machine-parseable print so the Playwright test can scope its UI
  // assertions to THIS run's commitment (the inbox accumulates across
  // seed runs since GraphDB isn't wiped per-run).
  console.log(`  COMMITMENT_SUBJECT=${commitmentSubject}`)
  console.log(`  MILESTONE_IDS=m1,m2`)

  // ─── Two-gate release: validator attests, THEN steward approves ──
  // For each milestone:
  //   (a) Sarah (validator) signs recordOutcome — her EOA is the
  //       `recordedBy`. Off-chain readers can verify she's in the round's
  //       `validators` array.
  //   (b) Maria (steward / pool owner) signs the release delegation —
  //       executeBatch([transfer, recordRelease]). Pool USDC moves to
  //       Fort Collins Treasury.
  // Deployer signs nothing in either step.

  // ─── Stop-at-commitment cutoff for the Playwright E2E test ─────
  // When STOP_AT_COMMITMENT=1, the seed creates the commitment but skips
  // the attest + release steps so the UI test can drive Sarah's
  // attestation and Maria's release through the /tasks inbox.
  if (process.env.STOP_AT_COMMITMENT === '1') {
    console.log('\n══════ STOP_AT_COMMITMENT=1 — skipping attest + release ══════')
    console.log('  attestation + release left for the UI test to drive')
    try {
      const mod = await import(path.join(repoRoot, 'apps/web/src/lib/ontology/graphdb-sync.ts')) as { syncOnChainToGraphDB: () => Promise<unknown> }
      await mod.syncOnChainToGraphDB()
      console.log('  GraphDB sync ✓')
    } catch { /* dev server may be cold */ }
    // Machine-parseable demo data block — the polished customer-demo
    // playwright test (grant-flow-demo.spec.ts) reads these to pre-warm
    // URLs and scope its assertions to this run's artifacts.
    console.log('')
    console.log('═══ DEMO_DATA_BEGIN ═══')
    console.log(`DEMO_HUB_SLUG=catalyst`)
    console.log(`DEMO_POOL_SLUG=${POOL_SLUG}`)
    console.log(`DEMO_ROUND_SLUG=${ROUND_SLUG}`)
    console.log(`DEMO_INTENT_ID=${DAVID_INTENT_UUID}`)
    console.log(`DEMO_PROPOSAL_ID=${gpSubject}`)
    console.log(`DEMO_POOL_ADDRESS=${pool}`)
    console.log(`DEMO_MARIA_TREASURY=${mariaTreasury}`)
    console.log(`DEMO_RECIPIENT_TREASURY=${davidOrgTreasury}`)
    console.log(`DEMO_FORT_COLLINS=${fortCollins}`)
    console.log(`DEMO_CATALYST=${network}`)
    console.log('═══ DEMO_DATA_END ═══')
    console.log('\nPickup URLs:')
    console.log(`  Sarah inbox (attestation): http://localhost:3000/h/catalyst/tasks  (login as cat-user-005)`)
    console.log(`  Maria inbox (release):     http://localhost:3000/h/catalyst/tasks  (login as cat-user-001)`)
    return
  }

  console.log('\nSTEP 11a — Sarah (validator) attests milestone-1 delivery')
  const m1Amount = (TOTAL * 4000n) / 10000n
  try {
    await sarahWallet.writeContract({
      address: COMMIT_REG, abi: sdk.commitmentRegistryAbi,
      functionName: 'recordOutcome',
      args: [commitmentSubject, keccak256(toBytes('m1')), keccak256(toBytes('evidence:m1:cohort1-report.pdf'))],
    })
    console.log('  attestation m1 ✓ (Sarah signed; recordedBy = Sarah\'s EOA)')
  } catch (e) {
    console.warn('  attestation m1 warning:', (e as Error).message.slice(0, 200))
  }

  console.log('\nSTEP 11b — Maria (steward) approves & releases milestone-1 ($12k)')
  await releaseTranche({
    pool, recipient: davidOrgTreasury, amount: m1Amount,
    milestoneId: keccak256(toBytes('m1')),
    commitmentSubject, sdk, signerKey: maria.privateKey,
  })

  console.log('\nSTEP 12a — Sarah (validator) attests milestone-2 delivery')
  const m2Amount = TOTAL - m1Amount
  try {
    await sarahWallet.writeContract({
      address: COMMIT_REG, abi: sdk.commitmentRegistryAbi,
      functionName: 'recordOutcome',
      args: [commitmentSubject, keccak256(toBytes('m2')), keccak256(toBytes('evidence:m2:final-report.pdf'))],
    })
    console.log('  attestation m2 ✓ (Sarah signed)')
  } catch (e) {
    console.warn('  attestation m2 warning:', (e as Error).message.slice(0, 200))
  }

  console.log('\nSTEP 12b — Maria (steward) approves & releases milestone-2 ($18k)')
  await releaseTranche({
    pool, recipient: davidOrgTreasury, amount: m2Amount,
    milestoneId: keccak256(toBytes('m2')),
    commitmentSubject, sdk, signerKey: maria.privateKey,
  })

  // ─── Final state ────────────────────────────────────────────────
  const c = await pub.readContract({
    address: COMMIT_REG, abi: sdk.commitmentRegistryAbi,
    functionName: 'getCommitment', args: [commitmentSubject],
  }) as readonly [Hex, Hex, Address, Address, Address, bigint, bigint, Hex]
  const completedHash = keccak256(toBytes('sa:CommitmentCompleted'))
  const treasuryBal = await pub.readContract({
    address: USDC, abi: sdk.mockUsdcAbi, functionName: 'balanceOf', args: [davidOrgTreasury],
  }) as bigint
  const poolBal = await pub.readContract({
    address: USDC, abi: sdk.mockUsdcAbi, functionName: 'balanceOf', args: [pool],
  }) as bigint

  console.log('\n══════ FINAL STATE ══════')
  console.log(`commitment Completed?               ${c[7].toLowerCase() === completedHash.toLowerCase() ? '✓ YES' : '✗ NO'}`)
  console.log(`commitment total / released:        ${c[5].toString()} / ${c[6].toString()}`)
  console.log(`Fort Collins Treasury USDC:         ${treasuryBal.toString()}  (expected ${TOTAL.toString()})`)
  console.log(`pool USDC remaining:                ${poolBal.toString()}      (expected 0)`)
  console.log(`commitment.needIntent links to:     ${needIntentUrn}`)
  console.log()
  console.log('Walk through it:')
  console.log(`  Intent (David):    http://localhost:3000/h/catalyst/intents/${DAVID_INTENT_UUID}`)
  console.log(`  Round:             http://localhost:3000/h/catalyst/rounds/${ROUND_SLUG}`)
  console.log(`  Pool:              http://localhost:3000/h/catalyst/pools/${POOL_SLUG}`)
  console.log(`  Proposal+timeline: http://localhost:3000/h/catalyst/proposals/${gpSubject}`)
  console.log(`  Network graph:     http://localhost:3000/agents`)

  try {
    const mod = await import(path.join(repoRoot, 'apps/web/src/lib/ontology/graphdb-sync.ts')) as { syncOnChainToGraphDB: () => Promise<unknown> }
    await mod.syncOnChainToGraphDB()
    console.log('  on-chain → GraphDB sync ✓')
  } catch (e) {
    console.warn('  GraphDB sync warning:', (e as Error).message.slice(0, 160))
  }
}

async function releaseTranche(opts: {
  pool: Address
  recipient: Address
  amount: bigint
  milestoneId: Hex
  commitmentSubject: Hex
  sdk: Awaited<ReturnType<typeof loadSdk>>
  signerKey: Hex
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
    await redeemThroughDonor({
      donor: opts.pool, calldata: callData,
      signerKey: opts.signerKey,
      label: 'release-tranche',
    })
    console.log('  release ✓ (signed by Maria as pool steward)')
  } catch (e) {
    console.warn('  release error:', (e as Error).message.slice(0, 240))
  }
}

main().catch((e) => { console.error('demo seed failed:', e); process.exit(1) })
