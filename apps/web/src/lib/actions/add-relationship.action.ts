'use server'

/**
 * Backing actions for the home-dashboard "Add relationship" panel.
 *
 *   listAddressableAgentsAction — every active agent in the on-chain
 *                                  registry, surfaced as a flat list
 *                                  ready for a dropdown.
 *   listRelationshipTaxonomyAction — relationship type + role
 *                                    definitions from the SDK taxonomy
 *                                    so the picker doesn't need to ship
 *                                    its own keccak hashes.
 *   addRelationshipAction         — thin wrapper around
 *                                    assertRelationship(...) that
 *                                    accepts UI string keys instead of
 *                                    bytes32 hashes (which the existing
 *                                    UI surface already uses).
 */

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient } from '@/lib/contracts'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import {
  agentAccountResolverAbi,
  ATL_PRIMARY_NAME,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT, TYPE_HUB,
  AGENT_TYPE_LABELS,
  hashTaxonomyTerm,
  listRelationshipTypeDefinitions,
  getRelationshipTypeDefinitionByKey,
  getRoleDefinitionByKey,
  listRoleDefinitionsForRelationshipType,
} from '@smart-agent/sdk'
import { assertRelationship } from './assert-relationship.action'

export type AgentKind = 'person' | 'org' | 'ai' | 'hub'

export interface AddrAgent {
  address: `0x${string}`
  displayName: string
  primaryName: string | null
  agentType: string                // hash hex
  agentTypeLabel: string           // human label
  agentKind: AgentKind | 'unknown'
}

const TYPE_HASH_TO_LABEL: Record<string, string> = {
  [(TYPE_PERSON       as string).toLowerCase()]: AGENT_TYPE_LABELS[TYPE_PERSON]       ?? 'Person',
  [(TYPE_ORGANIZATION as string).toLowerCase()]: AGENT_TYPE_LABELS[TYPE_ORGANIZATION] ?? 'Organization',
  [(TYPE_AI_AGENT     as string).toLowerCase()]: AGENT_TYPE_LABELS[TYPE_AI_AGENT]     ?? 'AI Agent',
  [(TYPE_HUB          as string).toLowerCase()]: AGENT_TYPE_LABELS[TYPE_HUB]          ?? 'Hub',
}

const TYPE_HASH_TO_KIND: Record<string, AgentKind> = {
  [(TYPE_PERSON       as string).toLowerCase()]: 'person',
  [(TYPE_ORGANIZATION as string).toLowerCase()]: 'org',
  [(TYPE_AI_AGENT     as string).toLowerCase()]: 'ai',
  [(TYPE_HUB          as string).toLowerCase()]: 'hub',
}

/**
 * Walk the on-chain registry. Returns every active agent with a
 * resolvable display name. Excludes the caller's own person agent
 * (relationships against yourself aren't useful in the UI).
 */
export async function listAddressableAgentsAction(): Promise<AddrAgent[]> {
  const me = await getCurrentUser()
  const myPersonAgent = me ? ((await getPersonAgentForUser(me.id)) as `0x${string}` | null) : null

  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr) return []
  const client = getPublicClient()

  let count = 0n
  try {
    count = (await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount',
    })) as bigint
  } catch { return [] }

  const out: AddrAgent[] = []
  const myLower = myPersonAgent?.toLowerCase()
  for (let i = 0n; i < count; i++) {
    let agentAddr: `0x${string}`
    try {
      agentAddr = (await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getAgentAt', args: [i],
      })) as `0x${string}`
    } catch { continue }
    if (myLower && agentAddr.toLowerCase() === myLower) continue

    let core: { agentType: `0x${string}`; displayName: string; active: boolean }
    try {
      core = (await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getCore', args: [agentAddr],
      })) as typeof core
    } catch { continue }
    if (!core.active) continue

    let primaryName = ''
    try {
      primaryName = (await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [agentAddr, ATL_PRIMARY_NAME as `0x${string}`],
      })) as string
    } catch { /* */ }

    out.push({
      address: agentAddr,
      displayName: core.displayName || `${agentAddr.slice(0, 6)}…${agentAddr.slice(-4)}`,
      primaryName: primaryName || null,
      agentType: core.agentType,
      agentTypeLabel: TYPE_HASH_TO_LABEL[core.agentType.toLowerCase()] ?? 'Agent',
      agentKind: TYPE_HASH_TO_KIND[core.agentType.toLowerCase()] ?? 'unknown',
    })
  }

  out.sort((a, b) => a.displayName.localeCompare(b.displayName))
  return out
}

