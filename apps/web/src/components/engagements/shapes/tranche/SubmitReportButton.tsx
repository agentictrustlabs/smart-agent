'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { attachReport } from '@/lib/actions/engagements/tranches.action'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
}

export function SubmitReportButton({
  engagementId,
  trancheIdx,
  prompt,
}: {
  engagementId: string
  trancheIdx: number
  prompt: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [uri, setUri] = useState('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    if (!text.trim()) {
      setErr('Write a short narrative for the report.')
      return
    }
    setErr(null)
    start(async () => {
      const r = await attachReport({
        engagementId,
        trancheIdx,
        reportText: text.trim(),
        reportUri: uri.trim() || undefined,
      })
      if ('error' in r) setErr(r.error)
      else { setOpen(false); setText(''); setUri(''); router.refresh() }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '0.5rem 1rem',
          background: C.accent, color: '#fff',
          border: 'none', borderRadius: 8,
          fontSize: '0.82rem', fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        📤 Submit report
      </button>
    )
  }

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '0.75rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
      flex: 1, minWidth: 280,
    }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Tranche {trancheIdx} · {prompt}
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={4}
        placeholder="Narrative — what happened this period, what's next…"
        style={{
          padding: '0.45rem 0.6rem', borderRadius: 6,
          border: `1px solid ${C.border}`, fontSize: '0.85rem',
          fontFamily: 'inherit', resize: 'vertical',
        }}
      />
      <input
        type="url"
        value={uri}
        onChange={e => setUri(e.target.value)}
        placeholder="Optional link to financials, photos, full report…"
        style={{
          padding: '0.4rem 0.55rem', borderRadius: 6,
          border: `1px solid ${C.border}`, fontSize: '0.82rem',
        }}
      />
      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
        <button type="button" onClick={() => { setOpen(false); setText(''); setUri(''); setErr(null) }} disabled={pending}
          style={{ padding: '0.4rem 0.85rem', background: '#fff', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={pending}
          style={{ padding: '0.4rem 1rem', background: C.accent, color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
          {pending ? 'Submitting…' : 'Submit'}
        </button>
      </div>
      {err && <div style={{ fontSize: '0.75rem', color: '#991b1b' }}>{err}</div>}
    </div>
  )
}
