import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getEdgesBySubject } from '@/lib/contracts'
import { getPersonAgentForUser, getOrgsForPersonAgent, getAiAgentsForOrg } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getEdge, getEdgeRoles } from '@/lib/contracts'
import { REVIEW_RELATIONSHIP, ROLE_REVIEWER } from '@smart-agent/sdk'
import type { HubProfile } from '@/lib/hub-profiles'
import { getHubProfile, getHubIdForTemplate } from '@/lib/hub-profiles'

/**
 * User-centric context API.
 * Returns everything needed to render the UI for the connected user:
 * - person agent
 * - all orgs with roles
 * - delegations (what the user is authorized to do)
 * - capabilities derived from roles + delegations
 */

export interface UserOrg {
  address: string
  name: string
  description: string
  roles: string[]
  aiAgents: Array<{ address: string; name: string; agentType: string }>
  capabilities: string[]
  hasChildren: boolean
}

export interface UserDelegation {
  id: string
  orgAddress: string
  orgName: string
  type: string // e.g. 'review', 'treasury', 'governance'
  status: string
  expiresAt: string
  caveats: string[]
}

export interface UserHub {
  address: string
  name: string
  description: string
}

export interface UserNavItem {
  href: string
  label: string
  sublabel?: string
  badge?: string
  icon?: string // 'group' | 'person' | 'org' | 'ai'
}

export interface UserNavSection {
  key: string       // 'my-groups', 'my-disciples', 'my-orgs', etc.
  label: string     // "My Groups", "Coaching", "Organizations"
  items: UserNavItem[]
}

export interface UserContextResponse {
  personAgent: { address: string; name: string; primaryName: string } | null
  orgs: UserOrg[]
  delegations: UserDelegation[]
  /** Hub agents the user belongs to (via HAS_MEMBER edges) */
  hubs: UserHub[]
  /** Union of all capabilities across all orgs */
  capabilities: string[]
  /** Union of all roles across all orgs */
  roles: string[]
  /** Resolved hub profile (on-chain data with static fallback) */
  hubProfile: HubProfile | null
  /** Personalized navigation sections based on user's agents and relationships */
  personalNav: UserNavSection[]
}

