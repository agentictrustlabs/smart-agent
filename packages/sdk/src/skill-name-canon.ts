/**
 * Skill name canonicalizer.
 *
 * The on-chain canonical handle for a skill is its `skillId` (a hash of
 * `scheme:conceptId`). Names in the `.skill` TLD are a developer-friendly
 * alias, not the source of truth. This module converts a SKOS or OASF
 * concept identifier into its DNS-safe `.skill` label tree.
 *
 * Rules (locked by the v0 plan §2.8):
 *   • OASF source IDs use `_`. DNS labels use `-`. Convert `_` → `-`.
 *   • Lowercase + NFKC unicode normalization. (Skill labels may contain
 *     non-ASCII glyphs from upstream taxonomies; normalize before hashing.)
 *   • Strip everything not in `[a-z0-9-]`. Collapse runs of `-`. Trim
 *     leading/trailing `-`.
 *   • Order is leaf-first, matching the `.geo` precedent
 *     (`erie.colorado.us.geo`):
 *       - oasf:`communication.write.grant_writing` →
 *         `grant-writing.communication.write.skill`
 *       - custom:`org-X-internal-cert` →
 *         `org-x-internal-cert.skill`
 *       - skos:`grant-writing` → `grant-writing.skill`
 *
 * Bi-directional binding via `bindName(skillId, nameNode)`. Canonical
 * resolution remains by `skillId` — the name is just an alias.
 */

import { keccak256, toBytes } from 'viem'

export interface CanonicalSkillName {
  /** Each label, leaf → root. e.g. ['grant-writing', 'communication', 'write']. */
  labels: string[]
  /** Full DNS-style fully qualified name with the `.skill` TLD appended. */
  fqn: string
  /** namehash of `fqn` per the AgentNameRegistry convention. */
  nameNode: `0x${string}`
}

/** NFKC + lowercase + ASCII-strip + dash-collapse. */
export function canonicalizeLabel(raw: string): string {
  if (!raw) return ''
  // NFKC normalization unifies compatible characters (ascii-equivalents win).
  const normalized = raw.normalize('NFKC').toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized
}

/**
 * Convert a SKOS/OASF/custom concept id to a `.skill` canonical name.
 *
 * @param scheme `oasf` | `custom` | `skos` (matches `SkillDefinitionClient.skillIdFor`).
 * @param conceptId Path-style identifier; `.` is the level separator (OASF
 *   convention) for hierarchical concepts. Custom and skos schemes typically
 *   pass a single segment.
 */
export function canonicalSkillName(scheme: string, conceptId: string): CanonicalSkillName {
  const segs = (conceptId ?? '').split('.').map(canonicalizeLabel).filter(Boolean)
  if (segs.length === 0) {
    return { labels: [], fqn: '.skill', nameNode: namehashOfSkillFqn([]) }
  }
  // Leaf-first order: reverse the dotted path.
  const labels = [...segs].reverse()
  const fqn = `${labels.join('.')}.skill`
  return { labels, fqn, nameNode: namehashOfSkillFqn(labels) }
}

/**
 * namehash for `<labels…>.skill`.
 *
 * Convention (matches AgentNameRegistry):
 *   namehash([]) = keccak256(0×0…0 ‖ keccak256("skill"))   // root
 *   namehash([leaf, …]) = keccak256(parent ‖ keccak256(leaf))
 *
 * Walk parents first → leaf last so the final hash matches the on-chain
 * computation (`childNode = keccak256(parentNode ‖ labelhash)`).
 */
export function namehashOfSkillFqn(labelsLeafFirst: string[]): `0x${string}` {
  const ZERO = ('0x' + '0'.repeat(64)) as `0x${string}`
  const rootLabel = keccak256(toBytes('skill'))
  let node = keccak256(`${ZERO}${rootLabel.slice(2)}` as `0x${string}`)
  // Walk root → leaf, which is the reverse of leaf-first.
  for (let i = labelsLeafFirst.length - 1; i >= 0; i--) {
    const lh = keccak256(toBytes(labelsLeafFirst[i]))
    node = keccak256(`${node}${lh.slice(2)}` as `0x${string}`)
  }
  return node
}
