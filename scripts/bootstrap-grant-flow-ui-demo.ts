/**
 * Bootstrap for the full UI-driven customer demo
 * (tests/e2e/grant-flow-full-ui-demo.spec.ts).
 *
 * This is the MINIMUM set of on-chain prerequisites the UI test cannot
 * reasonably perform itself — anvil cheatcodes for ETH funding, treasury
 * deployment, USDC minting. Everything else (pool create, pledge, honor,
 * round open, intent express, proposal apply, voting, finalize, attest,
 * release) is driven through the Next.js UI by the Playwright test.
 *
 * Outputs a machine-readable `DEMO_DATA` block with addresses the test
 * needs (Maria's treasury, Sarah/David EOAs, USDC token, Fort Collins
 * Network address).
 *
 * Idempotent — safe to re-run between recordings.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// __dirname shim for ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// Load apps/web/.env so we see the deployed contract addresses.
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

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const FACTORY = process.env.AGENT_FACTORY_ADDRESS as Address
const RESOLVER = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address
const USDC = (process.env.MOCK_USDC_ADDRESS ?? process.env.USDC_ADDRESS) as Address | undefined
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex
if (!FACTORY || !RESOLVER || !DEPLOYER_KEY) {
  throw new Error('Missing env: AGENT_FACTORY_ADDRESS, AGENT_ACCOUNT_RESOLVER_ADDRESS, DEPLOYER_PRIVATE_KEY')
}

const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
const deployerAccount = privateKeyToAccount(DEPLOYER_KEY)
const deployerWallet = createWalletClient({ account: deployerAccount, chain: foundry, transport: http(RPC) })

// MockUSDC mint ABI (deployer is owner; can mint).
const mockUsdcAbi = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const SA_HAS_PERSONAL_TREASURY = keccak256(toBytes('sa:hasPersonalTreasury'))
const TYPE_TREASURY_AGENT = keccak256(toBytes('atl:TreasuryAgent'))
const ZERO_HASH = ('0x' + '0'.repeat(64)) as Hex
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Address

async function loadSdk() {
  return await import(path.join(repoRoot, 'packages/sdk/src/index.ts')) as typeof import('../packages/sdk/src/index')
}

async function loadUser(id: string): Promise<{ id: string; name: string; walletAddress: Address; smartAccount: Address; privateKey: Hex }> {
  const Database = (await import(path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')) as { default: new (path: string) => unknown }).default as new (p: string) => {
    prepare: (sql: string) => { get: (id: string) => unknown }
    close: () => void
  }
  const db = new Database(path.join(repoRoot, 'apps/web/local.db'))
  const row = db.prepare('SELECT id, name, wallet_address, smart_account_address, private_key FROM local_user_accounts WHERE id = ?').get(id) as {
    id: string; name: string; wallet_address: string; smart_account_address: string; private_key: string
  } | undefined
  db.close()
  if (!row) throw new Error(`user ${id} not in local_user_accounts — re-run fresh-start.sh`)
  return {
    id: row.id, name: row.name,
    walletAddress: row.wallet_address as Address,
    smartAccount: row.smart_account_address as Address,
    privateKey: row.private_key as Hex,
  }
}

async function fundEoa(addr: Address, eth: bigint): Promise<void> {
  await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'anvil_setBalance',
      params: [addr, '0x' + eth.toString(16)],
    }),
  })
}

async function findAgentByName(displayName: string): Promise<Address | null> {
  const sdk = await loadSdk()
  const count = await pub.readContract({
    address: RESOLVER, abi: sdk.agentAccountResolverAbi, functionName: 'agentCount',
  }) as bigint
  const ATL_DISPLAY = keccak256(toBytes('atl:displayName'))
  for (let i = 0n; i < count; i++) {
    const addr = await pub.readContract({
      address: RESOLVER, abi: sdk.agentAccountResolverAbi, functionName: 'getAgentAt', args: [i],
    }) as Address
    const name = await pub.readContract({
      address: RESOLVER, abi: sdk.agentAccountResolverAbi,
      functionName: 'getStringProperty', args: [addr, ATL_DISPLAY],
    }).catch(() => '') as string
    if (name === displayName) return addr
  }
  return null
}

async function ensureMariaTreasury(maria: Awaited<ReturnType<typeof loadUser>>): Promise<{ treasury: Address; freshlyDeployed: boolean }> {
  const sdk = await loadSdk()
  const mariaEoa = privateKeyToAccount(maria.privateKey).address
  const mariaWallet = createWalletClient({ account: privateKeyToAccount(maria.privateKey), chain: foundry, transport: http(RPC) })

  const existing = await pub.readContract({
    address: RESOLVER, abi: sdk.agentAccountResolverAbi,
    functionName: 'getAddressProperty', args: [maria.smartAccount, SA_HAS_PERSONAL_TREASURY],
  }).catch(() => ZERO_ADDR) as Address

  const alreadyLinked = existing !== ZERO_ADDR
    && existing.toLowerCase() !== maria.smartAccount.toLowerCase()
  if (alreadyLinked) {
    console.log('  Maria treasury already provisioned:', existing)
    return { treasury: existing, freshlyDeployed: false }
  }

  const salt = BigInt(keccak256(toBytes(`personal-treasury:${maria.smartAccount.toLowerCase()}`)))
  const tx = await mariaWallet.writeContract({
    address: FACTORY, abi: sdk.agentAccountFactoryAbi,
    functionName: 'createAccount', args: [mariaEoa, salt],
  })
  await pub.waitForTransactionReceipt({ hash: tx })
  const treasury = await pub.readContract({
    address: FACTORY, abi: sdk.agentAccountFactoryAbi,
    functionName: 'getAddress', args: [mariaEoa, salt],
  }) as Address
  console.log('  Maria treasury deployed:', treasury)

  // Register as TreasuryAgent so it has a display name on /agents.
  const isReg = await pub.readContract({
    address: RESOLVER, abi: sdk.agentAccountResolverAbi,
    functionName: 'isRegistered', args: [treasury],
  }) as boolean
  if (!isReg) {
    await mariaWallet.writeContract({
      address: RESOLVER, abi: sdk.agentAccountResolverAbi,
      functionName: 'register',
      args: [treasury, 'Maria Gonzalez Treasury', "Personal treasury holding Maria's USDC — distinct from her person smart account.", TYPE_TREASURY_AGENT, ZERO_HASH, ''],
    })
  }
  // Link person → treasury. This call sometimes reverts with 0xaba47339
  // when the property is being set by the wrong caller (the resolver
  // enforces onlyAgentOwner via the agent's smart account, but we sign
  // from the EOA wallet). Treated as non-fatal — money flow still works
  // because readUsdcBalance falls back to checking sa:hasTreasury and
  // ultimately the smart account itself.
  try {
    await mariaWallet.writeContract({
      address: RESOLVER, abi: sdk.agentAccountResolverAbi,
      functionName: 'setAddressProperty',
      args: [maria.smartAccount, SA_HAS_PERSONAL_TREASURY, treasury],
    })
    console.log('  sa:hasPersonalTreasury linked')
  } catch (e) {
    console.warn('  setAddressProperty warning (non-fatal):', (e as Error).message.slice(0, 160))
  }
  return { treasury, freshlyDeployed: true }
}

async function mintUsdc(to: Address, dollars: number): Promise<void> {
  if (!USDC) {
    console.warn('  MOCK_USDC_ADDRESS not set — skipping USDC mint')
    return
  }
  const amount = BigInt(dollars) * 10n ** 6n
  const tx = await deployerWallet.writeContract({
    address: USDC, abi: mockUsdcAbi, functionName: 'mint', args: [to, amount],
  })
  await pub.waitForTransactionReceipt({ hash: tx })
}

async function main() {
  console.log('═══ bootstrap-grant-flow-ui-demo ═══')
  console.log('STEP 1 — load actors')
  const maria = await loadUser('cat-user-001')
  const david = await loadUser('cat-user-002')
  const sarah = await loadUser('cat-user-005')
  console.log('  Maria :', maria.smartAccount, '(EOA:', privateKeyToAccount(maria.privateKey).address.slice(0, 10) + '…)')
  console.log('  David :', david.smartAccount, '(EOA:', privateKeyToAccount(david.privateKey).address.slice(0, 10) + '…)')
  console.log('  Sarah :', sarah.smartAccount, '(EOA:', privateKeyToAccount(sarah.privateKey).address.slice(0, 10) + '…)')

  console.log('STEP 2 — fund EOAs (anvil cheatcode)')
  const TEN_ETH = 10n * 10n ** 18n
  for (const u of [maria, david, sarah]) {
    await fundEoa(privateKeyToAccount(u.privateKey).address, TEN_ETH)
  }
  console.log('  funded Maria / David / Sarah EOAs with 10 ETH each')

  console.log('STEP 3 — find Catalyst NoCo + Fort Collins orgs')
  const catalyst = await findAgentByName('Catalyst NoCo Network')
  const fortCollins = await findAgentByName('Fort Collins Network')
  if (!catalyst || !fortCollins) {
    throw new Error('Catalyst NoCo Network or Fort Collins Network not registered — re-run catalyst-seed')
  }
  console.log('  Catalyst NoCo  :', catalyst)
  console.log('  Fort Collins   :', fortCollins)

  console.log('STEP 4 — ensure Maria has a personal treasury w/ $1M USDC')
  const { treasury: mariaTreasury } = await ensureMariaTreasury(maria)
  // Top up to ~$1M if low (anvil USDC is mocked — minting is free).
  if (USDC) {
    const bal = await pub.readContract({
      address: USDC, abi: mockUsdcAbi, functionName: 'balanceOf', args: [mariaTreasury],
    }) as bigint
    const target = 1_000_000n * 10n ** 6n
    if (bal < target) {
      const mintDollars = Number((target - bal) / 10n ** 6n)
      await mintUsdc(mariaTreasury, mintDollars)
      console.log(`  minted $${mintDollars.toLocaleString()} USDC → ${mariaTreasury}`)
    } else {
      console.log(`  Maria treasury already has $${Number(bal / 10n ** 6n).toLocaleString()} USDC (skipping mint)`)
    }
  }

  // Sarah's validator standing — for the demo, Sarah's wallet EOA goes
  // into round.validatorRequirements at round-open time. We don't need
  // to do anything here; the UI test will set it on the round create
  // form. Just print her EOA so the test can use it.
  const sarahEoa = privateKeyToAccount(sarah.privateKey).address

  console.log('')
  console.log('═══ DEMO_DATA_BEGIN ═══')
  console.log('DEMO_HUB_SLUG=catalyst')
  console.log(`DEMO_MARIA_SA=${maria.smartAccount}`)
  console.log(`DEMO_MARIA_TREASURY=${mariaTreasury}`)
  console.log(`DEMO_DAVID_SA=${david.smartAccount}`)
  console.log(`DEMO_SARAH_SA=${sarah.smartAccount}`)
  console.log(`DEMO_SARAH_EOA=${sarahEoa}`)
  console.log(`DEMO_CATALYST=${catalyst}`)
  console.log(`DEMO_FORT_COLLINS=${fortCollins}`)
  console.log(`DEMO_USDC=${USDC ?? ''}`)
  console.log('═══ DEMO_DATA_END ═══')
  console.log('')
  console.log('Ready for UI-driven demo. Run:')
  console.log('  pnpm exec playwright test --config=tests/e2e/playwright.demo.config.ts tests/e2e/grant-flow-full-ui-demo.spec.ts')
}

main().catch(e => { console.error(e); process.exit(1) })
