'use client'

/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Proposal composer (T045).
 *
 * Single-page form holding the full GrantProposal draft state. POSTs as
 * JSON to the sibling `apply/route.ts` (T046). Uses the project's light
 * corporate palette.
 */

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  warn: '#a16207',
  errorBg: '#fef2f2',
  errorFg: '#991b1b',
}

interface RoundContext {
  /** Round id slug (e.g. demo-trauma-care-q2) — for the back link. */
  roundId: string
  /** Friendly human-readable name (sa:displayName or fallback). */
  displayName: string
  /** Short description of the mandate (kinds + geo + budget summary). */
  description: string
  /** Display name of the fund operating the round, when resolvable. */
  fundName?: string
  deadline: string
  decisionDate: string
  budgetCeiling: number
  acceptedKinds: string[]
  milestoneMin?: number
  milestoneMax?: number
}

interface ViewerIntentOption {
  id: string
  title: string
  kind: string | null
}

interface BudgetLineItemState {
  name: string
  amount: number
  unit: string
  justification: string
}

interface MilestoneState {
  name: string
  dueDate: string
  evidenceRequired: string
  trancheAmount: number
}

interface DesiredOutcomeState {
  statement: string
  measurable: string
  validators: string // comma-separated agentIds in the form; split on submit
}

type Cadence = 'quarterly' | 'milestone' | 'annual' | 'none'
type Format = 'written' | 'written+financial' | 'written+financial+testimony'

const CADENCES: Cadence[] = ['quarterly', 'milestone', 'annual', 'none']
const FORMATS: Format[] = ['written', 'written+financial', 'written+financial+testimony']

// ───────────────────────────────────────────────────────────────────────

export interface ProposalComposerProps {
  hubSlug: string
  roundId: string
  proposerAgentId: string
  round: RoundContext
  viewerIntents: ViewerIntentOption[]
}

