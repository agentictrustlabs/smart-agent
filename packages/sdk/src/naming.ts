/**
 * Agent Naming System
 *
 * Names like `david.fortcollins.catalyst.agent` are paths through
 * NAMESPACE_CONTAINS relationship edges in the trust graph.
 *
 * The name hierarchy IS the relationship graph — no separate registry.
 * Each edge carries a label in its metadataURI, forming a human-readable
 * namespace tree that mirrors organizational structure.
 *
 * Resolution traverses edges from root to leaf. Reverse resolution
 * reads the ATL_PRIMARY_NAME predicate from AgentAccountResolver.
 */

import { keccak256, encodePacked, toBytes } from 'viem'
import type { PublicClient } from 'viem'
import {
  agentRelationshipAbi,
  agentRelationshipQueryAbi,
  agentAccountResolverAbi,
} from './abi'

// Re-export the relationship type constant
export { NAMESPACE_CONTAINS, ROLE_NAMESPACE_PARENT, ROLE_NAMESPACE_CHILD } from './relationship-taxonomy'
export { ATL_PRIMARY_NAME, ATL_NAME_LABEL } from './predicates'

// ─── TLD ────────────────────────────────────────────────────────────

export const AGENT_TLD = 'agent'

// ─── Namehash ───────────────────────────────────────────────────────

/**
 * Compute the namehash for an .agent name.
 * Follows the ENS namehash algorithm: recursive keccak256 of parent + labelhash.
 *
 * namehash("") = 0x0000...0000
 * namehash("agent") = keccak256(namehash("") + labelhash("agent"))
 * namehash("catalyst.agent") = keccak256(namehash("agent") + labelhash("catalyst"))
 */
export function namehash(name: string): `0x${string}` {
  if (!name) return '0x0000000000000000000000000000000000000000000000000000000000000000'
  const labels = normalize(name).split('.')
  let node: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000000'
  for (let i = labels.length - 1; i >= 0; i--) {
    const lh = labelhash(labels[i])
    node = keccak256(encodePacked(['bytes32', 'bytes32'], [node, lh]))
  }
  return node
}

/**
 * Compute the labelhash for a single label.
 */
export function labelhash(label: string): `0x${string}` {
  return keccak256(toBytes(label))
}

/**
 * Normalize an agent name: lowercase, trim whitespace, validate labels.
 */
export function normalize(name: string): string {
  const cleaned = name.toLowerCase().trim()
  if (!cleaned) throw new Error('Empty name')
  const labels = cleaned.split('.')
  for (const label of labels) {
    if (!label) throw new Error('Empty label in name')
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      throw new Error(`Invalid label "${label}": must be alphanumeric with optional hyphens, no leading/trailing hyphens`)
    }
  }
  return cleaned
}

/**
 * Split a name into labels (rightmost = TLD).
 * "david.fortcollins.catalyst.agent" → ["david", "fortcollins", "catalyst", "agent"]
 */
export function splitName(name: string): string[] {
  return normalize(name).split('.')
}

/**
 * Build the fully-qualified name from a path of labels.
 * ["catalyst", "fortcollins", "david"] → "david.fortcollins.catalyst.agent"
 * The path is from root to leaf (excluding TLD).
 */
export function buildName(pathFromRoot: string[]): string {
  return [...pathFromRoot].reverse().join('.') + '.' + AGENT_TLD
}

// ─── Resolution (on-chain edge traversal) ───────────────────────────

export interface NameResolutionConfig {
  client: PublicClient
  relationshipAddress: `0x${string}`
  queryAddress: `0x${string}`
  resolverAddress: `0x${string}`
  /** Address of the root .agent namespace owner (hub or governor) — used to find top-level names */
  rootAgents?: `0x${string}`[]
}

export interface NameTreeNode {
  address: `0x${string}`
  label: string
  fullName: string
  children: NameTreeNode[]
}

