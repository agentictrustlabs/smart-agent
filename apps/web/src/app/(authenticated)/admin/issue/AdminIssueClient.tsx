'use client'

import { useState, useTransition } from 'react'
import {
  adminIssueMembershipAction,
  adminIssueGuardianAction,
  adminCreateOid4vciOfferAction,
} from '@/lib/actions/ssi/admin-issue.action'

export function AdminIssueClient() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <MembershipForm />
      <GuardianForm />
      <Oid4vciOfferForm />
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1rem 1.25rem' }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.75rem' }}>{title}</h2>
      {children}
    </div>
  )
}

function input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{
    padding: '0.45rem 0.6rem', border: '1px solid #c7d0e8', borderRadius: 6, fontSize: 13, width: '100%',
    ...props.style,
  }} />
}

function MembershipForm() {
  const [pending, start] = useTransition()
  const [f, setF] = useState({ membershipStatus: 'active', role: 'leader', joinedYear: '2024', circleId: 'circle_wellington' })
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <Card title="Direct issue — OrgMembership">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        {(['membershipStatus', 'role', 'joinedYear', 'circleId'] as const).map(k =>
          <label key={k} style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
            {k}
            {input({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.currentTarget.value }) })}
          </label>,
        )}
      </div>
      <button disabled={pending} onClick={() => start(async () => {
        setMsg(null)
        const r = await adminIssueMembershipAction(f)
        setMsg(r.success ? `✓ issued ${r.credentialId}` : `✗ ${r.error}`)
      })} style={btn}>
        {pending ? 'Issuing…' : 'Issue OrgMembership to me'}
      </button>
      {msg && <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div>}
    </Card>
  )
}

function GuardianForm() {
  const [pending, start] = useTransition()
  const [f, setF] = useState({ relationship: 'legal-guardian', minorBirthYear: '2012', issuedYear: '2026' })
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <Card title="Direct issue — GuardianOfMinor">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        {(['relationship', 'minorBirthYear', 'issuedYear'] as const).map(k =>
          <label key={k} style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
            {k}
            {input({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.currentTarget.value }) })}
          </label>,
        )}
      </div>
      <button disabled={pending} onClick={() => start(async () => {
        setMsg(null)
        const r = await adminIssueGuardianAction(f)
        setMsg(r.success ? `✓ issued ${r.credentialId}` : `✗ ${r.error}`)
      })} style={btn}>
        {pending ? 'Issuing…' : 'Issue Guardian to me'}
      </button>
      {msg && <div style={{ marginTop: 8, fontSize: 12 }}>{msg}</div>}
    </Card>
  )
}

function Oid4vciOfferForm() {
  const [pending, start] = useTransition()
  const [f, setF] = useState({ membershipStatus: 'active', role: 'member', joinedYear: '2023', circleId: 'circle_wellington' })
  const [offer, setOffer] = useState<{
    preAuthCode: string; offerUri: string; credDefId: string; schemaId: string; issuerId: string
  } | null>(null)
  return (
    <Card title="OID4VCI — issue via pre-authorized offer URI">
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Generates a pre-authorized_code offer URI that can be pasted into
        <a href="/wallet/oid4vci" style={{ color: '#3f6ee8' }}> /wallet/oid4vci </a>
        to exchange for a credential. Simulates an external OID4VCI flow.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        {(['membershipStatus', 'role', 'joinedYear', 'circleId'] as const).map(k =>
          <label key={k} style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
            {k}
            {input({ value: f[k], onChange: (e) => setF({ ...f, [k]: e.currentTarget.value }) })}
          </label>,
        )}
      </div>
      <button disabled={pending} onClick={() => start(async () => {
        const r = await adminCreateOid4vciOfferAction(f)
        if (r.success) setOffer({ preAuthCode: r.preAuthCode!, offerUri: r.offerUri!, credDefId: r.credDefId!, schemaId: r.schemaId!, issuerId: r.issuerId! })
        else setOffer(null)
      })} style={btn}>
        {pending ? 'Building…' : 'Create pre-auth offer'}
      </button>
      {offer && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>pre-authorized_code:</div>
          <code style={{ display: 'block', padding: '6px 8px', background: '#f1f5f9', borderRadius: 6, fontSize: 11, wordBreak: 'break-all' }}>{offer.preAuthCode}</code>
          <div style={{ fontSize: 12, color: '#64748b', margin: '8px 0 4px' }}>credential_offer_uri (paste into /wallet/oid4vci):</div>
          <code style={{ display: 'block', padding: '6px 8px', background: '#f1f5f9', borderRadius: 6, fontSize: 11, wordBreak: 'break-all' }}>{offer.offerUri}</code>
        </div>
      )}
    </Card>
  )
}

const btn: React.CSSProperties = {
  padding: '0.5rem 0.9rem', background: '#3f6ee8', color: '#fff',
  borderRadius: 8, border: 0, cursor: 'pointer', fontWeight: 600, fontSize: 13,
}
