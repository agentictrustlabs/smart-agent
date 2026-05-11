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
  const [onboardCta, setOnboardCta] = useState<string | null>(null)

  const onClick = async () => {
    setErr(null)
    setOnboardCta(null)
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
      // The route returns { ok: false, error: { kind, messages?, reason?, ... } }.
      // Surface the underlying message verbatim — the MCP layer's error
      // messages ("not permitted by delegation scope", "stale-candidate",
      // etc.) are the actually useful debugging signal. Falling back to
      // the kind alone lost all the why.
      const e = json?.error ?? {}
      const detail = (Array.isArray(e.messages) && e.messages.length > 0 && e.messages[0])
        || e.reason
        || e.kind
        || `HTTP ${res.status}`
      const detailStr = String(detail)
      // "No active agent session" / "Session expired" mean the user
      // hasn't completed the A2A bootstrap (typical for freshly-
      // connected non-demo users). Flag for the CTA banner.
      const sessionMissing =
        detailStr.includes('No active agent session') ||
        detailStr.includes('Session expired') ||
        detailStr.includes('Invalid or expired session token') ||
        detailStr.includes('No A2A session')
      setErr(detailStr)
      setOnboardCta(sessionMissing ? `/h/${hubSlug}` : null)
      startTransition(() => {
        router.replace(`/h/${hubSlug}/intents/${viewedIntentId}?err=${encodeURIComponent(e.kind ?? 'validation')}`)
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        style={isDisabled ? STYLE.disabled : STYLE.enabled}
        title={err ?? undefined}
      >
        {isBusy ? 'Proposing…' : err ? 'Try again' : 'Propose match'}
      </button>
      {err && (
        <div
          style={{
            fontSize: '0.68rem',
            color: '#991b1b',
            background: '#fef2f2',
            border: '1px solid rgba(153,27,27,0.25)',
            padding: '0.35rem 0.5rem',
            borderRadius: 6,
            maxWidth: 280,
            wordBreak: 'break-word',
          }}
        >
          {err}
          {onboardCta && (
            <a
              href={onboardCta}
              style={{
                display: 'inline-block',
                marginTop: '0.3rem',
                padding: '0.25rem 0.55rem',
                background: '#8b5e3c',
                color: '#fff',
                borderRadius: 5,
                fontWeight: 600,
                fontSize: '0.68rem',
                textDecoration: 'none',
              }}
            >
              Complete agent onboarding →
            </a>
          )}
        </div>
      )}
    </div>
  )
}
