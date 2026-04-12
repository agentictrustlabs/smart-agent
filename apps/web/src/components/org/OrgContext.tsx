'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

interface OrgInfo {
  address: string
  name: string
  description: string
  templateId: string | null
}

interface OrgContextValue {
  orgs: OrgInfo[]
  selectedOrg: OrgInfo | null
  userRoles: string[]
  aiAgents: Array<{ address: string; name: string; agentType: string }>
  /** Capabilities of the selected org (drives nav visibility) */
  orgCapabilities: string[]
  selectOrg: (address: string) => void
  loading: boolean
  hasRole: (role: string) => boolean
  hasCapability: (cap: string) => boolean
  primaryRole: string
}

const OrgCtx = createContext<OrgContextValue>({
  orgs: [], selectedOrg: null, userRoles: [], aiAgents: [], orgCapabilities: [],
  selectOrg: () => {}, loading: true, hasRole: () => false, hasCapability: () => false, primaryRole: '',
})

export function useOrgContext() {
  return useContext(OrgCtx)
}

const STORAGE_KEY = 'smart-agent-selected-org'

export function OrgContextProvider({ children }: { children: React.ReactNode }) {
  const [orgs, setOrgs] = useState<OrgInfo[]>([])
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)
  const [rolesByOrg, setRolesByOrg] = useState<Record<string, string[]>>({})
  const [aiByOrg, setAiByOrg] = useState<Record<string, Array<{ address: string; name: string; agentType: string }>>>({})
  const [capsByOrg, setCapsByOrg] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) setSelectedAddress(stored)

    fetch('/api/org-context')
      .then(r => r.json())
      .then(data => {
        setOrgs(data.orgs ?? [])
        setRolesByOrg(data.roles ?? {})
        setAiByOrg(data.aiAgents ?? {})
        setCapsByOrg(data.capabilities ?? {})

        if (!stored && data.orgs?.length > 0) {
          setSelectedAddress(data.orgs[0].address)
          localStorage.setItem(STORAGE_KEY, data.orgs[0].address)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const selectOrg = useCallback((address: string) => {
    setSelectedAddress(address)
    localStorage.setItem(STORAGE_KEY, address)
  }, [])

  const selectedOrg = orgs.find(o => o.address.toLowerCase() === selectedAddress?.toLowerCase()) ?? orgs[0] ?? null
  const userRoles = selectedOrg ? (rolesByOrg[selectedOrg.address.toLowerCase()] ?? []) : []
  const aiAgents = selectedOrg ? (aiByOrg[selectedOrg.address.toLowerCase()] ?? []) : []
  const orgCapabilities = selectedOrg ? (capsByOrg[selectedOrg.address.toLowerCase()] ?? []) : []

  const hasRole = useCallback((role: string) => userRoles.includes(role), [userRoles])
  const hasCapability = useCallback((cap: string) => orgCapabilities.includes(cap), [orgCapabilities])

  const ROLE_PRIORITY = ['owner', 'ceo', 'treasurer', 'authorized-signer', 'board-member', 'admin', 'operator', 'member', 'auditor', 'reviewer']
  const primaryRole = ROLE_PRIORITY.find(r => userRoles.includes(r)) ?? userRoles[0] ?? ''

  return (
    <OrgCtx.Provider value={{ orgs, selectedOrg, userRoles, aiAgents, orgCapabilities, selectOrg, loading, hasRole, hasCapability, primaryRole }}>
      {children}
    </OrgCtx.Provider>
  )
}
