/**
 * One-shot: re-sign + persist Disciple→Coach cross-delegations for the
 * catalyst community without requiring a full fresh-start. Self-contained;
 * does not import the web app's 'use server' modules.
 *
 *   pnpm tsx scripts/reseed-coaching-delegations.ts
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// Hand-parse apps/web/.env so we don't pull in dotenv as a script dep.
const envFile = path.join(repoRoot, 'apps/web/.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (m && !process.env[m[1]]) {
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}

import Database from 'better-sqlite3'
import { createPublicClient, createWalletClient, http, keccak256, encodePacked } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import {
  hashDelegation, encodeTimestampTerms, buildCaveat, buildDataScopeCaveat,
  DATA_ACCESS_DELEGATION, ROLE_DATA_GRANTOR, ROLE_DATA_GRANTEE, ROOT_AUTHORITY,
  agentRelationshipAbi, agentAccountResolverAbi, ATL_CONTROLLER,
} from '@smart-agent/sdk'

const PERSON_AUDIENCE = 'urn:mcp:server:person'
const COACHING_PROFILE_FIELDS = [
  'displayName', 'email', 'phone', 'language',
  'city', 'stateProvince', 'country',
]

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const DELEGATION_MANAGER = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
const TIMESTAMP_ENFORCER = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
const REL_ADDR = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}`
const RESOLVER_ADDR = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`

if (!DELEGATION_MANAGER || !TIMESTAMP_ENFORCER || !REL_ADDR || !DEPLOYER_KEY) {
  console.error('Missing env (DELEGATION_MANAGER_ADDRESS, TIMESTAMP_ENFORCER_ADDRESS, AGENT_RELATIONSHIP_ADDRESS, DEPLOYER_PRIVATE_KEY)')
  process.exit(1)
}

const PAIRS: Array<{ discipleUserId: string; coachUserId: string }> = [
  { discipleUserId: 'cat-user-006', coachUserId: 'cat-user-001' },
  { discipleUserId: 'cat-user-004', coachUserId: 'cat-user-002' },
]

const publicClient = createPublicClient({ chain: { ...foundry, id: CHAIN_ID }, transport: http(RPC_URL) })
const deployer = privateKeyToAccount(DEPLOYER_KEY)
const walletClient = createWalletClient({ account: deployer, chain: { ...foundry, id: CHAIN_ID }, transport: http(RPC_URL) })

const dbPath = path.join(repoRoot, 'apps/web/local.db')
const db = new Database(dbPath, { readonly: true })

interface UserRow {
  id: string
  smart_account_address: string | null
  person_agent_address: string | null
  private_key: string | null
}

function loadUser(id: string): UserRow | undefined {
  return db.prepare('SELECT id, smart_account_address, person_agent_address, private_key FROM users WHERE id = ?').get(id) as UserRow | undefined
}

async function processPair(discipleUserId: string, coachUserId: string): Promise<{ status: string }> {
  const disciple = loadUser(discipleUserId)
  const coach = loadUser(coachUserId)
  if (!disciple?.smart_account_address || !disciple?.private_key) return { status: `skip: disciple ${discipleUserId} missing` }
  if (!coach?.smart_account_address || !coach?.person_agent_address) return { status: `skip: coach ${coachUserId} missing` }
  if (!disciple.person_agent_address) return { status: `skip: disciple ${discipleUserId} no PA` }

  const discipleSA = disciple.smart_account_address.toLowerCase() as `0x${string}`
  const coachSA = coach.smart_account_address.toLowerCase() as `0x${string}`
  const disciplePA = disciple.person_agent_address.toLowerCase() as `0x${string}`
  const coachPA = coach.person_agent_address.toLowerCase() as `0x${string}`

  // Compute the existing edge id.
  const edgeId = await publicClient.readContract({
    address: REL_ADDR, abi: agentRelationshipAbi,
    functionName: 'computeEdgeId',
    args: [disciplePA, coachPA, DATA_ACCESS_DELEGATION as `0x${string}`],
  }) as `0x${string}`

  const exists = await publicClient.readContract({
    address: REL_ADDR, abi: agentRelationshipAbi,
    functionName: 'edgeExists', args: [edgeId],
  }) as boolean

  // Build a fresh delegation, signed by disciple's EOA (legit owner of disciple's SA).
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 365 * 24 * 60 * 60
  const salt = BigInt(keccak256(encodePacked(
    ['address', 'address', 'string'],
    [discipleSA, coachSA, 'coach-mcp:profile:v1'],
  )))

  const grants = [{ server: PERSON_AUDIENCE, resources: ['profile'], fields: COACHING_PROFILE_FIELDS }]
  const caveats = [
    buildCaveat(TIMESTAMP_ENFORCER, encodeTimestampTerms(now, expiresAt)),
    buildDataScopeCaveat(grants),
  ]
  const delegation = {
    delegator: discipleSA,
    delegate: coachSA,
    authority: ROOT_AUTHORITY as `0x${string}`,
    caveats,
    salt,
  }
  const delHash = hashDelegation(
    { ...delegation, salt: salt.toString() },
    CHAIN_ID,
    DELEGATION_MANAGER,
  )
  const signer = privateKeyToAccount(disciple.private_key as `0x${string}`)
  const signature = await signer.signMessage({ message: { raw: delHash } })
  const signedDelegation = {
    ...delegation,
    salt: salt.toString(),
    signature,
    caveats: caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
  }
  const metadataURI = JSON.stringify({
    delegation: signedDelegation,
    delegationHash: delHash,
    grants,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    audience: PERSON_AUDIENCE,
    kind: 'coaching-profile',
  })

  // Sanity: verify signature via ERC-1271 BEFORE committing on-chain.
  const erc1271 = await publicClient.readContract({
    address: discipleSA, abi: [{ name: 'isValidSignature', type: 'function', stateMutability: 'view',
      inputs: [{ name: 'hash', type: 'bytes32' }, { name: 'sig', type: 'bytes' }],
      outputs: [{ name: '', type: 'bytes4' }] }],
    functionName: 'isValidSignature', args: [delHash, signature],
  }) as `0x${string}`
  if (erc1271 !== '0x1626ba7e') {
    return { status: `ERC-1271 rejected delegation for disciple=${disciple.id} (sa=${discipleSA}) — got ${erc1271}` }
  }

  if (exists) {
    const hash = await walletClient.writeContract({
      address: REL_ADDR, abi: agentRelationshipAbi,
      functionName: 'setMetadataURI',
      args: [edgeId, metadataURI],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    return { status: `updated edge for ${disciple.id} → ${coach.id}` }
  }

  const createHash = await walletClient.writeContract({
    address: REL_ADDR, abi: agentRelationshipAbi,
    functionName: 'createRelationship',
    args: [{
      subject: disciplePA, object_: coachPA,
      relationshipType: DATA_ACCESS_DELEGATION as `0x${string}`,
      roles: [ROLE_DATA_GRANTOR as `0x${string}`, ROLE_DATA_GRANTEE as `0x${string}`],
      metadataURI,
    } as never],
  })
  await publicClient.waitForTransactionReceipt({ hash: createHash })
  // Confirm
  const confirmHash = await walletClient.writeContract({
    address: REL_ADDR, abi: agentRelationshipAbi,
    functionName: 'confirmRelationship', args: [edgeId],
  })
  await publicClient.waitForTransactionReceipt({ hash: confirmHash })
  return { status: `created edge for ${disciple.id} → ${coach.id}` }
}

async function main() {
  console.log(`reseed: rel=${REL_ADDR} dm=${DELEGATION_MANAGER} resolver=${RESOLVER_ADDR}`)
  for (const p of PAIRS) {
    const r = await processPair(p.discipleUserId, p.coachUserId)
    console.log('-', r.status)
  }
}

main().catch(err => {
  console.error('reseed failed:', err)
  process.exit(1)
})