/**
 * Resolve a .agent name to an address by traversing NAMESPACE_CONTAINS edges.
 *
 * Algorithm:
 * 1. Split name into labels: "david.fortcollins.catalyst.agent" → ["david", "fortcollins", "catalyst"]
 * 2. Start from root agents, find one whose ATL_NAME_LABEL == "catalyst"
 * 3. From that agent, follow NAMESPACE_CONTAINS edges to find child with label "fortcollins"
 * 4. From that agent, find child with label "david"
 * 5. Return the final agent's address
 */
export async function resolveName(
  name: string,
  config: NameResolutionConfig,
): Promise<`0x${string}` | null> {
  const labels = splitName(name)
  if (labels[labels.length - 1] === AGENT_TLD) labels.pop() // remove TLD
  if (labels.length === 0) return null

  // Walk from root (rightmost label) to leaf (leftmost)
  const { NAMESPACE_CONTAINS: NS_TYPE } = await import('./relationship-taxonomy')
  let currentAddress: `0x${string}` | null = null

  // Find root agent by label
  const rootLabel = labels[labels.length - 1]
  if (config.rootAgents) {
    for (const root of config.rootAgents) {
      const label = await readNameLabel(root, config)
      if (label === rootLabel) {
        currentAddress = root
        break
      }
    }
  }

  if (!currentAddress) {
    // Fallback: search all registered agents for the root label
    try {
      const count = await config.client.readContract({
        address: config.resolverAddress,
        abi: agentAccountResolverAbi,
        functionName: 'agentCount',
      }) as bigint

      for (let i = 0n; i < count; i++) {
        const addr = await config.client.readContract({
          address: config.resolverAddress,
          abi: agentAccountResolverAbi,
          functionName: 'getAgentAt',
          args: [i],
        }) as `0x${string}`

        const label = await readNameLabel(addr, config)
        if (label === rootLabel) {
          // Verify it's a root (no NAMESPACE_CONTAINS parent)
          const parents = await getNamespaceParents(addr, config)
          if (parents.length === 0) {
            currentAddress = addr
            break
          }
        }
      }
    } catch { /* registry unavailable */ }
  }

  if (!currentAddress) return null

  // Walk remaining labels (right-to-left, skipping root which we already found)
  for (let i = labels.length - 2; i >= 0; i--) {
    const targetLabel = labels[i]
    const children = await getNamespaceChildren(currentAddress, config)
    let found = false

    for (const child of children) {
      const childLabel = await readNameLabel(child, config)
      if (childLabel === targetLabel) {
        currentAddress = child
        found = true
        break
      }
    }

    if (!found) return null
  }

  return currentAddress
}

/**
 * Reverse resolve: address → primary name.
 * Reads ATL_PRIMARY_NAME from the resolver.
 */
export async function reverseResolve(
  address: `0x${string}`,
  config: Pick<NameResolutionConfig, 'client' | 'resolverAddress'>,
): Promise<string | null> {
  const { ATL_PRIMARY_NAME } = await import('./predicates')
  try {
    const name = await config.client.readContract({
      address: config.resolverAddress,
      abi: agentAccountResolverAbi,
      functionName: 'getStringProperty',
      args: [address, ATL_PRIMARY_NAME],
    }) as string
    return name || null
  } catch {
    return null
  }
}

/**
 * List all direct subnames of a parent agent.
 */
export async function listSubnames(
  parentAddress: `0x${string}`,
  config: NameResolutionConfig,
): Promise<Array<{ address: `0x${string}`; label: string }>> {
  const children = await getNamespaceChildren(parentAddress, config)
  const results: Array<{ address: `0x${string}`; label: string }> = []
  for (const child of children) {
    const label = await readNameLabel(child, config)
    if (label) results.push({ address: child, label })
  }
  return results
}

/**
 * Get the ascending namespace path for an agent (leaf → root).
 * Returns labels from the agent up to the root namespace.
 */
export async function getNamePath(
  address: `0x${string}`,
  config: NameResolutionConfig,
): Promise<string[]> {
  const path: string[] = []
  let current: `0x${string}` = address

  for (let depth = 0; depth < 10; depth++) { // max depth guard
    const label = await readNameLabel(current, config)
    if (label) path.push(label)

    const parents = await getNamespaceParents(current, config)
    if (parents.length === 0) break
    current = parents[0]
  }

  return path
}

