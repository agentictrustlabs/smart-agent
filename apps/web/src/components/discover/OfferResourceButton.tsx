'use client'

import { useState } from 'react'
import { OfferResourceDialog } from './OfferResourceDialog'

const C = { accent: '#8b5e3c' }

export function OfferResourceButton({ hubId, myAgent }: { hubId: string; myAgent: string | null }) {
  const [open, setOpen] = useState(false)
  if (!myAgent) {
    return (
      <span style={{ fontSize: '0.78rem', color: '#9a8c7e' }}>
        Sign in with a person agent to publish offerings.
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '0.5rem 0.9rem',
          background: C.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: '0.85rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        + Offer something
      </button>
      <OfferResourceDialog
        open={open}
        onClose={() => setOpen(false)}
        hubId={hubId}
        myAgent={myAgent}
      />
    </>
  )
}
