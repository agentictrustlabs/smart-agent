import Link from 'next/link'
import { getHubIntentSummary } from '@/lib/actions/intents.action'

const C = {
  card: '#ffffff',
  border: '#ece6db',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  bandBg: 'rgba(13,148,136,0.06)',
  bandBorder: 'rgba(13,148,136,0.20)',
  bandFg: '#0f766e',
  receiveBg: '#fff', receiveFg: '#0f766e', receiveBorder: 'rgba(13,148,136,0.30)',
  giveBg: '#fff',    giveFg: '#92400e',    giveBorder: 'rgba(217,119,6,0.30)',
}

const PRIORITY_FG: Record<string, string> = {
  critical: '#991b1b',
  high:     '#92400e',
  normal:   '#3730a3',
  low:      '#5b21b6',
}

/**
 * `<OpenNeedsStrip>` — hub-wide intents board (renamed strip).
 *
 * Now reads from the `intents` table (post-I3 backfill) directly. Both
 * receive-shaped and give-shaped intents render here, separated by a
 * direction chip (📥 / 📤). The matcher pairs them across direction +
 * object — this strip just surfaces the inventory.
 *
 * Hidden when there are no expressed intents.
 */
export async function OpenNeedsStrip({ hubId, hubSlug }: { hubId: string; hubSlug: string }) {
  const summary = await getHubIntentSummary(hubId)
  const total = summary.receiveCount + summary.giveCount
  if (total === 0) return null

  // Interleave the top picks: 2 receive + 2 give to show both sides at a glance.
  const top = [
    ...summary.topReceive.slice(0, 2),
    ...summary.topGive.slice(0, 2),
  ]

  return (
    <div
      style={{
        background: C.bandBg,
        border: `1px solid ${C.bandBorder}`,
        borderRadius: 12,
        padding: '0.85rem 1rem',
        marginBottom: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '0.6rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.bandFg, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
              Open intents
            </h2>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: C.bandFg }}>{total}</span>
            <span style={{ fontSize: '0.7rem', color: C.textMuted }}>
              · 📥 {summary.receiveCount} receive
              {summary.giveCount > 0 && <> · 📤 {summary.giveCount} give</>}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.15rem' }}>
            What people in the hub are asking for and offering — anyone can engage
          </div>
        </div>
        <Link
          href={`/h/${hubSlug}/discover`}
          style={{
            flexShrink: 0,
            fontSize: '0.7rem',
            color: '#fff',
            background: C.bandFg,
            textDecoration: 'none',
            fontWeight: 600,
            padding: '0.3rem 0.7rem',
            borderRadius: 999,
          }}
        >
          Discover →
        </Link>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {top.map(i => {
          const isRecv = i.direction === 'receive'
          const dirChip = isRecv
            ? { bg: C.receiveBg, fg: C.receiveFg, border: C.receiveBorder, icon: '📥' }
            : { bg: C.giveBg, fg: C.giveFg, border: C.giveBorder, icon: '📤' }
          return (
            <Link
              key={i.id}
              href={`/h/${hubSlug}/intents/${i.id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.3rem 0.65rem',
                background: dirChip.bg,
                border: `1px solid ${dirChip.border}`,
                borderRadius: 999,
                textDecoration: 'none',
                fontSize: '0.78rem',
                color: C.text,
                maxWidth: '100%',
              }}
            >
              <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>{dirChip.icon}</span>
              <span
                style={{
                  fontSize: '0.55rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.4rem',
                  borderRadius: 999,
                  background: '#fafaf6',
                  color: PRIORITY_FG[i.priority] ?? C.textMuted,
                  border: `1px solid ${PRIORITY_FG[i.priority] ?? C.textMuted}30`,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  flexShrink: 0,
                }}
              >
                {i.priority}
              </span>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                {i.title}
              </span>
            </Link>
          )
        })}
        {total > top.length && (
          <Link
            href={`/h/${hubSlug}/discover`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.3rem 0.65rem',
              background: 'transparent',
              border: `1px dashed ${C.bandBorder}`,
              borderRadius: 999,
              textDecoration: 'none',
              fontSize: '0.72rem',
              color: C.bandFg,
              fontWeight: 600,
            }}
          >
            +{total - top.length} more
          </Link>
        )}
        <Link
          href={`/h/${hubSlug}/intents/new`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.3rem 0.65rem',
            background: C.bandFg,
            border: `1px solid ${C.bandFg}`,
            borderRadius: 999,
            textDecoration: 'none',
            fontSize: '0.72rem',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          + Express an intent
        </Link>
      </div>
    </div>
  )
}
