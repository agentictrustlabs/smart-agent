export type HubId = 'generic' | 'global-church' | 'catalyst' | 'cil'

export type AgentContextKind = 'collection' | 'cohort' | 'network' | 'lineage' | 'portal'

export interface HubNavItem {
  href: string
  label: string
  /** Icon key for bottom/primary tabs */
  icon?: string
  /** If set, tab only shows when user has this capability */
  requiresCapability?: string
  /** If set, tab only shows when user has this role */
  requiresRole?: string
  /** Where this item appears in the layout */
  section?: 'primary' | 'secondary' | 'admin' | 'personal'
  /** Contextual sub-tabs shown when this nav item is active */
  subTabs?: Array<{ href: string; label: string; exact?: boolean }>
  /** If true, match exactly (don't match child routes) */
  exact?: boolean
  /** Additional prefixes that should also activate this tab */
  activePrefixes?: string[]
}

export interface HubFeatures {
  circles?: boolean
  prayer?: boolean
  grow?: boolean
  coaching?: boolean
  genmap?: boolean
  activities?: boolean
  treasury?: boolean
  reviews?: boolean
  members?: boolean
  map?: boolean
}

export interface HubTheme {
  accent: string
  accentLight: string
  bg: string
  headerBg: string
  text: string
  textMuted: string
  border: string
  /** Secondary accent (e.g. teal for sub-tabs) */
  secondary: string
  secondaryLight: string
}

