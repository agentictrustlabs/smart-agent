import { getAgentMetadata } from '@/lib/agent-metadata'

export const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

export interface ResolvedAgentLabel {
  address: `0x${string}` | null
  label: string
  resolved: boolean
}

export function stripAgentIri(value: string | null | undefined): string {
  if (!value) return ''
  return value.startsWith(AGENT_IRI_PREFIX) ? value.slice(AGENT_IRI_PREFIX.length) : value
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function isAddressFallback(label: string, address: string): boolean {
  const normalizedLabel = label.replace('…', '...')
  return normalizedLabel.toLowerCase() === shortAddress(address).toLowerCase()
}

export async function resolveAgentLabel(
  addressOrIri: string | null | undefined,
  fallback = 'Unresolved agent',
): Promise<ResolvedAgentLabel> {
  const stripped = stripAgentIri(addressOrIri)
  if (!ADDRESS_RE.test(stripped)) {
    return { address: null, label: fallback, resolved: false }
  }

  const address = stripped as `0x${string}`
  try {
    const meta = await getAgentMetadata(address)
    const displayName = meta.displayName && !isAddressFallback(meta.displayName, address)
      ? meta.displayName
      : ''
    const label = meta.primaryName || displayName || meta.nameLabel
    if (label) return { address, label, resolved: true }
  } catch {
    // Intentionally fall through to the human fallback; round UI should not
    // surface raw addresses when resolver metadata is unavailable.
  }

  return { address, label: fallback, resolved: false }
}
