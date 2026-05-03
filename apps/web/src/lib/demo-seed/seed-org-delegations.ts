'use server'

/**
 * Seed Org → User Smart Account cross-delegations on-chain.
 *
 * For every ORGANIZATION_GOVERNANCE edge with ROLE_OWNER (PersonAgent owns
 * Org), mint a signed Org→UserSmartAccount delegation and persist it in a
 * parallel DATA_ACCESS_DELEGATION edge. The delegation is signed by the
 * deployer key, which is an ERC-1271 owner of every org's AgentAccount —
 * so this is legitimate org-owner authorization, not a bypass.
 *
 * At runtime an admin user bootstraps their OWN A2A session, reads this
 * cross-delegation off the edge, and presents it to org-mcp via the
 * `crossDelegation` arg. Org-mcp validates:
 *   1. session.delegator == crossDelegation.delegate (= user smart account)
 *   2. ERC-1271(crossDelegation.delegator).isValidSignature(crossDelegation)
 *   3. orgPrincipal := crossDelegation.delegator
 *
 * This is the "user → Person Agent → Org Agent" bridge expressed as a
 * single signed delegation token.
 */

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, toBytes, encodePacked } from 'viem'
import {
  hashDelegation, encodeTimestampTerms, buildCaveat, buildDataScopeCaveat,
  DATA_ACCESS_DELEGATION, ROLE_DATA_GRANTOR, ROLE_DATA_GRANTEE, ROOT_AUTHORITY,
  agentRelationshipAbi,
} from '@smart-agent/sdk'
import {
  getPublicClient, getWalletClient,
  createRelationship, confirmRelationship,
} from '@/lib/contracts'
import { getPersonAgentForUser } from '@/lib/agent-registry'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const ORG_AUDIENCE = 'urn:mcp:server:org'

export interface OrgGovernancePair {
  /** Org's smart-account address (= delegator) */
  orgAddress: `0x${string}`
  /** Owning user's id (used to look up smart account + person agent) */
  ownerUserId: string
}

/**
 * For each (org, owner-user) pair: idempotently create a signed
 * DATA_ACCESS_DELEGATION edge from Org → PersonAgent containing a
 * cross-delegation that authorizes the user's smart account to act as
 * the org against org-mcp.
 */
