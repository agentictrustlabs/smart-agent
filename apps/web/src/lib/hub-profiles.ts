export type HubId = 'generic' | 'global-church' | 'catalyst' | 'cil'

export type AgentContextKind = 'collection' | 'cohort' | 'network' | 'lineage' | 'portal'

export interface HubNavItem {
  href: string
  label: string
  /** If true, only show when context has this capability */
  requiresCapability?: string
}

export interface HubProfile {
  id: HubId
  name: string
  description: string
  templateIds: string[]
  contextTerm: string
  contextPlural: string
  defaultContextKind: AgentContextKind
  networkLabel: string
  lineageLabel: string
  overviewLabel: string
  contextsLabel: string
  agentLabel: string
  activityLabel: string
  /** Hub-specific navigation items */
  navItems: HubNavItem[]
}

export interface AgentContextView {
  id: string
  kind: AgentContextKind
  name: string
  description: string
  orgAddress: string
  hubId: HubId
  isDefault?: boolean
}

export const HUB_PROFILES: HubProfile[] = [
  {
    id: 'generic',
    name: 'Trust Workspace',
    description: 'General trust, organization, and agent management workspace.',
    templateIds: [
      'grant-org',
      'service-business',
      'product-collective',
      'investment-club',
      'network',
    ],
    contextTerm: 'Agent Context',
    contextPlural: 'Agent Contexts',
    defaultContextKind: 'collection',
    networkLabel: 'Network',
    lineageLabel: 'Lineage',
    overviewLabel: 'Overview',
    contextsLabel: 'Contexts',
    agentLabel: 'Agents',
    activityLabel: 'Activity',
    navItems: [
      { href: '/dashboard', label: 'Overview' },
      { href: '/agents', label: 'Agents' },
      { href: '/network', label: 'Network' },
      { href: '/treasury', label: 'Treasury' },
      { href: '/reviews', label: 'Reviews' },
      { href: '/settings', label: 'Admin' },
    ],
  },
  {
    id: 'global-church',
    name: 'Global Church',
    description: 'Trust and stewardship portal for churches, agencies, and endorsers.',
    templateIds: [
      'church',
      'denomination',
      'mission-agency',
      'giving-intermediary',
      'accreditation-body',
      'seminary',
    ],
    contextTerm: 'Council',
    contextPlural: 'Councils',
    defaultContextKind: 'cohort',
    networkLabel: 'Church Network',
    lineageLabel: 'Lineage',
    overviewLabel: 'Council View',
    contextsLabel: 'Councils',
    agentLabel: 'Participants',
    activityLabel: 'Activity',
    navItems: [
      { href: '/dashboard', label: 'Council View' },
      { href: '/agents', label: 'Participants' },
      { href: '/network', label: 'Church Network' },
      { href: '/treasury', label: 'Treasury' },
      { href: '/reviews', label: 'Endorsements' },
      { href: '/team', label: 'Members' },
    ],
  },
  {
    id: 'catalyst',
    name: 'Catalyst Network',
    description: 'Community development portal for hubs, circles, and facilitators.',
    templateIds: [
      'catalyst-network',
      'facilitator-hub',
    ],
    contextTerm: 'Network',
    contextPlural: 'Networks',
    defaultContextKind: 'lineage',
    networkLabel: 'Partner Network',
    lineageLabel: 'Lineage',
    overviewLabel: 'Network View',
    contextsLabel: 'Networks',
    agentLabel: 'Participants',
    activityLabel: 'Field Activity',
    navItems: [
      { href: '/dashboard', label: 'Network View' },
      { href: '/agents', label: 'Participants' },
      { href: '/network', label: 'Partner Network' },
      { href: '/genmap', label: 'Lineage' },
      { href: '/activities', label: 'Field Activity' },
      { href: '/members', label: 'Members' },
      { href: '/reviews', label: 'Reviews' },
    ],
  },
  {
    id: 'cil',
    name: 'Collective Impact Labs',
    description: 'Revenue-sharing capital deployment with trust graph, assertions, and conflict resolution.',
    templateIds: [
      'cil-operator',
      'cil-funder',
      'cil-pilot',
      'cil-business',
    ],
    contextTerm: 'Operating Group',
    contextPlural: 'Operating Groups',
    defaultContextKind: 'cohort',
    networkLabel: 'Trust Network',
    lineageLabel: 'Capital Flow',
    overviewLabel: 'Pilot View',
    contextsLabel: 'Groups',
    agentLabel: 'Participants',
    activityLabel: 'Operations',
    navItems: [
      { href: '/dashboard', label: 'Pilot View' },
      { href: '/agents', label: 'Participants' },
      { href: '/network', label: 'Trust Network' },
      { href: '/activities', label: 'Operations' },
      { href: '/members', label: 'Members' },
      { href: '/reviews', label: 'Assertions' },
      { href: '/treasury', label: 'Treasury' },
    ],
  },
]

/**
 * Resolve a hub profile from on-chain hub agent metadata.
 * Falls back to static profiles if hub predicates aren't set.
 */
