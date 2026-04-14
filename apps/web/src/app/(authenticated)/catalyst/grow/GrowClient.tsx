'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toggleModule } from '@/lib/actions/grow.action'

// ─── Types ──────────────────────────────────────────────────────────

interface ProgressRecord {
  id: string
  moduleKey: string
  program: string
  track: string | null
  completed: number
}

interface GrowClientProps {
  progress: ProgressRecord[]
  churchCount: number
}

// ─── Colors ─────────────────────────────────────────────────────────

const C = {
  bg: '#faf8f3',
  card: '#ffffff',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
  accentBorder: 'rgba(139,94,60,0.20)',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  border: '#ece6db',
  green: '#2e7d32',
  greenLight: 'rgba(46,125,50,0.10)',
  greenBorder: 'rgba(46,125,50,0.20)',
}

// ─── Module definitions ─────────────────────────────────────────────

const FOUR_ONE_ONE_MODULES = [
  { key: '411-1', label: 'See your relationships (oikos mapping)' },
  { key: '411-2', label: 'Tell your story (testimony)' },
  { key: '411-3', label: 'Share the gospel' },
  { key: '411-4', label: 'Know God\'s heart for the nations' },
  { key: '411-5', label: 'Pray with authority' },
  { key: '411-6', label: 'Spirit-filled living' },
]

const COMMANDS_OF_CHRIST = [
  { key: 'coc-love', label: 'Love' },
  { key: 'coc-pray', label: 'Pray' },
  { key: 'coc-go', label: 'Go/Make Disciples' },
  { key: 'coc-baptize', label: 'Baptize' },
  { key: 'coc-supper', label: 'Lord\'s Supper' },
  { key: 'coc-give', label: 'Give' },
  { key: 'coc-anxious', label: 'Don\'t be anxious' },
  { key: 'coc-judge', label: 'Do not judge' },
  { key: 'coc-abide', label: 'Abide/Bear fruit' },
  { key: 'coc-unity', label: 'Be unified' },
]

// ─── Helpers ────────────────────────────────────────────────────────

function isComplete(progress: ProgressRecord[], key: string, program: string, track?: string): boolean {
  return progress.some(
    (p) => p.moduleKey === key && p.program === program && (!track || p.track === track) && p.completed === 1
  )
}

function pct(done: number, total: number): number {
  if (total === 0) return 0
  return Math.round((done / total) * 100)
}

// ─── Accordion Section ─────────────────────────────────────────────

