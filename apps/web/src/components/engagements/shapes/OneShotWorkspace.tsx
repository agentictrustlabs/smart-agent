/**
 * OneShotWorkspace — single delivery moment, then close.
 *
 * Coverage: Connector (warm intro), Data, Scripture / Information delivery,
 * one-time Venue, lightweight Credential.
 *
 * Shape: minimal page. One headline, one DeliveryCard, then everything else
 * tucked under a single Records disclosure. No PhaseRibbon at the top, no
 * capacity meter, no work-items strip — none of those primitives carry weight
 * for "send one email and confirm it landed".
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 One-Shot, §4 column.
 */

import { CommitmentThread } from '@/components/engagements/CommitmentThread'
import { ThreadMessageComposer } from '@/components/engagements/ThreadMessageComposer'
import { EntitlementStatusActions } from '@/app/h/[hubId]/(hub)/entitlements/[id]/EntitlementStatusActions'
import { DeliveryCard } from './oneshot/DeliveryCard'
import type { EngagementWorkspaceProps } from './types'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  headerBg: '#fdfcf8',
}

const VERB_BY_RESOURCE: Record<string, { verb: string; noun: string }> = {
  'resourceType:Connector':  { verb: 'Make the warm intro',           noun: 'intro' },
  'resourceType:Data':       { verb: 'Share the requested data',      noun: 'data exchange' },
  'resourceType:Scripture':  { verb: 'Deliver the translation step',  noun: 'translation step' },
  'resourceType:Venue':      { verb: 'Confirm the venue use',         noun: 'venue use' },
  'resourceType:Credential': { verb: 'Issue the credential',          noun: 'credential' },
}

export function OneShotWorkspace(props: EngagementWorkspaceProps) {
  const {
    detail, threadEntries, hubSlug, hubName, firstOrgAddr,
    role, holderName, providerName,
    topic, icon,
  } = props

  const { verb, noun } = VERB_BY_RESOURCE[detail.terms.object] ?? { verb: 'Deliver', noun: 'delivery' }
  const counterpartyName = role === 'holder' ? providerName : holderName
  const isParty = role === 'holder' || role === 'provider'

  const myConfirmed = role === 'holder' ? !!detail.holderConfirmedAt
    : role === 'provider' ? !!detail.providerConfirmedAt
    : false
  const otherConfirmed = role === 'holder' ? !!detail.providerConfirmedAt
    : role === 'provider' ? !!detail.holderConfirmedAt
    : false

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* Compact one-line header */}
      <div style={{
        background: C.headerBg,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.85rem 1.1rem',
        marginBottom: '1rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {hubName} · One-shot engagement
        </div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>{icon}</span>
          {topic}
        </h1>
        <div style={{ fontSize: '0.78rem', color: C.textMuted }}>
          {role === 'holder' ? `From ${providerName}` : role === 'provider' ? `For ${holderName}` : `${holderName} ⇄ ${providerName}`}
          {detail.validUntil && (
            <> · expires {fmtDate(detail.validUntil)}</>
          )}
        </div>
      </div>

      {/* Hero — DeliveryCard */}
      <DeliveryCard
        engagementId={detail.id}
        orgAddress={firstOrgAddr}
        isParty={isParty}
        role={role}
        counterpartyName={counterpartyName}
        deliveryVerb={verb}
        deliveryNoun={noun}
        delivered={!!detail.evidenceBundleHash}
        deliveredAt={detail.evidencePinnedAt}
        iConfirmed={myConfirmed}
        otherConfirmed={otherConfirmed}
        closed={!!detail.assertionId}
      />

      {/* 3-stop mini-ribbon — bare minimum wayfinding */}
      <ThreeStopRibbon
        delivered={!!detail.evidenceBundleHash}
        bothConfirmed={myConfirmed && otherConfirmed}
        deposited={!!detail.assertionId}
      />

      {/* Records disclosure — full audit trail */}
      <details style={discStyle}>
        <summary style={summaryStyle}>Records · full thread &amp; audit</summary>
        <div style={{ paddingTop: '0.6rem' }}>
          <section id="thread" style={{ marginBottom: '1rem', scrollMarginTop: '1rem' }}>
            <h3 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem', marginTop: 0 }}>
              Commitment thread ({threadEntries.length})
            </h3>
            {isParty && (
              <div style={{ marginBottom: '0.6rem' }}>
                <ThreadMessageComposer engagementId={detail.id} />
              </div>
            )}
            <CommitmentThread
              entries={threadEntries}
              agentNameByAddress={{
                [detail.holderAgent]: holderName,
                [detail.providerAgent]: providerName,
              }}
              hubSlug={hubSlug}
            />
          </section>
        </div>
      </details>

      {isParty && (
        <EntitlementStatusActions entitlementId={detail.id} status={detail.status} />
      )}
    </div>
  )
}

// ─── 3-stop mini-ribbon for One-Shot ───────────────────────────────

function ThreeStopRibbon({
  delivered,
  bothConfirmed,
  deposited,
}: {
  delivered: boolean
  bothConfirmed: boolean
  deposited: boolean
}) {
  const stops = [
    { label: 'Agreed', done: true },
    { label: 'Delivered', done: delivered },
    { label: 'Closed', done: deposited || (bothConfirmed && deposited) },
  ]
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.85rem',
      padding: '0.6rem 0.85rem',
      background: '#fff',
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      marginBottom: '1rem',
      fontSize: '0.78rem',
    }}>
      {stops.map((s, i) => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            width: 18, height: 18, borderRadius: '50%',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: s.done ? '#10b981' : '#fafaf6',
            color: s.done ? '#fff' : C.textMuted,
            border: s.done ? 'none' : `1px solid ${C.border}`,
            fontSize: '0.65rem', fontWeight: 700,
          }}>
            {s.done ? '✓' : i + 1}
          </span>
          <span style={{ color: s.done ? C.text : C.textMuted, fontWeight: 600 }}>{s.label}</span>
          {i < stops.length - 1 && (
            <span style={{ color: C.textMuted, marginLeft: '0.4rem' }}>→</span>
          )}
        </div>
      ))}
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
