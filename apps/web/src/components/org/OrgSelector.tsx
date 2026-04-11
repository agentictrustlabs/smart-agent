'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useOrgContext } from './OrgContext'

export function OrgSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const { orgs, selectedOrg, primaryRole, selectOrg, loading } = useOrgContext()

  if (loading) return null

  if (orgs.length === 0) {
    return (
      <div data-component="org-selector">
        <a href="/setup" style={{ color: '#2563eb', fontSize: '0.8rem' }}>Create Organization</a>
      </div>
    )
  }

  function handleChange(address: string) {
    selectOrg(address)
    // Update URL so server components can read the selected org
    const orgPages = ['/dashboard', '/team', '/treasury', '/agents']
    if (orgPages.some(p => pathname.startsWith(p))) {
      router.push(`${pathname}?org=${address}`)
    }
  }

  return (
    <div data-component="org-selector" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {orgs.length === 1 ? (
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{selectedOrg?.name}</span>
      ) : (
        <select
          value={selectedOrg?.address ?? ''}
          onChange={(e) => handleChange(e.target.value)}
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
