'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { provisionHolderWalletAction } from '@/lib/actions/ssi/provision.action'
import { acceptCredentialAction } from '@/lib/actions/ssi/accept.action'
import { rotateLinkSecretAction } from '@/lib/actions/ssi/rotate.action'

interface WalletSummary {
  id: string
  walletContext: string
  holderWalletRef: string
  status: string
  createdAt: string
}

export function ContextPicker({
  wallets, activeContext,
}: { wallets: WalletSummary[]; activeContext: string }) {
  const router = useRouter()
  const [newContext, setNewContext] = useState('')
  const [creating, startCreate] = useTransition()

  const contextList = wallets.map(w => w.walletContext)
  if (!contextList.includes(activeContext)) contextList.push(activeContext)
  if (contextList.length === 0) contextList.push('default')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
                  padding: '0.55rem 0.9rem', background: '#fff', border: '1px solid #e2e8f0',
                  borderRadius: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Active wallet context:</span>
      <select
        value={activeContext}
        onChange={e => router.push(`/wallet?context=${encodeURIComponent(e.currentTarget.value)}`)}
        style={{ padding: '0.35rem 0.55rem', border: '1px solid #c7d0e8', borderRadius: 6, fontSize: 13 }}
      >
        {Array.from(new Set(contextList)).map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <span style={{ fontSize: 11, color: '#64748b' }}>
        ({wallets.length} wallet{wallets.length === 1 ? '' : 's'})
      </span>
      <div style={{ flex: 1 }} />
      <input
        placeholder="new context (e.g. professional)"
        value={newContext}
        onChange={e => setNewContext(e.currentTarget.value)}
        style={{ padding: '0.35rem 0.55rem', border: '1px solid #c7d0e8', borderRadius: 6, fontSize: 12, minWidth: 220 }}
      />
      <button
        disabled={creating || newContext.trim().length < 2}
        onClick={() => startCreate(async () => {
          const ctx = newContext.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
          if (!ctx) return
          const r = await provisionHolderWalletAction(ctx)
          if (r.success) {
            setNewContext('')
            router.push(`/wallet?context=${encodeURIComponent(ctx)}`)
          } else {
            alert(`provision failed: ${r.error}`)
          }
        })}
        style={{
          padding: '0.4rem 0.8rem', background: '#3f6ee8', color: '#fff',
          borderRadius: 6, border: 0, cursor: creating ? 'wait' : 'pointer', fontWeight: 600, fontSize: 12,
        }}
      >
        {creating ? 'Creating…' : '+ New context'}
      </button>
    </div>
  )
}

export function ProvisionButton({ walletContext }: { walletContext: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  return (
    <div>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          setErr(null)
          const r = await provisionHolderWalletAction(walletContext)
          if (!r.success) setErr(r.error ?? 'unknown')
          else router.refresh()
        })}
        data-testid="provision-button"
        style={{
          padding: '0.55rem 1rem', background: '#3f6ee8', color: '#fff',
          borderRadius: 8, border: 0, cursor: pending ? 'wait' : 'pointer', fontWeight: 600,
        }}
      >
        {pending ? 'Provisioning…' : `Provision "${walletContext}" wallet`}
      </button>
      {err && <div data-testid="provision-error" style={{ marginTop: 8, color: '#c62828' }}>Error: {err}</div>}
    </div>
  )
}

const MEMBERSHIP_DEFAULTS = { membershipStatus: 'active', role: 'member', joinedYear: '2025', circleId: 'circle_wellington' }
const GUARDIAN_DEFAULTS   = { relationship: 'parent', minorBirthYear: '2015', issuedYear: '2026' }

function AcceptButton({
  label, walletContext, args,
}: {
  label: string
  walletContext: string
  args: {
    issuer: 'org' | 'family'
    credentialType: 'OrgMembershipCredential' | 'GuardianOfMinorCredential'
    attributes: Record<string, string>
  }
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk]   = useState<string | null>(null)
  return (
    <div>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          setErr(null); setOk(null)
          const r = await acceptCredentialAction({ ...args, walletContext })
          if (!r.success) setErr(r.error ?? 'unknown')
          else { setOk(r.credentialId!); router.refresh() }
        })}
        data-testid={args.credentialType === 'OrgMembershipCredential' ? 'accept-membership' : 'accept-guardian'}
        style={{
          padding: '0.5rem 0.9rem', background: '#fff', color: '#202637',
          border: '1px solid #c7d0e8', borderRadius: 8, cursor: pending ? 'wait' : 'pointer', fontWeight: 500,
        }}
      >
        {pending ? 'Accepting…' : label}
      </button>
      {err && <div data-testid="accept-error" style={{ marginTop: 6, color: '#c62828', fontSize: 12 }}>✗ {err}</div>}
      {ok && <div data-testid="accept-ok" style={{ marginTop: 6, color: '#2e7d32', fontSize: 12 }}>✓ stored {ok.slice(0, 20)}…</div>}
    </div>
  )
}
export function AcceptMembershipButton({ walletContext }: { walletContext: string }) {
  return (
    <AcceptButton
      label="Accept OrgMembership (Catalyst)"
      walletContext={walletContext}
      args={{ issuer: 'org', credentialType: 'OrgMembershipCredential', attributes: MEMBERSHIP_DEFAULTS }}
    />
  )
}
export function AcceptGuardianButton({ walletContext }: { walletContext: string }) {
  return (
    <AcceptButton
      label="Accept GuardianOfMinor (Family)"
      walletContext={walletContext}
      args={{ issuer: 'family', credentialType: 'GuardianOfMinorCredential', attributes: GUARDIAN_DEFAULTS }}
    />
  )
}

export function RotateLinkSecretButton({ walletContext }: { walletContext: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div>
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm(`Rotate link secret for "${walletContext}"? Existing credentials in this wallet will need to be re-issued.`)) return
          start(async () => {
            setMsg(null)
            const r = await rotateLinkSecretAction({ walletContext })
            if (r.success) {
              setMsg(`✓ rotated · ${r.credentialsMarkedStale} credential(s) marked stale`)
              router.refresh()
            } else {
              setMsg(`✗ ${r.error}`)
            }
          })
        }}
        style={{
          padding: '0.35rem 0.7rem', background: '#fff', color: '#c65d4b',
          border: '1px solid #c65d4b55', borderRadius: 6, cursor: pending ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600,
        }}
      >
        {pending ? 'Rotating…' : 'Rotate link secret'}
      </button>
      {msg && <div style={{ marginTop: 6, fontSize: 11 }}>{msg}</div>}
    </div>
  )
}
