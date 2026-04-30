/**
 * AgreementCard — bilateral split-pane workspace header for an engagement.
 *
 * The engagement is bilateral: holder receives, provider gives, but BOTH
 * parties have outcomes they're working toward. The card surfaces both
 * seats side-by-side with their own outcome cards and confirmation states,
 * so the workspace reads as a contract *between* two agents — not an
 * entitlement granted *to* one side.
 *
 * Spec: docs/specs/round-trip-trust-deposit-plan.md §3.1
 */

import Link from 'next/link'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  holderTint: '#fefaf3', // warm cream — receiving side
  providerTint: '#f5f7fb', // cool blue-grey — giving side
  divider: '#ece6db',
  confirmedBg: '#dcfce7', confirmedFg: '#166534',
  pendingBg: '#fef3c7', pendingFg: '#92400e',
}

export interface AgreementParty {
  agentAddress: string
  displayName: string
  isMe: boolean
  intentId: string
  intentTitle: string
  outcomeDescription: string | null
  outcomeStatus: 'pending' | 'partial' | 'achieved' | 'not-achieved' | null
  confirmedAt: string | null
}

export interface AgreementCardProps {
  hubSlug: string
  topic: string
  icon: string
  resourceLeaf: string
  cadence: string
  validFrom: string
  validUntil: string | null
  holder: AgreementParty
  provider: AgreementParty
  hubName: string
}

export function AgreementCard({
  hubSlug,
  topic,
  icon,
  resourceLeaf,
  cadence,
  validFrom,
  validUntil,
  holder,
  provider,
  hubName,
}: AgreementCardProps) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: '1rem',
    }}>
      {/* Top bar — engagement identity, cadence, term */}
      <div style={{
        padding: '0.85rem 1.1rem',
        borderBottom: `1px solid ${C.divider}`,
        background: '#fdfcf8',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {hubName} · Engagement
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.3rem' }}>{icon}</span>
          {topic}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.75rem', color: C.textMuted }}>
          <span>{resourceLeaf}</span>
          <span>·</span>
          <span>{cadence} cadence</span>
          <span>·</span>
          <span>granted {fmtDate(validFrom)}</span>
          {validUntil && (<>
            <span>·</span>
            <span>through {fmtDate(validUntil)}</span>
          </>)}
        </div>
      </div>

      {/* Bilateral pane */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <PartyColumn
          side="holder"
          tint={C.holderTint}
          rightBorder
          hubSlug={hubSlug}
          party={holder}
        />
        <PartyColumn
          side="provider"
          tint={C.providerTint}
          rightBorder={false}
          hubSlug={hubSlug}
          party={provider}
        />
      </div>
    </div>
  )
}

function PartyColumn({
  side,
  tint,
  rightBorder,
  hubSlug,
  party,
}: {
  side: 'holder' | 'provider'
  tint: string
  rightBorder: boolean
  hubSlug: string
  party: AgreementParty
}) {
  const sideLabel = side === 'holder' ? 'Holder · receiving' : 'Provider · giving'
  const sideIcon = side === 'holder' ? '📥' : '📤'
  const confirmTone = party.confirmedAt
    ? { bg: C.confirmedBg, fg: C.confirmedFg, label: `Confirmed ${fmtDate(party.confirmedAt)}` }
    : { bg: C.pendingBg, fg: C.pendingFg, label: 'Awaiting confirmation' }

  return (
    <div style={{
      padding: '1rem 1.1rem',
      background: tint,
      borderRight: rightBorder ? `1px solid ${C.divider}` : 'none',
      minWidth: 0,
    }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
        {sideIcon} {sideLabel}{party.isMe ? ' · you' : ''}
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: C.text, marginBottom: '0.15rem' }}>
        <Link href={`/agents/${party.agentAddress}`} style={{ color: C.text, textDecoration: 'none' }}>
          {party.displayName}
        </Link>
      </div>
      <div style={{ fontSize: '0.72rem', color: C.textMuted, marginBottom: '0.7rem' }}>
        From <Link href={`/h/${hubSlug}/intents/${party.intentId}`} style={{ color: C.accent, textDecoration: 'none' }}>{party.intentTitle}</Link>
      </div>

      <div style={{ borderTop: `1px solid ${C.divider}`, paddingTop: '0.7rem' }}>
        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
          Their outcome
        </div>
        {party.outcomeDescription ? (
          <div style={{ fontSize: '0.85rem', color: C.text, fontWeight: 500, lineHeight: 1.4 }}>
            {party.outcomeDescription}
          </div>
        ) : (
          <div style={{ fontSize: '0.78rem', color: C.textMuted, fontStyle: 'italic' }}>
            No explicit outcome yet — engagement closes on capacity exhaustion.
          </div>
        )}
        {party.outcomeStatus && (
          <div style={{ fontSize: '0.65rem', color: C.textMuted, marginTop: '0.3rem' }}>
            outcome status: <span style={{ color: party.outcomeStatus === 'achieved' ? C.confirmedFg : C.text, fontWeight: 600 }}>{party.outcomeStatus}</span>
          </div>
        )}
      </div>

      <div style={{ marginTop: '0.85rem' }}>
        <span style={{
          display: 'inline-block',
          fontSize: '0.65rem', fontWeight: 700,
          padding: '0.2rem 0.55rem', borderRadius: 999,
          background: confirmTone.bg, color: confirmTone.fg,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {confirmTone.label}
        </span>
      </div>
    </div>
  )
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}