export interface RelationshipTaxonomyRow {
  /** Stable string key from the SDK taxonomy (e.g. "OrganizationMembership"). */
  key: string
  /** Human label. */
  label: string
  /** Roles available for this relationship type, in display order. */
  roles: Array<{ key: string; label: string }>
  /** Object-side agent types this relationship type is meaningful for,
   *  given that the caller (subject) is always a Person. The picker
   *  filters by this against the selected agent's type. */
  validObjectTypes: Array<'person' | 'org' | 'ai' | 'hub'>
}

/**
 * Curated mapping of relationship-type key → valid object agent types
 * when the SUBJECT is always the caller's person agent. Hubs aren't
 * included here because hub-membership runs through the dedicated
 * /h/<slug> onboarding wizard, not this generic picker.
 */
const VALID_OBJECT_TYPES: Record<string, Array<'person' | 'org' | 'ai' | 'hub'>> = {
  // Person → Person
  Coaching:               ['person'],
  PersonalInfluence:      ['person'],
  DataAccessDelegation:   ['person'],
  // Person → Org
  OrganizationMembership: ['org'],
  OrganizationGovernance: ['org'],
  // Person → Org / AI
  OrganizationalControl:  ['org', 'ai'],
  // Person → Person / Org
  EconomicSecurity:       ['person', 'org'],
  Compliance:             ['person', 'org'],
  InsuranceCoverage:      ['person', 'org'],
  GenerationalLineage:    ['person', 'org'],
  Review:                 ['person', 'org'],
  ReviewRelationship:     ['person', 'org'],
  // Person → Person / Org / AI
  ServiceAgreement:       ['person', 'org', 'ai'],
  ValidationTrust:        ['person', 'org', 'ai'],
  ActivityValidation:     ['person', 'org', 'ai'],
  DelegationAuthority:    ['person', 'org', 'ai'],
  // Person → AI
  RuntimeAttestation:     ['ai'],
  BuildProvenance:        ['ai'],
  // Excluded: Alliance (org↔org), HasMember (parent→child),
  // NamespaceContains (namespace-only).
}

export async function listRelationshipTaxonomyAction(): Promise<RelationshipTaxonomyRow[]> {
  const types = listRelationshipTypeDefinitions()
  return types
    .filter(t => VALID_OBJECT_TYPES[t.key])
    .map(t => {
      // BUG FIX: listRoleDefinitionsForRelationshipType expects a HASH, not
      // a key. Passing the key always returned [] → empty role list → the
      // picker showed "no roles" for every selection. Compute the keccak
      // of the term once and pass that.
      const hash = hashTaxonomyTerm(t.term)
      const roles = listRoleDefinitionsForRelationshipType(hash)
      return {
        key: t.key,
        label: t.label ?? t.key,
        roles: roles.map(r => ({ key: r.key, label: r.label ?? r.key })),
        validObjectTypes: VALID_OBJECT_TYPES[t.key] ?? [],
      }
    })
    // Drop any with zero roles — nothing to mint.
    .filter(t => t.roles.length > 0)
}

export interface AddRelationshipUIInput {
  objectAgentAddress: string
  /** Taxonomy keys (not bytes32 hashes) — easier for the UI. */
  relationshipTypeKey: string
  roleKey: string
}

/**
 * Subject = caller's person agent (resolved server-side).
 * Object = passed in.
 *
 * Wraps assertRelationship with the UI-friendly key→hash translation
 * (the on-chain edge needs bytes32 hashes; the UI works in keys).
 */
export async function addRelationshipAction(input: AddRelationshipUIInput): Promise<{ success: boolean; edgeId?: string; autoConfirmed?: boolean; error?: string }> {
  const me = await getCurrentUser()
  if (!me) return { success: false, error: 'Not signed in' }
  const subject = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
  if (!subject) return { success: false, error: 'No person agent — finish onboarding' }

  const relType = getRelationshipTypeDefinitionByKey(input.relationshipTypeKey)
  if (!relType) return { success: false, error: `Unknown relationship type: ${input.relationshipTypeKey}` }
  const role = getRoleDefinitionByKey(input.roleKey)
  if (!role) return { success: false, error: `Unknown role: ${input.roleKey}` }

  return await assertRelationship({
    subjectAgentAddress: subject,
    objectAgentAddress: input.objectAgentAddress,
    relationshipType: hashTaxonomyTerm(relType.term),
    role: hashTaxonomyTerm(role.term),
  })
}
