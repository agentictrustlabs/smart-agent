'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import type { UserContextResponse, UserOrg, UserDelegation, UserHub } from '@/app/api/user-context/route'

interface UserContextValue {
  /** Connected user's person agent */
  personAgent: { address: string; name: string } | null
  /** All organizations the user has roles in */
  orgs: UserOrg[]
  /** Active delegations granted to this user */
  delegations: UserDelegation[]
  /** Hub agents the user belongs to */
  hubs: UserHub[]
  /** Union of all capabilities across all orgs + delegations */
  capabilities: string[]
  /** Union of all roles across all orgs */
  roles: string[]
  /** Loading state */
  loading: boolean
  /** Check if user has a specific capability (across any org) */
  hasCapability: (cap: string) => boolean
  /** Check if user has a specific role (in any org) */
  hasRole: (role: string) => boolean
  /** Get orgs where user has a specific role */
  orgsWithRole: (role: string) => UserOrg[]
  /** Get orgs where user has a specific capability */
  orgsWithCapability: (cap: string) => UserOrg[]
  /** Primary role (highest priority across all orgs) */
  primaryRole: string
}

const UserCtx = createContext<UserContextValue>({
  personAgent: null, orgs: [], delegations: [], hubs: [], capabilities: [], roles: [],
  loading: true, hasCapability: () => false, hasRole: () => false,
  orgsWithRole: () => [], orgsWithCapability: () => [], primaryRole: '',
})

export function useUserContext() {
  return useContext(UserCtx)
}

const ROLE_PRIORITY = ['owner', 'ceo', 'treasurer', 'authorized-signer', 'board-member', 'admin', 'operator', 'member', 'auditor', 'reviewer']

export function UserContextProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<UserContextResponse>({
    personAgent: null, orgs: [], delegations: [], hubs: [], capabilities: [], roles: [],
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/user-context')
      .then(r => r.json())
      .then((d: UserContextResponse) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const hasCapability = useCallback((cap: string) => data.capabilities.includes(cap), [data.capabilities])
  const hasRole = useCallback((role: string) => data.roles.includes(role), [data.roles])

  const orgsWithRole = useCallback((role: string) =>
    data.orgs.filter(o => o.roles.some(r => r.toLowerCase() === role.toLowerCase())),
    [data.orgs])

  const orgsWithCapability = useCallback((cap: string) =>
    data.orgs.filter(o => o.capabilities.includes(cap)),
    [data.orgs])

  const primaryRole = useMemo(() =>
    ROLE_PRIORITY.find(r => data.roles.includes(r)) ?? data.roles[0] ?? '',
    [data.roles])

  return (
    <UserCtx.Provider value={{
      personAgent: data.personAgent,
      orgs: data.orgs,
      delegations: data.delegations,
      hubs: data.hubs,
      capabilities: data.capabilities,
      roles: data.roles,
      loading,
      hasCapability,
      hasRole,
      orgsWithRole,
      orgsWithCapability,
      primaryRole,
    }}>
      {children}
    </UserCtx.Provider>
  )
}
