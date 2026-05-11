/**
 * Spec 004 v2 — AnonCreds marketplace auth nullifier helpers.
 *
 * The nullifier is a deterministic one-way commitment derived from a
 * per-issuance secret embedded in the credential + the action context.
 * The same credential applied to the same context always produces the
 * same nullifier, so the registry can dedup actions ("one ballot per
 * voter per proposal", "one proposal lifecycle per submitter per round")
 * without learning identity.
 *
 * Construction (v2):
 *
 *   nullifier_hash = keccak256(nullifierSecret || '|' || context)
 *
 *   - nullifierSecret: per-issuance random value baked into the
 *     AnonCreds credential by the issuer. The HOLDER never controls
 *     its value; the verifier confirms the value via the AnonCreds
 *     proof of issuer signature.
 *   - context: the action's scope. Cred-bound contexts use the
 *     credential's `roundSubject` / `poolAgentId` attribute directly,
 *     which the verifier ALSO confirms against the action's target.
 *
 * Contexts in use:
 *   - `vote:<roundSubject>` — one ballot per voter per proposal
 *     within a round. Per-proposal uniqueness is enforced ON CHAIN
 *     by VoteRegistry's voteSubject = keccak256("sa:vote:" +
 *     roundSubject + proposalSubject + nullifier), so the nullifier
 *     context only needs to bind to the round (not the proposal).
 *   - `proposal:<roundSubject>` — one proposal lifecycle per
 *     submitter per round. Covers submit/edit/withdraw/clone.
 *
 * v2 anonymity trade-off: the nullifierSecret is revealed to the
 * verifier inside the round (so the verifier can compute the
 * nullifier). This eliminates cross-round / cross-pool linkability
 * (each cred has its own secret) but keeps within-round linkability.
 * Full hidden-secret ZK nullifier derivation (Semaphore/MACI-style)
 * is the v3 target — see spec 004 plan.
 *
 * v1 used `holderPseudoId`, a stable cross-context pseudonym, which
 * was strictly worse and is now removed.
 */

import { keccak256, toBytes, concat } from 'viem'

export type NullifierContext =
  | `vote:${string}`
  | `proposal:${string}`

export function computeNullifier(args: {
  /** Per-issuance nullifier secret revealed by the AnonCreds presentation. */
  nullifierSecret: string
  context: NullifierContext
}): string {
  if (!args.nullifierSecret) throw new Error('nullifierSecret is required')
  if (!args.context) throw new Error('context is required')
  // keccak256(nullifierSecret || '|' || context). The literal `|`
  // separator prevents the boundary from being ambiguous.
  return keccak256(concat([
    toBytes(args.nullifierSecret),
    toBytes('|'),
    toBytes(args.context),
  ]))
}

export function voteContext(roundSubject: string): NullifierContext {
  return `vote:${roundSubject}`
}

/**
 * Single context for the entire proposal lifecycle (submit / edit /
 * withdraw / clone). All four operations on the same proposal share
 * the same nullifier, so the holder who originally submitted is the
 * only one able to re-derive it for subsequent mutations.
 */
export function proposalContext(roundSubject: string): NullifierContext {
  return `proposal:${roundSubject}`
}
