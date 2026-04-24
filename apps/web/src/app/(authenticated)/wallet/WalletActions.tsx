'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { provisionHolderWalletAction } from '@/lib/actions/ssi/provision.action'
import { acceptCredentialAction } from '@/lib/actions/ssi/accept.action'

export function ProvisionButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  return (
    <div>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          setErr(null)
          const r = await provisionHolderWalletAction()
          if (!r.success) setErr(r.error ?? 'unknown')
          else router.refresh()
        })}
        style={{
          padding: '0.6rem 1rem', background: '#3f6ee8', color: '#fff',
          borderRadius: 8, border: 0, cursor: pending ? 'wait' : 'pointer', fontWeight: 600,
        }}
      >
        {pending ? 'Provisioning…' : 'Provision holder wallet'}
      </button>
      {err && <div style={{ marginTop: 8, color: '#c62828' }}>Error: {err}</div>}
    </div>
  )
}

const MEMBERSHIP_DEFAULTS = { membershipStatus: 'active', role: 'member', joinedYear: '2025', circleId: 'circle_wellington' }
const GUARDIAN_DEFAULTS   = { relationship: 'parent', minorBirthYear: '2015', issuedYear: '2026' }

export function AcceptMembershipButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  return (
    <div>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          setErr(null); setOk(null)
          const r = await acceptCredentialAction({
            issuer: 'org',
            credentialType: 'OrgMembershipCredential',
            attributes: MEMBERSHIP_DEFAULTS,
          })
          if (!r.success) setErr(r.error ?? 'unknown')
          else { setOk(r.credentialId!); router.refresh() }
        })}
        style={{
          padding: '0.5rem 0.9rem', background: '#fff', color: '#202637',
          border: '1px solid #c7d0e8', borderRadius: 8, cursor: pending ? 'wait' : 'pointer', fontWeight: 500,
        }}
      >
        {pending ? 'Accepting…' : 'Accept OrgMembership (Catalyst)'}
      </button>
      {err && <div style={{ marginTop: 6, color: '#c62828', fontSize: 12 }}>✗ {err}</div>}
      {ok && <div style={{ marginTop: 6, color: '#2e7d32', fontSize: 12 }}>✓ stored {ok.slice(0, 20)}…</div>}
    </div>
  )
}

export function AcceptGuardianButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  return (
    <div>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          setErr(null); setOk(null)
          const r = await acceptCredentialAction({
            issuer: 'family',
            credentialType: 'GuardianOfMinorCredential',
            attributes: GUARDIAN_DEFAULTS,
          })
          if (!r.success) setErr(r.error ?? 'unknown')
          else { setOk(r.credentialId!); router.refresh() }
        })}
        style={{
          padding: '0.5rem 0.9rem', background: '#fff', color: '#202637',
          border: '1px solid #c7d0e8', borderRadius: 8, cursor: pending ? 'wait' : 'pointer', fontWeight: 500,
        }}
      >
        {pending ? 'Accepting…' : 'Accept GuardianOfMinor (Family)'}
      </button>
      {err && <div style={{ marginTop: 6, color: '#c62828', fontSize: 12 }}>✗ {err}</div>}
      {ok && <div style={{ marginTop: 6, color: '#2e7d32', fontSize: 12 }}>✓ stored {ok.slice(0, 20)}…</div>}
    </div>
  )
}
