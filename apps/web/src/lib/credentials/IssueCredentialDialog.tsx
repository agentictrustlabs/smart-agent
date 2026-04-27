'use client'

import { useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { findIssuableKind } from './registry'
import type { CredentialFormContext, FormHandle, FormSubmissionResult } from './forms/types'
import {
  prepareWalletProvisionIfNeeded,
  submitWalletProvision,
} from '@/lib/actions/ssi/wallet-provision.action'
import {
  prepareCredentialIssuance,
  completeCredentialIssuance,
} from '@/lib/actions/ssi/request-credential.action'
import { signWalletActionClient } from '@/lib/sign-wallet-action-client'

interface IssueCredentialDialogProps {
  /** Which credential kind (e.g. 'OrgMembershipCredential', 'GeoLocationCredential'). */
  credentialType: string
  /** Hub-context propagated from `HubLayout` when available. */
  context?: CredentialFormContext
  onCancel: () => void
  onIssued: (credentialId: string) => void
}

type Phase =
  | 'idle'
  | 'preparing'
  | 'signing-provision' | 'submitting-provision'
  | 'preparing-offer'
  | 'signing-accept'
  | 'completing'

const PHASE_LABEL: Record<Phase, string> = {
  'idle':                  'Get credential',
  'preparing':             'Preparing…',
  'signing-provision':     'Sign to provision your wallet…',
  'submitting-provision':  'Provisioning wallet…',
  'preparing-offer':       'Fetching credential offer…',
  'signing-accept':        'Sign to accept the credential…',
  'completing':            'Issuing credential…',
}

/**
 * Generic AnonCreds issuance dialog. Renders the form registered for
 * `credentialType` and runs the standard provision → sign → submit
 * flow on submit. One component for every credential kind.
 *
 * The kind-specific form decides what attributes the credential will
 * carry (and any extra issue args like `targetOrgAddress`); this
 * dialog is the framing + state machine around it.
 */
export function IssueCredentialDialog({
  credentialType, context, onCancel, onIssued,
}: IssueCredentialDialogProps) {
  const kind = findIssuableKind(credentialType)
  const [phase, setPhase] = useState<Phase>('idle')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const formApi = useRef<FormHandle | null>(null)
  const [_formReady, setFormReady] = useState(false)

  if (!kind) {
    return (
      <Backdrop onCancel={onCancel}>
        <div style={{ fontSize: 13, color: '#b91c1c' }}>
          Unknown credential type: <code>{credentialType}</code>
        </div>
      </Backdrop>
    )
  }
  const { descriptor, Form } = kind

  function handleFormSubmit(result: FormSubmissionResult) {
    setErr(null)
    start(async () => {
      try {
        // ─── 1. Provision (or reuse) the holder wallet. ─────────────
        setPhase('preparing')
        const prep = await prepareWalletProvisionIfNeeded()
        if (!prep.success || !prep.signer) {
          setErr(prep.error ?? 'Prepare failed'); setPhase('idle'); return
        }

        let holderWalletId: string
        let walletContext: string
        if (prep.alreadyProvisioned) {
          holderWalletId = prep.alreadyProvisioned.holderWalletId
          walletContext = prep.alreadyProvisioned.walletContext
        } else if (prep.needsProvision) {
          setPhase('signing-provision')
          const sig = await signWalletActionClient(
            prep.needsProvision.action,
            prep.needsProvision.hash,
            prep.signer,
          )
          setPhase('submitting-provision')
          const subm = await submitWalletProvision({
            action: prep.needsProvision.action,
            signature: sig,
          })
          if (!subm.success || !subm.holderWalletId || !subm.walletContext) {
            setErr(subm.error ?? 'Provision failed'); setPhase('idle'); return
          }
          holderWalletId = subm.holderWalletId
          walletContext  = subm.walletContext
        } else {
          setErr('Unexpected prepare response'); setPhase('idle'); return
        }

        // ─── 2. Fetch offer + AcceptCredentialOffer action. ─────────
        setPhase('preparing-offer')
        const accept = await prepareCredentialIssuance({
          credentialType: descriptor.credentialType,
          holderWalletId,
          walletContext,
          attributes: result.attributes,
          extraIssueArgs: result.extraIssueArgs,
        })
        if (!accept.success || !accept.signer || !accept.offer || !accept.toSign || !accept.attributes) {
          setErr(accept.error ?? 'Offer fetch failed'); setPhase('idle'); return
        }

        // ─── 3. Client-sign AcceptCredentialOffer. ─────────────────
        setPhase('signing-accept')
        const acceptSig = await signWalletActionClient(
          accept.toSign.action,
          accept.toSign.hash,
          accept.signer,
        )

        // ─── 4. Complete issuance. ─────────────────────────────────
        setPhase('completing')
        const fin = await completeCredentialIssuance({
          credentialType: descriptor.credentialType,
          action: accept.toSign.action,
          signature: acceptSig,
          holderWalletId,
          walletContext,
          offer: accept.offer,
          attributes: accept.attributes,
          extraIssueArgs: accept.extraIssueArgs,
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

  function exposeFormHandle(h: FormHandle) {
    formApi.current = h
    setFormReady(h.ready)
  }

  function triggerSubmit(e: React.FormEvent) {
    e.preventDefault()
    formApi.current?.trigger()
  }

  const buttonLabel = phase === 'idle' ? `Get ${descriptor.noun} credential` : PHASE_LABEL[phase]
  const busy = pending || phase !== 'idle'

  return (
    <Backdrop onCancel={onCancel}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#171c28', margin: '0 0 4px' }}>
        Get {descriptor.displayName.toLowerCase()} credential
      </h2>
      <p style={{ fontSize: 13, color: '#5d6478', margin: '0 0 16px' }}>
        {descriptor.description}
      </p>

      <form onSubmit={triggerSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Form
          busy={busy}
          context={context ?? {}}
          onSubmit={handleFormSubmit}
          onValidationError={setErr}
          expose={exposeFormHandle}
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
          <Button type="button" variant="outlined" onClick={onCancel} disabled={busy} className="flex-1">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy}
            className="flex-1"
            data-testid="issue-credential-submit"
          >
            {buttonLabel}
          </Button>
        </div>
      </form>
    </Backdrop>
  )
}

function Backdrop({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
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
        {children}
      </div>
    </div>
  )
}
