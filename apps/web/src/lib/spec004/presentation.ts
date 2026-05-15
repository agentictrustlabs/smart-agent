/**
 * Spec 004 (b2) — server-side helper that builds + executes an AnonCreds
 * presentation for the AnonCreds-gated marketplace tools (vote:cast,
 * grant_proposal:*, …).
 *
 * Routing rule (phase 3 of A2A-first consolidation):
 *   - All person-mcp tool calls (`ssi_list_my_credentials`,
 *     `ssi_get_credential_details`, `ssi_create_wallet_action`,
 *     `ssi_create_presentation`) go through `callMcp('person', …)` which
 *     resolves to the signed-in user's person agent via the A2A proxy.
 *     The user IS the presenter here, so we never pin `agentAddress`.
 *   - No direct HTTP to PERSON_MCP_URL.
 *
 * The action layer needs to hand org-mcp a presentation JSON + request.
 * org-mcp's inline `verifyPresentation` then runs `verifierVerifyPresentation`
 * and derives the nullifier from `holderPseudoId`. This helper drives the
 * person-mcp side of that exchange:
 *
 *   1. Build a `presentationRequest` matching what org-mcp expects.
 *   2. Mint + sign a `CreatePresentation` WalletAction.
 *   3. Call `ssi_create_presentation` on person-mcp via A2A proxy.
 *   4. Return `{ presentationJson, presentationRequest }`.
 */

import 'server-only'
import { CREDENTIAL_KINDS, findCredentialKind } from '@smart-agent/sdk'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { callMcp } from '@/lib/clients/mcp-client'
import { signWalletAction, loadSignerForCurrentUser } from '@/lib/ssi/signer'

export type MarketplaceCredentialType = 'ProposalSubmitterCredential' | 'RoundVoterCredential'

export interface BuildPresentationInput {
  credentialType: MarketplaceCredentialType
  /** Attribute name → value that the org-mcp verifier will demand
   *  via `expectedAttributes`. Driven by the action: for
   *  `vote:cast` we pass nothing (no expected attrs); for
   *  `grant_proposal:submit` we pass `{ poolAgentId }`. */
  expectedAttributes?: Record<string, string>
}

export type BuildPresentationResult =
  | {
      ok: true
      presentationJson: string
      presentationRequest: Record<string, unknown>
    }
  | { ok: false; error: string }

// ─── Presentation request builders ───────────────────────────────────

function nonce(): string {
  // AnonCreds nonces are decimal-only strings, typically ≤ 24 digits.
  // crypto.randomUUID has letters; use Math + Date to stay in [0, 2^53).
  return String(Math.floor(Math.random() * 1e15)) + String(Math.floor(Math.random() * 1e7))
}

function buildRequest(input: BuildPresentationInput): Record<string, unknown> {
  const descriptor = findCredentialKind(input.credentialType)
  if (!descriptor) throw new Error(`unknown credentialType ${input.credentialType}`)
  const restrictions = [{ cred_def_id: descriptor.credDefId }]
  // Spec 004 v2 — the credential MUST reveal the per-issuance
  // `nullifierSecret` so the verifier can derive the action nullifier.
  // Caller-supplied expectedAttributes drive any cred ↔ context bindings
  // (e.g. roundSubject for RoundVoterCredential, poolAgentId for
  // ProposalSubmitterCredential); the verifier matches them exactly
  // against the revealed values.
  const requested_attributes: Record<string, unknown> = {
    attr_nullifierSecret: { name: 'nullifierSecret', restrictions },
  }
  for (const name of Object.keys(input.expectedAttributes ?? {})) {
    requested_attributes[`attr_${name}`] = { name, restrictions }
  }
  return {
    name: `${input.credentialType} action proof`,
    version: '1.0',
    nonce: nonce(),
    requested_attributes,
    requested_predicates: {},
  }
}

// ─── Main entrypoint ─────────────────────────────────────────────────

