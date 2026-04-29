'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

const QuickActivityModal = dynamic(
  () => import('@/components/catalyst/QuickActivityModal'),
  { ssr: false },
)

const C = { accent: '#8b5e3c' }

/**
 * Need-detail CTA: opens QuickActivityModal pre-filled with this need's
 * `fulfillsNeedId`. Closes the PROV chain end-to-end from the UI:
 *
 *   need-detail → click → modal opens with the need pre-picked
 *     → submit → activity logs with fulfillsNeedId set
 *     → maybeAdvanceNeedStatus runs server-side
 *     → need flips open→in-progress (1st activity)
 *     → need flips in-progress→met (threshold crossed)
 *     → accepted matches flip to fulfilled
 */
export function LogFulfillmentButton({ needId, needTitle, hubId, orgAddress }: {
  needId: string
  needTitle: string
  hubId: string
  orgAddress: string | null
}) {
  const [open, setOpen] = useState(false)
  if (!orgAddress) {
    return (
      <span style={{ fontSize: '0.78rem', color: '#9a8c7e' }}>
        Join an org to log fulfillment activities for this need.
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
          fontSize: '0.8rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        + Log fulfillment activity
      </button>
      {open && (
        <QuickActivityModal
          orgAddress={orgAddress}
          isOpen={open}
          onClose={() => setOpen(false)}
          hubId={hubId}
          defaultFulfillsNeedId={needId}
          defaultTitle={`Toward: ${needTitle}`}
          defaultType="meeting"
        />
      )}
    </>
  )
}
