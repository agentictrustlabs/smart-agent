'use server'

/**
 * Org actions used by HubOnboardClient's `org` step and by the hub-home /
 * dropdown "Create organization" surfaces.
 *
 *   - getJoinableOrgsForHub: orgs that are HAS_MEMBER of this hub
 *   - joinOrgAsPerson:       link person agent → org via HAS_MEMBER edge
 *   - createOrgInHub:        deploy a fresh org agent + add it to the hub
 *                             + auto-add caller as a member
 *   - currentUserOrgInHub:    is the current user already in an org under
 *                              this hub?
 */

import { getAddress } from 'viem'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { requireSession, getSession } from '@/lib/auth/session'
import {
  getEdgesBySubject,
  getEdgesByObject,
  getEdge,
  createRelationship,
  confirmRelationship,
  getPublicClient,
} from '@/lib/contracts'
import { getAgentMetadata } from '@/lib/agent-metadata'
import {
  agentAccountResolverAbi,
  TYPE_ORGANIZATION,
  HAS_MEMBER,
  ROLE_MEMBER,
} from '@smart-agent/sdk'
import { deployOrgAgent } from '@/lib/actions/deploy-org-agent.action'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { setAgentTemplateId } from '@/lib/agent-resolver'

const HAS_MEMBER_HEX = (HAS_MEMBER as string).toLowerCase()

export interface JoinableOrg {
  address: string
  displayName: string
  primaryName: string
  description: string
  alreadyMember: boolean
}

/**
 * List orgs that are members of the given hub. Each entry includes whether
 * the *currently-logged-in* user is already a member of that org so the UI
 * can hide redundant "Join" buttons.
 */
export async function getJoinableOrgsForHub(hubAddressInput: string): Promise<JoinableOrg[]> {
  const hubAddress = getAddress(hubAddressInput as `0x${string}`)
  const session = await getSession()
  let personAgent: `0x${string}` | null = null
  if (session) {
    const user = await db.select().from(schema.users)
      .where(eq(schema.users.did, session.userId)).limit(1).then(r => r[0])
    if (user) personAgent = await getPersonAgentForUser(user.id) as `0x${string}` | null
  }

  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr) return []

  const orgs: JoinableOrg[] = []
  let edges: `0x${string}`[] = []
  try { edges = await getEdgesBySubject(hubAddress) } catch { return [] }

  const seen = new Set<string>()
  for (const edgeId of edges) {
    try {
      const edge = await getEdge(edgeId)
      if (!edge) continue
      if ((edge.relationshipType ?? '').toLowerCase() !== HAS_MEMBER_HEX) continue
      const candidate = edge.object_.toLowerCase()
      if (seen.has(candidate)) continue
      seen.add(candidate)

      // Confirm it's an org (not a person agent member of the hub).
      const core = await getPublicClient().readContract({
        address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getCore',
        args: [getAddress(candidate as `0x${string}`)],
      }) as { agentType: `0x${string}`; active: boolean }
      if (core.agentType !== TYPE_ORGANIZATION || !core.active) continue

      const meta = await getAgentMetadata(candidate)
      const alreadyMember = personAgent
        ? await isPersonInOrg(getAddress(candidate as `0x${string}`), personAgent)
        : false
      orgs.push({
        address: candidate,
        displayName: meta.displayName,
        primaryName: meta.primaryName,
        description: meta.description ?? '',
        alreadyMember,
      })
    } catch { /* skip bad edge */ }
  }

  return orgs.sort((a, b) => a.displayName.localeCompare(b.displayName))
}

/** True if the current user already has any org membership in this hub. */
export async function currentUserOrgInHub(hubAddressInput: string): Promise<boolean> {
  const orgs = await getJoinableOrgsForHub(hubAddressInput)
  return orgs.some(o => o.alreadyMember)
}

/**
 * Add the user as a member of an existing org. Writes a HAS_MEMBER edge
 * with subject=org and object=personAgent.
 */
