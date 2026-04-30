'use client'

/**
 * ThreadMessageComposer — light client island for posting a 'message' kind
 * entry to the Commitment Thread. Two-way coordination anchored to the
 * engagement (no more leaking into ad-hoc channels).
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §4 G3
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { postEngagementMessage } from '@/lib/actions/engagements/messages.action'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
}

export function ThreadMessageComposer({
  engagementId,
}: {
  engagementId: string
}) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    const body = text.trim()
    if (!body) return
    setErr(null)
    start(async () => {
      const r = await postEngagementMessage({ engagementId, text: body })
      if ('error' in r) {
        setErr(r.error)
      } else {
        setText('')
        router.refresh()
      }
    })
  }

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '0.7rem 0.85rem',
    }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Send a message to the other party — coordination, questions, status…"
        rows={2}
        style={{
          width: '100%',
          fontSize: '0.85rem',
          color: C.text,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.4rem' }}>
        <span style={{ fontSize: '0.68rem', color: C.textMuted }}>
          ⌘/Ctrl + Enter to send · pinned to the thread
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={pending || text.trim() === ''}
          style={{
            padding: '0.4rem 0.85rem',
            background: text.trim() === '' ? '#f3f4f6' : C.accent,
            color: text.trim() === '' ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: '0.78rem',
            fontWeight: 600,
            cursor: text.trim() === '' ? 'not-allowed' : 'pointer',
          }}
        >
          {pending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {err && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: '#991b1b' }}>{err}</div>
      )}
    </div>
  )
}
