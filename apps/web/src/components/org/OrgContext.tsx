'use client'

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  type AgentContextView,
  buildDefaultAgentContexts,
  getHubProfile,
  inferHubId,
  type HubId,
} from '@/lib/hub-profiles'

interface OrgInfo {
  address: string
  name: string
  description: string
  templateId: string | null
  hubId: HubId
}

interface HubInfo {
  id: HubId
  name: string
  contextTerm: string
}

interface OrgContextValue {
  orgs: OrgInfo[]
  allOrgs: OrgInfo[]
  selectedOrg: OrgInfo | null
  availableHubs: HubInfo[]
  selectedHub: HubInfo | null
  userRoles: string[]
  aiAgents: Array<{ address: string; name: string; agentType: string }>
  /** Capabilities of the selected org (drives nav visibility) */
  orgCapabilities: string[]
  agentContexts: AgentContextView[]
  activeContext: AgentContextView | null
  selectOrg: (address: string) => void
  selectHub: (hubId: HubId) => void
  selectAgentContext: (contextId: string) => void
  loading: boolean
  hasRole: (role: string) => boolean
  hasCapability: (cap: string) => boolean
  primaryRole: string
  agentContextTerm: string
}

const OrgCtx = createContext<OrgContextValue>({
  orgs: [], allOrgs: [], selectedOrg: null, availableHubs: [], selectedHub: null,
  userRoles: [], aiAgents: [], orgCapabilities: [], agentContexts: [], activeContext: null,
  selectOrg: () => {}, selectHub: () => {}, selectAgentContext: () => {},
  loading: true, hasRole: () => false, hasCapability: () => false, primaryRole: '', agentContextTerm: 'Agent Context',
})

export function useOrgContext() {
  return useContext(OrgCtx)
}

const STORAGE_KEY = 'smart-agent-selected-org'
const HUB_STORAGE_KEY = 'smart-agent-selected-hub'
const CONTEXT_STORAGE_KEY = 'smart-agent-selected-context'

