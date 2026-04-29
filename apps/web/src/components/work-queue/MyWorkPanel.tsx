'use client'

/**
 * `<MyWorkPanel>` — the unified work queue surface for the connected
 * user. Sits at the top of `HubDashboard` and answers "what should I
 * do next?" before any KPI or feed loads.
 *
 * Driven entirely by `listMyWorkItemsAction` (no local DB writes).
 * The mode picker filters which kinds surface; mode buckets show
 * counts per mode so the user can see at a glance whether to switch.
 *
 * Role mapping: the user's freeform role string (from
 * DEMO_USER_META, surfaced via UserContext) selects a default mode +
 * a list of pinnable secondaries. Network admins land on Govern;
 * circle leaders / multipliers land on Disciple; members land on
 * Walk; etc. The user can switch at any time and the picker
 * remembers their choice in sessionStorage for the rest of the tab.
 */

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { listMyWorkItemsAction } from '@/lib/work-queue/aggregator'
import {
  type WorkItem, type WorkMode, MODE_LABEL, MODE_EMPTY_HINT,
} from '@/lib/work-queue/types'
import { defaultModeForRole, availableModesForRole } from '@/lib/work-queue/role-modes'
import { useUserContext } from '@/components/user/UserContext'

const SESSION_MODE_KEY = 'smart-agent.work-queue.mode'

export function MyWorkPanel() {
  const ctx = useUserContext()
  const role = ctx.primaryRole

  // Mode state. Default seeded from role; persisted in sessionStorage
  // so a Maria-as-Govern user doesn't snap back every page nav.
  const [mode, setModeState] = useState<WorkMode>('govern')
  const [items, setItems] = useState<WorkItem[] | null>(null)
  const [buckets, setBuckets] = useState<Record<WorkMode, number>>({
    govern: 0, disciple: 0, route: 0, walk: 0, discover: 0,
  })
  const [pending, start] = useTransition()
  const available = availableModesForRole(role)

  function setMode(m: WorkMode) {
    setModeState(m)
    try { window.sessionStorage.setItem(SESSION_MODE_KEY, m) } catch { /* */ }
  }

  // Initial mode pick — sessionStorage > role default. Run once.
  useEffect(() => {
    let initial: WorkMode | null = null
    try {
      const stored = window.sessionStorage.getItem(SESSION_MODE_KEY) as WorkMode | null
      if (stored && (['govern','disciple','route','walk','discover'] as const).includes(stored as WorkMode)) {
        initial = stored
      }
    } catch { /* */ }
    setModeState(initial ?? defaultModeForRole(role))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  // Refetch when mode changes.
  useEffect(() => {
    start(async () => {
      const r = await listMyWorkItemsAction({ mode })
      setItems(r.items)
      setBuckets(r.modeBuckets)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const totalUnfiltered = Object.values(buckets).reduce((a, b) => a + b, 0)

  return (
    <div style={{
      background: '#fff', border: '1px solid #ece6db', borderRadius: 12,
      padding: '1rem 1.25rem', marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{
          fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e',
          textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0,
        }}>My Work</h2>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {pending ? 'loading…' : `${totalUnfiltered} item${totalUnfiltered === 1 ? '' : 's'} across modes`}
        </span>
      </div>

      <ModePicker mode={mode} available={available} buckets={buckets} onChange={setMode} />
      <QueuePanel items={items} mode={mode} pending={pending} />
    </div>
  )
}

// ─── ModePicker ───────────────────────────────────────────────────

function ModePicker(props: {
  mode: WorkMode
  available: WorkMode[]
  buckets: Record<WorkMode, number>
  onChange: (m: WorkMode) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      {props.available.map(m => {
        const active = m === props.mode
        const count = props.buckets[m]
        return (
          <button
            key={m}
            type="button"
            onClick={() => props.onChange(m)}
            data-testid={`work-mode-${m}`}
            style={{
              padding: '0.25rem 0.65rem',
              borderRadius: 999,
              border: `1px solid ${active ? '#8b5e3c' : '#ece6db'}`,
              background: active ? '#fdf6ee' : '#fff',
              color: active ? '#5c4a3a' : '#64748b',
              fontSize: 12,
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {MODE_LABEL[m]}
            {count > 0 && (
              <span style={{
                background: active ? '#8b5e3c' : '#cbd5e1',
                color: '#fff',
                borderRadius: 999,
                padding: '0 6px',
                fontSize: 10,
                fontWeight: 700,
                minWidth: 16,
                textAlign: 'center',
              }}>{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── QueuePanel ───────────────────────────────────────────────────

function QueuePanel(props: { items: WorkItem[] | null; mode: WorkMode; pending: boolean }) {
  if (props.items === null) {
    return <div style={{ fontSize: 12, color: '#94a3b8', padding: '0.5rem 0' }}>Loading…</div>
  }
  if (props.items.length === 0) {
    return (
      <div style={{
        fontSize: 12, color: '#94a3b8', padding: '0.75rem 0',
        fontStyle: 'italic',
      }}>{MODE_EMPTY_HINT[props.mode]}</div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {props.items.map(item => <WorkItemCard key={item.id} item={item} />)}
    </div>
  )
}

// ─── WorkItemCard ─────────────────────────────────────────────────

function WorkItemCard({ item }: { item: WorkItem }) {
  return (
    <Link
      href={item.actionUrl}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '0.6rem 0.75rem',
        borderRadius: 8,
        border: '1px solid #ece6db',
        background: '#fdfaf4',
        textDecoration: 'none',
        color: 'inherit',
      }}
      data-testid={`work-item-${item.kind}`}
    >
      <div style={{ fontSize: 18, lineHeight: '20px' }}>{item.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', marginBottom: 1 }}>
          {item.title}
        </div>
        {item.detail && (
          <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.detail}
          </div>
        )}
      </div>
      <div style={{ fontSize: 16, color: '#cbd5e1', alignSelf: 'center' }}>›</div>
    </Link>
  )
}