export async function joinOrgAsPerson(orgAddressInput: string): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireSession()
    const user = await db.select().from(schema.users)
      .where(eq(schema.users.did, session.userId)).limit(1).then(r => r[0])
    if (!user?.smartAccountAddress) return { success: false, error: 'no smart account on user row' }
    const personAgent = getAddress(user.smartAccountAddress as `0x${string}`)
    const org = getAddress(orgAddressInput as `0x${string}`)

    // Idempotent: skip if the edge already exists.
    if (await isPersonInOrg(org, personAgent)) {
      return { success: true }
    }

    const edgeId = await createRelationship({
      subject: org,
      object: personAgent,
      roles: [ROLE_MEMBER as `0x${string}`],
      relationshipType: HAS_MEMBER as `0x${string}`,
    })
    await confirmRelationship(edgeId)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'join org failed' }
  }
}

/**
 * Deploy a new org agent, register it, link it to the hub, and add the
 * caller as a member. One server roundtrip from the client's perspective.
 */
export async function createOrgInHub(input: {
  hubAddress: string
  name: string
  description: string
  /** Org template (e.g. 'church', 'service-business'). Persisted via
   *  setAgentTemplateId so downstream views can derive the correct
   *  capabilities, AI agents, and role slots. */
  templateId: string
}): Promise<{ success: boolean; orgAddress?: string; error?: string }> {
  try {
    const session = await requireSession()
    const user = await db.select().from(schema.users)
      .where(eq(schema.users.did, session.userId)).limit(1).then(r => r[0])
    if (!user?.smartAccountAddress) return { success: false, error: 'no smart account on user row' }
    if (!input.name.trim()) return { success: false, error: 'org name is required' }
    if (!input.templateId) return { success: false, error: 'org template is required' }

    // 1. Deploy + register the org agent (existing helper handles smart-account
    // deployment + AgentControl init + AgentAccountResolver registration).
    const deploy = await deployOrgAgent({
      name: input.name.trim(),
      description: input.description.trim(),
      minOwners: 1,
      quorum: 1,
      coOwners: [],
    })
    if (!deploy.success || !deploy.smartAccountAddress) {
      return { success: false, error: deploy.error ?? 'org deployment failed' }
    }
    const orgAddress = getAddress(deploy.smartAccountAddress as `0x${string}`)

    // 1b. Persist the org template so the dashboard, navigation, and AI
    // agent provisioning pick up the right profile downstream. This is a
    // separate write because deployOrgAgent doesn't take a template; if it
    // fails we still return success (org exists, just untagged) and let
    // the UI surface a "no template" fallback.
    try {
      await setAgentTemplateId(orgAddress, input.templateId)
    } catch (err) {
      console.warn('setAgentTemplateId failed (non-fatal):', err)
    }

    // 2. Link the org to the hub (HAS_MEMBER edge subject=hub, object=org).
    const hubAddress = getAddress(input.hubAddress as `0x${string}`)
    try {
      const hubEdge = await createRelationship({
        subject: hubAddress, object: orgAddress,
        roles: [ROLE_MEMBER as `0x${string}`],
        relationshipType: HAS_MEMBER as `0x${string}`,
      })
      await confirmRelationship(hubEdge)
    } catch (err) {
      console.warn('hub HAS_MEMBER write failed:', err)
      // Non-fatal — org is deployed, but admin will need to add it to hub
      // manually. Caller still gets a successful result with the org addr.
    }

    // 3. Auto-add caller as a member of the new org.
    const personAgent = getAddress(user.smartAccountAddress as `0x${string}`)
    try {
      const orgEdge = await createRelationship({
        subject: orgAddress, object: personAgent,
        roles: [ROLE_MEMBER as `0x${string}`],
        relationshipType: HAS_MEMBER as `0x${string}`,
      })
      await confirmRelationship(orgEdge)
    } catch (err) {
      console.warn('org HAS_MEMBER write failed:', err)
    }

    return { success: true, orgAddress }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'create org failed' }
  }
}

async function isPersonInOrg(org: `0x${string}`, person: `0x${string}`): Promise<boolean> {
  try {
    const edges = await getEdgesByObject(person)
    for (const id of edges) {
      try {
        const edge = await getEdge(id)
        if (!edge) continue
        if ((edge.relationshipType ?? '').toLowerCase() !== HAS_MEMBER_HEX) continue
        if (edge.subject.toLowerCase() === org.toLowerCase()) return true
      } catch { /* skip bad edge */ }
    }
  } catch { /* registry unavailable */ }
  return false
}
