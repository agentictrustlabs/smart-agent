'use server'

/**
 * Seed Org → User Smart Account cross-delegations on-chain.
 *
 * For every ORGANIZATION_GOVERNANCE edge with ROLE_OWNER (PersonAgent owns
 * Org), mint a signed Org→UserSmartAccount delegation and persist it in a
 * parallel DATA_ACCESS_DELEGATION edge.
 *
 * The delegation is EIP-712 signed by the org's OWN owner EOA (the
 * deterministic-from-label EOA that was set as initialOwner at factory
 * deploy time — see `agent-self-register.ts`). Per the seed-as-self
 * refactor, the deployer key is no longer a co-owner of org smart
 * accounts, so deployer-signed delegations would fail ERC-1271
 * validation at runtime redemption. The org's own EOA IS an owner of
 * its AgentAccount, so ERC-1271 validates it correctly.
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
import { keccak256, encodePacked } from 'viem'
import {
  hashDelegation, encodeTimestampTerms, buildCaveat, buildDataScopeCaveat,
  buildDelegateBindingCaveat,
  DATA_ACCESS_DELEGATION, ROLE_DATA_GRANTOR, ROLE_DATA_GRANTEE, ROOT_AUTHORITY,
  agentRelationshipAbi,
} from '@smart-agent/sdk'
import {
  getPublicClient, getWalletClient,
  createRelationship, confirmRelationship,
} from '@/lib/contracts'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { agentRelationshipAbi as relAbi } from '@smart-agent/sdk'
import { resolveAgentIdentity } from './agent-self-register'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const ORG_AUDIENCE = 'urn:mcp:server:org'
const PEOPLE_GROUPS_AUDIENCE = 'urn:mcp:server:people-groups'

const DEFAULT_ORG_GRANTS = [{
  server: ORG_AUDIENCE,
  resources: ['revenue', 'proposals', 'intents', 'members', 'engagements', 'entitlements'],
  fields: ['*'],
}]

const DEFAULT_PEOPLE_GROUPS_GRANTS = [{
  server: PEOPLE_GROUPS_AUDIENCE,
  resources: ['segments', 'estimates', 'reachedness', 'communities', 'community-locations', 'geometries', 'classifications'],
  fields: ['*'],
}]

interface DataScopeGrant {
  server: string
  resources: string[]
  fields: string[]
}

export interface OrgGovernancePair {
  /** Org's smart-account address (= delegator) */
  orgAddress: `0x${string}`
  /** Owning user's id (used to look up smart account + person agent) */
  ownerUserId: string
  /** Audience for the delegation. Defaults to urn:mcp:server:org. */
  audience?: string
  /** Optional grants override. Defaults to all-resources for the audience. */
  grants?: DataScopeGrant[]
  /** Salt seed string; lets us mint multiple audiences against the same pair. */
  saltLabel?: string
}

/**
 * For each (org, owner-user) pair: idempotently create a signed
 * DATA_ACCESS_DELEGATION edge from Org → PersonAgent containing a
 * cross-delegation that authorizes the user's smart account to act as
 * the org against org-mcp.
 */
