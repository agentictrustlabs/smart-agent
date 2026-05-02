'use client'

/**
 * DeliveryCard — primary surface for One-Shot engagements.
 *
 * Two binary state moments:
 *   1. Has it been delivered?  → Mark delivered (logs activity + pins evidence)
 *   2. Has it landed for both?  → Confirm (dual sign-off)
 *
 * Replaces the 9-section workspace for one-shot connector intros, scripture
 * deliveries, one-time data exchanges, lightweight credentials. The whole
 * point of the shape is: minimal page, one action at a time.
 *
 * Spec: docs/specs/engagement-shapes-plan.md §3 One-Shot
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markDelivered } from '@/lib/actions/engagements/oneshot.action'
import { confirmOutcome } from '@/lib/actions/entitlements.action'

const C = {
  card: '#ffffff', border: '#ece6db',
  text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c',
  openBg: '#fdf6ed', openBorder: '#e9b87a', openFg: '#8b5e3c',
  deliveredBg: '#eff6ff', deliveredBorder: '#bfdbfe', deliveredFg: '#1d4ed8',
  confirmedBg: '#dcfce7', confirmedBorder: '#bbf7d0', confirmedFg: '#166534',
}

export interface DeliveryCardProps {
  engagementId: string
  orgAddress: string | null
  isParty: boolean
  role: 'holder' | 'provider' | 'observer'
  counterpartyName: string
  /** Verb tailored per resource type — "deliver", "send the intro", "share the data". */
  deliveryVerb: string
  /** What's being delivered, e.g. "warm intro", "Q1 narrative report data". */
  deliveryNoun: string
  /** Has the activity+evidence-pin already happened? */
  delivered: boolean
  deliveredAt: string | null
  /** Both-confirmation state. */
  iConfirmed: boolean
  otherConfirmed: boolean
  /** Final state — engagement deposited? */
  closed: boolean
}

export function DeliveryCard(props: DeliveryCardProps) {
  if (props.closed) return <ClosedState {...props} />
  if (props.iConfirmed && props.otherConfirmed) return <DepositingState />
  if (props.delivered) return <ConfirmState {...props} />
  return <DeliverState {...props} />
}

// ─── State 1: needs delivery ───────────────────────────────────────

function DeliverState(props: DeliveryCardProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const [uri, setUri] = useState('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    if (!props.orgAddress) {
      setErr('Need an org context to log this delivery — open the engagement from your hub home.')
      return
    }
    setErr(null)
    start(async () => {
      const r = await markDelivered({
        engagementId: props.engagementId,
        summary: summary.trim() || undefined,
        artifactUri: uri.trim() || undefined,
        orgAddress: props.orgAddress!,
      })
      if ('error' in r) setErr(r.error)
      else router.refresh()
    })
  }

  return (
    <section style={cardStyle(C.openBg, C.openBorder)}>
      <Eyebrow tone={C.openFg}>Open · awaiting delivery</Eyebrow>
      <Headline>{props.deliveryVerb} for {props.counterpartyName}.</Headline>
      <Subline>
        When you do it, mark it here. The engagement closes after both of you
        confirm it landed.
      </Subline>

      {!open ? (
        <Actions>
          {props.isParty && (
            <PrimaryButton
              onClick={() => setOpen(true)}
              disabled={!props.orgAddress}
              label={`Mark ${props.deliveryNoun} delivered`}
            />
          )}
          {!props.isParty && (
            <ObserverNote>
              You&apos;re not a party here — only the provider can mark this delivered.
            </ObserverNote>
          )}
        </Actions>
      ) : (
        <Composer
          summary={summary} setSummary={setSummary}
          uri={uri} setUri={setUri}
          onCancel={() => { setOpen(false); setSummary(''); setUri(''); setErr(null) }}
          onSubmit={submit}
          pending={pending}
          deliveryNoun={props.deliveryNoun}
        />
      )}
      {err && <ErrLine>{err}</ErrLine>}
    </section>
  )
}

// ─── State 2: delivered, both must confirm ─────────────────────────

function ConfirmState(props: DeliveryCardProps) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function confirm() {
    setErr(null)
    start(async () => {
      const r = await confirmOutcome(props.engagementId)
      if ('error' in r) setErr(r.error)
      else router.refresh()
    })
  }

  const myLabel = props.role === 'holder' ? 'Holder' : 'Provider'
  return (
    <section style={cardStyle(C.deliveredBg, C.deliveredBorder)}>
      <Eyebrow tone={C.deliveredFg}>Delivered · awaiting confirmation</Eyebrow>
      <Headline>
        {props.deliveryNoun.charAt(0).toUpperCase() + props.deliveryNoun.slice(1)} delivered{props.deliveredAt ? ` ${fmtRelative(props.deliveredAt)}` : ''}.
      </Headline>
      <Subline>
        Did it land for {props.counterpartyName}? When both of you confirm, the engagement closes
        and lands on each of your trust profiles.
      </Subline>

      <ConfirmRows
        iConfirmed={props.iConfirmed}
        otherConfirmed={props.otherConfirmed}
        roleLabel={myLabel}
        counterpartyName={props.counterpartyName}
      />

      {props.isParty && !props.iConfirmed && (
        <Actions>
          <PrimaryButton
            onClick={confirm}
            disabled={pending}
            label={pending ? 'Confirming…' : '✓ Confirm it landed'}
          />
        </Actions>
      )}
      {props.isParty && props.iConfirmed && !props.otherConfirmed && (
        <Subline style={{ marginTop: '0.6rem', fontStyle: 'italic' }}>
          Waiting on {props.counterpartyName} to confirm.
        </Subline>
      )}
      {err && <ErrLine>{err}</ErrLine>}
    </section>
  )
}

