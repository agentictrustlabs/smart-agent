export type HubId = 'generic' | 'global-church' | 'ilad' | 'cpm' | 'catalyst'

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
    id: 'ilad',
    name: 'ILAD Capital',
    description: 'Capital deployment, training, revenue, and governance workspace.',
    templateIds: [
      'impact-investor',
      'field-agency',
      'oversight-committee',
      'portfolio-business',
    ],
    contextTerm: 'Operating Group',
    contextPlural: 'Operating Groups',
    defaultContextKind: 'cohort',
    networkLabel: 'Delivery Network',
    lineageLabel: 'Growth Tree',
    overviewLabel: 'Operating View',
    contextsLabel: 'Groups',
    agentLabel: 'Operators',
    activityLabel: 'Operations',
    navItems: [
      { href: '/dashboard', label: 'Operating View' },
      { href: '/agents', label: 'Operators' },
      { href: '/network', label: 'Delivery Network' },
      { href: '/portfolio', label: 'Portfolio' },
      { href: '/revenue', label: 'Revenue' },
      { href: '/training', label: 'Training' },
      { href: '/governance', label: 'Governance' },
      { href: '/treasury', label: 'Treasury' },
    ],
  },
  {
    id: 'cpm',
    name: 'Church Planting Movement',
    description: 'Movement tracking portal for teams, groups, and multiplication streams.',
    templateIds: [
      'movement-network',
      'church-planting-team',
      'local-group',
    ],
    contextTerm: 'Movement',
    contextPlural: 'Movements',
    defaultContextKind: 'lineage',
    networkLabel: 'Movement Network',
    lineageLabel: 'Lineage',
    overviewLabel: 'Movement View',
    contextsLabel: 'Movements',
    agentLabel: 'Field Agents',
    activityLabel: 'Field Activity',
    navItems: [
      { href: '/dashboard', label: 'Movement View' },
      { href: '/agents', label: 'Field Agents' },
      { href: '/network', label: 'Movement Network' },
      { href: '/genmap', label: 'Lineage' },
      { href: '/activities', label: 'Field Activity' },
      { href: '/members', label: 'Members' },
      { href: '/reviews', label: 'Reviews' },
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
]

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

export function inferHubId(templateId: string | null | undefined, capabilities: string[]): HubId {
  if (templateId) return getHubIdForTemplate(templateId)
  if (capabilities.includes('portfolio') || capabilities.includes('revenue') || capabilities.includes('training')) return 'ilad'
  if (capabilities.includes('genmap') || capabilities.includes('activities')) return 'cpm'
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

  if (profile.defaultContextKind !== 'lineage') {
    contexts.push({
      id: `network:${args.orgAddress.toLowerCase()}`,
      kind: 'network',
      name: `${args.orgName} ${profile.networkLabel}`,
      description: `Graph-derived context for ${args.orgName}.`,
      orgAddress: args.orgAddress,
      hubId: args.hubId,
    })
  }

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
