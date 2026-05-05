/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Eligibility block (T034).
 *
 * Server component. Renders the eligibility block on the round detail
 * page (FR-007):
 *   - Geo (`mandate.acceptedGeo`)
 *   - Organisational requirements (parsed from mandate JSON if present)
 *   - Required credentials with the viewer's ownership status inline
 *     ("✓ VerifiedHuman" / "✗ VerifiedOrg — obtain via …")
 *
 * Credential ownership lookup is a v1 placeholder. The project's
 * AnonCreds verifier infra exists (`apps/web/src/lib/credentials/`) but
 * a `userHoldsCredential(principal, kind)` helper isn't present yet —
 * this block accepts a `viewerCredentialKinds` array passed from the
 * page so we can wire in the helper later without rewriting the
 * component. When the helper lands, `[roundId]/page.tsx` populates the
 * array; until then it can pass an empty list and the block renders
 * the "✗ <Kind> — obtain via …" guidance for every required credential.
 */

import { CREDENTIAL_KINDS } from '@smart-agent/sdk'
import type { Round } from '@smart-agent/sdk'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  okBg: 'rgba(13,148,136,0.08)',
  okFg: '#0f766e',
  missBg: 'rgba(190,18,60,0.06)',
  missFg: '#9f1239',
}

function credentialDisplayName(kind: string): string {
  const found = CREDENTIAL_KINDS.find(c => c.credentialType === kind)
  return found?.displayName ?? kind
}

function credentialIssuanceHint(kind: string): string {
  const found = CREDENTIAL_KINDS.find(c => c.credentialType === kind)
  if (!found) return 'Contact a credential issuer.'
  return `Get the ${found.displayName} credential from your wallet.`
}

export function EligibilityBlock({
  round,
  viewerCredentialKinds = [],
}: {
  round: Round
  /** Credential kinds the viewer currently holds — used for "✓/✗" inline. */
  viewerCredentialKinds?: ReadonlyArray<string>
}) {
  const required = round.requiredCredentials ?? []
  const heldSet = new Set(viewerCredentialKinds)

  // Try to parse organisational requirements out of the mandate JSON.
  // Round mandates may carry an optional `organisationalRequirements`
  // field; absent fields render no row. Defensively typed.
  const orgReqs = parseOrgReqs(round)

  return (
    <section
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.95rem 1rem',
        marginBottom: '0.85rem',
      }}
    >
      <h2 style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.65rem' }}>
        Eligibility
      </h2>

      <Row label="Geography">
        {round.mandate.acceptedGeo?.length > 0
          ? round.mandate.acceptedGeo.join(', ')
          : <span style={{ color: C.textMuted }}>Open to any geography</span>}
      </Row>

      {orgReqs.length > 0 && (
        <Row label="Organisation">
          {orgReqs.join(', ')}
        </Row>
      )}

      <Row label="Required credentials">
        {required.length === 0 ? (
          <span style={{ color: C.textMuted }}>None required</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {required.map((cred) => {
              const held = heldSet.has(cred)
              const displayName = credentialDisplayName(cred)
              return (
                <div
                  key={cred}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '0.5rem',
                    fontSize: '0.82rem',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      padding: '0.15rem 0.5rem',
                      borderRadius: 999,
                      background: held ? C.okBg : C.missBg,
                      color: held ? C.okFg : C.missFg,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {held ? '✓' : '✗'} {displayName}
                  </span>
                  {!held && (
                    <span style={{ color: C.textMuted, fontSize: '0.75rem' }}>
                      {credentialIssuanceHint(cred)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Row>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.85rem', marginBottom: '0.55rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
      <div style={{ flex: '0 0 130px', fontSize: '0.7rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: C.text }}>
        {children}
      </div>
    </div>
  )
}

function parseOrgReqs(round: Round): string[] {
  // Mandate is structured (not a JSON literal in TS — already parsed by
  // the discovery service) but `organisationalRequirements` is not in
  // our base type. We accept it via an opt-in `unknown` lookup so that
  // future round-author flows can include it without breaking.
  const m = round.mandate as unknown as Record<string, unknown>
  const raw = m['organisationalRequirements']
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string')
  }
  return []
}
