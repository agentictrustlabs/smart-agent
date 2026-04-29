import { DEMO_USER_META } from '@/lib/auth/session'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { defaultModeForRole } from '@/lib/work-queue/role-modes'
import type { WorkMode } from '@/lib/work-queue/types'
import { MyMenteesPanel } from './MyMenteesPanel'
import { MyOikosSnapshotPanel } from './MyOikosSnapshotPanel'
import { PendingTriagePanel } from './PendingTriagePanel'

/**
 * `<DashboardForMode>` — server-component composer that picks the
 * mode-specific panels for the caller's primary role.
 *
 *   disciple mode (Multiplier, Coach, Multi-Gen Coach, Strategist)
 *     → MyMenteesPanel + MyOikosSnapshotPanel
 *   route mode    (Dispatcher, Digital Responder, Network Admin)
 *     → PendingTriagePanel
 *   govern mode   (Owner, Program Director, Board)
 *     → no extra panels (the existing Govern dashboard already has the
 *       skill / geo / trust-search panels right below this)
 *   walk mode     (early disciple)
 *     → no extra panels for now (Phase 5 adds the journey card)
 *
 * Role resolution: prefers the freeform DEMO_USER_META title (richer —
 * "Multiplier" vs the on-chain "operator"), falls back to the first
 * on-chain role we know about.
 */

interface Props {
  /** Caller's on-chain roles (already loaded by parent so we don't refetch). */
  onChainRoles: string[]
}

export async function DashboardForMode({ onChainRoles }: Props) {
  const me = await getCurrentUser()
  const role = pickRoleForUser(me?.did ?? null, onChainRoles)
  const mode: WorkMode = defaultModeForRole(role)

  switch (mode) {
    case 'disciple':
      return (
        <>
          <MyMenteesPanel />
          <MyOikosSnapshotPanel />
        </>
      )
    case 'route':
      return <PendingTriagePanel />
    case 'walk':
    case 'govern':
    case 'discover':
    default:
      return null
  }
}

function pickRoleForUser(did: string | null, onChainRoles: string[]): string {
  if (did) {
    for (const meta of Object.values(DEMO_USER_META)) {
      if (meta.userId === did) return meta.role
    }
  }
  return onChainRoles[0] ?? ''
}