export function OrgContextProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const [allOrgs, setAllOrgs] = useState<OrgInfo[]>([])
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)
  const [selectedHubId, setSelectedHubId] = useState<HubId | null>(null)
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null)
  const [rolesByOrg, setRolesByOrg] = useState<Record<string, string[]>>({})
  const [aiByOrg, setAiByOrg] = useState<Record<string, Array<{ address: string; name: string; agentType: string }>>>({})
  const [capsByOrg, setCapsByOrg] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    const storedHub = localStorage.getItem(HUB_STORAGE_KEY) as HubId | null
    const storedContext = localStorage.getItem(CONTEXT_STORAGE_KEY)
    const queryOrg = searchParams.get('org')
    const queryHub = searchParams.get('hub') as HubId | null
    const queryContext = searchParams.get('context')

    if (queryOrg || stored) setSelectedAddress(queryOrg ?? stored)
    if (queryHub || storedHub) setSelectedHubId(queryHub ?? storedHub)
    if (queryContext || storedContext) setSelectedContextId(queryContext ?? storedContext)

    fetch('/api/org-context')
      .then(r => r.json())
      .then(data => {
        const nextCaps = data.capabilities ?? {}
        const nextOrgs: OrgInfo[] = (data.orgs ?? []).map((org: Omit<OrgInfo, 'hubId'>) => ({
          ...org,
          hubId: inferHubId(org.templateId, nextCaps[org.address.toLowerCase()] ?? []),
        }))
        setAllOrgs(nextOrgs)
        setRolesByOrg(data.roles ?? {})
        setAiByOrg(data.aiAgents ?? {})
        setCapsByOrg(nextCaps)

        if (!stored && !queryOrg && nextOrgs.length > 0) {
          setSelectedAddress(nextOrgs[0].address)
          localStorage.setItem(STORAGE_KEY, nextOrgs[0].address)
        }
        if (!storedHub && !queryHub && nextOrgs.length > 0) {
          setSelectedHubId(nextOrgs[0].hubId)
          localStorage.setItem(HUB_STORAGE_KEY, nextOrgs[0].hubId)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [searchParams])

  const selectOrg = useCallback((address: string) => {
    setSelectedAddress(address)
    localStorage.setItem(STORAGE_KEY, address)
  }, [])

  const selectHub = useCallback((hubId: HubId) => {
    setSelectedHubId(hubId)
    localStorage.setItem(HUB_STORAGE_KEY, hubId)
  }, [])

  const selectAgentContext = useCallback((contextId: string) => {
    setSelectedContextId(contextId)
    localStorage.setItem(CONTEXT_STORAGE_KEY, contextId)
  }, [])

  const availableHubs = useMemo<HubInfo[]>(() => {
    const ids = [...new Set(allOrgs.map(org => org.hubId))]
    return ids.map(id => {
      const profile = getHubProfile(id)
      return { id, name: profile.name, contextTerm: profile.contextTerm }
    })
  }, [allOrgs])

  const effectiveHubId = useMemo<HubId | null>(() => {
    if (selectedHubId && availableHubs.some(hub => hub.id === selectedHubId)) return selectedHubId
    return allOrgs[0]?.hubId ?? null
  }, [selectedHubId, availableHubs, allOrgs])

  const orgs = useMemo(() => {
    if (!effectiveHubId) return allOrgs
    return allOrgs.filter(org => org.hubId === effectiveHubId)
  }, [allOrgs, effectiveHubId])

  const selectedOrg = orgs.find(o => o.address.toLowerCase() === selectedAddress?.toLowerCase()) ?? orgs[0] ?? null
  const selectedHub = effectiveHubId ? availableHubs.find(hub => hub.id === effectiveHubId) ?? null : null
  const userRoles = selectedOrg ? (rolesByOrg[selectedOrg.address.toLowerCase()] ?? []) : []
  const aiAgents = selectedOrg ? (aiByOrg[selectedOrg.address.toLowerCase()] ?? []) : []
  const orgCapabilities = selectedOrg ? (capsByOrg[selectedOrg.address.toLowerCase()] ?? []) : []
  const agentContexts = useMemo(() => {
    if (!selectedOrg) return []
    return buildDefaultAgentContexts({
      orgAddress: selectedOrg.address,
      orgName: selectedOrg.name,
      orgDescription: selectedOrg.description,
      hubId: selectedOrg.hubId,
      capabilities: orgCapabilities,
      aiAgentCount: aiAgents.length,
    })
  }, [selectedOrg, orgCapabilities, aiAgents.length])
  const activeContext = agentContexts.find(context => context.id === selectedContextId)
    ?? agentContexts.find(context => context.isDefault)
    ?? agentContexts[0]
    ?? null

  const hasRole = useCallback((role: string) => userRoles.includes(role), [userRoles])
  const hasCapability = useCallback((cap: string) => orgCapabilities.includes(cap), [orgCapabilities])

  const ROLE_PRIORITY = ['owner', 'ceo', 'treasurer', 'authorized-signer', 'board-member', 'admin', 'operator', 'member', 'auditor', 'reviewer']
  const primaryRole = ROLE_PRIORITY.find(r => userRoles.includes(r)) ?? userRoles[0] ?? ''
  const agentContextTerm = selectedHub ? getHubProfile(selectedHub.id).contextTerm : 'Agent Context'

  useEffect(() => {
    if (effectiveHubId) localStorage.setItem(HUB_STORAGE_KEY, effectiveHubId)
  }, [effectiveHubId])

  useEffect(() => {
    if (selectedOrg) localStorage.setItem(STORAGE_KEY, selectedOrg.address)
  }, [selectedOrg])

  useEffect(() => {
    if (activeContext) localStorage.setItem(CONTEXT_STORAGE_KEY, activeContext.id)
  }, [activeContext])

  return (
    <OrgCtx.Provider value={{
      orgs,
      allOrgs,
      selectedOrg,
      availableHubs,
      selectedHub,
      userRoles,
      aiAgents,
      orgCapabilities,
      agentContexts,
      activeContext,
      selectOrg,
      selectHub,
      selectAgentContext,
      loading,
      hasRole,
      hasCapability,
      primaryRole,
      agentContextTerm,
    }}>
      {children}
    </OrgCtx.Provider>
  )
}
