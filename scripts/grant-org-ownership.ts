/**
 * grant-org-ownership.ts
 *
 * One-shot admin script: for each (org, ownerUserSmartAccount) pair, make
 * the user's smart account an actual ERC-4337 owner of the org's
 * AgentAccount (not just a relationship-edge ROLE_OWNER).
 *
 * This is the bootstrap step that lets the unified delegation flow work
 * for rounds backed by existing org agents (Catalyst, etc.). Without it,
 * `FundRegistry.openRound`'s `onlyFundOwner(fundAgent)` check fails when
 * the redeem's rootDelegator is the user — the user isn't an account-level
 * owner of the fund.
 *
 * Mechanism: deployer (already an owner of every org's AgentAccount) signs
 * a tightly-scoped delegation `orgAccount → deployerEOA` with caveats
 * `[AllowedTargets([orgAccount]), AllowedMethods([addOwner])]`, then
 * redeems it through DelegationManager. The redeem makes msg.sender to
 * `orgAccount.execute` = DelegationManager (passes _requireForExecute),
 * which then calls `orgAccount.addOwner(userSmartAccount)` from `self`
 * (passes onlySelf).
 *
 * Idempotent: skips pairs where the user is already an owner.
 *
 * Usage:
 *   cd apps/web && pnpm exec tsx ../../scripts/grant-org-ownership.ts
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createWalletClient, createPublicClient, http,
  encodeFunctionData, encodeAbiParameters, toFunctionSelector,
  keccak256, encodePacked,
  type Address, type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
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

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as Hex
const DM = process.env.DELEGATION_MANAGER_ADDRESS as Address
const TIMESTAMP_ENFORCER = process.env.TIMESTAMP_ENFORCER_ADDRESS as Address
const TARGETS_ENFORCER = process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address
const METHODS_ENFORCER = process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address

if (!DEPLOYER_KEY || !DM || !TIMESTAMP_ENFORCER || !TARGETS_ENFORCER || !METHODS_ENFORCER) {
  throw new Error('missing env: DEPLOYER_PRIVATE_KEY / DELEGATION_MANAGER_ADDRESS / TIMESTAMP_ENFORCER_ADDRESS / ALLOWED_TARGETS_ENFORCER_ADDRESS / ALLOWED_METHODS_ENFORCER_ADDRESS')
}

const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex

const agentAccountIsOwnerAbi = [{
  type: 'function', name: 'isOwner', stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ type: 'bool' }],
}] as const

const agentAccountAddOwnerAbi = [{
  type: 'function', name: 'addOwner', stateMutability: 'nonpayable',
  inputs: [{ name: 'owner', type: 'address' }],
  outputs: [],
}] as const

const delegationManagerAbi = [{
  type: 'function', name: 'redeemDelegation', stateMutability: 'nonpayable',
  inputs: [
    { name: 'delegations', type: 'tuple[]', components: [
      { name: 'delegator', type: 'address' },
      { name: 'delegate', type: 'address' },
      { name: 'authority', type: 'bytes32' },
      { name: 'caveats', type: 'tuple[]', components: [
        { name: 'enforcer', type: 'address' },
        { name: 'terms', type: 'bytes' },
        { name: 'args', type: 'bytes' },
      ]},
      { name: 'salt', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ]},
    { name: 'target', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
  outputs: [],
}, {
  type: 'function', name: 'hashDelegation', stateMutability: 'view',
  inputs: [
    { name: 'd', type: 'tuple', components: [
      { name: 'delegator', type: 'address' },
      { name: 'delegate', type: 'address' },
      { name: 'authority', type: 'bytes32' },
      { name: 'caveats', type: 'tuple[]', components: [
        { name: 'enforcer', type: 'address' },
        { name: 'terms', type: 'bytes' },
        { name: 'args', type: 'bytes' },
      ]},
      { name: 'salt', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ]},
  ],
  outputs: [{ type: 'bytes32' }],
}] as const

async function grant(orgAddress: Address, userSmartAccount: Address) {
  const account = privateKeyToAccount(DEPLOYER_KEY)
  const wallet = createWalletClient({ account, chain: undefined, transport: http(RPC_URL) })
  const pub = createPublicClient({ chain: undefined, transport: http(RPC_URL) })

  const already = await pub.readContract({
    address: orgAddress, abi: agentAccountIsOwnerAbi, functionName: 'isOwner',
    args: [userSmartAccount],
  })
  if (already) {
    console.log(`  ✓ ${userSmartAccount} already owns ${orgAddress}`)
    return
  }

  const now = Math.floor(Date.now() / 1000)
  const validUntil = now + 3600  // 1h is plenty for this single redeem

  const timestampTerms = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [BigInt(now - 60), BigInt(validUntil)],
  )
  const targetsTerms = encodeAbiParameters(
    [{ type: 'address[]' }],
    [[orgAddress]],
  )
  const addOwnerSelector = toFunctionSelector('addOwner(address)')
  const methodsTerms = encodeAbiParameters(
    [{ type: 'bytes4[]' }],
    [[addOwnerSelector]],
  )

  const caveats = [
    { enforcer: TIMESTAMP_ENFORCER, terms: timestampTerms, args: '0x' as Hex },
    { enforcer: TARGETS_ENFORCER,   terms: targetsTerms,   args: '0x' as Hex },
    { enforcer: METHODS_ENFORCER,   terms: methodsTerms,   args: '0x' as Hex },
  ]

  const salt = BigInt(keccak256(encodePacked(['address', 'address', 'uint256'], [orgAddress, userSmartAccount, BigInt(now)])))

  const delegation = {
    delegator: orgAddress,
    delegate:  account.address as Address,
    authority: ROOT_AUTHORITY,
    caveats,
    salt,
    signature: '0x' as Hex,
  }

  // Hash via the on-chain hashDelegation (matches DelegationManager's EIP-712).
  const digest = await pub.readContract({
    address: DM, abi: delegationManagerAbi, functionName: 'hashDelegation',
    args: [delegation],
  })

  // Deployer signs as ERC-1271 owner of org. The org's AgentAccount validates
  // the signature in `_validateSignature` by recovering an ECDSA owner.
  const signature = await account.signMessage({ message: { raw: digest } })
  const signed = { ...delegation, signature }

  const innerData = encodeFunctionData({
    abi: agentAccountAddOwnerAbi, functionName: 'addOwner', args: [userSmartAccount],
  })

  const tx = await wallet.writeContract({
    address: DM, abi: delegationManagerAbi, functionName: 'redeemDelegation',
    args: [[signed], orgAddress, 0n, innerData],
    chain: undefined,
  })
  await pub.waitForTransactionReceipt({ hash: tx })
  console.log(`  ✓ added ${userSmartAccount} as owner of ${orgAddress} (tx ${tx})`)
}

async function main() {
  const Database = (await import(
    path.join(repoRoot, 'node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3/lib/index.js')
  ) as { default: new (filename: string, options?: { readonly?: boolean }) => {
    prepare: (sql: string) => { all: () => unknown[] }
  } }).default
  const db = new Database(path.join(repoRoot, 'apps/web/local.db'), { readonly: true })

  // Read demo (user, smartAccountAddress) pairs.
  const users = db.prepare('SELECT id, smart_account_address FROM users').all() as Array<{ id: string; smart_account_address: string | null }>

  // For each user, look up the orgs they govern (ORGANIZATION_GOVERNANCE +
  // ROLE_OWNER role) on chain. For demo simplicity here, we hardcode the
  // catalyst pairs — the boot-seed change in seed-catalyst-onchain.ts is
  // where we'd derive these from the relationship graph.
  const CATALYST = '0x0F669E6851A15FD0E5904EB197c369C2ab578D9b' as Address
  const userById = new Map(users.map(u => [u.id, u.smart_account_address as Address | null]))

  const pairs: Array<[string, Address]> = [
    ['cat-user-001', CATALYST],   // Maria
    ['cat-user-002', CATALYST],   // Sarah
  ]

  console.log('[grant-org-ownership] starting')
  for (const [userId, orgAddr] of pairs) {
    const sa = userById.get(userId)
    if (!sa) {
      console.warn(`  ! user ${userId} not in DB`)
      continue
    }
    try {
      await grant(orgAddr, sa)
    } catch (err) {
      console.error(`  ✗ ${userId} → ${orgAddr}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log('[grant-org-ownership] done')
}

main().catch((err) => { console.error(err); process.exit(1) })
