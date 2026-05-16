'use client'

/**
 * ActionBadge — count badge rendered inside nav items to signal pending
 * actions (funding milestones, votes, invites). Keeps the nav compact by
 * capping display at 99+.
 *
 * Usage:
 *   <span className="relative">
 *     Funding
 *     <ActionBadge count={3} />
 *   </span>
 */

interface ActionBadgeProps {
  count: number
  /** Accessible label suffix, e.g. "funding milestones" → "3 funding milestones pending" */
  label?: string
}

export function ActionBadge({ count, label }: ActionBadgeProps) {
  if (count <= 0) return null
  const display = count > 99 ? '99+' : String(count)
  return (
    <span
      aria-label={label ? `${display} ${label} pending` : `${display} pending`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        borderRadius: 999,
        background: '#b91c1c',
        color: '#fff',
        fontSize: '0.6rem',
        fontWeight: 700,
        padding: '0 4px',
        lineHeight: 1,
        marginLeft: 4,
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    >
      {display}
    </span>
  )
}
