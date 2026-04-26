'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getJoinableOrgsForHub, type JoinableOrg } from '@/lib/actions/onboarding/org-onboard.action'
import {
  prepareAnonOrgRegistration,
  submitProvisionWallet,
  prepareAcceptCredentialOffer,
  completeAnonOrgRegistration,
} from '@/lib/actions/ssi/anon-org.action'
import { signWalletActionClient } from '@/lib/sign-wallet-action-client'

interface AnonOrgRegistrationDialogProps {
  hubAddress: string
  hubName: string
  onCancel: () => void
  onIssued: (credentialId: string) => void
}

type Phase = 'idle' | 'preparing' | 'signing-provision' | 'submitting-provision' | 'preparing-offer' | 'signing-accept' | 'completing'

const PHASE_LABEL: Record<Phase, string> = {
  'idle': 'Register anonymously',
  'preparing': 'Preparing…',
  'signing-provision': 'Sign to provision your wallet…',
  'submitting-provision': 'Provisioning wallet…',
  'preparing-offer': 'Fetching credential offer…',
  'signing-accept': 'Sign to accept the credential…',
  'completing': 'Issuing credential…',
}

/**
 * Anonymous org registration with **client-side signing**.
 *
 * The two WalletActions in the AnonCreds dance (ProvisionHolderWallet,
 * AcceptCredentialOffer) are signed by the user's auth method:
 *
 *   - SIWE / MetaMask → eth_signTypedData_v4 popup
 *   - Passkey / Google → WebAuthn assertion (Daimo verifier validates the
 *     P-256 signature on-chain)
 *   - Demo / legacy   → server-side with stored EOA key (no client prompt)
 *
 * The deployer key is never used here — the holder's signature *is* the
 * authorization. If the user already has a holder wallet, only the
 * AcceptCredentialOffer prompt is needed.
 */
