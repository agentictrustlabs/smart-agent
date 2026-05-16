'use client'

/**
 * HubShell — outer layout grid for the hub application shell.
 *
 * Responsibilities:
 *   - Full-height flex column (header + main + optional status bar)
 *   - Passes the background color from the hub theme
 *   - Provides a stable DOM structure so child content renders predictably
 *
 * This is a thin layout primitive. Business logic stays in HubLayoutInner.
 */

interface HubShellProps {
  children: React.ReactNode
  bg: string
}

export function HubShell({ children, bg }: HubShellProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: bg,
      }}
    >
      {children}
    </div>
  )
}