export interface HubViewMode {
  key: string
  label: string
  requiresRole?: string
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
  /** Hub-specific navigation items (all sections) */
  navItems: HubNavItem[]
  /** Features/tools available in this hub */
  features: HubFeatures
  /** Color theme */
  theme: HubTheme
  /** Role-specific view modes (e.g., Disciple/Coach switcher) */
  viewModes?: HubViewMode[]
  /** Greeting template (e.g., "Good day, {name}") */
  greetingTemplate?: string
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

// ---------------------------------------------------------------------------
// Helper: filter nav items by section
// ---------------------------------------------------------------------------
export function getNavBySection(profile: HubProfile, section: HubNavItem['section']): HubNavItem[] {
  return profile.navItems.filter(item => item.section === section)
}

// ---------------------------------------------------------------------------
// Hub Profiles
// ---------------------------------------------------------------------------
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
    features: { members: true, reviews: true, treasury: true },
    theme: {
      accent: '#1565c0',
      accentLight: 'rgba(21,101,192,0.10)',
      bg: '#fafafa',
      headerBg: '#ffffff',
      text: '#37474f',
      textMuted: '#90a4ae',
      border: '#e0e0e0',
      secondary: '#1565c0',
      secondaryLight: 'rgba(21,101,192,0.08)',
    },
    navItems: [
      { href: '/catalyst', label: 'Home', section: 'primary', exact: true, activePrefixes: ['/', '/catalyst', '/dashboard'] },
      { href: '/groups', label: 'Organizations', section: 'primary', activePrefixes: ['/groups', '/catalyst/groups', '/agents'] },
      { href: '/steward', label: 'Manage', section: 'primary', activePrefixes: ['/steward', '/treasury', '/reviews', '/network', '/trust'] },
      { href: '/activity', label: 'Activity', section: 'primary', activePrefixes: ['/activity', '/activities'] },
      { href: '/settings', label: 'Settings', section: 'admin', requiresCapability: 'settings' },
      { href: '/me', label: 'Profile', section: 'personal' },
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
    features: {
      circles: true,
      prayer: true,
      grow: true,
      coaching: true,
      genmap: true,
      activities: true,
      members: true,
      reviews: true,
      treasury: true,
    },
    theme: {
      accent: '#8b5e3c',
      accentLight: 'rgba(139,94,60,0.10)',
      bg: '#faf8f3',
      headerBg: '#ffffff',
      text: '#5c4a3a',
      textMuted: '#9a8c7e',
      border: '#ece6db',
      secondary: '#0d9488',
      secondaryLight: 'rgba(13,148,136,0.08)',
    },
    viewModes: [
      { key: 'disciple', label: 'Disciple' },
      { key: 'coach', label: 'Coach', requiresCapability: 'coaching' },
    ],
    greetingTemplate: 'Good day, {name}',
    navItems: [
      { href: '/catalyst', label: 'Home', section: 'primary', exact: true, activePrefixes: ['/', '/catalyst', '/dashboard'] },
      { href: '/agents', label: 'Agents', section: 'primary', activePrefixes: ['/agents'] },
      { href: '/steward', label: 'Management', section: 'primary', activePrefixes: ['/steward', '/treasury', '/reviews', '/network', '/trust', '/groups', '/activity', '/nurture', '/oikos'] },
      { href: '/settings', label: 'Settings', section: 'admin', requiresCapability: 'settings' },
      { href: '/me', label: 'Profile', section: 'personal' },
    ],
  },
  {
    id: 'catalyst',
    name: 'Catalyst NoCo Network',
    description: 'Northern Colorado church planting and Hispanic outreach — circles, discipleship, and community development.',
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
    features: {
      circles: true,
      prayer: true,
      grow: true,
      coaching: true,
      genmap: true,
      activities: true,
      members: true,
      map: true,
    },
    theme: {
      accent: '#8b5e3c',
      accentLight: 'rgba(139,94,60,0.10)',
      bg: '#faf8f3',
      headerBg: '#ffffff',
      text: '#5c4a3a',
      textMuted: '#9a8c7e',
      border: '#ece6db',
      secondary: '#0d9488',
      secondaryLight: 'rgba(13,148,136,0.08)',
    },
    viewModes: [
      { key: 'disciple', label: 'Disciple' },
      { key: 'coach', label: 'Coach', requiresCapability: 'coaching' },
    ],
    greetingTemplate: 'Good day, {name}',
    navItems: [
      { href: '/catalyst', label: 'Home', section: 'primary', exact: true, activePrefixes: ['/', '/catalyst', '/dashboard'] },
      { href: '/nurture', label: 'Nurture', section: 'primary', activePrefixes: ['/nurture', '/catalyst/prayer', '/catalyst/grow', '/catalyst/coach'] },
      { href: '/oikos', label: 'Oikos', section: 'primary', activePrefixes: ['/oikos', '/circles', '/catalyst/circles'] },
      { href: '/groups', label: 'Build', section: 'primary', activePrefixes: ['/groups', '/catalyst/groups', '/catalyst/members', '/catalyst/map'] },
      { href: '/steward', label: 'Steward', section: 'primary', requiresCapability: 'governance', activePrefixes: ['/steward', '/treasury', '/reviews', '/network', '/trust'] },
      { href: '/activity', label: 'Activity', section: 'primary', activePrefixes: ['/activity', '/catalyst/activities', '/activities'] },
      { href: '/agents', label: 'Agents', section: 'admin', requiresCapability: 'agents' },
      { href: '/settings', label: 'Settings', section: 'admin', requiresCapability: 'settings' },
      { href: '/me', label: 'Profile', section: 'personal' },
    ],
  },
  {
    id: 'cil',
    name: 'Mission Collective',
    description: 'Revenue-sharing capital deployment — ILAD operations, Ravah model, business trust graph.',
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
    overviewLabel: 'Command Center',
    contextsLabel: 'Groups',
    agentLabel: 'Participants',
    activityLabel: 'Revenue',
    features: {
      activities: true,
      members: true,
      treasury: true,
      reviews: true,
      genmap: true,
      map: false,
      circles: false,
      prayer: false,
      grow: false,
      coaching: false,
    },
    theme: {
      accent: '#2563EB',
      accentLight: 'rgba(37,99,235,0.08)',
      bg: '#f8fafc',
      headerBg: '#ffffff',
      text: '#1e293b',
      textMuted: '#64748b',
      border: '#e2e8f0',
      secondary: '#10B981',
      secondaryLight: 'rgba(16,185,129,0.08)',
    },
    greetingTemplate: 'Welcome, {name}',
    viewModes: [],
    navItems: [
      { href: '/catalyst', label: 'Command Center', section: 'primary', exact: true, activePrefixes: ['/', '/catalyst', '/dashboard'] },
      { href: '/groups', label: 'Portfolio', section: 'primary', activePrefixes: ['/groups', '/catalyst/groups', '/catalyst/members'] },
      { href: '/activity', label: 'Revenue', section: 'primary', activePrefixes: ['/activity', '/catalyst/activities', '/activities'] },
      { href: '/steward', label: 'Governance', section: 'primary', activePrefixes: ['/steward', '/treasury', '/reviews', '/network', '/trust'] },
      { href: '/nurture', label: 'Training', section: 'primary', activePrefixes: ['/nurture', '/catalyst/grow'] },
      { href: '/agents', label: 'Agents', section: 'admin', requiresCapability: 'agents' },
      { href: '/settings', label: 'Settings', section: 'admin', requiresCapability: 'settings' },
      { href: '/me', label: 'Profile', section: 'personal' },
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
    const {
      agentAccountResolverAbi,
      ATL_HUB_NETWORK_LABEL, ATL_HUB_CONTEXT_TERM,
      ATL_HUB_OVERVIEW_LABEL, ATL_HUB_AGENT_LABEL,
      ATL_HUB_FEATURES, ATL_HUB_THEME, ATL_HUB_VIEW_MODES, ATL_HUB_GREETING,
    } = await import('@smart-agent/sdk')
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
    // navJson read removed — static profiles are authoritative for nav items
    const featuresJson = await getString(ATL_HUB_FEATURES as `0x${string}`)
    const themeJson = await getString(ATL_HUB_THEME as `0x${string}`)
    const viewModesJson = await getString(ATL_HUB_VIEW_MODES as `0x${string}`)
    const greeting = await getString(ATL_HUB_GREETING as `0x${string}`)

    // Try to find a matching static profile by hub name for fallback defaults
    const nameLower = (core.displayName || '').toLowerCase()
    let staticFallback: HubProfile | undefined
    if (nameLower.includes('catalyst')) staticFallback = HUB_PROFILES.find(p => p.id === 'catalyst')
    else if (nameLower.includes('global') && nameLower.includes('church')) staticFallback = HUB_PROFILES.find(p => p.id === 'global-church')
    else if (nameLower.includes('collective') || nameLower.includes('cil')) staticFallback = HUB_PROFILES.find(p => p.id === 'cil')
    const defaultProfile = staticFallback ?? HUB_PROFILES[0]

    // Always use static navItems — on-chain nav config may lack required fields (section, activePrefixes).
    // The static profiles in HUB_PROFILES are the authoritative nav source.
    const navItems: HubNavItem[] = defaultProfile.navItems

    let features: HubFeatures = defaultProfile.features
    if (featuresJson) {
      try { features = JSON.parse(featuresJson) } catch { /* use static fallback */ }
    }

    let theme: HubTheme = defaultProfile.theme
    if (themeJson) {
      try {
        const parsed = JSON.parse(themeJson)
        // Merge with defaults so missing keys fall back gracefully
        theme = { ...defaultProfile.theme, ...parsed }
      } catch { /* use static fallback */ }
    }

    let viewModes: HubViewMode[] | undefined = defaultProfile.viewModes
    if (viewModesJson) {
      try { viewModes = JSON.parse(viewModesJson) } catch { /* use static fallback */ }
    }

    const greetingTemplate = greeting || defaultProfile.greetingTemplate

    return {
      id: defaultProfile.id,
      name: core.displayName || defaultProfile.name,
      description: core.description || defaultProfile.description,
      templateIds: defaultProfile.templateIds,
      contextTerm: contextTerm || defaultProfile.contextTerm,
      contextPlural: (contextTerm ? contextTerm + 's' : defaultProfile.contextPlural),
      defaultContextKind: defaultProfile.defaultContextKind,
      networkLabel: networkLabel || defaultProfile.networkLabel,
      lineageLabel: defaultProfile.lineageLabel,
      overviewLabel: overviewLabel || defaultProfile.overviewLabel,
      contextsLabel: contextTerm ? contextTerm + 's' : defaultProfile.contextsLabel,
      agentLabel: agentLabel || defaultProfile.agentLabel,
      activityLabel: defaultProfile.activityLabel,
      navItems,
      features,
      theme,
      viewModes,
      greetingTemplate,
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

/**
 * Infer hub ID from a demo user key prefix.
 */
export function inferHubIdFromDemoKey(demoUserKey: string | null | undefined): HubId | null {
  if (!demoUserKey) return null
  if (demoUserKey.startsWith('gc-')) return 'global-church'
  if (demoUserKey.startsWith('cat-')) return 'catalyst'
  if (demoUserKey.startsWith('cil-')) return 'cil'
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

  // Note: network context already added above — no duplicate needed

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
