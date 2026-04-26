'use client'

import { useState } from 'react'
import { CreateOrgDialog } from '@/components/org/CreateOrgDialog'

interface CreateOrgButtonProps {
  hubAddress: string
  hubName: string
  hubId: 'catalyst' | 'cil' | 'global-church' | 'generic'
  /** Override the button label. Default: "Create organization". */
  label?: string
  /** Visual style. */
  variant?: 'primary' | 'inline'
  className?: string
}

/**
 * Client-side wrapper that opens CreateOrgDialog. Server components
 * (HubDashboard, etc.) include this on hub-home pages so users can
 * create an org without leaving the page.
 */
export function CreateOrgButton({
  hubAddress,
  hubName,
  hubId,
  label = 'Create organization',
  variant = 'inline',
  className,
}: CreateOrgButtonProps) {
  const [open, setOpen] = useState(false)

  const style: React.CSSProperties = variant === 'primary'
    ? {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '0.55rem 0.95rem', borderRadius: 8,
        background: '#3f6ee8', color: '#fff', fontSize: 13, fontWeight: 600,
        border: 'none', cursor: 'pointer',
      }
    : {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '0.45rem 0.7rem', borderRadius: 8,
        background: 'transparent', color: '#3f6ee8',
        fontSize: 12, fontWeight: 600,
        border: '1px dashed #94a3b8', cursor: 'pointer',
      }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={style}
        className={className}
        data-testid="hub-home-create-org"
      >
        + {label}
      </button>
      {open && (
        <CreateOrgDialog
          hubAddress={hubAddress}
          hubName={hubName}
          hubId={hubId}
          onCancel={() => setOpen(false)}
          onCreated={() => {
            setOpen(false)
            window.location.reload()
          }}
        />
      )}
    </>
  )
}