export async function seedOrgCrossDelegations(pairs: OrgGovernancePair[]): Promise<number> {
  const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}` | undefined
  const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}` | undefined
  const relAddr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}` | undefined
  if (!delegationManagerAddr || !timestampEnforcerAddr || !relAddr) {
    console.warn('[seed-org-deleg] missing env (DELEGATION_MANAGER_ADDRESS, TIMESTAMP_ENFORCER_ADDRESS, AGENT_RELATIONSHIP_ADDRESS)')
    return 0
  }

  const publicClient = getPublicClient()

  let created = 0
  for (const pair of pairs) {
    const { orgAddress, ownerUserId } = pair
    const audience = pair.audience ?? ORG_AUDIENCE
    const grants = pair.grants ?? (audience === PEOPLE_GROUPS_AUDIENCE ? DEFAULT_PEOPLE_GROUPS_GRANTS : DEFAULT_ORG_GRANTS)
    const saltLabel = pair.saltLabel ?? `${audience}:v1`

    const u = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, ownerUserId)).get()
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

    // Build delegation: org's own owner EOA signs as ERC-1271 owner of
    // org's smart account. The deterministic-from-label EOA is the org's
    // initialOwner at factory deploy time (seed-as-self pattern), so
    // `_owners[recovered] == true` in AgentAccount._verifyEcdsa.
    const orgIdentity = await resolveAgentIdentity(orgLower)
    if (!orgIdentity) {
      throw new Error(`[seed-org-deleg] cannot resolve owner EOA for org ${orgLower} — was it deployed via one of the seed-*-onchain files? (no fallback to deployer key)`)
    }
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 365 * 24 * 60 * 60 // 1 year
    const salt = BigInt(keccak256(encodePacked(['address', 'address', 'string'], [orgLower, userSmartAccount, saltLabel])))

    // Sprint 2 S2.3 — bind the cross-delegation to the recipient user's
    // BOTH smart-account AND person-agent. Org-mcp's verifier (and
    // person-mcp's, when this delegation is presented there) asserts
    // both addresses match the session subject.
    const caveats = [
      buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt)),
      buildDataScopeCaveat(grants),
      buildDelegateBindingCaveat(userSmartAccount, personLower),
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
    const signature = await orgIdentity.eoa.signMessage({ message: { raw: delHash } })

    const signedDelegation = {
      ...delegation,
      salt: salt.toString(),
      signature,
      caveats: caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
    }

    const newAudienceEntry = {
      audience,
      delegation: signedDelegation,
      delegationHash: delHash,
      grants,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    }

    // Read existing edge (if any) and merge by audience.
    let existingMetaArray: Array<typeof newAudienceEntry> = []
    let existingEdgeId: `0x${string}` | null = null
    try {
      const computed = await publicClient.readContract({
        address: relAddr, abi: agentRelationshipAbi,
        functionName: 'computeEdgeId',
        args: [orgLower, personLower, DATA_ACCESS_DELEGATION as `0x${string}`],
      }) as `0x${string}`
      const exists = await publicClient.readContract({
        address: relAddr, abi: agentRelationshipAbi,
        functionName: 'edgeExists', args: [computed],
      }) as boolean
      if (exists) {
        existingEdgeId = computed
        const edge = await publicClient.readContract({
          address: relAddr, abi: agentRelationshipAbi,
          functionName: 'getEdge', args: [computed],
        }) as { status: number; metadataURI: string }
        if (edge.status >= 2 && edge.status < 5 && edge.metadataURI) {
          try {
            const parsed = JSON.parse(edge.metadataURI)
            if (Array.isArray(parsed.delegations)) {
              existingMetaArray = parsed.delegations
            } else if (parsed.delegation) {
              // Legacy single-audience form — wrap into array.
              existingMetaArray = [{
                audience: parsed.audience ?? ORG_AUDIENCE,
                delegation: parsed.delegation,
                delegationHash: parsed.delegationHash,
                grants: parsed.grants ?? [],
                expiresAt: parsed.expiresAt,
              }]
            }
          } catch { /* unparseable; replace */ }

          // Idempotency by (audience, delegationHash).
          const already = existingMetaArray.find(
            d => d.audience === audience && d.delegationHash?.toLowerCase() === delHash.toLowerCase(),
          )
          if (already) continue
        }
      }
    } catch { /* fall through to create */ }

    // Merge: replace any existing entry for this audience, else append.
    const merged = [
      ...existingMetaArray.filter(d => d.audience !== audience),
      newAudienceEntry,
    ]
    const metadataURI = JSON.stringify({ delegations: merged })

    try {
      if (existingEdgeId) {
        // Update existing edge via setMetadataURI.
        const wc = getWalletClient()
        const hash = await wc.writeContract({
          address: relAddr, abi: relAbi,
          functionName: 'setMetadataURI',
          args: [existingEdgeId, metadataURI],
        })
        await publicClient.waitForTransactionReceipt({ hash })
        created++
        continue
      }
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
  audience: string = ORG_AUDIENCE,
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

    // New multi-audience form.
    if (Array.isArray(meta.delegations)) {
      const match = meta.delegations.find((d: { audience?: string }) => d.audience === audience)
      if (!match) return null
      return { delegation: match.delegation, delegationHash: match.delegationHash }
    }
    // Legacy single-audience form. Match audience if present, else fall through.
    if (meta.delegation && (meta.audience ?? ORG_AUDIENCE) === audience) {
      return { delegation: meta.delegation, delegationHash: meta.delegationHash }
    }
    return null
  } catch {
    return null
  }
}
