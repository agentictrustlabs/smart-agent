'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useOrgContext } from './OrgContext'
import { getHubProfile } from '@/lib/hub-profiles'

export function ContextSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const {
    orgs, selectedOrg, selectedHub, availableHubs,
    agentContexts, activeContext, primaryRole,
    selectOrg, selectHub, selectAgentContext, loading,
  } = useOrgContext()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (loading) return null

  if (orgs.length === 0) {
    return (
      <div data-component="context-selector">
        <a href="/setup" style={{ color: '#1565c0', fontSize: '0.8rem' }}>Create Organization</a>
      </div>
    )
  }

  const hubProfile = selectedHub ? getHubProfile(selectedHub.id) : null

  function handleOrgChange(address: string) {
    selectOrg(address)
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.set('org', address)
    router.push(`${pathname}?${nextParams.toString()}`)
    setOpen(false)
  }

  function handleContextChange(contextId: string) {
    selectAgentContext(contextId)
    setOpen(false)
  }

  function handleHubChange(hubId: string) {
    selectHub(hubId as Parameters<typeof selectHub>[0])
    setOpen(false)
  }

  return (
    <div ref={ref} data-component="context-selector" style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'transparent', border: '1px solid var(--border)',
          padding: '0.3rem 0.6rem', borderRadius: 6, cursor: 'pointer',
          maxWidth: 280,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activeContext?.name ?? selectedOrg?.name ?? 'Select Context'}
          </div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'flex', gap: '0.4rem' }}>
            {hubProfile && <span>{hubProfile.contextTerm}</span>}
            {primaryRole && <span>· {primaryRole}</span>}
          </div>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.4, flexShrink: 0 }}>
          <path d="M2 4 L5 7 L8 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, width: 320,
          padding: '0.5rem', maxHeight: 400, overflowY: 'auto',
        }}>
          {/* Hub switcher (if multiple hubs) */}
          {availableHubs.length > 1 && (
            <div style={{ marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.2rem 0.5rem', fontWeight: 500 }}>Hub</div>
              {availableHubs.map(hub => (
                <button key={hub.id} onClick={() => handleHubChange(hub.id)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '0.3rem 0.5rem',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
                  background: hub.id === selectedHub?.id ? 'var(--accent-light)' : 'transparent',
                  color: hub.id === selectedHub?.id ? 'var(--accent)' : 'var(--text)',
                  fontWeight: hub.id === selectedHub?.id ? 600 : 400,
                }}>
                  {hub.name}
                </button>
              ))}
            </div>
          )}

          {/* Agent contexts */}
          {agentContexts.length > 0 && (
            <div style={{ marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.2rem 0.5rem', fontWeight: 500 }}>
                {hubProfile?.contextPlural ?? 'Contexts'}
              </div>
              {agentContexts.map(ctx => (
                <button key={ctx.id} onClick={() => handleContextChange(ctx.id)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '0.35rem 0.5rem',
                  border: 'none', borderRadius: 4, cursor: 'pointer',
                  background: ctx.id === activeContext?.id ? 'var(--accent-light)' : 'transparent',
                }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: ctx.id === activeContext?.id ? 600 : 400, color: ctx.id === activeContext?.id ? 'var(--accent)' : 'var(--text)' }}>
                    {ctx.name}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    {ctx.kind}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Org selector (anchor org) */}
          {orgs.length > 1 && (
            <div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.2rem 0.5rem', fontWeight: 500 }}>Anchor Org</div>
              {orgs.map(org => (
                <button key={org.address} onClick={() => handleOrgChange(org.address)} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '0.3rem 0.5rem',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem',
                  background: org.address === selectedOrg?.address ? 'var(--accent-light)' : 'transparent',
                  color: org.address === selectedOrg?.address ? 'var(--accent)' : 'var(--text)',
                  fontWeight: org.address === selectedOrg?.address ? 600 : 400,
                }}>
                  {org.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
