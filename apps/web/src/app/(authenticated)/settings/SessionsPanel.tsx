'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  listActiveSessionsAction,
  revokeSessionAction,
  bumpRevocationEpochAction,
  type SessionSummary,
} from '@/lib/actions/sessions.action'

/**
 * Active sessions panel (design doc M5).
 *
 * Shows every SessionGrant.v1 currently authorising the signed-in user's
 * smart account: which services are in `audience`, when it was minted, the
 * idle and hard expiry, and a one-click revoke. The "Revoke all sessions"
 * panic button bumps the per-account revocationEpoch so every existing
 * grant becomes invalid even before its hard TTL.
 */
export function SessionsPanel() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [info, setInfo] = useState<string | null>(null)

  function reload() {
    start(async () => {
      const res = await listActiveSessionsAction()
      if (!res.success) {
        setError(res.error ?? 'load failed')
        setSessions([])
        return
      }
      setError(null)
      setSessions(res.sessions ?? [])
    })
  }

  useEffect(() => { reload() }, [])

  function onRevoke(sessionId: string) {
    if (!confirm(`Revoke this session? Any device using it will be kicked off.`)) return
    start(async () => {
      const res = await revokeSessionAction(sessionId)
      if (!res.success) { setError(res.error ?? 'revoke failed'); return }
      setInfo(`Session revoked.`)
      reload()
    })
  }

  function onPanic() {
    if (!confirm(
      `Revoke ALL active sessions and force re-signin? This bumps the revocation epoch — every grant ever issued for this account becomes invalid immediately.`,
    )) return
    start(async () => {
      const res = await bumpRevocationEpochAction()
      if (!res.success) { setError(res.error ?? 'panic-revoke failed'); return }
      setInfo(`All sessions revoked (epoch=${res.epoch}). You'll need to sign in again.`)
      reload()
    })
  }

  return (
    <div>
      <h2>Active Sessions</h2>
      <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
        Each row is a <strong>passkey-rooted delegated session</strong> currently authorised
        to act on your behalf. Revoke any session you don&apos;t recognise — the next
        request from that session is rejected by the verifier on person-mcp.
      </p>

      {error && <p style={{ color: '#c62828' }}>{error}</p>}
      {info && <p style={{ color: '#2e7d32' }}>{info}</p>}

      {sessions === null ? (
        <p data-component="text-muted">Loading…</p>
      ) : sessions.length === 0 ? (
        <p data-component="text-muted">No active sessions. Sign in to mint one.</p>
      ) : (
        <table data-component="graph-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Session</th>
              <th>Audience</th>
              <th>Risk ceiling</th>
              <th>Idle expires</th>
              <th>Hard expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.sessionId}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {s.sessionId.slice(0, 8)}…{s.sessionId.slice(-4)}
                </td>
                <td style={{ fontSize: '0.8rem' }}>{s.audience.join(', ')}</td>
                <td>
                  <span data-component="role-badge" data-status={s.maxRisk === 'medium' ? 'proposed' : 'active'}>
                    {s.maxRisk}
                  </span>
                </td>
                <td style={{ fontSize: '0.75rem', color: '#616161' }}>{formatRel(s.idleExpiresAt)}</td>
                <td style={{ fontSize: '0.75rem', color: '#616161' }}>{formatRel(s.expiresAt)}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => onRevoke(s.sessionId)}
                    disabled={pending}
                    style={{ fontSize: '0.75rem', color: '#c62828', background: 'none', border: '1px solid #c62828', borderRadius: 4, padding: '0.2rem 0.5rem', cursor: 'pointer' }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid #c62828', borderRadius: 6, background: '#fff5f5' }}>
        <h3 style={{ marginTop: 0, color: '#c62828' }}>Panic button</h3>
        <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Bump the per-account revocation epoch — invalidates every existing grant immediately,
          even ones you don&apos;t see here (lost devices, stolen cookies). You will be signed out
          everywhere and need to sign in again with your passkey.
        </p>
        <button
          type="button"
          onClick={onPanic}
          disabled={pending}
          style={{ fontSize: '0.85rem', background: '#c62828', color: '#fff', border: 'none', borderRadius: 4, padding: '0.5rem 1rem', cursor: 'pointer' }}
        >
          Revoke all sessions
        </button>
      </div>
    </div>
  )
}

function formatRel(iso: string): string {
  const d = new Date(iso).getTime()
  const now = Date.now()
  const diff = d - now
  if (diff < 0) return 'expired'
  const min = Math.floor(diff / 60000)
  if (min < 60) return `in ${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `in ${hr}h ${min % 60}m`
  return `in ${Math.floor(hr / 24)}d ${hr % 24}h`
}
