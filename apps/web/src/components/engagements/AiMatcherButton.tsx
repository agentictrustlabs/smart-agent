'use client'

/**
 * AiMatcherButton — fires one round of AI matching for the current hub.
 *
 * Renders a button + an inline result panel showing the agent's reasoning
 * for each match it considered (accepted, skipped, errored).
 *
 * Spec: docs/specs/engagement-shapes-plan.md §R18
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface AiMatchDecision {
  intentId: string
  intentTitle: string
  selectedMatchId: string
  selectedScore: number
  rejectedMatchIds: string[]
  reasoning: string
  skippedReason?: string
}

interface AiMatchRoundResult {
  matcherAgentName: string
  considered: number
  accepted: number
  skipped: number
  decisions: AiMatchDecision[]
  errors: Array<{ matchId: string; error: string }>
}

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  aiBg: '#f5f3ff', aiBorder: '#c4b5fd', aiFg: '#6d28d9',
  acceptedBg: '#dcfce7', acceptedFg: '#166534',
  skippedBg: '#fef3c7', skippedFg: '#92400e',
}

export function AiMatcherButton({ hubId }: { hubId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<AiMatchRoundResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function run() {
    setErr(null)
    setResult(null)
    start(async () => {
      try {
        const res = await fetch(`/api/ai-matcher/run?hubId=${encodeURIComponent(hubId)}`, {
          method: 'POST',
        })
        const data = await res.json()
        if (!res.ok) {
          setErr(data.error ?? 'AI matcher failed')
          return
        }
        setResult(data)
        router.refresh()
      } catch (e) {
        setErr((e as Error).message)
      }
    })
  }

  return (
    <div style={{
      background: C.aiBg,
      border: `1px solid ${C.aiBorder}`,
      borderRadius: 12,
      padding: '0.85rem 1rem',
      marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.aiFg, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            🤖 AI matcher
          </div>
          <div style={{ fontSize: '0.85rem', color: C.text, marginTop: '0.2rem' }}>
            Run one round: the AI agent looks at proposed matches, picks the highest-scored per intent, and accepts on your behalf.
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          style={{
            padding: '0.55rem 1.1rem',
            background: C.aiFg, color: '#fff',
            border: 'none', borderRadius: 8,
            fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {pending ? 'Running…' : 'Run AI matcher'}
        </button>
      </div>

      {err && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: '#991b1b' }}>
          {err}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '0.85rem' }}>
          <div style={{ fontSize: '0.78rem', color: C.text, marginBottom: '0.45rem' }}>
            <strong>{result.matcherAgentName}</strong> considered {result.considered} proposed match{result.considered === 1 ? '' : 'es'}:
            {' '}<span style={{ color: C.acceptedFg, fontWeight: 600 }}>{result.accepted} accepted</span>,
            {' '}<span style={{ color: C.skippedFg, fontWeight: 600 }}>{result.skipped} skipped</span>
            {result.errors.length > 0 && <>, {result.errors.length} errored</>}.
          </div>
          {result.decisions.length === 0 && (
            <div style={{ fontSize: '0.78rem', color: C.textMuted, fontStyle: 'italic' }}>
              No proposed matches in this hub right now.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {result.decisions.map(d => {
              const accepted = !d.skippedReason
              const tone = accepted
                ? { bg: C.acceptedBg, fg: C.acceptedFg, label: '✓ Accepted' }
                : { bg: C.skippedBg, fg: C.skippedFg, label: '⏸ Skipped' }
              return (
                <div key={d.selectedMatchId} style={{
                  background: '#fff',
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: '0.55rem 0.75rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.85rem', color: C.text, fontWeight: 600, flex: 1, minWidth: 0 }}>
                      {d.intentTitle}
                    </div>
                    <span style={{
                      fontSize: '0.6rem', fontWeight: 700,
                      padding: '0.18rem 0.5rem', borderRadius: 999,
                      background: tone.bg, color: tone.fg,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      {tone.label} · {d.selectedScore / 100}%
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: C.textMuted, marginTop: '0.3rem' }}>
                    {d.reasoning}
                    {d.skippedReason && <> <em>({d.skippedReason})</em></>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