export async function seedOrgCrossDelegations(pairs: OrgGovernancePair[]): Promise<number> {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
  const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}` | undefined
  const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}` | undefined
  const relAddr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}` | undefined
  if (!deployerKey || !delegationManagerAddr || !timestampEnforcerAddr || !relAddr) {
    console.warn('[seed-org-deleg] missing env (DEPLOYER_PRIVATE_KEY, DELEGATION_MANAGER_ADDRESS, TIMESTAMP_ENFORCER_ADDRESS, AGENT_RELATIONSHIP_ADDRESS)')
    return 0
  }

  const deployer = privateKeyToAccount(deployerKey)
  const publicClient = getPublicClient()

  let created = 0
  for (const { orgAddress, ownerUserId } of pairs) {
    const u = db.select().from(schema.users).where(eq(schema.users.id, ownerUserId)).get()
    if (!u?.smartAccountAddress) {
      console.warn(`[seed-org-deleg] owner ${ownerUserId} has no smart account`)
      continue
    }
    const personAgent = await getPersonAgentForUser(u.id)
    if (!personAgent) {
      console.warn(`[seed-org-deleg] owner ${ownerUserId} has no person agent`)
      continue
    }

    const userSmartAccount = u.smartAccountAddress.toLowerCase() as `0x${string}`
    const orgLower = orgAddress.toLowerCase() as `0x${string}`
    const personLower = personAgent.toLowerCase() as `0x${string}`

    // Idempotency: skip if a delegation edge already exists between this
    // (org, person-agent) pair.
    try {
      const edgeId = await publicClient.readContract({
        address: relAddr, abi: agentRelationshipAbi,
        functionName: 'computeEdgeId',
        args: [orgLower, personLower, DATA_ACCESS_DELEGATION as `0x${string}`],
      }) as `0x${string}`
      const exists = await publicClient.readContract({
        address: relAddr, abi: agentRelationshipAbi,
        functionName: 'edgeExists', args: [edgeId],
      }) as boolean
      if (exists) {
        const edge = await publicClient.readContract({
          address: relAddr, abi: agentRelationshipAbi,
          functionName: 'getEdge', args: [edgeId],
        }) as { status: number; metadataURI: string }
        if (edge.status >= 2 && edge.status < 5 && edge.metadataURI) {
          // Already seeded.
          continue
        }
      }
    } catch { /* fall through to create */ }

    // Build delegation: deployer signs as ERC-1271 owner of org's smart account.
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 365 * 24 * 60 * 60 // 1 year
    const salt = BigInt(keccak256(encodePacked(['address', 'address', 'string'], [orgLower, userSmartAccount, 'org-mcp:v1'])))

    // Broad org-mcp grant — covers all current org-mcp resource families.
    const grants = [{
      server: ORG_AUDIENCE,
      resources: ['revenue', 'proposals', 'intents', 'members', 'engagements', 'entitlements'],
      fields: ['*'],
    }]

    const caveats = [
      buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt)),
      buildDataScopeCaveat(grants),
    ]

    const delegation = {
      delegator: orgLower,
      delegate: userSmartAccount,
      authority: ROOT_AUTHORITY as `0x${string}`,
      caveats,
      salt,
    }
    const delHash = hashDelegation(
      { ...delegation, salt: salt.toString() },
      CHAIN_ID,
      delegationManagerAddr,
    )
    const signature = await deployer.signMessage({ message: { raw: delHash } })

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
      audience: ORG_AUDIENCE,
    })

    try {
      const edgeId = await createRelationship({
        subject: orgLower,
        object: personLower,
        relationshipType: DATA_ACCESS_DELEGATION as `0x${string}`,
        roles: [ROLE_DATA_GRANTOR as `0x${string}`, ROLE_DATA_GRANTEE as `0x${string}`],
        metadataURI,
      })
      await confirmRelationship(edgeId)
      created++
    } catch (err) {
      console.warn(`[seed-org-deleg] edge create failed for org=${orgLower} person=${personLower}:`, (err as Error).message)
    }
  }

  // Walletclient access — silence unused.
  void getWalletClient

  return created
}

/**
 * Read the seeded Org→User cross-delegation off-chain so the seeder can
 * present it to org-mcp. Returns null if no delegation is on-chain yet.
 */
export async function getOrgCrossDelegation(
  orgAddress: string,
  ownerUserId: string,
): Promise<{
  delegation: {
    delegator: `0x${string}`
    delegate: `0x${string}`
    authority: `0x${string}`
    caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
    salt: string
    signature: `0x${string}`
  }
  delegationHash: string
} | null> {
  const relAddr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}` | undefined
  if (!relAddr) return null
  const personAgent = await getPersonAgentForUser(ownerUserId)
  if (!personAgent) return null
  const orgLower = orgAddress.toLowerCase() as `0x${string}`
  const personLower = personAgent.toLowerCase() as `0x${string}`

  const publicClient = getPublicClient()
  try {
    const edgeId = await publicClient.readContract({
      address: relAddr, abi: agentRelationshipAbi,
      functionName: 'computeEdgeId',
      args: [orgLower, personLower, DATA_ACCESS_DELEGATION as `0x${string}`],
    }) as `0x${string}`
    const exists = await publicClient.readContract({
      address: relAddr, abi: agentRelationshipAbi,
      functionName: 'edgeExists', args: [edgeId],
    }) as boolean
    if (!exists) return null
    const edge = await publicClient.readContract({
      address: relAddr, abi: agentRelationshipAbi,
      functionName: 'getEdge', args: [edgeId],
    }) as { status: number; metadataURI: string }
    if (edge.status >= 5 || !edge.metadataURI) return null
    const meta = JSON.parse(edge.metadataURI)
    if (!meta.delegation) return null
    return {
      delegation: meta.delegation,
      delegationHash: meta.delegationHash,
    }
  } catch {
    return null
  }
}