export async function buildMarketplacePresentation(
  input: BuildPresentationInput,
): Promise<BuildPresentationResult> {
  void CREDENTIAL_KINDS

  let signerCtx
  try {
    signerCtx = await loadSignerForCurrentUser()
  } catch (e) {
    return { ok: false, error: `no signer: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (signerCtx.kind !== 'eoa') {
    return { ok: false, error: 'spec-004 presentation building requires an EOA-backed signer (demo path)' }
  }
  const principal = signerCtx.principal

  // Locate the holder wallet + credential id matching the type. If
  // expectedAttributes are present (e.g. `poolAgentId` for the proposal
  // submitter cred), prefer a cred whose attribute values actually match.
  // The list endpoint only returns metadata (no attribute values) — for
  // attribute-aware matching we have to drill into each candidate via
  // `ssi_get_credential_details`. Otherwise a user with creds for
  // multiple pools/rounds would just present the first one and get
  // rejected downstream as `attribute mismatch`.
  const list = await callMcp<{ credentials: Array<{
    id: string; holderWalletRef: string; credentialType: string; walletContext: string
  }> }>('person', 'ssi_list_my_credentials', { principal })
  const candidates = list.credentials.filter((c) => c.credentialType === input.credentialType)
  if (candidates.length === 0) {
    return { ok: false, error: `no held credential of type ${input.credentialType}` }
  }
  const expected = input.expectedAttributes ?? {}
  const expectedKeys = Object.keys(expected)
  let row: typeof candidates[number] | undefined
  if (expectedKeys.length === 0) {
    // No attribute constraints — first cred is fine.
    row = candidates[0]
  } else {
    for (const c of candidates) {
      try {
        const details = await callMcp<{
          credential?: { attributes?: Record<string, string> }
          error?: string
        }>('person', 'ssi_get_credential_details', { principal, credentialId: c.id })
        const attrs = details.credential?.attributes ?? {}
        const matches = expectedKeys.every(k => (attrs[k] ?? '').toLowerCase() === (expected[k] ?? '').toLowerCase())
        if (matches) { row = c; break }
      } catch { /* try the next candidate */ }
    }
    if (!row) {
      // Treat "have cred but none matching the action context" as
      // equivalent to "no held credential" so the action layer's
      // auto-self-issue path fires and mints a fresh cred for THIS pool.
      return { ok: false, error: `no held credential of type ${input.credentialType} matching expectedAttributes` }
    }
  }

  const presentationRequest = buildRequest(input)

  // Reveal attr_holderPseudoId always; reveal any expectedAttributes' attr_<name>.
  const revealReferents = Object.keys(presentationRequest.requested_attributes as Record<string, unknown>)

  const built = await callMcp<{ action: WalletAction & { expiresAt: string } }>(
    'person',
    'ssi_create_wallet_action',
    {
      principal,
      walletContext: row.walletContext,
      type: 'CreatePresentation',
      counterpartyId: 'urn:smart-agent:spec004:org-mcp',
      purpose: 'spec004_marketplace_action',
      credentialType: input.credentialType,
      holderWalletId: row.holderWalletRef,
      proofRequest: presentationRequest,
      allowedReveal: revealReferents.map((r) => r.startsWith('attr_') ? r.slice(5) : r),
      allowedPredicates: [],
      forbiddenAttrs: [],
    },
  )
  const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
  const { signer, signature } = await signWalletAction(action)

  const presRes = await callMcp<{
    presentation?: string
    error?: string
  }>('person', 'ssi_create_presentation', {
    action: built.action,
    signature,
    expectedSigner: signer,
    presentationRequest,
    credentialSelections: [
      {
        credentialId: row.id,
        revealReferents,
        predicateReferents: [],
      },
    ],
  })
  if (presRes.error || !presRes.presentation) {
    return { ok: false, error: presRes.error ?? 'no presentation returned' }
  }
  return {
    ok: true,
    presentationJson: presRes.presentation,
    presentationRequest,
  }
}
