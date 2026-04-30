/**
 * TrustResidueCard — what a closed engagement deposits on the agent profile.
 *
 * Three sections:
 *   • Validation profile — engagements completed, witnessed, recency
 *   • Attested skills — what other agents have claimed about this one
 *   • Recent reviews — peer reviews from past closures
 *
 * Renders empty-state cleanly for agents who haven't closed an engagement yet.
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §4
 */

import type { TrustResidue } from '@/lib/actions/engagements/trust-residue.action'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  pillBg: '#f5f3ff', pillFg: '#6d28d9',
  reviewBg: '#fafaf6',
  doneBg: '#dcfce7', doneFg: '#166534',
  witnessBg: '#fff7ed', witnessFg: '#9a3412',
}

export function TrustResidueCard({
  residue,
}: {
  residue: TrustResidue
}) {
  const empty = residue.engagementsCount === 0
    && residue.recentReviews.length === 0
    && residue.skills.length === 0

  return (
    <section style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: '1rem 1.1rem',
      marginBottom: '1rem',
    }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        🏛️ Trust residue
      </div>

      {empty ? (
        <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>
          No closed engagements yet. Trust residue accrues from mutually-confirmed engagements.
        </div>
      ) : (
        <>
          {/* Validation profile */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '0.75rem',
            marginBottom: '0.85rem',
          }}>
            <Stat label="Engagements" value={residue.engagementsCount} />
            <Stat label="Witnessed" value={residue.witnessedCount} />
            <Stat label="Last close" value={residue.lastEngagementAt ? fmtDate(residue.lastEngagementAt) : '—'} small />
          </div>

          {/* Skills */}
          {residue.skills.length > 0 && (
            <div style={{ marginBottom: '0.85rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                Attested skills
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {residue.skills.map((s, i) => (
                  <div key={i} style={{
                    fontSize: '0.78rem',
                    padding: '0.32rem 0.65rem',
                    borderRadius: 999,
                    background: s.side === 'provider' ? C.pillBg : '#ecfdf5',
                    color: s.side === 'provider' ? C.pillFg : '#065f46',
                    fontWeight: 600,
                  }}>
                    {s.skillSlug}
                    <span style={{ marginLeft: '0.4rem', fontWeight: 500, opacity: 0.7 }}>
                      ×{s.count}{s.witnessedFraction > 0 ? ` · ${Math.round(s.witnessedFraction * 100)}% witnessed` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reviews */}
          {residue.recentReviews.length > 0 && (
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                Recent reviews ({residue.recentReviews.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {residue.recentReviews.slice(0, 5).map(r => (
                  <div key={r.id} style={{
                    background: C.reviewBg,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8rem',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 700, color: C.text }}>{r.score}</span>
                      <span style={{ fontSize: '0.7rem', color: C.textMuted }}>· conf {Math.round(r.confidence * 100)}%</span>
                      {r.witnessLifted && (
                        <span style={{
                          fontSize: '0.6rem', fontWeight: 700,
                          padding: '0.15rem 0.45rem', borderRadius: 999,
                          background: C.witnessBg, color: C.witnessFg,
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>witnessed</span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: C.textMuted }}>{fmtDate(r.createdAt)}</span>
                    </div>
                    {r.narrative && (
                      <div style={{ fontSize: '0.78rem', color: C.text }}>{r.narrative}</div>
                    )}
                    <div style={{ fontSize: '0.68rem', color: C.textMuted, marginTop: '0.2rem' }}>
                      from {r.reviewerAgent.slice(0, 8)}…{r.reviewerAgent.slice(-4)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Stat({ label, value, small }: { label: string; value: number | string; small?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: small ? '0.95rem' : '1.4rem', fontWeight: 700, color: C.text, marginTop: '0.15rem' }}>
        {value}
      </div>
    </div>
  )
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}
