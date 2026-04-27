'use client'

import { useState, useTransition } from 'react'
import { walletStatusAction, type CredentialRow } from '@/lib/actions/ssi/list.action'
import {
  prepareVerifyHeldCredential,
  completeVerifyHeldCredential,
  type ProofSummary,
} from '@/lib/actions/ssi/verify-held.action'
import { signWalletActionClient } from '@/lib/sign-wallet-action-client'
import { findCredentialKind } from '@smart-agent/sdk'

interface VerifierSnapshot {
  label: string
  verifierId: string
  verifierAddress: `0x${string}`
}

interface PresentationSnapshot {
  name: string
  requestedAttrNames: string[]
  predicates: Array<{ attribute: string; operator: string; value: number }>
}

type VerifyState =
  | { phase: 'busy'; label: string }
  | {
      phase: 'verified'
      revealed: Record<string, string>
      pairwise?: string
      verifier: VerifierSnapshot
      request: PresentationSnapshot
      verifiedAt: number
      proofSummary?: ProofSummary
    }
  | { phase: 'failed'; reason: string }

/**
 * Lists AnonCreds credentials held in the user's vault. Attribute values
 * (e.g. featureName, role, joinedYear, …) are loaded inline alongside
 * metadata — the holder owns this data and asks for it directly.
 *
 * The "Test verification" button runs the credential through verifier-mcp
 * and shows the verifier identity, what was checked, and what was revealed.
 */