export function ProposalComposer(props: ProposalComposerProps) {
  const router = useRouter()
  const sp = useSearchParams()
  const initialErr = sp.get('err')
  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(initialErr)

  const [basedOnIntentId, setBasedOnIntentId] = useState<string>(
    props.viewerIntents[0]?.id ?? '',
  )

  const [lineItems, setLineItems] = useState<BudgetLineItemState[]>([
    { name: '', amount: 0, unit: 'USD', justification: '' },
  ])
  const budgetTotal = lineItems.reduce((sum, li) => sum + (Number(li.amount) || 0), 0)
  const overCeiling = props.round.budgetCeiling > 0 && budgetTotal > props.round.budgetCeiling

  const [planNarrative, setPlanNarrative] = useState('')
  const [planArtifactRef, setPlanArtifactRef] = useState('')

  const [milestones, setMilestones] = useState<MilestoneState[]>([
    { name: '', dueDate: '', evidenceRequired: '', trancheAmount: 0 },
  ])

  const [desiredOutcomes, setDesiredOutcomes] = useState<DesiredOutcomeState[]>([
    { statement: '', measurable: '', validators: '' },
  ])

  const [reportingCadence, setReportingCadence] = useState<Cadence>('milestone')
  const [reportingFormat, setReportingFormat] = useState<Format>('written+financial')

  const [orgNarrative, setOrgNarrative] = useState('')
  const [priorRefs, setPriorRefs] = useState('')

  // ─── Submit ─────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    const payload = {
      proposerAgentId: props.proposerAgentId,
      roundId: props.roundId,
      fundMandateId: null,
      basedOnIntentId,
      budget: {
        lineItems: lineItems.map((li) => ({
          name: li.name,
          amount: Number(li.amount) || 0,
          unit: li.unit,
          justification: li.justification || undefined,
        })),
        total: budgetTotal,
      },
      plan: {
        narrative: planNarrative,
        planArtifactRef: planArtifactRef || undefined,
      },
      milestones: milestones.map((m) => ({
        name: m.name,
        dueDate: m.dueDate,
        evidenceRequired: m.evidenceRequired,
        trancheAmount: Number(m.trancheAmount) || 0,
      })),
      desiredOutcomes: desiredOutcomes.map((d) => ({
        statement: d.statement,
        measurable: d.measurable,
        validators: d.validators.split(',').map((s) => s.trim()).filter(Boolean),
      })),
      reportingObligations: { cadence: reportingCadence, format: reportingFormat },
      organisationalBackground: {
        narrative: orgNarrative,
        priorTrackRecordRefs: priorRefs
          ? priorRefs.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
      },
    }

    startTransition(async () => {
      try {
        const res = await fetch(
          `/h/${props.hubSlug}/rounds/${props.roundId}/apply/submit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        )
        if (res.redirected) {
          router.push(res.url)
          return
        }
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok === false) {
          setSubmitError(formatErrorMessage(data?.error ?? data))
          return
        }
        // Fall back to a manual redirect using the proposal id from the response.
        const proposalId = (data as { proposal?: { id?: string } })?.proposal?.id
        if (proposalId) {
          router.push(`/h/${props.hubSlug}/proposals/${proposalId}`)
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'submit failed')
      }
    })
  }

  // ─── Render ─────────────────────────────────────────────────────────
  const deadlineDate = props.round.deadline ? props.round.deadline.slice(0, 10) : '—'
  const decisionDateStr = props.round.decisionDate ? props.round.decisionDate.slice(0, 10) : '—'

  return (
    <form onSubmit={handleSubmit} style={{ paddingBottom: '3rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Draft a proposal
          {props.round.fundName ? <> · {props.round.fundName}</> : null}
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: C.text, margin: '0.15rem 0' }}>
          {props.round.displayName}
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.text, margin: '0.3rem 0 0.4rem' }}>
          {props.round.description}
        </p>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.4rem' }}>
          {props.round.acceptedKinds.map(k => (
            <span key={k} style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              padding: '0.18rem 0.55rem',
              borderRadius: 999,
              background: 'rgba(139,94,60,0.10)',
              color: C.accent,
              border: `1px solid rgba(139,94,60,0.20)`,
            }}>
              {k}
            </span>
          ))}
          <span style={{ fontSize: '0.78rem', color: C.textMuted, marginLeft: 'auto' }}>
            Deadline {deadlineDate} · Decision by {decisionDateStr}
          </span>
        </div>
        <div style={{ marginTop: '0.65rem' }}>
          <a
            href={`/h/${props.hubSlug}/rounds/${props.round.roundId}`}
            style={{ color: C.accent, fontSize: '0.78rem', textDecoration: 'none' }}
          >
            ← Back to round detail
          </a>
        </div>
      </div>

      {submitError && (
        <div style={{ background: C.errorBg, color: C.errorFg, padding: '0.75rem 0.95rem', borderRadius: 10, marginBottom: '1rem', fontSize: '0.85rem' }}>
          {submitError}
        </div>
      )}

      {/* Intent picker */}
      <Section title="Underlying intent">
        {props.viewerIntents.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: C.textMuted, fontStyle: 'italic' }}>
            You have no expressed or acknowledged intents in this hub. Express a need first.
          </div>
        ) : (
          <select
            value={basedOnIntentId}
            onChange={(e) => setBasedOnIntentId(e.target.value)}
            style={selectStyle}
            required
          >
            {props.viewerIntents.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}{i.kind ? ` · ${i.kind}` : ''}
              </option>
            ))}
          </select>
        )}
      </Section>

      {/* Budget */}
      <Section title="Budget">
        {lineItems.map((li, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 0.7fr 1.5fr auto', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input
              placeholder="Line item"
              value={li.name}
              onChange={(e) => updateLineItem(idx, { name: e.target.value })}
              style={inputStyle}
            />
            <input
              type="number"
              placeholder="Amount"
              value={li.amount || ''}
              onChange={(e) => updateLineItem(idx, { amount: Number(e.target.value) })}
              style={inputStyle}
            />
            <input
              placeholder="Unit"
              value={li.unit}
              onChange={(e) => updateLineItem(idx, { unit: e.target.value })}
              style={inputStyle}
            />
            <input
              placeholder="Justification (optional)"
              value={li.justification}
              onChange={(e) => updateLineItem(idx, { justification: e.target.value })}
              style={inputStyle}
            />
            <button type="button" onClick={() => removeLineItem(idx)} style={removeBtnStyle}>×</button>
          </div>
        ))}
        <button type="button" onClick={addLineItem} style={addBtnStyle}>
          + Add line item
        </button>
        <div style={{ marginTop: '0.6rem', fontSize: '0.85rem', color: C.text }}>
          <strong>Total:</strong> {budgetTotal.toLocaleString()} {lineItems[0]?.unit ?? ''}
          {props.round.budgetCeiling > 0 && (
            <span style={{ marginLeft: '0.6rem', color: C.textMuted }}>
              (ceiling: {props.round.budgetCeiling.toLocaleString()})
            </span>
          )}
        </div>
        {overCeiling && (
          <div style={{ marginTop: '0.5rem', color: C.warn, fontSize: '0.8rem' }}>
            Total exceeds round budget ceiling — submission will be rejected.
          </div>
        )}
      </Section>

      {/* Plan */}
      <Section title="Plan">
        <textarea
          placeholder="Plan narrative — describe what you'll do, how, with whom"
          value={planNarrative}
          onChange={(e) => setPlanNarrative(e.target.value)}
          rows={6}
          required
          style={textareaStyle}
        />
        <input
          placeholder="Plan artifact URL (optional)"
          value={planArtifactRef}
          onChange={(e) => setPlanArtifactRef(e.target.value)}
          style={{ ...inputStyle, marginTop: '0.5rem' }}
        />
      </Section>

      {/* Milestones */}
      <Section title="Milestones">
        {milestones.map((m, idx) => (
          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 2fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input
              placeholder="Milestone name"
              value={m.name}
              onChange={(e) => updateMilestone(idx, { name: e.target.value })}
              style={inputStyle}
            />
            <input
              type="date"
              value={m.dueDate}
              onChange={(e) => updateMilestone(idx, { dueDate: e.target.value })}
              style={inputStyle}
            />
            <input
              placeholder="Evidence required"
              value={m.evidenceRequired}
              onChange={(e) => updateMilestone(idx, { evidenceRequired: e.target.value })}
              style={inputStyle}
            />
            <input
              type="number"
              placeholder="Tranche"
              value={m.trancheAmount || ''}
              onChange={(e) => updateMilestone(idx, { trancheAmount: Number(e.target.value) })}
              style={inputStyle}
            />
            <button type="button" onClick={() => removeMilestone(idx)} style={removeBtnStyle}>×</button>
          </div>
        ))}
        <button type="button" onClick={addMilestone} style={addBtnStyle}>
          + Add milestone
        </button>
        {(props.round.milestoneMin !== undefined || props.round.milestoneMax !== undefined) && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: C.textMuted }}>
            Round expects {props.round.milestoneMin ?? '?'}–{props.round.milestoneMax ?? '?'} milestones (you have {milestones.length}).
          </div>
        )}
      </Section>

      {/* Desired outcomes */}
      <Section title="Desired outcomes">
        {desiredOutcomes.map((d, idx) => (
          <div key={idx} style={{ marginBottom: '0.7rem', borderLeft: `3px solid ${C.border}`, paddingLeft: '0.6rem' }}>
            <input
              placeholder="Outcome statement"
              value={d.statement}
              onChange={(e) => updateOutcome(idx, { statement: e.target.value })}
              style={{ ...inputStyle, marginBottom: '0.35rem' }}
            />
            <input
              placeholder="How is this measured?"
              value={d.measurable}
              onChange={(e) => updateOutcome(idx, { measurable: e.target.value })}
              style={{ ...inputStyle, marginBottom: '0.35rem' }}
            />
            <input
              placeholder="Validator agent IDs (comma-separated)"
              value={d.validators}
              onChange={(e) => updateOutcome(idx, { validators: e.target.value })}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => removeOutcome(idx)}
              style={{ ...removeBtnStyle, marginTop: '0.3rem' }}
            >
              Remove outcome
            </button>
          </div>
        ))}
        <button type="button" onClick={addOutcome} style={addBtnStyle}>
          + Add outcome
        </button>
      </Section>

      {/* Reporting obligations */}
      <Section title="Reporting">
        <Row label="Cadence">
          <select value={reportingCadence} onChange={(e) => setReportingCadence(e.target.value as Cadence)} style={selectStyle}>
            {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Row>
        <Row label="Format">
          <select value={reportingFormat} onChange={(e) => setReportingFormat(e.target.value as Format)} style={selectStyle}>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Row>
      </Section>

      {/* Organisational background */}
      <Section title="Organisational background">
        <textarea
          placeholder="Tell the stewards about your organisation — track record, current capacity, leadership"
          value={orgNarrative}
          onChange={(e) => setOrgNarrative(e.target.value)}
          rows={5}
          required
          style={textareaStyle}
        />
        <input
          placeholder="Prior track-record refs (comma-separated URLs, optional)"
          value={priorRefs}
          onChange={(e) => setPriorRefs(e.target.value)}
          style={{ ...inputStyle, marginTop: '0.5rem' }}
        />
      </Section>

      {/* Submit */}
      <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
        <button
          type="submit"
          disabled={isPending || props.viewerIntents.length === 0}
          style={{
            padding: '0.7rem 1.25rem',
            background: C.accent,
            color: '#fff',
            borderRadius: 10,
            fontSize: '0.92rem',
            fontWeight: 700,
            border: 'none',
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending || props.viewerIntents.length === 0 ? 0.6 : 1,
          }}
        >
          {isPending ? 'Submitting…' : 'Submit proposal'}
        </button>
      </div>
    </form>
  )

  // ─── Helpers ────────────────────────────────────────────────────────
  function updateLineItem(i: number, patch: Partial<BudgetLineItemState>) {
    setLineItems((items) => items.map((li, idx) => idx === i ? { ...li, ...patch } : li))
  }
  function addLineItem() {
    setLineItems((items) => [...items, { name: '', amount: 0, unit: items[0]?.unit ?? 'USD', justification: '' }])
  }
  function removeLineItem(i: number) {
    setLineItems((items) => items.length === 1 ? items : items.filter((_, idx) => idx !== i))
  }
  function updateMilestone(i: number, patch: Partial<MilestoneState>) {
    setMilestones((ms) => ms.map((m, idx) => idx === i ? { ...m, ...patch } : m))
  }
  function addMilestone() {
    setMilestones((ms) => [...ms, { name: '', dueDate: '', evidenceRequired: '', trancheAmount: 0 }])
  }
  function removeMilestone(i: number) {
    setMilestones((ms) => ms.length === 1 ? ms : ms.filter((_, idx) => idx !== i))
  }
  function updateOutcome(i: number, patch: Partial<DesiredOutcomeState>) {
    setDesiredOutcomes((os) => os.map((o, idx) => idx === i ? { ...o, ...patch } : o))
  }
  function addOutcome() {
    setDesiredOutcomes((os) => [...os, { statement: '', measurable: '', validators: '' }])
  }
  function removeOutcome(i: number) {
    setDesiredOutcomes((os) => os.length === 1 ? os : os.filter((_, idx) => idx !== i))
  }
}

// ─── Section / row helpers ────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: '0.95rem 1rem',
      marginBottom: '0.85rem',
    }}>
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.85rem', marginBottom: '0.4rem', alignItems: 'center' }}>
      <div style={{ flex: '0 0 130px', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: '0.5rem 0.65rem',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: '0.85rem',
  color: C.text,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical' as const,
  fontFamily: 'inherit',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 'auto',
}

const addBtnStyle: React.CSSProperties = {
  padding: '0.4rem 0.7rem',
  fontSize: '0.78rem',
  border: `1px dashed ${C.border}`,
  borderRadius: 8,
  background: 'transparent',
  color: C.accent,
  cursor: 'pointer',
}

const removeBtnStyle: React.CSSProperties = {
  padding: '0.3rem 0.55rem',
  fontSize: '0.85rem',
  border: 'none',
  borderRadius: 6,
  background: '#f5f1ea',
  color: C.errorFg,
  cursor: 'pointer',
}

// ─── Error formatting ─────────────────────────────────────────────────

function formatErrorMessage(error: unknown): string {
  if (!error) return 'Submission failed.'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error && 'kind' in error) {
    const e = error as { kind: string; [k: string]: unknown }
    switch (e.kind) {
      case 'missing-required-fields':
        return `Missing required fields: ${(e.fields as string[] | undefined)?.join(', ') ?? '?'}`
      case 'budget-overage':
        return `Budget total ${e.submitted} exceeds round ceiling ${e.ceiling}.`
      case 'missing-credential':
        return `Missing required credentials: ${(e.required as string[] | undefined)?.join(', ') ?? '?'}`
      case 'open-call-not-accepted':
        return 'This fund is not accepting open-call applications right now.'
      case 'private-round-not-addressed':
        return 'You are not on the addressed-applicants list for this private round.'
      case 'validation':
        return (e.messages as string[] | undefined)?.join('; ') ?? 'Validation failed.'
      default:
        return `Error: ${e.kind}`
    }
  }
  return 'Submission failed.'
}