function AccordionRow({
  title,
  badges,
  children,
}: {
  title: string
  badges: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      marginBottom: '0.5rem',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          gap: '0.5rem',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: C.text, textAlign: 'left' }}>
          {title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
          {badges}
          <span style={{ fontSize: '0.7rem', color: C.textMuted }}>{open ? '\u25B2' : '\u25BC'}</span>
        </div>
      </button>
      {open && (
        <div style={{ padding: '0 1rem 0.75rem', borderTop: `1px solid ${C.border}` }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Badge ──────────────────────────────────────────────────────────

function Badge({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) {
  return (
    <span style={{
      fontSize: '0.65rem',
      fontWeight: 700,
      color,
      background: bg,
      border: `1px solid ${border}`,
      padding: '2px 8px',
      borderRadius: 12,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

// ─── Checkbox Item ──────────────────────────────────────────────────

function CheckItem({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  const [pending, startTransition] = useTransition()

  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.35rem 0',
      cursor: pending ? 'wait' : 'pointer',
      opacity: pending ? 0.6 : 1,
      fontSize: '0.85rem',
      color: C.text,
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={() => startTransition(onToggle)}
        disabled={pending}
        style={{
          accentColor: C.accent,
          width: 16,
          height: 16,
          cursor: 'inherit',
        }}
      />
      <span style={{ textDecoration: checked ? 'line-through' : 'none', color: checked ? C.textMuted : C.text }}>
        {label}
      </span>
    </label>
  )
}

// ─── Main Component ─────────────────────────────────────────────────

export function GrowClient({ progress: initialProgress, churchCount }: GrowClientProps) {
  const [progress, setProgress] = useState(initialProgress)

  async function handleToggle(moduleKey: string, program: string, track?: string) {
    const result = await toggleModule(moduleKey, program, track)
    setProgress((prev) => {
      const idx = prev.findIndex(
        (p) => p.moduleKey === moduleKey && p.program === program && (!track || p.track === track)
      )
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], completed: result.completed ? 1 : 0 }
        return updated
      }
      // New record
      return [
        ...prev,
        { id: moduleKey, moduleKey, program, track: track ?? null, completed: result.completed ? 1 : 0 },
      ]
    })
  }

  // Calculate 411 stats
  const fourOneOneDone = FOUR_ONE_ONE_MODULES.filter((m) => isComplete(progress, m.key, '411')).length
  const fourOneOnePct = pct(fourOneOneDone, FOUR_ONE_ONE_MODULES.length)

  // Calculate commands stats
  const cocObeyingDone = COMMANDS_OF_CHRIST.filter((m) => isComplete(progress, m.key, 'commands', 'obeying')).length
  const cocTeachingDone = COMMANDS_OF_CHRIST.filter((m) => isComplete(progress, m.key, 'commands', 'teaching')).length
  const cocObeyPct = pct(cocObeyingDone, COMMANDS_OF_CHRIST.length)
  const cocTeachPct = pct(cocTeachingDone, COMMANDS_OF_CHRIST.length)

  // 3/3rds
  const isPracticing = isComplete(progress, '3thirds-practicing', '3thirds')
  const isTeaching3rds = isComplete(progress, '3thirds-teaching', '3thirds')

  return (
    <div>
      {/* Section 1: Personal Walk Foundations */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: C.accent,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          margin: '0 0 0.35rem',
        }}>
          Personal Walk Foundations
        </h2>
        <p style={{ fontSize: '0.8rem', color: C.textMuted, margin: '0 0 0.75rem', lineHeight: 1.4 }}>
          The first things a disciple picks up: how to see your relationships, tell your story, share the gospel, and obey what Jesus commanded.
        </p>

        {/* 411 Training */}
        <AccordionRow
          title="411 Training"
          badges={
            fourOneOneDone > 0 ? (
              <Badge
                label={`${fourOneOnePct}%`}
                color={C.accent}
                bg={C.accentLight}
                border={C.accentBorder}
              />
            ) : null
          }
        >
          <div style={{ paddingTop: '0.5rem' }}>
            {FOUR_ONE_ONE_MODULES.map((mod) => (
              <CheckItem
                key={mod.key}
                label={`Module ${mod.key.split('-')[1]}: ${mod.label}`}
                checked={isComplete(progress, mod.key, '411')}
                onToggle={() => handleToggle(mod.key, '411')}
              />
            ))}
          </div>
        </AccordionRow>

        {/* Commands of Christ */}
        <AccordionRow
          title="Commands of Christ"
          badges={
            <>
              {cocObeyingDone > 0 && (
                <Badge
                  label={`Obeying ${cocObeyPct}%`}
                  color={C.accent}
                  bg={C.accentLight}
                  border={C.accentBorder}
                />
              )}
              {cocTeachingDone > 0 && (
                <Badge
                  label={`Teaching ${cocTeachPct}%`}
                  color={C.accent}
                  bg={C.accentLight}
                  border={C.accentBorder}
                />
              )}
            </>
          }
        >
          <div style={{ paddingTop: '0.5rem' }}>
            {/* Header row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 70px 70px',
              gap: '0.25rem',
              padding: '0.25rem 0 0.4rem',
              borderBottom: `1px solid ${C.border}`,
              marginBottom: '0.25rem',
            }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: C.textMuted }}>Command</span>
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, textAlign: 'center' }}>Obeying</span>
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, textAlign: 'center' }}>Teaching</span>
            </div>
            {COMMANDS_OF_CHRIST.map((cmd) => (
              <div
                key={cmd.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 70px 70px',
                  gap: '0.25rem',
                  alignItems: 'center',
                  padding: '0.3rem 0',
                }}
              >
                <span style={{ fontSize: '0.85rem', color: C.text }}>{cmd.label}</span>
                <div style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={isComplete(progress, cmd.key, 'commands', 'obeying')}
                    onChange={() => handleToggle(cmd.key, 'commands', 'obeying')}
                    style={{ accentColor: C.accent, width: 16, height: 16, cursor: 'pointer' }}
                  />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={isComplete(progress, cmd.key, 'commands', 'teaching')}
                    onChange={() => handleToggle(cmd.key, 'commands', 'teaching')}
                    style={{ accentColor: C.accent, width: 16, height: 16, cursor: 'pointer' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </AccordionRow>
      </div>

      {/* Section 2: Gathering with Others */}
      <div>
        <h2 style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: C.accent,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          margin: '0 0 0.35rem',
        }}>
          Gathering with Others
        </h2>
        <p style={{ fontSize: '0.8rem', color: C.textMuted, margin: '0 0 0.75rem', lineHeight: 1.4 }}>
          What happens when two or three gather in Jesus&apos; name.
        </p>

        {/* 3/3rds Group Meeting */}
        <AccordionRow
          title="3/3rds Group Meeting"
          badges={
            <>
              {isPracticing && (
                <Badge label="Practicing" color={C.green} bg={C.greenLight} border={C.greenBorder} />
              )}
              {isTeaching3rds && (
                <Badge label="Teaching" color={C.green} bg={C.greenLight} border={C.greenBorder} />
              )}
            </>
          }
        >
          <div style={{ paddingTop: '0.5rem' }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', color: C.text, display: 'block', marginBottom: '0.35rem' }}>
                Are you practicing 3/3rds meetings?
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <PillButton
                  label="Yes"
                  active={isPracticing}
                  onClick={() => handleToggle('3thirds-practicing', '3thirds')}
                />
                <PillButton
                  label="No"
                  active={!isPracticing}
                  onClick={() => {
                    if (isPracticing) handleToggle('3thirds-practicing', '3thirds')
                  }}
                />
              </div>
            </div>
            <div>
              <span style={{ fontSize: '0.85rem', color: C.text, display: 'block', marginBottom: '0.35rem' }}>
                Are you teaching others to lead?
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <PillButton
                  label="Yes"
                  active={isTeaching3rds}
                  onClick={() => handleToggle('3thirds-teaching', '3thirds')}
                />
                <PillButton
                  label="No"
                  active={!isTeaching3rds}
                  onClick={() => {
                    if (isTeaching3rds) handleToggle('3thirds-teaching', '3thirds')
                  }}
                />
              </div>
            </div>
          </div>
        </AccordionRow>

        {/* Church Circle */}
        <AccordionRow
          title="Church Circle"
          badges={
            <Badge
              label={`${churchCount} church${churchCount !== 1 ? 'es' : ''}`}
              color={C.accent}
              bg={C.accentLight}
              border={C.accentBorder}
            />
          }
        >
          <div style={{ paddingTop: '0.5rem' }}>
            <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0 0 0.5rem' }}>
              View and manage your church circles in the Groups page.
            </p>
            <Link
              href="/catalyst/groups"
              style={{
                display: 'inline-block',
                padding: '0.4rem 1rem',
                background: C.accent,
                color: '#fff',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: '0.82rem',
                textDecoration: 'none',
              }}
            >
              View Groups
            </Link>
          </div>
        </AccordionRow>
      </div>
    </div>
  )
}

// ─── Pill Button ────────────────────────────────────────────────────

function PillButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.3rem 0.9rem',
        borderRadius: 16,
        border: `1px solid ${active ? C.accent : C.border}`,
        background: active ? C.accent : 'transparent',
        color: active ? '#fff' : C.text,
        fontWeight: 600,
        fontSize: '0.8rem',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}
