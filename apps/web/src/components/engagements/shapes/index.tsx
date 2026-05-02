/**
 * Shape dispatch — picks the right `<*Workspace>` from a `ShapeResolution`.
 *
 *   resolveShape(...)  // pure: terms.object + cadence → ShapeResolution
 *      │
 *      ▼
 *   <EngagementShapeRouter resolved={r} {...props} />
 *      │
 *      ▼
 *   <CadenceWorkspace> | <OneShotWorkspace> | <TrancheWorkspace> | <GovernanceWorkspace>
 *
 * Spec: docs/specs/engagement-shapes-plan.md §6 (R9).
 */

import type { EngagementWorkspaceProps } from './types'
import { CadenceWorkspace } from './CadenceWorkspace'
import { OneShotWorkspace } from './OneShotWorkspace'
import { TrancheWorkspace } from './TrancheWorkspace'
import { GovernanceWorkspace } from './GovernanceWorkspace'
import { MatchingWorkspace } from './MatchingWorkspace'

export { CadenceWorkspace, OneShotWorkspace, TrancheWorkspace, GovernanceWorkspace, MatchingWorkspace }
export type { EngagementWorkspaceProps } from './types'

export function EngagementShapeRouter(props: EngagementWorkspaceProps) {
  const shape = props.resolvedShape.shape
  switch (shape) {
    case 'matching':   return <MatchingWorkspace {...props} />
    case 'cadence':    return <CadenceWorkspace {...props} />
    case 'oneshot':    return <OneShotWorkspace {...props} />
    case 'tranche':    return <TrancheWorkspace {...props} />
    case 'governance': return <GovernanceWorkspace {...props} />
    default: {
      // Exhaustiveness check — adding a 6th shape requires an explicit case.
      const _exhaustive: never = shape
      throw new Error(`Unknown engagement shape: ${String(_exhaustive)}`)
    }
  }
}
