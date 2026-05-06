'use client'

/**
 * Spec 001 — Intent Marketplace (Direct Lane). ProposeMatchButton.
 *
 * Client component that POSTs to the propose-match route with the basis
 * snapshot. Surfaces typed errors (`stale-candidate`, `duplicate-pending`,
 * `self-match-excluded`, `visibility-blocked`) by redirecting back to the
 * intent detail with a `?err=...` flag. The Next.js navigation triggers
 * a re-render which surfaces the flash banner from CandidatesSection.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { RankBasis } from '@smart-agent/sdk'

interface ProposeMatchButtonProps {
  hubSlug: string
  viewedIntentId: string
  candidateIntentId: string
  basis: RankBasis
  disabled?: boolean
}

const STYLE = {
  enabled: {
    padding: '0.4rem 0.8rem',
    background: '#8b5e3c',
    color: '#fff',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: '0.78rem',
    border: 'none',
    cursor: 'pointer',
  } as const,
  disabled: {
    padding: '0.4rem 0.8rem',
    background: '#e5e7eb',
    color: '#9ca3af',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: '0.78rem',
    border: 'none',
    cursor: 'not-allowed',
  } as const,
}

export function ProposeMatchButton({
  hubSlug,
  viewedIntentId,
  candidateIntentId,
  basis,
  disabled,
}: ProposeMatchButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const onClick = async () => {
    setErr(null)
    try {
      const res = await fetch(`/h/${hubSlug}/intents/${viewedIntentId}/propose-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIntentId, basis }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.ok) {
        startTransition(() => {
          router.replace(`/h/${hubSlug}/intents/${viewedIntentId}?matched=1`)
          router.refresh()
        })
        return
      }
      const errorKind = json?.error?.kind ?? 'validation'
      setErr(errorKind)
      startTransition(() => {
        router.replace(`/h/${hubSlug}/intents/${viewedIntentId}?err=${encodeURIComponent(errorKind)}`)
        router.refresh()
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      setErr(msg)
    }
  }

  const isBusy = pending
  const isDisabled = disabled || isBusy

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      style={isDisabled ? STYLE.disabled : STYLE.enabled}
      title={err ?? undefined}
    >
      {isBusy ? 'Proposing…' : err ? 'Try again' : 'Propose match'}
    </button>
  )
}