export function HeldCredentialsPanel() {
  const [open, setOpen] = useState(false)
  const [creds, setCreds] = useState<CredentialRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [verify, setVerify] = useState<Record<string, VerifyState>>({})

  function setVerifyFor(id: string, value: VerifyState) {
    setVerify(prev => ({ ...prev, [id]: value }))
  }

  async function testVerification(c: CredentialRow) {
    setVerifyFor(c.id, { phase: 'busy', label: 'Fetching request…' })
    try {
      const prep = await prepareVerifyHeldCredential({ credentialId: c.id })
      if (!prep.success || !prep.signer || !prep.toSign || !prep.presentationRequest || !prep.selection || !prep.verifierIdentity || !prep.credentialType) {
        setVerifyFor(c.id, { phase: 'failed', reason: prep.error ?? 'prepare failed' })
        return
      }
      setVerifyFor(c.id, { phase: 'busy', label: 'Sign to present…' })
      const sig = await signWalletActionClient(
        prep.toSign.action,
        prep.toSign.hash,
        prep.signer,
      )
      setVerifyFor(c.id, { phase: 'busy', label: 'Verifying…' })
      const fin = await completeVerifyHeldCredential({
        action: prep.toSign.action,
        signature: sig,
        credentialId: c.id,
        credentialType: prep.credentialType,
        presentationRequest: prep.presentationRequest,
        selection: prep.selection,
        verifierIdentity: prep.verifierIdentity,
      })
      if (!fin.success) {
        setVerifyFor(c.id, { phase: 'failed', reason: fin.error ?? 'verify failed' })
        return
      }
      if (!fin.verified) {
        setVerifyFor(c.id, { phase: 'failed', reason: fin.reason ?? 'not verified' })
        return
      }
      const req = prep.presentationRequest as {
        name?: string
        requested_attributes?: Record<string, { name: string }>
        requested_predicates?: Record<string, { name: string; p_type: string; p_value: number }>
      }
      const predicates = Object.values(req.requested_predicates ?? {}).map(p => ({
        attribute: p.name, operator: p.p_type, value: p.p_value,
      }))
      const requestedAttrNames = Object.values(req.requested_attributes ?? {}).map(a => a.name)
      setVerifyFor(c.id, {
        phase: 'verified',
        revealed: fin.revealedValues ?? {},
        pairwise: fin.pairwiseHandle,
        verifier: {
          label: prep.verifierIdentity.label,
          verifierId: prep.verifierIdentity.verifierId,
          verifierAddress: prep.verifierIdentity.verifierAddress,
        },
        request: {
          name: req.name ?? 'audit',
          requestedAttrNames,
          predicates,
        },
        verifiedAt: Date.now(),
      })
    } catch (e) {
      setVerifyFor(c.id, { phase: 'failed', reason: e instanceof Error ? e.message : 'failed' })
    }
  }

  function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (creds) return
    start(async () => {
      try {
        const status = await walletStatusAction()
        if (status.error) { setErr(status.error); return }
        setCreds(status.credentials)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to load credentials')
      }
    })
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'transparent', border: 'none',
          color: '#3f6ee8', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', padding: '0.25rem 0',
        }}
        data-testid="held-creds-toggle"
      >
        <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        {open ? 'Hide held credentials' : 'Show held credentials'}
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          {pending && <div style={{ fontSize: 12, color: '#94a3b8' }}>Loading…</div>}
          {err && (
            <div role="alert" style={{
              padding: '0.4rem 0.6rem', background: '#fef2f2',
              border: '1px solid #fecaca', color: '#b91c1c',
              borderRadius: 6, fontSize: 12,
            }}>{err}</div>
          )}
          {!pending && !err && creds && creds.length === 0 && (
            <div style={{ fontSize: 12, color: '#64748b' }}>
              No held credentials yet. Use the dropdown's <b>+ Get {`{noun}`} credential</b>
              entries to receive one.
            </div>
          )}
          {!pending && !err && creds && creds.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {creds.map(c => {
                const descriptor = findCredentialKind(c.credentialType)
                return (
                  <CredentialCard
                    key={c.id}
                    cred={c}
                    descriptor={descriptor ? { displayName: descriptor.displayName, attributeNames: descriptor.attributeNames } : null}
                    verifyState={verify[c.id]}
                    onTestVerification={() => testVerification(c)}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Per-credential card ─────────────────────────────────────────────────

interface DescriptorView {
  displayName: string
  attributeNames: readonly string[]
}

function CredentialCard({
  cred: c,
  descriptor,
  verifyState,
  onTestVerification,
}: {
  cred: CredentialRow
  descriptor: DescriptorView | null
  verifyState: VerifyState | undefined
  onTestVerification: () => void
}) {
  const v = verifyState
  return (
    <div
      style={{
        padding: '0.55rem 0.7rem',
        border: '1px solid #e5e7eb', borderRadius: 8,
        background: '#fafbfc', fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ fontWeight: 600, color: '#171c28' }} title={c.credentialType}>
          {descriptor?.displayName ?? c.credentialType}
        </span>
        {c.anchored === true && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
            textTransform: 'uppercase', color: '#15803d',
            background: '#dcfce7', padding: '1px 6px', borderRadius: 999,
          }}>anchored</span>
        )}
        {c.anchored === false && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
            textTransform: 'uppercase', color: '#92400e',
            background: '#fef3c7', padding: '1px 6px', borderRadius: 999,
          }}>unanchored</span>
        )}
      </div>
      {c.targetOrgDisplayName && (
        <div
          style={{ color: '#64748b', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
          title={c.targetOrgAddress ?? undefined}
        >
          <span>for</span>
          <span style={{ fontWeight: 600, color: '#171c28' }}>{c.targetOrgDisplayName}</span>
          {c.targetOrgPrimaryName && (
            <code style={{
              fontFamily: 'ui-monospace, monospace', fontSize: 10,
              background: '#eef2ff', color: '#3f6ee8',
              padding: '0 4px', borderRadius: 4,
            }}>{c.targetOrgPrimaryName}</code>
          )}
        </div>
      )}
      <div
        style={{ color: '#64748b', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
        title={c.issuerId}
      >
        <span>issued by</span>
        {c.issuerDisplayName ? (
          <>
            <span style={{ fontWeight: 600, color: '#171c28' }}>{c.issuerDisplayName}</span>
            {c.issuerPrimaryName && (
              <code style={{
                fontFamily: 'ui-monospace, monospace', fontSize: 10,
                background: '#eef2ff', color: '#3f6ee8',
                padding: '0 4px', borderRadius: 4,
              }}>{c.issuerPrimaryName}</code>
            )}
          </>
        ) : c.issuerAddress ? (
          <code style={{ fontSize: 10 }}>{c.issuerAddress.slice(0, 6)}…{c.issuerAddress.slice(-4)}</code>
        ) : (
          <code style={{ fontSize: 10 }}>{c.issuerId.slice(0, 28)}{c.issuerId.length > 28 ? '…' : ''}</code>
        )}
      </div>
      <div style={{ color: '#64748b', fontSize: 11 }}>
        received {new Date(c.receivedAt).toLocaleString()} · context {c.walletContext}
      </div>

      {/* ─── Private attribute values from the vault (always shown) ─── */}
      {Object.keys(c.attributes).length > 0 && (
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e5e7eb',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
            textTransform: 'uppercase', color: '#9a8c7e', marginBottom: 4,
          }}>
            Contents (private — only you see this)
          </div>
          <AttributeTable
            attributes={c.attributes}
            preferredOrder={descriptor?.attributeNames ?? null}
          />
        </div>
      )}

      {/* ─── Verification action / result ─── */}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e5e7eb', display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        {!v && (
          <button
            type="button"
            onClick={onTestVerification}
            style={{
              padding: '0.25rem 0.6rem',
              background: '#eef2ff', color: '#3f6ee8',
              border: '1px solid #c7d2fe', borderRadius: 5,
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
            }}
            data-testid="held-cred-test-verify"
          >
            Test verification
          </button>
        )}
        {v?.phase === 'busy' && (
          <span style={{ fontSize: 11, color: '#3f6ee8' }} data-testid="held-cred-verify-busy">
            {v.label}
          </span>
        )}
        {v?.phase === 'verified' && (
          <VerifiedDetail verify={v} onRerun={onTestVerification} />
        )}
        {v?.phase === 'failed' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }} data-testid="held-cred-verify-failed">
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
              textTransform: 'uppercase', color: '#b91c1c',
              background: '#fef2f2', padding: '1px 6px', borderRadius: 999,
            }}>failed</span>
            <span style={{ color: '#b91c1c' }} title={v.reason}>{v.reason.slice(0, 80)}{v.reason.length > 80 ? '…' : ''}</span>
            <button
              type="button"
              onClick={onTestVerification}
              style={{
                padding: '0.15rem 0.4rem',
                background: 'transparent', color: '#3f6ee8',
                border: '1px solid #c7d2fe', borderRadius: 4,
                fontSize: 10, cursor: 'pointer',
              }}
            >retry</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function AttributeTable({
  attributes,
  preferredOrder,
}: {
  attributes: Record<string, string>
  preferredOrder: readonly string[] | null
}) {
  const ordered = orderAttributeKeys(attributes, preferredOrder)
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      columnGap: 12, rowGap: 2,
      fontFamily: 'ui-monospace, monospace', fontSize: 11,
    }}>
      {ordered.map(name => (
        <ATRow key={name} name={name} value={attributes[name]} />
      ))}
    </div>
  )
}

