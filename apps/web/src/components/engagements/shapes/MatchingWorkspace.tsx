/**
 * MatchingWorkspace — the matchmaking artifact.
 *
 * Renders the *closed* match: who asked, who was selected, when, and a link
 * to the spawned delivery engagement (the actual working relationship).
 *
 * The matching engagement closes immediately at accept time — there's no
 * cadence, no evidence pinning, no determination to do. Trust deposit fires
 * at creation: "agent X reliably found a fit / agent Y was selected for role Z."
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 R16 (post-arc addendum).
 */

import Link from 'next/link'
import { db, schema } from '@/db'
import { and, eq } from 'drizzle-orm'
import { CommitmentThread } from '@/components/engagements/CommitmentThread'
import type { EngagementWorkspaceProps } from './types'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  matchBg: '#ecfdf5', matchBorder: '#a7f3d0', matchFg: '#065f46',
  childBg: '#fdfcf8',
}

export async function MatchingWorkspace(props: EngagementWorkspaceProps) {
  const {
    detail, threadEntries, hubSlug, hubName,
    holderName, providerName,
    topic, icon,
  } = props

  // Find the spawned delivery engagement, if it exists.
  const delivery = db.select().from(schema.entitlements)
    .where(and(
      eq(schema.entitlements.parentEngagementId, detail.id),
      eq(schema.entitlements.engagementKind, 'delivery'),
    ))
    .get()

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* Match summary card — celebratory */}
      <section style={{
        background: C.matchBg,
        border: `1px solid ${C.matchBorder}`,
        borderRadius: 14,
        padding: '1.1rem 1.25rem',
        marginBottom: '1rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.matchFg, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
          ✓ Match made · {hubName}
        </div>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>{icon}</span>
          {providerName} → {holderName}
        </h1>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: '#33704c', lineHeight: 1.45 }}>
          Original ask: <em>&ldquo;{topic}&rdquo;</em>.
          <br />
          Matched on {fmtDate(detail.validFrom)}. The matchmaker&apos;s job is done; the working
          relationship lives in the delivery engagement below.
        </p>
      </section>

      {/* Spawned delivery link */}
      {delivery ? (
        <section style={{
          background: C.childBg,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '0.95rem 1.1rem',
          marginBottom: '1rem',
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>
            Spawned delivery engagement
          </div>
          <div style={{ fontSize: '0.95rem', color: C.text, fontWeight: 600 }}>
            <Link href={`/h/${hubSlug}/entitlements/${delivery.id}`} style={{ color: C.accent }}>
              Open the working relationship →
            </Link>
          </div>
          <div style={{ fontSize: '0.75rem', color: C.textMuted, marginTop: '0.25rem' }}>
            That&apos;s where sessions, reports, evidence, and final sign-off live. This page only records the matchmaking moment.
          </div>
        </section>
      ) : (
        <section style={{
          background: C.childBg,
          border: `1px dashed ${C.border}`,
          borderRadius: 12,
          padding: '0.95rem 1.1rem',
          marginBottom: '1rem',
          fontSize: '0.85rem',
          color: C.textMuted,
        }}>
          No delivery engagement spawned yet (legacy data?). The match is recorded but the working relationship was never created.
        </section>
      )}

      {/* Audit thread — small, read-only */}
      <details style={discStyle}>
        <summary style={summaryStyle}>Records · audit trail of the match</summary>
        <div style={{ paddingTop: '0.6rem' }}>
          <CommitmentThread
            entries={threadEntries}
            agentNameByAddress={{
              [detail.holderAgent]: holderName,
              [detail.providerAgent]: providerName,
            }}
            hubSlug={hubSlug}
          />
        </div>
      </details>
    </div>
  )
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}

const discStyle: React.CSSProperties = {
  background: '#ffffff',
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: '0.85rem 1rem',
  marginBottom: '1rem',
}

const summaryStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  color: C.textMuted,
  cursor: 'pointer',
  listStyle: 'none',
}