export function AnonOrgRegistrationDialog({ hubAddress, hubName, onCancel, onIssued }: AnonOrgRegistrationDialogProps) {
  const [orgs, setOrgs] = useState<JoinableOrg[] | null>(null)
  const [orgAddress, setOrgAddress] = useState<string>('')
  const [role, setRole] = useState('member')
  const [phase, setPhase] = useState<Phase>('idle')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await getJoinableOrgsForHub(hubAddress).catch(() => [] as JoinableOrg[])
      if (cancelled) return
      setOrgs(list)
      if (list.length > 0) setOrgAddress(list[0].address)
    })()
    return () => { cancelled = true }
  }, [hubAddress])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!orgAddress) { setErr('Pick an organization'); return }
    const org = orgs?.find(o => o.address === orgAddress)
    if (!org) { setErr('Org lookup failed'); return }

    start(async () => {
      try {
        // ─── Step 1: prepare (returns existing wallet or provision action) ──
        setPhase('preparing')
        const prep = await prepareAnonOrgRegistration()
        if (!prep.success || !prep.signer) {
          setErr(prep.error ?? 'Prepare failed'); setPhase('idle'); return
        }

        let holderWalletId: string
        if (prep.alreadyProvisioned) {
          holderWalletId = prep.alreadyProvisioned.holderWalletId
        } else if (prep.needsProvision) {
          // ─── Step 2: client-sign + submit ProvisionHolderWallet ────────
          setPhase('signing-provision')
          const sig = await signWalletActionClient(
            prep.needsProvision.action,
            prep.needsProvision.hash,
            prep.signer,
          )
          setPhase('submitting-provision')
          const subm = await submitProvisionWallet({
            action: prep.needsProvision.action,
            signature: sig,
          })
          if (!subm.success || !subm.holderWalletId) {
            setErr(subm.error ?? 'Provision failed'); setPhase('idle'); return
          }
          holderWalletId = subm.holderWalletId
        } else {
          setErr('Unexpected prepare response'); setPhase('idle'); return
        }

        // ─── Step 3: fetch offer + build AcceptCredentialOffer action ──────
        setPhase('preparing-offer')
        const accept = await prepareAcceptCredentialOffer({ holderWalletId })
        if (!accept.success || !accept.signer || !accept.offer || !accept.toSign) {
          setErr(accept.error ?? 'Offer fetch failed'); setPhase('idle'); return
        }

        // ─── Step 4: client-sign AcceptCredentialOffer ────────────────────
        setPhase('signing-accept')
        const acceptSig = await signWalletActionClient(
          accept.toSign.action,
          accept.toSign.hash,
          accept.signer,
        )

        // ─── Step 5: complete the exchange ────────────────────────────────
        setPhase('completing')
        const fin = await completeAnonOrgRegistration({
          action: accept.toSign.action,
          signature: acceptSig,
          holderWalletId,
          offer: accept.offer,
          targetOrgAddress: org.address,
          attributes: {
            membershipStatus: 'active',
            role: role.trim() || 'member',
            joinedYear: String(new Date().getFullYear()),
            circleId: org.primaryName || `0x${org.address.slice(2, 10)}`,
          },
        })
        if (!fin.success || !fin.credentialId) {
          setErr(fin.error ?? 'Issuance failed'); setPhase('idle'); return
        }

        onIssued(fin.credentialId)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed')
        setPhase('idle')
      }
    })
  }

  const buttonLabel = phase === 'idle' ? 'Register anonymously' : PHASE_LABEL[phase]

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16,
          boxShadow: '0 24px 80px rgba(15, 23, 42, 0.30)',
          width: '100%', maxWidth: 480, padding: '1.25rem 1.25rem 1.5rem',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#171c28', margin: '0 0 4px' }}>
          Anonymous organization registration
        </h2>
        <p style={{ fontSize: 13, color: '#5d6478', margin: '0 0 16px' }}>
          Receive an AnonCreds membership credential from <b>{hubName || 'this hub'}</b>.
          Authorized by your passkey or wallet — no deployer-signed shortcuts.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
              Organization
            </label>
            {orgs === null ? (
              <div style={{ fontSize: 12, color: '#94a3b8', padding: '0.4rem 0' }}>Loading…</div>
            ) : orgs.length === 0 ? (
              <div style={{ fontSize: 12, color: '#b91c1c', padding: '0.4rem 0' }}>
                No orgs in this hub yet — create one first.
              </div>
            ) : (
              <select
                value={orgAddress}
                onChange={(e) => setOrgAddress(e.target.value)}
                style={{
                  width: '100%', padding: '0.55rem 0.7rem',
                  border: '1px solid #cbd5e1', borderRadius: 8,
                  fontSize: 13, background: '#fff',
                }}
                data-testid="anon-org-picker"
              >
                {orgs.map(o => (
                  <option key={o.address} value={o.address}>
                    {o.displayName}{o.primaryName ? ` — ${o.primaryName}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <Input
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="member"
            data-testid="anon-org-role"
          />

          <div style={{
            padding: '0.55rem 0.7rem', background: '#eff6ff',
            border: '1px solid #bfdbfe', color: '#1e40af',
            borderRadius: 8, fontSize: 12, lineHeight: 1.45,
          }}>
            You may see one or two signing prompts — the first authorizes
            provisioning your holder wallet (only the first time), the second
            authorizes accepting the credential.
          </div>

          {phase !== 'idle' && (
            <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 12, height: 12, border: '2px solid #cbd5e1', borderTopColor: '#3f6ee8',
                borderRadius: '50%', animation: 'spin 0.9s linear infinite',
              }} />
              <span>{PHASE_LABEL[phase]}</span>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}

          {err && (
            <div role="alert" style={{
              padding: '0.55rem 0.75rem', background: '#fef2f2',
              border: '1px solid #fecaca', color: '#b91c1c',
              borderRadius: 8, fontSize: 12,
            }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Button type="button" variant="outlined" onClick={onCancel} disabled={pending} className="flex-1">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !orgAddress || (orgs?.length ?? 0) === 0}
              className="flex-1"
              data-testid="anon-org-submit"
            >
              {buttonLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
