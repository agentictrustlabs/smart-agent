/**
 * Server-only hub profile helpers.
 *
 * `getHubProfileFromChain` reads on-chain hub metadata and is therefore a
 * server-side function. It MUST live in a `server-only` file so the import
 * graph from client modules (HubLayout → HubContext → hub-profiles) does
 * NOT transitively pull `@/lib/contracts` (and its deep chain into
 * `@google-cloud/kms` / `@grpc/grpc-js`) into the client bundle.
 *
 * Background: this function previously lived in `hub-profiles.ts`. Even
 * though it lazy-loaded `@/lib/contracts` via `await import()`, webpack
 * still added `contracts.ts` to the client module graph (dynamic imports
 * create a chunk boundary but DO NOT prune the static dependency walk).
 * That dragged the entire GCP-KMS / gRPC tree into the client bundle and
 * broke `pnpm --filter @smart-agent/web build` with `Module not found:
 * Can't resolve 'fs'` / `'net'` / `'tls'`.
 *
 * The fix: keep `hub-profiles.ts` strictly client-safe (static data + pure
 * helpers + types) and isolate any chain-reading function here.
 */
import 'server-only'

import {
  getHubProfile,
  HUB_PROFILES,
  type HubProfile,
  type HubNavItem,
  type HubFeatures,
  type HubTheme,
  type HubViewMode,
} from '@/lib/hub-profiles'

/**
 * Resolve a hub profile from on-chain hub agent metadata.
 * Falls back to static profiles if hub predicates aren't set.
 *
 * SERVER ONLY — pulls `@/lib/contracts` (relay wallet client, KMS-backed
 * signer) and the on-chain attribute resolver ABIs.
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
    const defaultProfile = staticFallback ?? getHubProfile('generic')

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
