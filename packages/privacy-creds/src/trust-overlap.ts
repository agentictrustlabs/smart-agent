/**
 * Trust-overlap primitives — pure helpers for unilateral local scoring.
 *
 * Lives in @smart-agent/privacy-creds because both ssi-wallet-mcp (server)
 * and the web/person-mcp (client) must agree on the canonical encoding used
 * to commit to evidence and public sets. A future ZK-of-membership proof
 * targets `evidenceCommit` exactly — the encoding here is locked.
 *
 *   ⚠ Locked-in shape, do not change without versioning.
 */

import { keccak256, toBytes } from 'viem'

/** JCS-style stable JSON: sorted keys, fixed array order, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}'
}

/** Lowercase 0x-prefixed form for an org address. */
export function canonicalOrgId(addr: string): string {
  const s = addr.toLowerCase()
  return s.startsWith('0x') ? s : '0x' + s
}

/** Per-org weight at a given block pin. v1 always returns 1.0. */
export function weightFor(_orgId: string, _blockPin?: bigint): number {
  return 1
}

/**
 *   score = Σ weightFor(orgId) for orgId in (publicSet ∩ heldSet)
 */
export function trustScore(args: {
  publicSet: string[]
  heldSet: string[]
  blockPin?: bigint
}): number {
  const held = new Set(args.heldSet.map(canonicalOrgId))
  let sum = 0
  for (const o of args.publicSet) {
    const id = canonicalOrgId(o)
    if (held.has(id)) sum += weightFor(id, args.blockPin)
  }
  return sum
}

/** Number of distinct shared org ids — same shape as score under weight=1. */
export function sharedCount(publicSet: string[], heldSet: string[]): number {
  const held = new Set(heldSet.map(canonicalOrgId))
  let n = 0
  for (const o of publicSet) if (held.has(canonicalOrgId(o))) n++
  return n
}

/**
 * Cryptographic commitment over the evidence used to compute a score.
 * The preimage stays in the wallet — only the keccak commit is durable.
 *
 * Future ZK-of-membership proofs target this exact commit, so the encoding
 * is locked: sorted publicSet, sorted heldSet, lowercase orgIds, explicit
 * blockPin (0n if unspecified).
 */
export function evidenceCommit(args: {
  publicSet: string[]
  heldSet: string[]
  policyId: string
  blockPin?: bigint
}): `0x${string}` {
  const evidence = {
    policyId: args.policyId,
    blockPin: (args.blockPin ?? 0n).toString(),
    publicSet: [...args.publicSet].map(canonicalOrgId).sort(),
    heldSet:   [...args.heldSet].map(canonicalOrgId).sort(),
  }
  return keccak256(toBytes(canonicalJson(evidence)))
}

/** Commitment over a public set alone (B's orgs). */
export function publicSetCommit(publicSet: string[]): `0x${string}` {
  const sorted = [...publicSet].map(canonicalOrgId).sort()
  return keccak256(toBytes(canonicalJson({ publicSet: sorted })))
}

/** Default trust-policy id. Every score row carries this. */
export const TRUST_POLICY_ID = 'smart-agent.trust-overlap.v1'

/**
 * The body of a MatchAgainstPublicSet WalletAction. Its keccak256 is bound
 * into the action's proofRequestHash field so neither side can swap the
 * candidate list under the signed envelope.
 *
 *   `callerAddress` — caller's on-chain person-agent address. Required
 *   because the WalletAction's `personPrincipal` is a logical id (e.g.
 *   "person_<uuid>"), not an EVM address; the MCP needs the chain address
 *   to read HAS_MEMBER edges. Including it in the signed body means the
 *   caller is explicitly authorising "use this address as my identity".
 */
export interface MatchAgainstPublicSetBody {
  policyId: string
  blockPin: string  // bigint serialized as decimal string
  callerAddress: string  // 0x... lowercase
  candidates: Array<{
    /** Stable id for the candidate — typically the agent address. */
    id: string
    publicSet: string[]
  }>
}

/** Compute the proof-request hash committed by a MatchAgainstPublicSet action. */
export function hashMatchBody(body: MatchAgainstPublicSetBody): `0x${string}` {
  const normalised: MatchAgainstPublicSetBody = {
    policyId: body.policyId,
    blockPin: body.blockPin,
    callerAddress: canonicalOrgId(body.callerAddress),
    candidates: body.candidates
      .map(c => ({ id: c.id.toLowerCase(), publicSet: [...c.publicSet].map(canonicalOrgId).sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
  return keccak256(toBytes(canonicalJson(normalised)))
}

/**
 * Body of a MatchAgainstPublicGeoSet wallet action.
 *
 *   featureSet — public geographic features (.geo namespace) the
 *                holder is being asked to prove their private location
 *                against. Each entry pins (featureId, featureVersion).
 *   relations  — relations the verifier wants matched (e.g.
 *                ['geo:residentOf', 'geo:operatesIn']). Empty = any.
 *   policyId   — 'smart-agent.geo-overlap.v1' so historical scores
 *                remain reproducible.
 *
 *   ⚠ The holder's H3 cell, exact lat/long, and any residency
 *     credentials remain private. The Phase 6 ZK circuit
 *     `H3MembershipInCoverageRoot` produces the proof; this body
 *     describes what the proof must satisfy and the public output
 *     is just `{score, evidenceCommit}`.
 */
export interface MatchAgainstPublicGeoSetBody {
  policyId: string
  blockPin: string
  callerAddress: string
  featureSet: Array<{
    featureId: string         // bytes32
    featureVersion: string    // uint64 as decimal
    h3CoverageRoot: string    // bytes32
  }>
  relations: string[]
}

export function hashGeoMatchBody(body: MatchAgainstPublicGeoSetBody): `0x${string}` {
  const normalised: MatchAgainstPublicGeoSetBody = {
    policyId: body.policyId,
    blockPin: body.blockPin,
    callerAddress: canonicalOrgId(body.callerAddress),
    featureSet: body.featureSet
      .map(f => ({
        featureId: f.featureId.toLowerCase(),
        featureVersion: f.featureVersion,
        h3CoverageRoot: f.h3CoverageRoot.toLowerCase(),
      }))
      .sort((a, b) => a.featureId.localeCompare(b.featureId) || a.featureVersion.localeCompare(b.featureVersion)),
    relations: [...body.relations].map(r => r.toLowerCase()).sort(),
  }
  return keccak256(toBytes(canonicalJson(normalised)))
}
