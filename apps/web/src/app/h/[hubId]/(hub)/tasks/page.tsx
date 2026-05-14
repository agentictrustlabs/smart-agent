/**
 * Spec 006 — validator + steward inbox.
 *
 * Shows pending work assigned to the viewer across every active commitment:
 *
 *   - "Awaiting your attestation": viewer is listed as a validator on the
 *     round and a milestone's outcome is unrecorded. CTA → recordOutcome.
 *   - "Awaiting your approval to release": viewer can manage the donor
 *     (pool steward) and a milestone has been validator-attested but not
 *     yet released. CTA → releaseTranche.
 *
 * Empty sections collapse cleanly. The page is server-rendered with a
 * thin client form per row for the action submit.
 */

import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { listInboxTasks, type InboxTask } from '@/lib/actions/commitments.action'
import { TaskRowActions } from './TaskRowActions'

export const dynamic = 'force-dynamic'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  attest: '#0f766e',
  release: '#166534',
}

function formatUsdc(amountStr: string): string {
  try {
    const n = BigInt(amountStr)
    const dollars = Number(n) / 1_000_000
    if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
    if (dollars >= 1_000)     return `$${(dollars / 1_000).toFixed(1)}k`
    return `$${dollars.toLocaleString()}`
  } catch {
    return amountStr
  }
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default async function TasksPage({ params, searchParams }: {
  params: Promise<{ hubId: string }>
  searchParams: Promise<{ commitment?: string }>
}) {
  const { hubId: slug } = await params
  const sp = await searchParams
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  // Look up the viewer's EOA from local_user_accounts (demo) — for non-demo
  // users this is the smart account itself, which still works for the
  // validator-match check.
  let viewerEoa = '' as `0x${string}`
  try {
    const rows = await db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, user.id)).limit(1)
    if (rows[0]?.walletAddress) viewerEoa = rows[0].walletAddress as `0x${string}`
  } catch { /* sessionless user — viewerEoa stays empty */ }

  const profile = getHubProfile(internalHubId)
  // `?commitment=0x...` scopes the inbox to a single commitment subject —
  // the polished customer demo uses this so the page render bypasses the
  // accumulated-history SPARQL scan (which hits Cloudflare's 524 timeout
  // when the dev environment has many old commits).
  const scopedCommitment = sp.commitment && /^0x[0-9a-fA-F]{64}$/.test(sp.commitment)
    ? (sp.commitment as `0x${string}`)
    : undefined
  const tasks = await listInboxTasks(viewerEoa, scopedCommitment)
  const attestations = tasks.filter((t) => t.kind === 'attestation')
  const releases = tasks.filter((t) => t.kind === 'release')

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Your tasks
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          Inbox ({tasks.length})
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          Milestones across every active commitment that need an action from you.
        </p>
      </div>

      <Section title="Awaiting your attestation" color={C.attest} count={attestations.length}>
        {attestations.length === 0 ? (
          <Empty text="No milestones awaiting your validation." />
        ) : (
          attestations.map((t) => <TaskCard key={`a-${t.commitmentSubject}-${t.milestoneId}`} task={t} hubSlug={slug} />)
        )}
      </Section>

      <Section title="Awaiting your approval to release" color={C.release} count={releases.length}>
        {releases.length === 0 ? (
          <Empty text="No tranches ready for your release approval." />
        ) : (
          releases.map((t) => <TaskCard key={`r-${t.commitmentSubject}-${t.milestoneId}`} task={t} hubSlug={slug} />)
        )}
      </Section>
    </div>
  )
}

function Section({
  title, color, count, children,
}: {
  title: string; color: string; count: number; children: React.ReactNode
}) {
  return (
    <section style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '1rem 1.15rem', marginBottom: '0.85rem',
    }}>
      <h2 style={{
        fontSize: '0.7rem', fontWeight: 700, color: C.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem',
      }}>
        <span style={{ color, marginRight: '0.4rem' }}>●</span>
        {title} ({count})
      </h2>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ fontSize: '0.82rem', color: C.textMuted, fontStyle: 'italic', padding: '0.4rem 0' }}>
      {text}
    </div>
  )
}

function TaskCard({ task, hubSlug }: { task: InboxTask; hubSlug: string }) {
  return (
    <div
      data-commitment-subject={task.commitmentSubject}
      data-milestone-id={task.milestoneId}
      data-task-kind={task.kind}
      style={{
        border: `1px solid ${C.border}`, borderRadius: 10,
        padding: '0.7rem 0.85rem', marginBottom: '0.55rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <span style={{ fontSize: '0.92rem', fontWeight: 700, color: C.text }}>
          {task.milestoneLabel}
        </span>
        <span style={{ fontSize: '0.78rem', color: C.textMuted }}>
          {formatUsdc(task.amount)}
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', color: C.textMuted, marginBottom: '0.5rem' }}>
        Donor <strong style={{ color: C.text }}>{task.donorLabel ?? shortAddr(task.donor)}</strong>
        {' → '}
        Recipient <strong style={{ color: C.text }}>{task.recipientLabel ?? shortAddr(task.recipient)}</strong>
        {task.needIntentId && (
          <>
            {' · need '}
            <a
              href={`/h/${hubSlug}/intents/${task.needIntentId.replace(/^urn:smart-agent:intent:/, '')}`}
              style={{ color: C.accent, textDecoration: 'none', fontWeight: 600 }}
            >
              {task.needIntentId.replace(/^urn:smart-agent:intent:/, '').slice(0, 32)}
            </a>
          </>
        )}
      </div>
      <TaskRowActions task={task} hubSlug={hubSlug} />
    </div>
  )
}
