'use client'

import { useState, useTransition } from 'react'
import { presentGuardianToCoachAction } from '@/lib/actions/ssi/present.action'

interface GuardianCred { id: string; issuerId: string; receivedAt: string }

export function CoachClient({ guardianCreds }: { guardianCreds: GuardianCred[] }) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{
    ok: boolean
    verified?: boolean
    reason?: string
    revealedAttrs?: string[]
    pairwiseHandle?: string
  } | null>(null)

  if (guardianCreds.length === 0) {
    return (
      <div style={{ color: '#64748b', fontSize: 14 }}>
        You don&apos;t hold a GuardianOfMinor credential yet. Accept one from <a href="/wallet" style={{ color: '#3f6ee8' }}>/wallet</a> first.
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#1e293b' }}>
        <strong>The coach will see:</strong>
        <ul style={{ margin: '6px 0 0 18px', color: '#64748b' }}>
          <li>A pairwise handle (a random identifier unique to you↔this coach)</li>
          <li>A zero-knowledge proof that your credential&apos;s <code>minorBirthYear ≥ 2006</code></li>
        </ul>
        <strong style={{ display: 'block', marginTop: 10 }}>The coach will NOT see:</strong>
        <ul style={{ margin: '6px 0 0 18px', color: '#64748b' }}>
          <li><code>relationship</code> (parent vs legal-guardian)</li>
          <li><code>issuedYear</code></li>
          <li>The exact <code>minorBirthYear</code> value</li>
          <li>Your name, email, wallet address, or any person identifier</li>
        </ul>
      </div>

      {guardianCreds.map(c => (
        <div key={c.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.75rem 1rem', border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 8,
        }}>
          <div>
            <div style={{ fontWeight: 600 }}>GuardianOfMinorCredential</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              from <code>{c.issuerId}</code> · received {new Date(c.receivedAt).toLocaleString()}
            </div>
          </div>
          <button
            disabled={pending}
            onClick={() => start(async () => {
              setResult(null)
              const r = await presentGuardianToCoachAction({ credentialId: c.id })
              setResult({
                ok: r.success, verified: r.verified, reason: r.reason,
                revealedAttrs: r.revealedAttrs, pairwiseHandle: r.pairwiseHandle,
              })
            })}
            style={{
              padding: '0.5rem 0.9rem', background: '#3f6ee8', color: '#fff',
              borderRadius: 8, border: 0, cursor: pending ? 'wait' : 'pointer', fontWeight: 600, fontSize: 13,
            }}
          >
            {pending ? 'Presenting…' : 'Present to coach'}
          </button>
        </div>
      ))}

      {result && (
        <div style={{
          marginTop: 18, padding: '0.9rem 1.1rem', borderRadius: 10,
          background: result.ok && result.verified ? 'rgba(46,125,50,0.08)' : 'rgba(198,93,75,0.08)',
          color:      result.ok && result.verified ? '#2e7d32' : '#c65d4b',
          border: `1px solid ${result.ok && result.verified ? 'rgba(46,125,50,0.25)' : 'rgba(198,93,75,0.25)'}`,
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
            {result.ok && result.verified ? '✓ Coach accepted the proof' : '✗ Proof rejected'}
          </div>
          {result.reason && <div style={{ fontSize: 12 }}>Reason: {result.reason}</div>}
          {result.revealedAttrs && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Revealed to coach: <code>{result.revealedAttrs.join(', ') || '(only pairwise handle + predicate)'}</code>
            </div>
          )}
          {result.pairwiseHandle && (
            <div style={{ fontSize: 11, marginTop: 4 }}>
              Pairwise handle: <code>{result.pairwiseHandle}</code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
