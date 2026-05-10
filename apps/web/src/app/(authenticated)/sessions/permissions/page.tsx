/**
 * Phase 4 — Session permissions page.
 *
 * Renders a human-readable preview of the active A2A session's scope and
 * lets the user revoke and re-grant. Lives at `/sessions/permissions`.
 *
 *   - Server-side: build a fresh SessionPermissionRequest from TOOL_POLICIES,
 *     render PermissionPreview, fetch the current session status from
 *     a2a-agent, and pull recent ExecutionReceipts for the audit list.
 *   - Client-side: small revoke / re-grant buttons that POST to
 *     /api/a2a/revoke and /api/a2a/bootstrap respectively.
 *
 * Auth: getCurrentUser(). Returns the user's home redirect if unauthenticated.
 *
 * Notes:
 *   - For v1 demo the wallet signature happens server-side in
 *     bootstrapA2ASessionForUser. This page is presentational + provides
 *     revoke/regrant. Production wallet flows (Privy / passkey) surface
 *     eth_signTypedData_v4 — that integration is a follow-up.
 *   - Re-uses the light corporate palette from PoolAdminPage and the
 *     wallet page. No new design tokens.
 */
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import {
  buildSessionPermissionRequest,
  previewSessionRequest,
  type SessionPermissionRequest,
  type PermissionPreview,
  type ExecutionReceiptSummary,
} from '@smart-agent/sdk'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { PermissionsActions } from './PermissionsActions'

export const dynamic = 'force-dynamic'

const C = {
  card: '#ffffff', border: '#ece6db', text: '#5c4a3a', textMuted: '#9a8c7e',
  accent: '#8b5e3c', accentLight: 'rgba(139,94,60,0.08)',
  ok: '#0f766e', okBg: 'rgba(15,118,110,0.08)',
  danger: '#b91c1c', dangerBg: 'rgba(185,28,28,0.07)',
  warnBg: 'rgba(234,179,8,0.10)', warnFg: '#92400e',
  bg: 'rgba(139,94,60,0.04)',
}

type DurationKey = 'h1' | 'h24' | 'h168'

const DURATIONS: Record<DurationKey, { seconds: number; label: string }> = {
  h1:   { seconds: 60 * 60,        label: '1 hour' },
  h24:  { seconds: 60 * 60 * 24,   label: '24 hours' },
  h168: { seconds: 60 * 60 * 24 * 7, label: '7 days' },
}

const DURATION_KEYS = ['h1', 'h24', 'h168'] as const

function asDurationKey(value: string | undefined): DurationKey {
  return (value && (DURATION_KEYS as readonly string[]).includes(value)) ? value as DurationKey : 'h24'
}

const CHAIN_LABELS: Record<number, string> = {
  31337: 'Anvil dev (31337)',
  11155111: 'Sepolia (11155111)',
}

interface StatusResponse {
  active: boolean
  reason?: string
  sessionId?: string
  expiresAtIso?: string
  createdAtIso?: string
  rootGrantHash?: `0x${string}` | null
  accountAddress?: `0x${string}`
  sessionKeyAddress?: `0x${string}`
}

interface SearchParams {
  duration?: string
}