function DepositingState() {
  return (
    <section style={cardStyle(C.confirmedBg, C.confirmedBorder)}>
      <Eyebrow tone={C.confirmedFg}>Both confirmed · closing</Eyebrow>
      <Headline>Closing this out and minting the trust deposit…</Headline>
      <Subline>This page will refresh in a moment.</Subline>
    </section>
  )
}

function ClosedState(props: DeliveryCardProps) {
  return (
    <section style={cardStyle(C.confirmedBg, C.confirmedBorder)}>
      <Eyebrow tone={C.confirmedFg}>Closed · trust banked</Eyebrow>
      <Headline>This {props.deliveryNoun} is done and on both profiles.</Headline>
      <Subline>
        A peer review and a skill claim have been written to your trust residue.
        See it under the Records disclosure below, or on each agent&apos;s profile.
      </Subline>
    </section>
  )
}

// ─── Sub-components ────────────────────────────────────────────────

function ConfirmRows({
  iConfirmed,
  otherConfirmed,
  roleLabel,
  counterpartyName,
}: {
  iConfirmed: boolean
  otherConfirmed: boolean
  roleLabel: string
  counterpartyName: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.85rem' }}>
      <ConfirmRow label={`You (${roleLabel.toLowerCase()})`} confirmed={iConfirmed} />
      <ConfirmRow label={counterpartyName} confirmed={otherConfirmed} />
    </div>
  )
}

function ConfirmRow({ label, confirmed }: { label: string; confirmed: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0.4rem 0.65rem',
      background: '#fff',
      border: `1px solid ${C.border}`,
      borderRadius: 6,
      fontSize: '0.82rem',
    }}>
      <span style={{ color: C.text }}>{label}</span>
      <span style={{
        fontSize: '0.65rem', fontWeight: 700,
        padding: '0.18rem 0.5rem', borderRadius: 999,
        background: confirmed ? C.confirmedBg : '#fef3c7',
        color: confirmed ? C.confirmedFg : '#92400e',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {confirmed ? '✓ Confirmed' : 'Pending'}
      </span>
    </div>
  )
}

function Composer({
  summary, setSummary,
  uri, setUri,
  onCancel, onSubmit, pending, deliveryNoun,
}: {
  summary: string
  setSummary: (s: string) => void
  uri: string
  setUri: (s: string) => void
  onCancel: () => void
  onSubmit: () => void
  pending: boolean
  deliveryNoun: string
}) {
  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: '0.7rem 0.85rem',
      marginTop: '0.85rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
    }}>
      <label style={{ fontSize: '0.78rem', color: C.text }}>
        How did the {deliveryNoun} go?
        <textarea
          value={summary}
          onChange={e => setSummary(e.target.value)}
          rows={2}
          placeholder="One line about what happened…"
          style={{
            display: 'block', marginTop: '0.2rem', width: '100%',
            padding: '0.4rem 0.55rem', borderRadius: 6,
            border: `1px solid ${C.border}`, fontSize: '0.85rem',
            fontFamily: 'inherit', resize: 'vertical',
          }}
        />
      </label>
      <label style={{ fontSize: '0.78rem', color: C.text }}>
        Optional artifact (link to email thread, doc, screenshot)
        <input
          type="url"
          value={uri}
          onChange={e => setUri(e.target.value)}
          placeholder="https://…"
          style={{
            display: 'block', marginTop: '0.2rem', width: '100%',
            padding: '0.4rem 0.55rem', borderRadius: 6,
            border: `1px solid ${C.border}`, fontSize: '0.85rem',
          }}
        />
      </label>
      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          style={{
            padding: '0.4rem 0.85rem',
            background: '#fff', color: C.textMuted,
            border: `1px solid ${C.border}`, borderRadius: 6,
            fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending}
          style={{
            padding: '0.4rem 1.1rem',
            background: C.accent, color: '#fff',
            border: 'none', borderRadius: 6,
            fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          {pending ? 'Saving…' : 'Mark delivered'}
        </button>
      </div>
    </div>
  )
}

function PrimaryButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '0.55rem 1.2rem',
        background: disabled ? '#f3f4f6' : C.accent,
        color: disabled ? '#9ca3af' : '#fff',
        border: 'none', borderRadius: 8,
        fontSize: '0.85rem', fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function Eyebrow({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: tone, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
      {children}
    </div>
  )
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: C.text, lineHeight: 1.3 }}>
      {children}
    </h2>
  )
}

function Subline({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{ margin: '0.45rem 0 0', fontSize: '0.85rem', color: '#6b5b4a', lineHeight: 1.45, ...style }}>
      {children}
    </p>
  )
}

function Actions({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
      {children}
    </div>
  )
}

function ObserverNote({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: '0.78rem', color: C.textMuted, fontStyle: 'italic', margin: 0 }}>{children}</p>
}

function ErrLine({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '0.75rem', color: '#991b1b', marginTop: '0.45rem' }}>{children}</div>
}

function cardStyle(bg: string, border: string): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 14,
    padding: '1.1rem 1.25rem',
    marginBottom: '1rem',
  }
}

function fmtRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime()
    const days = Math.floor(ms / 86_400_000)
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    const d = new Date(iso)
    return `on ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  } catch { return iso }
}
