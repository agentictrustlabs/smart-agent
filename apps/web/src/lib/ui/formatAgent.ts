/**
 * formatAgent — shared formatting helper for agent/address display.
 *
 * Returns a plain-language representation of any agent (person, org, AI)
 * so callers don't repeat truncation or name-lookup logic.
 *
 * Usage:
 *   const { name, shortAddress, kind } = formatAgent(address, metadata)
 *   <span>{name}</span>
 *   <span className="text-muted">{shortAddress}</span>
 *
 * The `name` field is always safe for primary display — it is never a raw
 * 0x address. `shortAddress` is optional secondary text.
 *
 * Terminology:
 *   - "Your agent"      when the address matches the viewer's own
 *   - Display name      when available from metadata
 *   - Truncated address as absolute last resort (never primary)
 */

export type AgentKind = 'person' | 'org' | 'ai' | 'hub' | 'unknown'

export interface FormattedAgent {
  /** Primary display name. Never a raw 0x address. */
  name: string
  /** Truncated address for secondary display, e.g. "0x1234…5678". */
  shortAddress: string
  /** Semantic kind of agent. */
  kind: AgentKind
  /** The .agent primary name if registered, otherwise empty string. */
  primaryName: string
}

export interface AgentMetadataInput {
  displayName?: string | null
  primaryName?: string | null
  agentType?: string | null
}

/**
 * Format an agent address + optional metadata into display-safe values.
 *
 * @param address     The agent's Ethereum address (0x…)
 * @param metadata    Optional resolved metadata (displayName, primaryName, agentType)
 * @param viewerAddress  The current viewer's own address, used to detect "you"
 */
export function formatAgent(
  address: string,
  metadata?: AgentMetadataInput | null,
  viewerAddress?: string | null,
): FormattedAgent {
  const shortAddress = truncateAddress(address)

  // Detect viewer's own agent
  if (viewerAddress && address.toLowerCase() === viewerAddress.toLowerCase()) {
    return {
      name: 'Your agent',
      shortAddress,
      kind: 'person',
      primaryName: metadata?.primaryName ?? '',
    }
  }

  const primaryName = metadata?.primaryName ?? ''
  const displayName = metadata?.displayName ?? ''
  const kind = resolveKind(metadata?.agentType)

  // Prefer .agent primary name, then displayName, then fall back gracefully
  const name = primaryName || displayName || fallbackName(address, kind)

  return { name, shortAddress, kind, primaryName }
}

/**
 * Truncate a 0x address to "0x1234…5678" form.
 */
export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address
  const clean = address.startsWith('0x') ? address : '0x' + address
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`
}

/**
 * Remove a raw URN or 0x address from a label string, returning only
 * the human-readable portion. Used to strip internal IDs from display.
 *
 * Example:
 *   sanitizeLabel('urn:smart-agent:pool:abc123') → 'abc123'
 *   sanitizeLabel('0xdeadbeef') → '0xdead…beef'
 */
export function sanitizeLabel(value: string): string {
  if (!value) return value

  // URN — strip the prefix, keep the last segment
  if (value.startsWith('urn:')) {
    const parts = value.split(':')
    return parts[parts.length - 1] ?? value
  }

  // Raw 0x address
  if (/^0x[a-fA-F0-9]{10,}$/.test(value)) {
    return truncateAddress(value)
  }

  return value
}

function resolveKind(agentType?: string | null): AgentKind {
  if (!agentType) return 'unknown'
  const t = agentType.toLowerCase()
  if (t.includes('person') || t.includes('human') || t.includes('member')) return 'person'
  if (t.includes('org') || t.includes('organization') || t.includes('church') || t.includes('business')) return 'org'
  if (t.includes('ai') || t.includes('agent') || t.includes('bot')) return 'ai'
  if (t.includes('hub')) return 'hub'
  return 'unknown'
}

function fallbackName(address: string, kind: AgentKind): string {
  const kindLabel =
    kind === 'person' ? 'Member'
    : kind === 'org' ? 'Organization'
    : kind === 'ai' ? 'Agent'
    : kind === 'hub' ? 'Hub'
    : 'Agent'
  return `${kindLabel} ${truncateAddress(address)}`
}
