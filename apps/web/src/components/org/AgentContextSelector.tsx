'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useOrgContext } from './OrgContext'

export function AgentContextSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { agentContexts, activeContext, agentContextTerm, selectAgentContext, loading } = useOrgContext()

  if (loading || agentContexts.length === 0) return null

  function handleChange(contextId: string) {
    selectAgentContext(contextId)
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set('context', contextId)
    router.push(`${pathname}?${nextParams.toString()}`)
  }

  return (
    <div data-component="agent-context-selector">
      {agentContexts.length === 1 ? (
        <span data-component="agent-context-chip">{activeContext?.name ?? agentContextTerm}</span>
      ) : (
        <select
          value={activeContext?.id ?? agentContexts[0]?.id ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          data-component="agent-context-selector-control"
        >
          {agentContexts.map(context => (
            <option key={context.id} value={context.id}>
              {context.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
