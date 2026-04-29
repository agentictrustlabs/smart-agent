'use client'

/**
 * `<PrincipalContextChip>` — single-line identity strip showing the
 * connected user's working context. Goes at the top of role-shaped
 * surfaces (Home, People, Discover) so the user always sees what
 * the system thinks they are: "Working as Maria · Owner · Catalyst
 * NoCo Network".
 *
 * Phase 2 ships a read-only chip. Phase 3 adds an inline editor:
 * click to suppress one of the dimensions or switch which org you're
 * acting *as* — useful for multi-role users like Maria who govern
 * multiple orgs and need to scope queries by which hat they're wearing.
 *
 * Sources: pulled entirely from `useUserContext` — no new fetches.
 */

import { useUserContext } from '@/components/user/UserContext'
import { defaultModeForRole, availableModesForRole } from '@/lib/work-queue/role-modes'
import { MODE_LABEL } from '@/lib/work-queue/types'

export function PrincipalContextChip() {
  const ctx = useUserContext()
  if (ctx.loading) return <ContextChipSkeleton />

  const name = ctx.personAgent?.name ?? null
  const primaryName = ctx.personAgent?.primaryName ?? null
  const role = ctx.primaryRole
  const primaryOrg = ctx.orgs[0]?.name ?? null
  const orgsCount = ctx.orgs.length
  const mode = defaultModeForRole(role)
  const otherModes = availableModesForRole(role).filter(m => m !== mode)

  if (!name) return null

  return (
    <div
      data-testid="principal-context-chip"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '0.4rem 0.75rem',
        marginBottom: '0.75rem',
        background: '#fdf6ee',
        border: '1px solid #ece6db',
        borderRadius: 999,
        fontSize: 12,
        color: '#5c4a3a',
      }}
    >
      <span style={{ color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, fontSize: 10 }}>
        Working as
      </span>
      <strong style={{ fontWeight: 700 }}>{name}</strong>
      {primaryName && (
        <code style={{ fontFamily: 'monospace', fontSize: 11, color: '#8b5e3c' }}>
          {primaryName}
        </code>
      )}
      {role && (
        <>
          <Separator />
          <span style={{ textTransform: 'capitalize' }}>{role}</span>
        </>
      )}
      {primaryOrg && (
        <>
          <Separator />
          <span>{primaryOrg}{orgsCount > 1 ? ` (+${orgsCount - 1})` : ''}</span>
        </>
      )}
      <Separator />
      <span style={{ fontSize: 11, color: '#64748b' }}>
        Mode: <strong style={{ color: '#5c4a3a' }}>{MODE_LABEL[mode]}</strong>
        {otherModes.length > 0 && (
          <span style={{ color: '#94a3b8' }}> · also {otherModes.map(m => MODE_LABEL[m]).join(', ')}</span>
        )}
      </span>
    </div>
  )
}

function Separator() {
  return <span aria-hidden style={{ color: '#cbd5e1' }}>·</span>
}

function ContextChipSkeleton() {
  return (
    <div
      style={{
        height: 32, marginBottom: '0.75rem',
        background: '#fdf6ee',
        border: '1px solid #ece6db',
        borderRadius: 999,
      }}
    />
  )
}
