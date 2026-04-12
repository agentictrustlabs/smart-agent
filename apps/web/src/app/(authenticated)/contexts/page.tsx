'use client'

import { useRouter } from 'next/navigation'
import { useOrgContext } from '@/components/org/OrgContext'

export default function ContextsPage() {
  const router = useRouter()
  const {
    selectedHub,
    selectedOrg,
    activeContext,
    agentContexts,
    selectAgentContext,
    agentContextTerm,
    loading,
  } = useOrgContext()

  if (loading) return <div data-page="contexts"><p>Loading...</p></div>

  return (
    <div data-page="contexts">
      <div data-component="page-header">
        <h1>{selectedHub?.name ?? 'Contexts'}</h1>
        <p>
          Re-center your workspace on an {agentContextTerm.toLowerCase()}.
          {selectedOrg ? ` Anchor org: ${selectedOrg.name}.` : ''}
        </p>
      </div>

      {selectedOrg && (
        <section data-component="graph-section">
          <div data-component="section-header">
            <h2>Anchor Org</h2>
          </div>
          <div data-component="context-anchor-card">
            <strong>{selectedOrg.name}</strong>
            {selectedOrg.description && <p data-component="text-muted">{selectedOrg.description}</p>}
          </div>
        </section>
      )}

      <section data-component="graph-section">
        <div data-component="section-header">
          <h2>{selectedHub?.contextTerm ?? agentContextTerm}s</h2>
        </div>
        {agentContexts.length === 0 ? (
          <p data-component="text-muted">No contexts available yet.</p>
        ) : (
          <div data-component="context-grid">
            {agentContexts.map(context => {
              const isActive = activeContext?.id === context.id
              return (
                <button
                  key={context.id}
                  data-component="context-card"
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => {
                    selectAgentContext(context.id)
                    const params = new URLSearchParams()
                    if (selectedHub) params.set('hub', selectedHub.id)
                    if (selectedOrg) params.set('org', selectedOrg.address)
                    params.set('context', context.id)
                    router.push(`/dashboard?${params.toString()}`)
                  }}
                >
                  <div data-component="context-card-head">
                    <strong>{context.name}</strong>
                    <span data-component="role-badge" data-status={isActive ? 'active' : 'confirmed'}>
                      {context.kind}
                    </span>
                  </div>
                  <p data-component="text-muted">{context.description}</p>
                  {isActive && <span data-component="context-card-active">Current context</span>}
                </button>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
