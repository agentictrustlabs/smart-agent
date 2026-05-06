/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pledge detail + amend (US5).
 *
 * Server component. Surfaces a single pledge's body and (when status is
 * `active`) an amend form. The form posts to the sibling
 * `[pledgeId]/amend/route.ts`. Stop action posts to the sibling
 * `[pledgeId]/stop/route.ts`.
 *
 * State-aware affordances per FR-018 / FR-019 / FR-020:
 *   - amend (active only)
 *   - stop  (active or waitlisted)
 *   - view  (everyone)
 */

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getMemberPledge } from '@/lib/actions/poolPledges.action'
import { cadenceAwareTotal } from '@smart-agent/sdk'
import { PledgeAmendForm } from './PledgeAmendForm'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  danger: '#dc2626',
}

export default async function PledgeDetailPage({
  params,
}: {
  params: Promise<{ hubId: string; pledgeId: string }>
}) {
  const { hubId: slug, pledgeId: rawId } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) redirect('/')

  const pledgeId = decodeURIComponent(rawId)
  const pledge = await getMemberPledge(pledgeId)
  if (!pledge) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: C.text }}>Pledge not found</h2>
        <p style={{ color: C.textMuted }}>This pledge does not exist or you are not its donor.</p>
      </div>
    )
  }

  const total = cadenceAwareTotal(pledge)
  const canAmend = pledge.status === 'active'
  const canStop = pledge.status === 'active' || pledge.status === 'waitlisted'
  const safeId = encodeURIComponent(pledgeId)

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Pledge · {pledge.status}
        </div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          {pledge.amount} {pledge.unit} {pledge.cadence !== 'one-time' && pledge.duration ? `for ${pledge.duration} ${pledge.cadence === 'monthly' ? 'months' : 'years'}` : ''}
        </h1>
        <div style={{ fontSize: '0.78rem', color: C.textMuted }}>
          Pool: <Link href={`/h/${slug}/pools/${encodeURIComponent(pledge.poolAgentId)}`} style={{ color: C.accent, textDecoration: 'none' }}>{pledge.poolAgentId}</Link>
        </div>
      </div>

      <Section title="Pledge body">
        <Row label="Cadence">{pledge.cadence}</Row>
        <Row label="Amount">{pledge.amount} {pledge.unit}</Row>
        {pledge.duration && <Row label="Duration">{pledge.duration} {pledge.cadence === 'monthly' ? 'months' : 'years'}</Row>}
        <Row label="Total">{total} {pledge.unit}</Row>
        <Row label="Story permissions">{pledge.storyPermissions}</Row>
        <Row label="Visibility">{pledge.visibility}</Row>
        <Row label="Pledged">{pledge.pledgedAt}</Row>
        {pledge.stoppedAt && <Row label="Stopped">{pledge.stoppedAt}</Row>}
        {pledge.onChainAssertionId && <Row label="On-chain anchor">{pledge.onChainAssertionId}</Row>}
        {pledge.restrictions && (
          <Row label="Restrictions">
            <pre style={{ fontSize: '0.78rem', margin: 0, color: C.text }}>{JSON.stringify(pledge.restrictions, null, 2)}</pre>
          </Row>
        )}
      </Section>

      {pledge.history.length > 0 && (
        <Section title="Amendment history">
          <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.85rem', color: C.text }}>
            {pledge.history.map((h, i) => (
              <li key={i} style={{ marginBottom: '0.35rem' }}>
                <strong>{h.kind}:</strong> {String(h.prevValue)} → {String(h.newValue)}
                <span style={{ color: C.textMuted, marginLeft: '0.4rem' }}>· {h.amendedAt.slice(0, 16)}</span>
                {h.windowResetAt && <span style={{ color: C.textMuted, marginLeft: '0.4rem' }}>· window reset</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {canAmend && (
        <Section title="Amend">
          <p style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.65rem' }}>
            Amount-only amendments preserve the existing duration window.
            Cadence and duration changes start a new window from today.
          </p>
          <PledgeAmendForm pledgeId={pledgeId} hubSlug={slug} pledge={pledge} />
        </Section>
      )}

      {canStop && (
        <Section title="Stop pledge">
          <p style={{ fontSize: '0.78rem', color: C.textMuted, marginBottom: '0.65rem' }}>
            Stopping this pledge cancels future disbursements scheduled after the
            stop timestamp. Already-allocated capacity is not recalled by this
            action — that is governed by the pool's stewardship rules.
          </p>
          <form action={`/h/${slug}/pledges/${safeId}/stop`} method="post">
            <button
              type="submit"
              style={{
                padding: '0.5rem 1.1rem',
                background: '#fff',
                color: C.danger,
                border: `1px solid ${C.danger}`,
                borderRadius: 8,
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Stop this pledge
            </button>
          </form>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.95rem 1rem',
        marginBottom: '0.85rem',
      }}
    >
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.85rem', marginBottom: '0.4rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
      <div style={{ flex: '0 0 130px', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: C.text }}>
        {children}
      </div>
    </div>
  )
}
