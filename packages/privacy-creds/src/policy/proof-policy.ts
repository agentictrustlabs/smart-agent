/**
 * Proof-policy gate. Runs *inside* ssi-wallet-mcp just before calling into
 * anoncreds-rs to create a presentation. Returns a normalized, reduced
 * disclosure set, or a denial reason.
 *
 * The signed WalletAction is the *outer* policy (what the user+person-mcp
 * allowed). This is the *inner* belt-and-braces check — we also block the
 * default forbidden attrs even if the signed action happens to allow them.
 */

import { DEFAULT_FORBIDDEN_ATTRS } from '../wallet-actions/types'

export interface Predicate {
  attribute: string
  operator: '>=' | '<=' | '>' | '<'
  value: number
}

export interface ProofPolicyInput {
  requestedRevealAttrs: string[]
  requestedPredicates: Predicate[]
  allowedReveal: string[]
  allowedPredicates: Predicate[]
  forbiddenAttrs: string[]
  availableInCred: string[]
}

export interface ProofPolicyOutput {
  ok: boolean
  reason?: string
  reveal: string[]
  predicates: Predicate[]
}

export function evaluateProofPolicy(input: ProofPolicyInput): ProofPolicyOutput {
  const forbid = new Set<string>([
    ...DEFAULT_FORBIDDEN_ATTRS,
    ...input.forbiddenAttrs.map(s => s.toLowerCase()),
  ])
  const allowReveal = new Set(input.allowedReveal.map(s => s.toLowerCase()))

  // `holder` is a known pairwise self-attested slot — never carries credential
  // data, just the (holderWalletId, verifierId) pairwise handle. Always allowed.
  const KNOWN_SELF_ATTESTED = new Set(['holder'])

  // 1. No requested reveal may be forbidden.
  for (const a of input.requestedRevealAttrs) {
    if (forbid.has(a.toLowerCase())) {
      return { ok: false, reason: `forbidden attribute requested: ${a}`, reveal: [], predicates: [] }
    }
  }

  // 2. Requested reveals must be both in allow-set and present in the credential.
  //    (Exception: known self-attested pairwise slots are pre-authorized.)
  for (const a of input.requestedRevealAttrs) {
    if (KNOWN_SELF_ATTESTED.has(a.toLowerCase())) continue
    if (!allowReveal.has(a.toLowerCase())) {
      return { ok: false, reason: `attribute not allowed: ${a}`, reveal: [], predicates: [] }
    }
    if (!input.availableInCred.includes(a)) {
      return { ok: false, reason: `attribute not in credential: ${a}`, reveal: [], predicates: [] }
    }
  }

  // 3. Requested predicates must be a subset (by attr+operator+value) of allowedPredicates.
  for (const p of input.requestedPredicates) {
    const match = input.allowedPredicates.find(
      ap => ap.attribute === p.attribute && ap.operator === p.operator && ap.value === p.value,
    )
    if (!match) {
      return {
        ok: false,
        reason: `predicate not allowed: ${p.attribute} ${p.operator} ${p.value}`,
        reveal: [],
        predicates: [],
      }
    }
  }

  // 4. Minimize: drop any revealed attr that is covered by a predicate on the same attr.
  const predicateAttrs = new Set(input.requestedPredicates.map(p => p.attribute.toLowerCase()))
  const reveal = input.requestedRevealAttrs.filter(a => !predicateAttrs.has(a.toLowerCase()))

  return { ok: true, reveal, predicates: input.requestedPredicates }
}
