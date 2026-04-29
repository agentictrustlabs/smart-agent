'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

const QuickActivityModal = dynamic(
  () => import('@/components/catalyst/QuickActivityModal'),
  { ssr: false },
)

const C = { accent: '#8b5e3c' }

export function LogFulfillmentForEntitlementButton({ entitlementId, entitlementTitle, orgAddress, hubId }: {
  entitlementId: string
  entitlementTitle: string
  orgAddress: string
  hubId: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '0.4rem 0.8rem',
          background: C.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: '0.78rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        + Log activity
      </button>
      {open && (
        <QuickActivityModal
          orgAddress={orgAddress}
          isOpen={open}
          onClose={() => setOpen(false)}
          hubId={hubId}
          defaultFulfillsEntitlementId={entitlementId}
          defaultTitle={`Toward: ${entitlementTitle}`}
          defaultType="meeting"
        />
      )}
    </>
  )
}
