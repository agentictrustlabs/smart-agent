'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useOrgContext } from './OrgContext'

export function HubSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { availableHubs, selectedHub, selectHub, loading } = useOrgContext()

  if (loading || availableHubs.length === 0) return null

  function handleChange(hubId: string) {
    selectHub(hubId as Parameters<typeof selectHub>[0])
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set('hub', hubId)
    nextParams.delete('org')
    nextParams.delete('context')
    router.push(`${pathname}?${nextParams.toString()}`)
  }

  return (
    <div data-component="hub-selector">
      {availableHubs.length === 1 ? (
        <span data-component="hub-chip">{selectedHub?.name}</span>
      ) : (
        <select
          value={selectedHub?.id ?? availableHubs[0]?.id ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          data-component="hub-selector-control"
        >
          {availableHubs.map(hub => (
            <option key={hub.id} value={hub.id}>{hub.name}</option>
          ))}
        </select>
      )}
    </div>
  )
}