function ATRow({ name, value }: { name: string; value: string }) {
  return (
    <>
      <span style={{ color: '#64748b' }}>{name}</span>
      <span style={{ color: '#171c28', wordBreak: 'break-all' }}>{value}</span>
    </>
  )
}

function orderAttributeKeys(
  attrs: Record<string, string>,
  preferred: readonly string[] | null,
): string[] {
  const present = new Set(Object.keys(attrs))
  if (!preferred) return Object.keys(attrs).sort()
  const out: string[] = []
  for (const p of preferred) if (present.has(p)) { out.push(p); present.delete(p) }
  for (const r of Array.from(present).sort()) out.push(r)
  return out
}

function VerifiedDetail({
  verify: v,
  onRerun,
}: {
  verify: Extract<VerifyState, { phase: 'verified' }>
  onRerun: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, flex: 1, minWidth: 0 }} data-testid="held-cred-verify-ok">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
          textTransform: 'uppercase', color: '#15803d',
          background: '#dcfce7', padding: '1px 6px', borderRadius: 999,
        }}>verified ✓</span>
        <span style={{ color: '#475569' }}>by</span>
        <span style={{ fontWeight: 600, color: '#171c28' }}>{v.verifier.label}</span>
        <button
          type="button"
          onClick={onRerun}
          style={{
            marginLeft: 'auto',
            padding: '0.15rem 0.4rem',
            background: 'transparent', color: '#94a3b8',
            border: '1px solid #e5e7eb', borderRadius: 4,
            fontSize: 9, cursor: 'pointer',
          }}
          title="Run verification again"
        >re-run</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, color: '#94a3b8', fontSize: 10 }}>
        <KvLine k="verifier DID" v={v.verifier.verifierId} mono />
        <KvLine k="verifier addr" v={v.verifier.verifierAddress} mono />
        <KvLine k="audit name" v={v.request.name} />
        <KvLine k="verified at" v={new Date(v.verifiedAt).toLocaleString()} />
      </div>

      {v.request.predicates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
          <span style={{ color: '#64748b', fontSize: 10 }}>Predicates proven (no value disclosed):</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {v.request.predicates.map((p, i) => (
              <code key={i} style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 3,
                background: '#dcfce7', color: '#166534',
                fontFamily: 'ui-monospace, monospace',
              }}>{p.attribute} {opSym(p.operator)} {p.value} ✓</code>
            ))}
          </div>
        </div>
      )}

      {Object.keys(v.revealed).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
          <span style={{ color: '#64748b', fontSize: 10 }}>Attributes revealed:</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {Object.entries(v.revealed).map(([k, val]) => (
              <code key={k} style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 3,
                background: '#eff6ff', color: '#1e40af',
                fontFamily: 'ui-monospace, monospace',
              }}>{k} = {val}</code>
            ))}
          </div>
        </div>
      )}

      {v.pairwise && (
        <div style={{ color: '#94a3b8', fontSize: 10 }}>
          pairwise handle <code style={{ fontFamily: 'ui-monospace, monospace' }}>{v.pairwise.slice(0, 16)}…</code>
          <span style={{ marginLeft: 6 }}>(per-verifier opaque ID — different verifiers can&apos;t correlate you across audits)</span>
        </div>
      )}
    </div>
  )
}

function KvLine({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ color: '#94a3b8', minWidth: 80 }}>{k}</span>
      <span
        style={{
          color: '#475569',
          fontFamily: mono ? 'ui-monospace, monospace' : undefined,
          wordBreak: 'break-all',
        }}
      >{v}</span>
    </div>
  )
}

function opSym(op: string): string {
  switch (op) {
    case '>=': return '≥'
    case '<=': return '≤'
    case '>':  return '>'
    case '<':  return '<'
    default:   return op
  }
}
