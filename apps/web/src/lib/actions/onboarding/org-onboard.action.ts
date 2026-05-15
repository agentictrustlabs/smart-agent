'use server'

/**
 * Org actions used by HubOnboardClient's `org` step and by the hub-home /
 * dropdown "Create organization" surfaces.
 *
 * Phase 4 — HAS_MEMBER edge writes route via the person-mcp
 * `relationship:emit_edge` + `relationship:set_edge_status` tools so the
 * web layer no longer signs them with the deployer wallet.
 *
 *   - getJoinableOrgsForHub: orgs that are HAS_MEMBER of this hub
 *   - joinOrgAsPerson:       link person agent → org via HAS_MEMBER edge
 *   - createOrgInHub:        deploy a fresh org agent + add it to the hub
 *                             + auto-add caller as a member
 *   - currentUserOrgInHub:    is the current user already in an org under
 *                              this hub?
 */

import { getAddress, type Hex } from 'viem'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { requireSession, getSession } from '@/lib/auth/session'
import {
  getEdgesBySubject,
  getEdgesByObject,
  getEdge,
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
import { ATL_TEMPLATE_ID } from '@/lib/agent-resolver'
import { callMcp } from '@/lib/clients/mcp-client'

const HAS_MEMBER_HEX = (HAS_MEMBER as string).toLowerCase()

export interface JoinableOrg {
  address: string
  displayName: string
  primaryName: string
  description: string
  alreadyMember: boolean
}

export async function getJoinableOrgsForHub(hubAddressInput: string): Promise<JoinableOrg[]> {
  const hubAddress = getAddress(hubAddressInput as `0x${string}`)
  const session = await getSession()
  let personAgent: `0x${string}` | null = null
  if (session) {
    const stateless = session.via === 'passkey' || session.via === 'siwe'
    if (stateless && session.smartAccountAddress) {
      personAgent = getAddress(session.smartAccountAddress as `0x${string}`)
    } else {
      const user = await db.select().from(schema.localUserAccounts)
        .where(eq(schema.localUserAccounts.did, session.userId)).limit(1).then(r => r[0])
      if (user) personAgent = await getPersonAgentForUser(user.id) as `0x${string}` | null
    }
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

export async function currentUserOrgInHub(hubAddressInput: string): Promise<boolean> {
  const orgs = await getJoinableOrgsForHub(hubAddressInput)
  return orgs.some(o => o.alreadyMember)
}

async function emitConfirmedActiveEdge(opts: {
  delegateFrom: `0x${string}`
  subject: `0x${string}`
  object: `0x${string}`
  relationshipType: `0x${string}`
  roles: `0x${string}`[]
}): Promise<Hex> {
  const r = await callMcp<{ ok: true; edgeId: Hex }>(
    'person',
    'relationship:emit_edge',
    {
      subject: opts.subject,
      object: opts.object,
      relationshipType: opts.relationshipType,
      roles: opts.roles,
    },
    { agentAddress: opts.delegateFrom },
  )
  await callMcp('person', 'relationship:set_edge_status',
    { edgeId: r.edgeId, newStatus: 2 },
    { agentAddress: opts.delegateFrom }).catch(() => undefined)
  await callMcp('person', 'relationship:set_edge_status',
    { edgeId: r.edgeId, newStatus: 3 },
    { agentAddress: opts.delegateFrom }).catch(() => undefined)
  return r.edgeId
}

export async function joinOrgAsPerson(orgAddressInput: string): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireSession()
    const stateless = session.via === 'passkey' || session.via === 'siwe'
    const smartAcctRaw = stateless
      ? session.smartAccountAddress
      : await db.select().from(schema.localUserAccounts)
          .where(eq(schema.localUserAccounts.did, session.userId)).limit(1)
          .then(r => r[0]?.smartAccountAddress ?? null)
    if (!smartAcctRaw) return { success: false, error: 'no smart account on session' }
    const personAgent = getAddress(smartAcctRaw as `0x${string}`)
    const org = getAddress(orgAddressInput as `0x${string}`)

    if (await isPersonInOrg(org, personAgent)) {
      return { success: true }
    }

    await emitConfirmedActiveEdge({
      delegateFrom: personAgent,
      subject: org,
      object: personAgent,
      roles: [ROLE_MEMBER as `0x${string}`],
      relationshipType: HAS_MEMBER as `0x${string}`,
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'join org failed' }
  }
}

export async function createOrgInHub(input: {
  hubAddress: string
  name: string
  description: string
  templateId: string
}): Promise<{ success: boolean; orgAddress?: string; error?: string }> {
  try {
    const session = await requireSession()
    const stateless = session.via === 'passkey' || session.via === 'siwe'
    const smartAcctRaw = stateless
      ? session.smartAccountAddress
      : await db.select().from(schema.localUserAccounts)
          .where(eq(schema.localUserAccounts.did, session.userId)).limit(1)
          .then(r => r[0]?.smartAccountAddress ?? null)
    if (!smartAcctRaw) return { success: false, error: 'no smart account on session' }
    if (!input.name.trim()) return { success: false, error: 'org name is required' }
    if (!input.templateId) return { success: false, error: 'org template is required' }

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

    try {
      await callMcp(
        'org',
        'agent_resolver:set_string_property',
        {
          agentAddress: orgAddress,
          predicate: ATL_TEMPLATE_ID,
          value: input.templateId,
        },
        { agentAddress: orgAddress },
      )
    } catch (err) {
      console.warn('agent_resolver:set_string_property(TEMPLATE_ID) failed (non-fatal):', err)
    }

    const hubAddress = getAddress(input.hubAddress as `0x${string}`)
    const personAgent = getAddress(smartAcctRaw as `0x${string}`)

    try {
      await emitConfirmedActiveEdge({
        delegateFrom: personAgent,
        subject: hubAddress,
        object: orgAddress,
        relationshipType: HAS_MEMBER as `0x${string}`,
        roles: [ROLE_MEMBER as `0x${string}`],
      })
    } catch (err) {
      console.warn('hub HAS_MEMBER write failed:', err)
    }

    try {
      await emitConfirmedActiveEdge({
        delegateFrom: personAgent,
        subject: orgAddress,
        object: personAgent,
        relationshipType: HAS_MEMBER as `0x${string}`,
        roles: [ROLE_MEMBER as `0x${string}`],
      })
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
