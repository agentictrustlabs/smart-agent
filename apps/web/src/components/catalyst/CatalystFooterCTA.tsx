'use client'

import { useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { WorkMode } from '@/lib/work-queue/types'

// `QuickActivityModal` is a default export and uses Leaflet/router hooks —
// load it client-only so the static page payload stays small.
const QuickActivityModal = dynamic(() => import('./QuickActivityModal'), { ssr: false })

const C = {
  accent: '#8b5e3c',
  accentSoft: '#a87548',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  card: '#ffffff',
}

interface Props {
  mode: WorkMode
  firstOrgAddr: string | null
}

interface Action {
  label: string
  kind: 'log-activity' | 'link'
  href?: string
  defaultActivityType?: string
}

function actionsForMode(mode: WorkMode): Action[] {
  switch (mode) {
    case 'govern':
      return [
        { label: 'Log activity', kind: 'log-activity', defaultActivityType: 'meeting' },
        { label: 'Send update', kind: 'link', href: '/activity' },
        { label: 'Invite', kind: 'link', href: '/people' },
      ]
    case 'route':
      return [
        { label: 'Review requests', kind: 'link', href: '/relationships' },
        { label: 'Log activity', kind: 'log-activity', defaultActivityType: 'follow-up' },
        { label: 'Invite', kind: 'link', href: '/people' },
      ]
    case 'disciple':
    case 'walk':
    case 'discover':
    default:
      return [
        { label: 'Log activity', kind: 'log-activity', defaultActivityType: 'meeting' },
        { label: 'Add to oikos', kind: 'link', href: '/oikos' },
        { label: 'Pray', kind: 'link', href: '/nurture/prayer' },
      ]
  }
}

export function CatalystFooterCTA({ mode, firstOrgAddr }: Props) {
  const actions = actionsForMode(mode)
  const [activityModalOpen, setActivityModalOpen] = useState(false)
  const [activityDefault, setActivityDefault] = useState<string>('meeting')

  function trigger(a: Action) {
    if (a.kind === 'log-activity') {
      setActivityDefault(a.defaultActivityType ?? 'meeting')
      setActivityModalOpen(true)
    }
  }

  return (
    <>
      {/* Desktop: trailing strip. Mobile: fixed bottom bar via responsive class. */}
      <div
        className="catalyst-footer-cta"
        style={{
          display: 'flex',
          gap: '0.5rem',
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '0.6rem 0.75rem',
          marginTop: '1rem',
        }}
      >
        {actions.map(a => {
          if (a.kind === 'link' && a.href) {
            return (
              <Link
                key={a.label}
                href={a.href}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '0.55rem 0.85rem',
                  background: C.accent,
                  color: '#fff',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  textDecoration: 'none',
                }}
              >
                {a.label}
              </Link>
            )
          }
          return (
            <button
              key={a.label}
              type="button"
              onClick={() => trigger(a)}
              disabled={a.kind === 'log-activity' && !firstOrgAddr}
              style={{
                flex: 1,
                padding: '0.55rem 0.85rem',
                background: a.kind === 'log-activity' && !firstOrgAddr ? '#cbd5e1' : C.accent,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: a.kind === 'log-activity' && !firstOrgAddr ? 'not-allowed' : 'pointer',
              }}
              title={a.kind === 'log-activity' && !firstOrgAddr ? 'Join a group first to log activity' : undefined}
            >
              {a.label}
            </button>
          )
        })}
      </div>

      {/* Quick-activity modal (controlled). Uses the first user org as the
          activity scope. */}
      {firstOrgAddr && activityModalOpen && (
        <QuickActivityModal
          orgAddress={firstOrgAddr}
          isOpen={activityModalOpen}
          onClose={() => setActivityModalOpen(false)}
          defaultType={activityDefault}
        />
      )}
    </>
  )
}