export default async function SessionPermissionsPage(props: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const sp = await props.searchParams
  const durationKey = asDurationKey(sp.duration)
  const duration = DURATIONS[durationKey]

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

  // Build the proposed permission request — what would be signed on
  // re-grant. The same shape the user agreed to at bootstrap (today's
  // auto-sign path) renders here.
  const permission: SessionPermissionRequest = buildSessionPermissionRequest({
    env: process.env as Record<string, string | undefined>,
    durationSeconds: duration.seconds,
    chainId,
    sessionIntent: `Authorize ${user.name ?? 'your agent'} to act on community funding flows for the next ${duration.label}.`,
  })

  const preview: PermissionPreview = previewSessionRequest(permission, {
    formatDuration,
    formatTargets: (addrs) => addrs.length === 0 ? 'No on-chain targets' : addrs.map(shortAddr).join(', '),
    formatChain: (id) => CHAIN_LABELS[id] ?? `Chain ${id}`,
  })
  // Override the SDK's generic label with the actual agent name.
  preview.agentName = user.name ?? 'Your agent'

  // Status + audit fetches (read-only, no signing).
  const [status, receipts] = await Promise.all([
    fetchStatus(),
    fetchAudit(),
  ])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Agent session permissions
        </div>
        <h1 style={{ fontSize: '1.55rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          {preview.agentName}
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.3rem 0 0' }}>
          {permission.sessionIntent}
        </p>
      </div>

      {/* Active session banner */}
      {status.active ? (
        <div data-component="session-status-banner" style={{
          background: C.okBg, color: C.ok, border: `1px solid ${C.ok}33`,
          padding: '0.7rem 1rem', borderRadius: 10, marginBottom: '1rem',
          fontSize: '0.85rem',
        }}>
          <strong>Active session</strong>
          {status.expiresAtIso ? ` · expires ${new Date(status.expiresAtIso).toLocaleString()}` : ''}
          {status.sessionKeyAddress ? ` · key ${shortAddr(status.sessionKeyAddress)}` : ''}
        </div>
      ) : (
        <div data-component="session-status-banner" style={{
          background: C.warnBg, color: C.warnFg, border: `1px solid ${C.warnFg}33`,
          padding: '0.7rem 1rem', borderRadius: 10, marginBottom: '1rem',
          fontSize: '0.85rem',
        }}>
          <strong>No active session</strong> · {status.reason === 'no-cookie' ? 'sign in to grant one' : status.reason}
        </div>
      )}

      <Section title="Session window">
        <Row label="Duration" value={preview.sessionWindow.durationLabel} />
        <Row label="Starts" value={new Date(preview.sessionWindow.startsAtIso).toLocaleString()} />
        <Row label="Expires" value={new Date(preview.sessionWindow.endsAtIso).toLocaleString()} />
        <Row label="Chain" value={preview.chainLabel} />
      </Section>

      <Section title={`Allowed actions (${preview.capabilityGroups.length} groups)`}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {preview.capabilityGroups.map((g) => (
            <li key={g.label} data-component="capability-group" style={{
              borderTop: `1px solid ${C.border}`,
              padding: '0.7rem 0',
            }}>
              <details>
                <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>
                    <strong style={{ color: C.text }}>{g.label}</strong>
                    <span style={{ color: C.textMuted, fontSize: '0.78rem', marginLeft: 8 }}>
                      {g.toolIds.length} {g.toolIds.length === 1 ? 'tool' : 'tools'}
                    </span>
                  </span>
                  <span style={{ fontSize: '0.72rem', color: C.textMuted }}>{g.onchainTargetsLabel}</span>
                </summary>
                <div style={{ fontSize: '0.82rem', color: C.textMuted, marginTop: '0.4rem' }}>{g.description}</div>
                <ul data-component="capability-tools" style={{ margin: '0.5rem 0 0 0.9rem', padding: 0, fontSize: '0.78rem', color: C.textMuted }}>
                  {g.toolIds.map((tid) => (
                    <li key={tid} style={{ listStyle: 'disc', marginLeft: '0.6rem' }}>
                      <code>{tid}</code>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Limits">
        {preview.limits.map((l) => (
          <Row key={l.label} label={l.label} value={l.value} />
        ))}
        <Row label="Revocable" value="Yes — revoke at any time" />
      </Section>

      {/* Action area — duration picker, revoke, regrant */}
      <PermissionsActions
        currentDurationKey={durationKey}
        active={status.active}
        sessionId={status.sessionId ?? null}
        rootGrantHash={status.rootGrantHash ?? null}
      />

      <Section title={`Executed actions (${receipts.length})`}>
        {receipts.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: '0.85rem' }}>No actions yet. Tools you invoke under this session will appear here.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.textMuted, fontWeight: 500 }}>
                <th style={th}>Tool</th>
                <th style={th}>Target</th>
                <th style={th}>Status</th>
                <th style={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={td}><code>{r.mcpTool}</code></td>
                  <td style={td}>{r.target ? shortAddr(r.target) : <span style={{ color: C.textMuted }}>—</span>}</td>
                  <td style={td}>
                    <StatusBadge status={r.status} />
                    {r.txHash && (
                      <code style={{ marginLeft: 6, fontSize: '0.72rem' }}>{r.txHash.slice(0, 10)}…</code>
                    )}
                    {r.errorReason && (
                      <span style={{ marginLeft: 6, color: C.danger, fontSize: '0.72rem' }}>{r.errorReason.slice(0, 60)}</span>
                    )}
                  </td>
                  <td style={td}>{r.finalizedAt ? new Date(r.finalizedAt).toLocaleString() : new Date(r.receivedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <div style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: C.textMuted }}>
        <Link href="/dashboard" style={{ color: C.accent }}>← Back to dashboard</Link>
      </div>
    </div>
  )
}

// ─── Server-side fetch helpers ───────────────────────────────────────

async function fetchStatus(): Promise<StatusResponse> {
  try {
    const base = await selfBaseUrl()
    const cookieHeader = (await headers()).get('cookie') ?? ''
    const res = await fetch(`${base}/api/a2a/session-status`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    })
    return await res.json() as StatusResponse
  } catch {
    return { active: false, reason: 'fetch-failed' }
  }
}

interface AuditReceiptRow extends ExecutionReceiptSummary {
  target: string | null
  mcpServer: string
  executionPath: string
  errorReason: string
  receivedAt: string
}

async function fetchAudit(): Promise<AuditReceiptRow[]> {
  try {
    const base = await selfBaseUrl()
    const cookieHeader = (await headers()).get('cookie') ?? ''
    const res = await fetch(`${base}/api/a2a/session-audit?limit=20`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    })
    const data = await res.json()
    return Array.isArray(data?.receipts) ? data.receipts as AuditReceiptRow[] : []
  } catch {
    return []
  }
}

async function selfBaseUrl(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

// ─── Pure formatters ─────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 seconds'
  const days = Math.floor(seconds / 86400)
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`
  const hours = Math.floor(seconds / 3600)
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`
  const minutes = Math.floor(seconds / 60)
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  return `${seconds} seconds`
}

function shortAddr(a: string): string {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

// ─── Layout sub-components ───────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: '1rem 1.25rem', marginBottom: '1rem',
    }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
        {title}
      </div>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div data-component="row" style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderTop: `1px solid ${C.border}`, fontSize: '0.85rem' }}>
      <span style={{ color: C.textMuted }}>{label}</span>
      <span style={{ color: C.text, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: ExecutionReceiptSummary['status'] }) {
  const map: Record<ExecutionReceiptSummary['status'], { bg: string; fg: string; label: string }> = {
    completed: { bg: 'rgba(15,118,110,0.08)', fg: '#0f766e', label: 'completed' },
    pending:   { bg: 'rgba(202,138,4,0.08)',  fg: '#a16207', label: 'pending'   },
    reverted:  { bg: 'rgba(185,28,28,0.08)',  fg: '#b91c1c', label: 'reverted'  },
    denied:    { bg: 'rgba(185,28,28,0.08)',  fg: '#b91c1c', label: 'denied'    },
  }
  const s = map[status]
  return (
    <span style={{
      background: s.bg, color: s.fg,
      padding: '0.1rem 0.45rem', borderRadius: 5,
      fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {s.label}
    </span>
  )
}

const th: React.CSSProperties = { padding: '0.4rem 0.6rem 0.4rem 0', textAlign: 'left' }
const td: React.CSSProperties = { padding: '0.5rem 0.6rem 0.5rem 0', verticalAlign: 'top' }