export async function getHubProfileFromChain(hubAddress: string): Promise<HubProfile | null> {
  try {
    const { getPublicClient } = await import('@/lib/contracts')
    const { agentAccountResolverAbi, ATL_HUB_NAV_CONFIG, ATL_HUB_NETWORK_LABEL, ATL_HUB_CONTEXT_TERM, ATL_HUB_OVERVIEW_LABEL, ATL_HUB_AGENT_LABEL } = await import('@smart-agent/sdk')
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    if (!resolverAddr) return null

    const client = getPublicClient()
    const core = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [hubAddress as `0x${string}`] }) as { displayName: string; description: string }

    const getString = async (pred: `0x${string}`) => {
      try { return await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [hubAddress as `0x${string}`, pred] }) as string } catch { return '' }
    }

    const networkLabel = await getString(ATL_HUB_NETWORK_LABEL as `0x${string}`) || 'Network'
    const contextTerm = await getString(ATL_HUB_CONTEXT_TERM as `0x${string}`) || 'Context'
    const overviewLabel = await getString(ATL_HUB_OVERVIEW_LABEL as `0x${string}`) || 'Overview'
    const agentLabel = await getString(ATL_HUB_AGENT_LABEL as `0x${string}`) || 'Agents'
    const navJson = await getString(ATL_HUB_NAV_CONFIG as `0x${string}`)

    let navItems: HubNavItem[] = [
      { href: '/dashboard', label: overviewLabel },
      { href: '/agents', label: agentLabel },
      { href: '/network', label: networkLabel },
    ]
    if (navJson) {
      try { navItems = JSON.parse(navJson) } catch { /* use defaults */ }
    }

    return {
      id: hubAddress.toLowerCase().slice(0, 10) as HubId,
      name: core.displayName || 'Hub',
      description: core.description || '',
      templateIds: [],
      contextTerm,
      contextPlural: contextTerm + 's',
      defaultContextKind: 'cohort',
      networkLabel,
      lineageLabel: 'Lineage',
      overviewLabel,
      contextsLabel: contextTerm + 's',
      agentLabel,
      activityLabel: 'Activity',
      navItems,
    }
  } catch { return null }
}

const TEMPLATE_TO_HUB = new Map<string, HubId>()
for (const profile of HUB_PROFILES) {
  for (const templateId of profile.templateIds) TEMPLATE_TO_HUB.set(templateId, profile.id)
}

export function getHubProfile(id: HubId | null | undefined): HubProfile {
  return HUB_PROFILES.find(profile => profile.id === id) ?? HUB_PROFILES[0]
}

export function getHubIdForTemplate(templateId: string | null | undefined): HubId {
  if (!templateId) return 'generic'
  return TEMPLATE_TO_HUB.get(templateId) ?? 'generic'
}

export function inferHubId(templateId: string | null | undefined, _capabilities: string[]): HubId {
  if (templateId) return getHubIdForTemplate(templateId)
  return 'generic'
}

export function buildDefaultAgentContexts(args: {
  orgAddress: string
  orgName: string
  orgDescription: string
  hubId: HubId
  capabilities: string[]
  aiAgentCount: number
}): AgentContextView[] {
  const profile = getHubProfile(args.hubId)
  const contexts: AgentContextView[] = [
    {
      id: `portal:${args.orgAddress.toLowerCase()}`,
      kind: 'portal',
      name: `${args.orgName} Portal`,
      description: `Portal view onto ${args.orgName} and its related agents.`,
      orgAddress: args.orgAddress,
      hubId: args.hubId,
    },
    {
      id: `${profile.defaultContextKind}:${args.orgAddress.toLowerCase()}`,
      kind: profile.defaultContextKind,
      name: `${args.orgName} ${profile.contextTerm}`,
      description: args.orgDescription || `${profile.contextTerm} centered on ${args.orgName}.`,
      orgAddress: args.orgAddress,
      hubId: args.hubId,
      isDefault: true,
    },
    {
      id: `network:${args.orgAddress.toLowerCase()}`,
      kind: profile.defaultContextKind === 'lineage' ? 'lineage' : 'network',
      name: `${args.orgName} ${profile.networkLabel}`,
      description: `Graph-derived context for ${args.orgName}.`,
      orgAddress: args.orgAddress,
      hubId: args.hubId,
    },
  ]

  // Note: network context already added above (line 236) — no duplicate needed

  if (args.capabilities.includes('genmap') && profile.defaultContextKind !== 'lineage') {
    contexts.push({
      id: `lineage:${args.orgAddress.toLowerCase()}`,
      kind: 'lineage',
      name: `${args.orgName} ${profile.lineageLabel}`,
      description: `Lineage view including recursive descendant relationships.`,
      orgAddress: args.orgAddress,
      hubId: args.hubId,
    })
  }

  if (args.aiAgentCount > 0) {
    contexts.push({
      id: `collection:${args.orgAddress.toLowerCase()}:agents`,
      kind: 'collection',
      name: `${args.orgName} ${profile.agentLabel}`,
      description: `Collection of AI and human agents associated with ${args.orgName}.`,
      orgAddress: args.orgAddress,
      hubId: args.hubId,
    })
  }

  return contexts
}