export async function GET() {
  const empty: UserContextResponse = { personAgent: null, orgs: [], delegations: [], hubs: [], capabilities: [], roles: [], hubProfile: null, personalNav: [] }

  try {
    const { getSession } = await import('@/lib/auth/session')
    const session = await getSession()
    if (!session) return NextResponse.json(empty)

    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    if (!users[0]) return NextResponse.json(empty)

    // Person agent from on-chain — must be deployed (no fallback)
    const personAddr = await getPersonAgentForUser(users[0].id)
    let personAgent: UserContextResponse['personAgent'] = null
    if (personAddr) {
      const meta = await getAgentMetadata(personAddr)
      // Fall back to the DB mirror when the on-chain ATL_PRIMARY_NAME is
      // empty (legacy accounts where the resolver write was skipped). The
      // upper-right surface keys off this primaryName.
      const primaryName = meta.primaryName || users[0].agentName || ''
      personAgent = { address: personAddr, name: meta.displayName, primaryName }
    }

    // All orgs via on-chain edges
    const orgEdges = personAddr ? await getOrgsForPersonAgent(personAddr) : []
    const allRoles = new Set<string>()
    const allCapabilities = new Set<string>()

    const orgs: UserOrg[] = []
    for (const orgEdge of orgEdges) {
      const meta = await getAgentMetadata(orgEdge.address)
      for (const r of orgEdge.roles) allRoles.add(r)

      // AI agents
      const aiAddrs = await getAiAgentsForOrg(orgEdge.address)
      const aiAgents = await Promise.all(
        aiAddrs.map(async addr => {
          const m = await getAgentMetadata(addr)
          return { address: addr, name: m.displayName, agentType: m.aiAgentClass || 'custom' }
        })
      )

      // Capabilities derived from role tools (SDK taxonomy)
      const { getToolsForRoles: resolveTools } = await import('@smart-agent/sdk')
      const roleKeys = orgEdge.roles.map(r => r.toLowerCase())
      const roleTools = resolveTools(roleKeys)
      const caps: string[] = [...roleTools]

      // On-chain structural capabilities
      let hasChildren = false
      try {
        const outEdges = await getEdgesBySubject(orgEdge.address as `0x${string}`)
        if (outEdges.length > 0) {
          hasChildren = true
          if (!caps.includes('genmap')) caps.push('genmap')
          if (!caps.includes('activities')) caps.push('activities')
          if (!caps.includes('members')) caps.push('members')
        }
      } catch { /* ignored */ }
      if (aiAgents.length > 0 && !caps.includes('treasury')) caps.push('treasury')

      const uniqueCaps = [...new Set(caps)]
      for (const c of uniqueCaps) allCapabilities.add(c)

      orgs.push({
        address: orgEdge.address,
        name: meta.displayName,
        description: meta.description,
        roles: orgEdge.roles,
        aiAgents,
        capabilities: uniqueCaps,
        hasChildren,
      })
    }

    // Reviewer authority is derived from active reviewer relationships.
    const delegations: UserDelegation[] = []
    if (personAddr) {
      const edgeIds = await getEdgesBySubject(personAddr as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.relationshipType !== REVIEW_RELATIONSHIP) continue
        if (edge.status < 2) continue
        const roles = await getEdgeRoles(edgeId)
        if (!roles.some(role => role === ROLE_REVIEWER)) continue

        const org = orgs.find(o => o.address.toLowerCase() === edge.object_.toLowerCase())
        delegations.push({
          id: edgeId,
          orgAddress: edge.object_,
          orgName: org?.name ?? edge.object_.slice(0, 10) + '...',
          type: 'review',
          status: 'available',
          expiresAt: '',
          caveats: ['Issued on demand'],
        })
        allCapabilities.add('reviews')
      }
    }

    // Discover hub agents the user belongs to. Two routes:
    //   1. Direct person-agent → hub HAS_MEMBER edge (written by
    //      joinHubAsPerson during onboarding — the user joined a hub
    //      without going through an org).
    //   2. Org → hub HAS_MEMBER edge (org-mediated membership).
    const { getHubsForAgent } = await import('@/lib/agent-registry')
    const hubs: UserHub[] = []
    const seenHubs = new Set<string>()
    if (personAddr) {
      try {
        const hubAddrs = await getHubsForAgent(personAddr)
        for (const hubAddr of hubAddrs) {
          if (seenHubs.has(hubAddr.toLowerCase())) continue
          seenHubs.add(hubAddr.toLowerCase())
          const hubMeta = await getAgentMetadata(hubAddr)
          hubs.push({ address: hubAddr, name: hubMeta.displayName, description: hubMeta.description })
        }
      } catch { /* ignored */ }
    }
    for (const org of orgs) {
      try {
        const hubAddrs = await getHubsForAgent(org.address)
        for (const hubAddr of hubAddrs) {
          if (seenHubs.has(hubAddr.toLowerCase())) continue
          seenHubs.add(hubAddr.toLowerCase())
          const hubMeta = await getAgentMetadata(hubAddr)
          hubs.push({ address: hubAddr, name: hubMeta.displayName, description: hubMeta.description })
        }
      } catch { /* ignored */ }
    }

    // Resolve hub profile from static profiles (authoritative source for nav, features, theme).
    // On-chain hub config is not used — the resolver access control prevents writes after initial deploy.
    let hubProfile: HubProfile | null = null
    {
      // Try to match by hub name from on-chain hub agents
      for (const hub of hubs) {
        const name = hub.name.toLowerCase()
        if (name.includes('catalyst')) { hubProfile = getHubProfile('catalyst'); break }
        if (name.includes('global') && name.includes('church')) { hubProfile = getHubProfile('global-church'); break }
        if (name.includes('collective') || name.includes('cil') || name.includes('mission')) { hubProfile = getHubProfile('cil'); break }
      }
      // If no hub match, infer from org template ID (set during org creation)
      if (!hubProfile && orgs.length > 0) {
        const { getAgentTemplateId } = await import('@/lib/agent-resolver')
        for (const org of orgs) {
          try {
            const templateId = await getAgentTemplateId(org.address)
            if (templateId) {
              hubProfile = getHubProfile(getHubIdForTemplate(templateId))
              break
            }
          } catch { /* ignored */ }
        }
      }
      // Final fallback: generic hub
      if (!hubProfile) {
        hubProfile = getHubProfile('generic')
      }
    }

    // ─── Coach capability from on-chain coaching edges ────────────────
    if (personAddr) {
      try {
        const { COACHING_MENTORSHIP } = await import('@smart-agent/sdk')
        const coachEdges = await getEdgesBySubject(personAddr as `0x${string}`)
        for (const edgeId of coachEdges) {
          const edge = await getEdge(edgeId)
          if (edge.status < 2 || edge.relationshipType !== COACHING_MENTORSHIP) continue
          allCapabilities.add('coaching')
          break
        }
      } catch { /* ignored */ }
    }

    // ─── Build personalNav sections ─────────────────────────────────
    const personalNav: UserNavSection[] = []

    // "My Groups" — orgs the user owns/operates that have children
    const groupOrgs = orgs.filter(o =>
      o.roles.some(r => ['owner', 'operator'].includes(r.toLowerCase())) && o.hasChildren
    )
    if (groupOrgs.length > 0) {
      const groupLabel = hubProfile?.contextTerm === 'Operating Group' ? 'My Portfolio' : 'My Groups'
      personalNav.push({
        key: 'my-groups',
        label: groupLabel,
        items: groupOrgs.map(o => ({
          href: `/catalyst/groups/${o.address}`,
          label: o.name,
          sublabel: o.roles[0],
          icon: 'group',
        })),
      })
    }

    // "Coaching" — disciples the user coaches (from on-chain edges)
    if (personAddr) {
      try {
        const { COACHING_MENTORSHIP } = await import('@smart-agent/sdk')
        const coachEdges = await getEdgesBySubject(personAddr as `0x${string}`)
        const discipleItems: UserNavItem[] = []
        for (const edgeId of coachEdges) {
          const edge = await getEdge(edgeId)
          if (edge.status < 2 || edge.relationshipType !== COACHING_MENTORSHIP) continue
          const discipleMeta = await getAgentMetadata(edge.object_)
          discipleItems.push({
            href: '/catalyst/me',
            label: discipleMeta.displayName,
            sublabel: 'Disciple',
            icon: 'person',
          })
        }
        if (discipleItems.length > 0) {
          personalNav.push({
            key: 'coaching',
            label: 'My Disciples',
            items: discipleItems,
          })
        }
      } catch { /* ignored */ }
    }

    // "Organizations" — all orgs the user belongs to
    if (orgs.length > 0) {
      personalNav.push({
        key: 'my-orgs',
        label: 'Organizations',
        items: orgs.map(o => ({
          href: `/agents/${o.address}`,
          label: o.name,
          sublabel: o.roles.join(', '),
          icon: 'org',
        })),
      })
    }

    // "AI Agents" — AI agents across all orgs
    const allAI = orgs.flatMap(o => o.aiAgents)
    if (allAI.length > 0) {
      personalNav.push({
        key: 'my-agents',
        label: 'AI Agents',
        items: allAI.map(a => ({
          href: `/agents/${a.address}`,
          label: a.name,
          sublabel: a.agentType,
          icon: 'ai',
        })),
      })
    }

    // "Credential wallet" — SSI holder-wallet links (always present)
    personalNav.push({
      key: 'ssi-wallet',
      label: 'Credential wallet',
      items: [
        { href: '/wallet',            label: 'My credentials',   icon: 'wallet'  },
        { href: '/admin/issue',       label: 'Issuer admin',      icon: 'issue'   },
        { href: '/verify/coach',      label: 'Coach verifier',    icon: 'verify'  },
        { href: '/wallet/oid4vci',    label: 'OID4VCI redeem',    icon: 'oidc'    },
      ],
    })

    return NextResponse.json({
      personAgent,
      orgs,
      delegations,
      hubs,
      capabilities: [...allCapabilities],
      roles: [...allRoles],
      hubProfile,
      personalNav,
    } satisfies UserContextResponse)
  } catch {
    return NextResponse.json(empty)
  }
}
