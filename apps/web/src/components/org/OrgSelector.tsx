'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useOrgContext } from './OrgContext'

export function OrgSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { orgs, selectedOrg, primaryRole, selectOrg, loading } = useOrgContext()

  if (loading) return null

  if (orgs.length === 0) {
    return (
      <div data-component="org-selector">
        <a href="/setup" style={{ color: '#1565c0', fontSize: '0.8rem' }}>Create Organization</a>
      </div>
    )
  }

  function handleChange(address: string) {
    selectOrg(address)
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set('org', address)
    nextParams.delete('context')
    router.push(`${pathname}?${nextParams.toString()}`)
  }

  return (
    <div data-component="org-selector" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {orgs.length === 1 ? (
        <span data-component="org-selector-chip">{selectedOrg?.name}</span>
      ) : (
        <select
          value={selectedOrg?.address ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          data-component="org-selector-control"
          style={{
            background: '#ffffff', border: '1px solid #e2e4e8', color: '#1a1a2e',
            padding: '0.3rem 0.5rem', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600,
          }}
        >
          {orgs.map((org) => (
            <option key={org.address} value={org.address}>{org.name}</option>
          ))}
        </select>
      )}
      {primaryRole && (
        <span data-component="role-badge" data-status="active" style={{ fontSize: '0.6rem' }}>
          {primaryRole}
        </span>
      )}
    </div>
  )
}
