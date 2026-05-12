/**
 * Spec 004 — Inline AnonCreds presentation verification.
 *
 * Verifies a presentation blob submitted by a holder during a marketplace
 * action (vote-cast / proposal-submit / proposal-edit / proposal-withdraw).
 * Returns the verified attribute set + the nullifier hash the caller
 * should persist alongside the action.
 *
 * Per spec 004 design (and the "verifier location" decision), this lives
 * inline in org-mcp rather than as an HTTP call to verifier-mcp:
 * verification is stateless — the action call carries the full
 * presentation blob, no multi-message wallet ceremony is involved.
 * verifier-mcp continues to own the interactive credential offer +
 * presentation-request choreography.
 */

import { AnonCreds } from '@smart-agent/privacy-creds'
import { loadVerifiedSchema, loadVerifiedCredDef } from '@smart-agent/credential-registry'
import type { OnChainResolver } from '@smart-agent/credential-registry'
import { findCredentialKind, computeNullifier, type NullifierContext } from '@smart-agent/sdk'

export interface VerifyPresentationInput {
  resolver: OnChainResolver
  credentialType: 'ProposalSubmitterCredential' | 'RoundVoterCredential'
  /** AnonCreds presentation JSON, as the holder wallet emitted it. */
  presentationJson: string
  /** Original presentation request the holder signed against. */
  presentationRequest: Record<string, unknown>
  /** Attribute name → expected value. Verification fails if the revealed
   *  attribute doesn't match (e.g. ensures the credential's `roundId`
   *  attribute matches the round being voted on). */
  expectedAttributes: Record<string, string>
  /** What to hash for the nullifier — `vote:${roundId}`, etc. */
  nullifierContext: NullifierContext
}

export type VerifyPresentationResult =
  | { ok: true; nullifierHash: string; attributes: Record<string, string> }
  | { ok: false; error: string }

/**
 * Stateless verifier. On success returns the nullifier the caller stores
 * in the action's row (proposal_submissions.nullifier_hash, etc.).
 *
 * The nullifier is derived from the holderPseudoId attribute the issuer
 * baked into the credential. It's stable for the lifetime of the
 * credential and unique per (issuer, holder, schema). Combined with the
 * action context, it produces a one-way commitment that prevents replay
 * without revealing identity.
 *
 * Production AnonCreds wiring will switch to a true nullifier emitted by
 * the proof system (so the holder can't fabricate the source); see spec
 * § Open Questions for the upgrade plan.
 */
export async function verifyPresentation(
  input: VerifyPresentationInput,
): Promise<VerifyPresentationResult> {
  const descriptor = findCredentialKind(input.credentialType)
  if (!descriptor) {
    return { ok: false, error: `unknown credential type: ${input.credentialType}` }
  }

  try {
    const schema = await loadVerifiedSchema(input.resolver, descriptor.schemaId)
    const credDef = await loadVerifiedCredDef(input.resolver, descriptor.credDefId)
    const verified = AnonCreds.verifierVerifyPresentation({
      presentationJson: input.presentationJson,
      presentationRequestJson: JSON.stringify(input.presentationRequest),
      schemasJson:  { [descriptor.schemaId]:  schema.json },
      credDefsJson: { [descriptor.credDefId]: credDef.json },
    })
    if (!verified) {
      return { ok: false, error: 'anoncreds verifierVerifyPresentation returned false' }
    }
  } catch (err) {
    return { ok: false, error: `verify failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // ─── Extract revealed attributes ─────────────────────────────────
  // The presentation JSON's `requested_proof.revealed_attrs` contains
  // `attr_<name>: { raw, encoded }` for each plaintext-revealed attribute.
  let parsed: {
    requested_proof?: {
      revealed_attrs?: Record<string, { raw: string }>
    }
    identifiers?: Array<{ cred_def_id?: string }>
  }
  try {
    parsed = JSON.parse(input.presentationJson) as typeof parsed
  } catch {
    return { ok: false, error: 'presentation JSON parse failed' }
  }
  const revealed: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed.requested_proof?.revealed_attrs ?? {})) {
    // Strip the `attr_` referent prefix the verifier-mcp uses by
    // convention (matches specs.ts).
    const name = k.startsWith('attr_') ? k.slice(5) : k
    revealed[name] = v.raw
  }

  // Enforce expectedAttributes — the action layer's gate. If the
  // credential's `roundId` attribute isn't the round being voted on,
  // verification fails even though the proof itself was cryptographically
  // valid. EVM addresses are compared case-insensitively (checksum vs
  // lowercase are equivalent identifiers); other values use strict equality.
  const looksLikeAddress = (v: string | undefined): boolean =>
    typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
  for (const [name, expected] of Object.entries(input.expectedAttributes)) {
    const got = revealed[name]
    const equal = looksLikeAddress(expected) && looksLikeAddress(got)
      ? (got as string).toLowerCase() === (expected as string).toLowerCase()
      : got === expected
    if (!equal) {
      return {
        ok: false,
        error: `attribute mismatch: ${name} expected "${expected}" but got "${got ?? '(missing)'}"`,
      }
    }
  }

  // Spec 004 v2 — nullifier is derived from the cred's per-issuance
  // `nullifierSecret` (not the dropped `holderPseudoId`). The secret is
  // revealed inside the round (so the verifier can compute the
  // nullifier) but rotates per cred so the verifier can't link the
  // holder across rounds/pools.
  const nullifierSecret = revealed['nullifierSecret']
  if (!nullifierSecret) {
    return {
      ok: false,
      error: 'presentation must reveal `nullifierSecret` so the nullifier can be derived',
    }
  }
  const nullifierHash = computeNullifier({
    nullifierSecret,
    context: input.nullifierContext,
  })

  return { ok: true, nullifierHash, attributes: revealed }
}