/**
 * Build a full name tree descending from an agent.
 */
export async function getNameTree(
  address: `0x${string}`,
  config: NameResolutionConfig,
  parentPath: string[] = [],
  maxDepth = 5,
): Promise<NameTreeNode> {
  const label = await readNameLabel(address, config) ?? address.slice(0, 10)
  const currentPath = [...parentPath, label]
  const fullName = buildName(currentPath)

  if (maxDepth <= 0) return { address, label, fullName, children: [] }

  const childAddrs = await getNamespaceChildren(address, config)
  const children: NameTreeNode[] = []
  for (const childAddr of childAddrs) {
    children.push(await getNameTree(childAddr, config, currentPath, maxDepth - 1))
  }

  return { address, label, fullName, children }
}

// ─── Internal helpers ───────────────────────────────────────────────

async function readNameLabel(
  agent: `0x${string}`,
  config: Pick<NameResolutionConfig, 'client' | 'resolverAddress'>,
): Promise<string | null> {
  const { ATL_NAME_LABEL } = await import('./predicates')
  try {
    const label = await config.client.readContract({
      address: config.resolverAddress,
      abi: agentAccountResolverAbi,
      functionName: 'getStringProperty',
      args: [agent, ATL_NAME_LABEL],
    }) as string
    return label || null
  } catch {
    return null
  }
}

async function getNamespaceChildren(
  parent: `0x${string}`,
  config: NameResolutionConfig,
): Promise<`0x${string}`[]> {
  const { NAMESPACE_CONTAINS: NS_TYPE } = await import('./relationship-taxonomy')
  try {
    // Try the query contract first (efficient)
    return await config.client.readContract({
      address: config.queryAddress,
      abi: agentRelationshipQueryAbi,
      functionName: 'directTargetsOf',
      args: [parent, NS_TYPE as `0x${string}`],
    }) as `0x${string}`[]
  } catch {
    // Fallback: iterate subject edges
    try {
      const edgeIds = await config.client.readContract({
        address: config.relationshipAddress,
        abi: agentRelationshipAbi,
        functionName: 'getEdgesBySubject',
        args: [parent],
      }) as `0x${string}`[]

      const children: `0x${string}`[] = []
      for (const edgeId of edgeIds) {
        const edge = await config.client.readContract({
          address: config.relationshipAddress,
          abi: agentRelationshipAbi,
          functionName: 'getEdge',
          args: [edgeId],
        }) as { relationshipType: `0x${string}`; object_: `0x${string}`; status: number }

        if (edge.relationshipType === NS_TYPE && edge.status >= 2 && edge.status < 4) {
          children.push(edge.object_)
        }
      }
      return children
    } catch {
      return []
    }
  }
}

async function getNamespaceParents(
  child: `0x${string}`,
  config: NameResolutionConfig,
): Promise<`0x${string}`[]> {
  const { NAMESPACE_CONTAINS: NS_TYPE } = await import('./relationship-taxonomy')
  try {
    return await config.client.readContract({
      address: config.queryAddress,
      abi: agentRelationshipQueryAbi,
      functionName: 'directSourcesOf',
      args: [child, NS_TYPE as `0x${string}`],
    }) as `0x${string}`[]
  } catch {
    // Fallback: iterate object edges
    try {
      const edgeIds = await config.client.readContract({
        address: config.relationshipAddress,
        abi: agentRelationshipAbi,
        functionName: 'getEdgesByObject',
        args: [child],
      }) as `0x${string}`[]

      const parents: `0x${string}`[] = []
      for (const edgeId of edgeIds) {
        const edge = await config.client.readContract({
          address: config.relationshipAddress,
          abi: agentRelationshipAbi,
          functionName: 'getEdge',
          args: [edgeId],
        }) as { relationshipType: `0x${string}`; subject: `0x${string}`; status: number }

        if (edge.relationshipType === NS_TYPE && edge.status >= 2 && edge.status < 4) {
          parents.push(edge.subject)
        }
      }
      return parents
    } catch {
      return []
    }
  }
}
