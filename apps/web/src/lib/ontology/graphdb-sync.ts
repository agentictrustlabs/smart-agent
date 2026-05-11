/**
 * GraphDB Sync Utility
 *
 * Reads all on-chain agent data from the AgentAccountResolver and
 * AgentRelationship contracts, emits RDF/Turtle triples conforming to
 * the Smart Agent ontology, and uploads to GraphDB via the discovery SDK.
 *
 * Emit pattern (multi-node decomposition):
 *
 *   Agent (sa:Agent)
 *     ├── sa:uaid "did:sa:{chainId}:{address}"
 *     ├── sa:displayName, sa:description, sa:agentType, sa:isActive
 *     ├── sa:hasIdentity → SmartAgentIdentity (sai:SmartAgentIdentity)
 *     │     ├── sai:hasAgentAccount → eth:SmartAccount
 *     │     ├── sai:hasOwnerAccount → eth:Account (per controller)
 *     │     ├── sai:capability, sai:supportedTrustModel
 *     │     ├── sai:a2aEndpoint, sai:mcpServer
 *     │     ├── sai:aiAgentClass, sai:templateId
 *     │     └── sai:hasIdentifier → sai:SmartAgentIdentifier
 *     └── (relationship edges reference the Agent node)
 *
 * Named graph: https://smartagent.io/graph/data/onchain
 */

import { keccak256, toHex } from 'viem'
import { getPublicClient, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  classAssertionAbi,
  fundRegistryAbi,
  poolRegistryAbi,
  iriToBytes32,
  ATL_CONTROLLER, ATL_CAPABILITY, ATL_SUPPORTED_TRUST,
  ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
  ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  ATL_LATITUDE, ATL_LONGITUDE,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT, TYPE_HUB,
  AGENT_TYPE_LABELS, AI_CLASS_LABELS,
  roleName, relationshipTypeName,
} from '@smart-agent/sdk'
import { DiscoveryService, DATA_GRAPH } from '@smart-agent/discovery'
import { getAgentTemplateId } from '@/lib/agent-resolver'

// ---------------------------------------------------------------------------
// Constants & IRI helpers
// ---------------------------------------------------------------------------

const SA = 'https://smartagent.io/ontology/core#'
const SAI = 'https://smartagent.io/ontology/identity#'
const SAR = 'https://smartagent.io/ontology/relationships#'
const ETH = 'https://smartagent.io/ontology/eth#'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

const TYPE_MAP: Record<string, string> = {
  [TYPE_PERSON]: 'PersonAgent',
  [TYPE_ORGANIZATION]: 'OrganizationAgent',
  [TYPE_AI_AGENT]: 'AIAgentAccount',
  [TYPE_HUB]: 'HubAgent',
}

const STATUS_IRI_MAP: Record<number, string> = {
  0: `${SAR}StatusNone`, 1: `${SAR}StatusProposed`, 2: `${SAR}StatusConfirmed`,
  3: `${SAR}StatusActive`, 4: `${SAR}StatusSuspended`, 5: `${SAR}StatusRevoked`,
  6: `${SAR}StatusRejected`,
}

function iri(uri: string): string { return `<${uri}>` }
function lit(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '')}"`
}
function litTyped(value: string, type: string): string { return `"${value}"^^<${type}>` }

function agentIRI(address: string): string {
  return iri(`${SA}agent/${address.toLowerCase()}`)
}
function identityIRI(address: string): string {
  return iri(`${SAI}identity/sa/${CHAIN_ID}/${address.toLowerCase()}`)
}
function identifierIRI(address: string): string {
  return iri(`${SAI}identifier/sa/${CHAIN_ID}/${address.toLowerCase()}`)
}
function accountIRI(address: string): string {
  return iri(`${ETH}account/${CHAIN_ID}/${address.toLowerCase()}`)
}
function edgeIRI(edgeId: string): string {
  return iri(`${SAR}edge/${edgeId.toLowerCase()}`)
}
function uaid(address: string): string {
  return `did:sa:${CHAIN_ID}:${address.toLowerCase()}`
}

function toPascalCase(s: string): string {
  return s.split(/[-\s/]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

function closeBlock(lines: string[]): void {
  const lastIdx = lines.length - 1
  lines[lastIdx] = lines[lastIdx].replace(/ ;$/, ' .')
  lines.push('')
}

// ---------------------------------------------------------------------------
// Turtle Emitter
// ---------------------------------------------------------------------------

export async function emitAgentsTurtle(): Promise<string> {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolverAddr) return ''

  const client = getPublicClient()
  const lines: string[] = []

  // Prefixes
  lines.push(`@prefix sa:   <${SA}> .`)
  lines.push(`@prefix sai:  <${SAI}> .`)
  lines.push(`@prefix sar:  <${SAR}> .`)
  lines.push(`@prefix eth:  <${ETH}> .`)
  lines.push(`@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`)
  lines.push(`@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`)
  lines.push(`@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .`)
  lines.push(`@prefix prov: <http://www.w3.org/ns/prov#> .`)
  lines.push('')

  try {
    const count = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'agentCount',
    }) as bigint

    const nameMap = new Map<string, string>()

    for (let i = 0n; i < count; i++) {
      const agentAddr = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getAgentAt', args: [i],
      }) as `0x${string}`

      const core = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getCore', args: [agentAddr],
      }) as {
        displayName: string; description: string
        agentType: `0x${string}`; agentClass: `0x${string}`
        metadataURI: string; active: boolean
      }

      const typeName = TYPE_MAP[core.agentType] ?? 'Agent'
      const displayName = core.displayName || `${agentAddr.slice(0, 6)}...${agentAddr.slice(-4)}`
      nameMap.set(agentAddr.toLowerCase(), displayName)
      const typeLabel = AGENT_TYPE_LABELS[core.agentType]
      const classLabel = AI_CLASS_LABELS[core.agentClass]

      // ─── Agent Node ─────────────────────────────────────────────
      // Read .agent name early so we can emit on the agent node
      let primaryName = ''
      let nameLabel = ''
      try {
        primaryName = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [agentAddr, ATL_PRIMARY_NAME as `0x${string}`] }) as string
        nameLabel = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [agentAddr, ATL_NAME_LABEL as `0x${string}`] }) as string
      } catch { /* */ }

      const a = agentIRI(agentAddr)
      lines.push(`${a} a sa:${typeName} ;`)
      lines.push(`    sa:uaid ${lit(uaid(agentAddr))} ;`)
      lines.push(`    sa:onChainAddress ${lit(agentAddr)} ;`)
      lines.push(`    sa:displayName ${lit(displayName)} ;`)
      if (primaryName) lines.push(`    sa:primaryName ${lit(primaryName)} ;`)
      if (nameLabel) lines.push(`    sa:nameLabel ${lit(nameLabel)} ;`)
      if (core.description) lines.push(`    sa:description ${lit(core.description)} ;`)
      if (typeLabel) lines.push(`    sa:agentType ${lit(typeLabel.toLowerCase())} ;`)
      lines.push(`    sa:isActive ${litTyped(String(core.active), 'http://www.w3.org/2001/XMLSchema#boolean')} ;`)
      lines.push(`    sa:hasIdentity ${identityIRI(agentAddr)} ;`)
      closeBlock(lines)

      // ─── SmartAgentIdentity Node ────────────────────────────────
      const id = identityIRI(agentAddr)
      lines.push(`${id} a sai:SmartAgentIdentity ;`)
      lines.push(`    sai:identityOf ${a} ;`)
      lines.push(`    sai:hasAgentAccount ${accountIRI(agentAddr)} ;`)
      lines.push(`    sai:hasIdentifier ${identifierIRI(agentAddr)} ;`)

      // AI class
      if (classLabel) lines.push(`    sai:aiAgentClass sa:${classLabel}Class ;`)

      // Controllers → owner accounts
      try {
        const controllers = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiAddressProperty',
          args: [agentAddr, ATL_CONTROLLER as `0x${string}`],
        }) as string[]
        for (const c of controllers) {
          lines.push(`    sai:hasOwnerAccount ${accountIRI(c)} ;`)
        }
      } catch { /* ignored */ }

      // Capabilities
      try {
        const caps = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiStringProperty',
          args: [agentAddr, ATL_CAPABILITY as `0x${string}`],
        }) as string[]
        for (const c of caps) lines.push(`    sai:capability ${lit(c)} ;`)
      } catch { /* ignored */ }

      // Trust models
      try {
        const models = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiStringProperty',
          args: [agentAddr, ATL_SUPPORTED_TRUST as `0x${string}`],
        }) as string[]
        for (const m of models) lines.push(`    sai:supportedTrustModel ${lit(m)} ;`)
      } catch { /* ignored */ }

      // Endpoints
      try {
        const a2a = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [agentAddr, ATL_A2A_ENDPOINT as `0x${string}`] }) as string
        if (a2a) lines.push(`    sai:a2aEndpoint ${lit(a2a)} ;`)
        const mcp = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [agentAddr, ATL_MCP_SERVER as `0x${string}`] }) as string
        if (mcp) lines.push(`    sai:mcpServer ${lit(mcp)} ;`)
      } catch { /* ignored */ }

      // Template ID
      try {
        const templateId = await getAgentTemplateId(agentAddr)
        if (templateId) lines.push(`    sai:templateId ${lit(templateId)} ;`)
      } catch { /* ignored */ }

      // Metadata URI
      if (core.metadataURI) lines.push(`    sai:metadataURI ${lit(core.metadataURI)} ;`)

      // .agent naming (values already read above for the Agent node)
      if (primaryName) lines.push(`    sa:primaryName ${lit(primaryName)} ;`)
      if (nameLabel) lines.push(`    sa:nameLabel ${lit(nameLabel)} ;`)

      // Geospatial
      try {
        const lat = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [agentAddr, ATL_LATITUDE as `0x${string}`] }) as string
        const lon = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [agentAddr, ATL_LONGITUDE as `0x${string}`] }) as string
        if (lat) lines.push(`    sa:latitude ${lit(lat)} ;`)
        if (lon) lines.push(`    sa:longitude ${lit(lon)} ;`)
      } catch { /* geo not set */ }

      closeBlock(lines)

      // ─── SmartAgentIdentifier Node ──────────────────────────────
      lines.push(`${identifierIRI(agentAddr)} a sai:SmartAgentIdentifier ;`)
      lines.push(`    rdfs:label ${lit(uaid(agentAddr))} ;`)
      closeBlock(lines)

      // ─── eth:SmartAccount Node (the agent's own account) ────────
      lines.push(`${accountIRI(agentAddr)} a eth:SmartAccount ;`)
      lines.push(`    eth:accountChainId ${litTyped(String(CHAIN_ID), 'http://www.w3.org/2001/XMLSchema#integer')} ;`)
      lines.push(`    eth:accountAddress ${lit(agentAddr)} ;`)
      closeBlock(lines)
    }

    // ─── Controller EOA Account Nodes (deduplicated) ──────────────
    const emittedAccounts = new Set<string>()
    for (let i = 0n; i < count; i++) {
      const agentAddr = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getAgentAt', args: [i],
      }) as `0x${string}`
      // The agent's own smart account is already emitted
      emittedAccounts.add(agentAddr.toLowerCase())

      try {
        const controllers = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getMultiAddressProperty',
          args: [agentAddr, ATL_CONTROLLER as `0x${string}`],
        }) as string[]
        for (const c of controllers) {
          const key = c.toLowerCase()
          if (emittedAccounts.has(key)) continue
          emittedAccounts.add(key)
          lines.push(`${accountIRI(c)} a eth:EOAAccount ;`)
          lines.push(`    eth:accountChainId ${litTyped(String(CHAIN_ID), 'http://www.w3.org/2001/XMLSchema#integer')} ;`)
          lines.push(`    eth:accountAddress ${lit(c)} ;`)
          closeBlock(lines)
        }
      } catch { /* ignored */ }
    }

    // ─── Relationship Edges ───────────────────────────────────────
    const emittedEdges = new Set<string>()

    for (let i = 0n; i < count; i++) {
      const agentAddr = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getAgentAt', args: [i],
      }) as `0x${string}`

      try {
        const outIds = await getEdgesBySubject(agentAddr)
        for (const edgeId of outIds) {
          if (emittedEdges.has(edgeId)) continue
          emittedEdges.add(edgeId)

          try {
            const edge = await getEdge(edgeId)
            const roles = await getEdgeRoles(edgeId)

            const e = edgeIRI(edgeId)
            lines.push(`${e} a sar:RelationshipEdge ;`)
            lines.push(`    sar:edgeId ${lit(edgeId)} ;`)
            lines.push(`    sar:subject ${agentIRI(edge.subject)} ;`)
            lines.push(`    sar:object ${agentIRI(edge.object_)} ;`)
            lines.push(`    sar:relationshipType sar:${toPascalCase(relationshipTypeName(edge.relationshipType))} ;`)
            lines.push(`    sar:edgeStatus ${iri(STATUS_IRI_MAP[edge.status] ?? STATUS_IRI_MAP[0])} ;`)

            for (const r of roles) {
              lines.push(`    sar:hasRole sar:${toPascalCase(roleName(r))} ;`)
            }

            closeBlock(lines)
          } catch { /* ignored */ }
        }
      } catch { /* ignored */ }
    }

  } catch (err) {
    console.error('Failed to emit agents turtle:', err)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// GraphDB Sync (via @smart-agent/discovery)
// ---------------------------------------------------------------------------

const TBOX_GRAPH = 'https://smartagent.io/graph/schema/tbox'
const CBOX_GRAPH = 'https://smartagent.io/graph/schema/cbox'

export async function syncOnChainToGraphDB(): Promise<{ success: boolean; message: string; agentCount?: number }> {
  console.log('[ontology-sync] Starting on-chain → GraphDB sync...')

  // Pre-flight: skip the (potentially multi-MB) turtle build entirely if
  // GraphDB is unreachable. Cheaper than retrying a big PUT three times
  // through Cloudflare's 524 path. The next debounce tick will try again.
  const discovery = DiscoveryService.fromEnv()
  const client = discovery.getClient()
  try {
    const reachable = await client.ping()
    if (!reachable) {
      return { success: false, message: 'GraphDB ping failed — skipping sync (will retry next debounce)' }
    }
  } catch (pingErr) {
    return { success: false, message: `GraphDB ping error: ${pingErr instanceof Error ? pingErr.message : pingErr}` }
  }

  const agentTurtle = await emitAgentsTurtle()
  if (!agentTurtle) {
    return { success: false, message: 'No agents found or resolver not configured.' }
  }

  const agentCount = (agentTurtle.match(/a sa:(PersonAgent|OrganizationAgent|AIAgentAccount|HubAgent)/g) ?? []).length
  console.log(`[ontology-sync] Emitted ${agentCount} agents. Building combined data-graph turtle...`)

  try {
    // Combine ALL data-graph contributions into one turtle and PUT once.
    // The GraphDB Graph Store HTTP protocol's PUT is destructive (replaces
    // the named graph). Multiple sequential PUTs to the same graph each
    // wipe what came before, so we must concatenate first.
    let dataTurtle = agentTurtle

    // Class-assertion mirror (intent-marketplace + sa:IntentAssertion)
    let assertionCount = 0
    try {
      const assertionTurtle = await emitClassAssertionsTurtle()
      if (assertionTurtle) {
        // emitClassAssertionsTurtle already emits its own @prefix block;
        // we strip duplicate prefixes and concatenate the body so the
        // combined turtle parses cleanly as a single document.
        const body = stripPrefixBlock(assertionTurtle)
        dataTurtle += '\n# ─── Class assertions ──────────────────────────────\n' + body
        assertionCount = (assertionTurtle.match(/ a sa:(IntentAssertion|MatchInitiationAssertion|PledgeAssertion|PoolPledgedTotalAssertion|RoundOpenedAssertion|RoundClosedAssertion)\b/g) ?? []).length
      }
    } catch (caErr) {
      console.warn('[ontology-sync] Class-assertion mirror failed (non-fatal):', caErr instanceof Error ? caErr.message : caErr)
    }

    // Round mirror — reads the org-mcp `rounds` table directly. The IA
    // principle (P4) says GraphDB only mirrors authoritative state; for
    // rounds, the authoritative body lives in the fund's org-mcp tenant.
    // Until cross-MCP federation is wired, the sync reads the local
    // org-mcp.db file directly (single-process dev setup).
    let roundCount = 0
    try {
      const roundTurtle = await emitRoundsTurtle()
      if (roundTurtle) {
        const body = stripPrefixBlock(roundTurtle)
        dataTurtle += '\n# ─── Rounds (from org-mcp) ─────────────────────────\n' + body
        roundCount = (roundTurtle.match(/ a sa:Round\b/g) ?? []).length
      }
    } catch (rErr) {
      console.warn('[ontology-sync] Round mirror failed (non-fatal):', rErr instanceof Error ? rErr.message : rErr)
    }

    // Pool mirror (spec 002) — reads the org-mcp `pools` table directly.
    // Same authoritative-body rationale as rounds. Pool aggregates
    // (`sa:PoolPledgedTotalAssertion`) flow via the class-assertion mirror
    // when anchored on chain — no separate emit needed here.
    let poolCount = 0
    try {
      const poolTurtle = await emitPoolsTurtle()
      if (poolTurtle) {
        const body = stripPrefixBlock(poolTurtle)
        dataTurtle += '\n# ─── Pools (from org-mcp) ──────────────────────────\n' + body
        poolCount = (poolTurtle.match(/ a sa:Pool\b/g) ?? []).length
      }
    } catch (pErr) {
      console.warn('[ontology-sync] Pool mirror failed (non-fatal):', pErr instanceof Error ? pErr.message : pErr)
    }

    // SINGLE PUT — replaces DATA_GRAPH with our combined turtle.
    //
    // Schema (T-Box, SHACL, C-Box) is INTENTIONALLY NOT uploaded here. The
    // runtime sync fires on every on-chain edge mutation (debounced); the
    // T-Box/C-Box rarely change, so re-uploading them constantly was the
    // single biggest load on the GraphDB instance (~MBs per call ×
    // hundreds of calls/min during catalyst-seed = Cloudflare 524s).
    //
    // Schema is now an admin-time concern — push via:
    //   pnpm exec tsx scripts/sync-ontology.ts
    // ...whenever docs/ontology/{tbox,cbox}/ changes. The runtime sync
    // ONLY mirrors authoritative-state data (agents, class assertions,
    // round/pool bodies).
    await client.uploadTurtle(dataTurtle, DATA_GRAPH)
    console.log(`[ontology-sync] Data graph uploaded: ${agentCount} agents + ${assertionCount} class assertions + ${roundCount} rounds + ${poolCount} pools`)

    return { success: true, message: `Uploaded ${agentCount} agents + ${assertionCount} assertions + ${roundCount} rounds + ${poolCount} pools to GraphDB data graph`, agentCount }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GraphDB upload failed'
    console.error(`[ontology-sync] Upload failed: ${message}`)
    return { success: false, message, agentCount }
  }
}

// ---------------------------------------------------------------------------
// Class Assertion Mirror (intent-marketplace + sa:IntentAssertion)
// ---------------------------------------------------------------------------

/** Class IRIs we know how to mirror; classId on chain is keccak256(IRI). */
const KNOWN_ASSERTION_CLASSES: ReadonlyArray<{ iri: string; localName: string }> = [
  { iri: 'sa:IntentAssertion', localName: 'IntentAssertion' },
  { iri: 'sa:MatchInitiationAssertion', localName: 'MatchInitiationAssertion' },
  { iri: 'sa:PledgeAssertion', localName: 'PledgeAssertion' },
  { iri: 'sa:PoolPledgedTotalAssertion', localName: 'PoolPledgedTotalAssertion' },
  { iri: 'sa:RoundOpenedAssertion', localName: 'RoundOpenedAssertion' },
  { iri: 'sa:RoundClosedAssertion', localName: 'RoundClosedAssertion' },
  // Treasury Phase 1 — public-tier on-chain anchors for Pool / Round /
  // Proposal lane state changes per output/onchain-treasury-plan.md § 3.5.
  { iri: 'sa:PoolOpenedAssertion', localName: 'PoolOpenedAssertion' },
  { iri: 'sa:PoolMandateUpdatedAssertion', localName: 'PoolMandateUpdatedAssertion' },
  { iri: 'sa:StewardSetUpdatedAssertion', localName: 'StewardSetUpdatedAssertion' },
  { iri: 'sa:PoolClosedAssertion', localName: 'PoolClosedAssertion' },
  { iri: 'sa:AllocationDecidedAssertion', localName: 'AllocationDecidedAssertion' },
  { iri: 'sa:DisbursementAssertion', localName: 'DisbursementAssertion' },
  { iri: 'sa:GrantAwardedAssertion', localName: 'GrantAwardedAssertion' },
  { iri: 'sa:GrantRescindedAssertion', localName: 'GrantRescindedAssertion' },
  { iri: 'sa:OutcomeAttestationAssertion', localName: 'OutcomeAttestationAssertion' },
]

function assertionIRI(id: bigint): string {
  return iri(`${SA}assertion/${id.toString()}`)
}

/**
 * Reads ClassAssertionMade events from the deployed ClassAssertion contract
 * and renders each as a Turtle node in the public mirror graph.
 *
 * Per-class structured fields (e.g., MatchInitiation's viewedIntent /
 * candidateIntent) come from parsing the on-chain payloadURI — left to
 * each spec's user-story implementation. This Phase-0 mirror only ships
 * the basic node skeleton (type, asserter, validity window, payloadURI).
 */
export async function emitClassAssertionsTurtle(): Promise<string> {
  const contractAddr = process.env.CLASS_ASSERTION_ADDRESS as `0x${string}` | undefined
  if (!contractAddr) return ''

  const client = getPublicClient()
  const lines: string[] = []

  lines.push(`@prefix sa:   <${SA}> .`)
  lines.push(`@prefix eth:  <${ETH}> .`)
  lines.push(`@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`)
  lines.push(`@prefix prov: <http://www.w3.org/ns/prov#> .`)
  lines.push(`@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .`)
  lines.push('')

  const classMap = new Map<string, string>()
  for (const c of KNOWN_ASSERTION_CLASSES) {
    classMap.set(iriToBytes32(c.iri).toLowerCase(), c.localName)
  }

  // Read total assertion count, iterate, materialise each one.
  let count = 0n
  try {
    count = (await client.readContract({
      address: contractAddr,
      abi: classAssertionAbi,
      functionName: 'assertionCount',
      args: [],
    })) as bigint
  } catch (err) {
    console.warn('[ontology-sync] ClassAssertion contract unreachable:', err instanceof Error ? err.message : err)
    return ''
  }

  if (count === 0n) return ''

  for (let i = 0n; i < count; i += 1n) {
    let rec: {
      assertionId: bigint
      classId: `0x${string}`
      subjectId: `0x${string}`
      asserter: `0x${string}`
      validFrom: bigint
      validUntil: bigint
      revoked: boolean
      payloadURI: string
    }
    try {
      rec = (await client.readContract({
        address: contractAddr,
        abi: classAssertionAbi,
        functionName: 'getAssertion',
        args: [i],
      })) as typeof rec
    } catch {
      continue
    }
    if (rec.revoked) continue

    const localName = classMap.get(rec.classId.toLowerCase())
    if (!localName) continue // skip unknown classes

    lines.push(`${assertionIRI(rec.assertionId)} a sa:${localName} ;`)
    lines.push(`  sa:onChainAssertionId "${rec.assertionId.toString()}" ;`)
    lines.push(`  sa:classId "${rec.classId}" ;`)
    lines.push(`  sa:subjectId "${rec.subjectId}" ;`)
    lines.push(`  prov:wasAssociatedWith ${accountIRI(rec.asserter)} ;`)
    if (rec.validFrom > 0n) {
      const iso = new Date(Number(rec.validFrom) * 1000).toISOString()
      lines.push(`  prov:generatedAtTime ${litTyped(iso, 'http://www.w3.org/2001/XMLSchema#dateTime')} ;`)
    }
    if (rec.validUntil > 0n) {
      const iso = new Date(Number(rec.validUntil) * 1000).toISOString()
      lines.push(`  sa:validUntil ${litTyped(iso, 'http://www.w3.org/2001/XMLSchema#dateTime')} ;`)
    }
    lines.push(`  sa:payloadURI ${lit(rec.payloadURI)} .`)
    lines.push('')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Round Mirror — reads org-mcp's `rounds` table directly
// ---------------------------------------------------------------------------
//
// The IA (P4) says GraphDB only mirrors authoritative state; round bodies
// live authoritatively in the fund's org-mcp tenant. Until cross-MCP
// federation is wired, the sync reads org-mcp's local SQLite file directly
// — acceptable for the single-process dev / demo setup. In production this
// would be a federated read via a system-delegation tool exposed by org-mcp.
//
// Each round is rendered as both:
//   1. A `sa:Round` subject with all body fields (mandate, milestone-template,
//      etc.) so the listRounds / getRoundDetail SPARQL builders find it.
//   2. A synthetic `sa:RoundOpenedAssertion` mirror node so the
//      listRoundsQuery's anchor-based join binds the round IRI from
//      `subjectId`. (When real on-chain anchoring ships for rounds, this
//      synthetic mirror is replaced by the on-chain → assertion mirror.)

function escapeTurtleString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
}

// ─── Concept reverse-lookup ─────────────────────────────────────────
// Round/Pool typed-attrs store concept *hashes* (keccak256 of "sa:Foo"), but
// the GraphDB mirror has historically used the human label ("open", "public",
// etc.) as the literal value. Reverse-map known concept hashes back to the
// short label so the SPARQL queries don't need rewriting.
const HASH = (s: string) => keccak256(toHex(s)) as `0x${string}`
const CONCEPT_LABEL: Record<string, string> = {
  // Round status
  [HASH('sa:RoundOpen')]: 'open',
  [HASH('sa:RoundReview')]: 'review',
  [HASH('sa:RoundDecided')]: 'decided',
  [HASH('sa:RoundClosed')]: 'closed',
  [HASH('sa:RoundCanceled')]: 'canceled',
  // Visibility (shared by Round + Pool)
  [HASH('sa:VisibilityPublic')]: 'public',
  [HASH('sa:VisibilityPrivate')]: 'private',
  // Reporting cadence
  [HASH('sa:CadenceMonthly')]: 'monthly',
  [HASH('sa:CadenceQuarterly')]: 'quarterly',
  [HASH('sa:CadenceAnnual')]: 'annual',
  [HASH('sa:CadenceMilestone')]: 'milestone',
  // Pool governance model
  [HASH('sa:GovDAF')]: 'daf',
  [HASH('sa:GovGivingCircle')]: 'giving-circle',
  [HASH('sa:GovFund')]: 'fund',
  [HASH('sa:GovOpenCall')]: 'open-call',
  // Pool ceiling policy
  [HASH('sa:CeilingBlock')]: 'block',
  [HASH('sa:CeilingWaitlist')]: 'waitlist',
  [HASH('sa:CeilingAccept')]: 'accept',
  // Common units. The poolRegistry hashes the user-entered unit string
  // directly (e.g. `USD` → keccak256("USD")), so reverse the lookup
  // here to render the original label. Add new units as the demo grows.
  [HASH('USD')]: 'USD',
  [HASH('EUR')]: 'EUR',
  [HASH('prayer-minutes')]: 'prayer-minutes',
  [HASH('loaves')]: 'loaves',
  [HASH('hours')]: 'hours',
  [HASH('minutes')]: 'minutes',
  [HASH('meals')]: 'meals',
  [HASH('coaching-hours')]: 'coaching-hours',
}

function conceptToLabel(hash: `0x${string}` | string): string {
  const k = (typeof hash === 'string' ? hash : hash).toLowerCase() as `0x${string}`
  return CONCEPT_LABEL[k] ?? ''
}

// Bytes32 zero — uninitialized attr returns this from getBytes32.
const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as `0x${string}`

// FundRegistry predicate hashes (matches the contract's bytes32 constants).
const SA_ROUND_FUND_AGENT_HASH = HASH('sa:roundFundAgent')
const SA_ROUND_POOL_AGENT_HASH = HASH('sa:roundPoolAgent')
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export async function emitRoundsTurtle(opts: { slugFilter?: string } = {}): Promise<string> {
  const fundRegistryAddr = process.env.FUND_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!fundRegistryAddr) return ''

  const client = getPublicClient()

  // Enumerate all subjects in FundRegistry's typed-attribute storage. This
  // returns both Fund subjects (= bytes32(uint160(fundAgent))) and Round
  // subjects (= keccak256("sa:round:" + roundId)). We filter by checking
  // whether SA_ROUND_FUND_AGENT is set; only round subjects have that.
  let allSubjects: readonly `0x${string}`[]
  if (opts.slugFilter) {
    // Targeted emit: only the requested round (and its anchor).
    const oneSubject = await client.readContract({
      address: fundRegistryAddr, abi: fundRegistryAbi,
      functionName: 'roundSubject', args: [opts.slugFilter],
    }) as `0x${string}`
    allSubjects = [oneSubject]
  } else try {
    allSubjects = await client.readContract({
      address: fundRegistryAddr, abi: fundRegistryAbi,
      functionName: 'allSubjects',
    }) as readonly `0x${string}`[]
  } catch {
    return ''
  }

  const lines: string[] = []
  lines.push(`@prefix sa:   <${SA}> .`)
  lines.push(`@prefix prov: <http://www.w3.org/ns/prov#> .`)
  lines.push(`@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .`)
  lines.push('')

  let emitted = 0
  for (const s of allSubjects) {
    let isRound = false
    try {
      isRound = await client.readContract({
        address: fundRegistryAddr, abi: fundRegistryAbi,
        functionName: 'isSet', args: [s, SA_ROUND_FUND_AGENT_HASH],
      }) as boolean
    } catch { isRound = false }
    if (!isRound) continue

    let slug = ''
    try {
      slug = await client.readContract({
        address: fundRegistryAddr, abi: fundRegistryAbi,
        functionName: 'getRoundSlug', args: [s],
      }) as string
    } catch { /* */ }
    if (!slug) continue  // skip rounds opened before slug attr existed

    const [
      fundAgent, deadline, decisionDate, reportingCadenceHash,
      requiredCredentialsHashes, visibilityHash, statusHash,
      mandate, milestoneTemplate, validatorRequirements, openedAt,
      hasPoolAgent,
    ] = await Promise.all([
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundFundAgent', args: [s] }) as Promise<`0x${string}`>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundDeadline', args: [s] }) as Promise<bigint>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundDecisionDate', args: [s] }) as Promise<bigint>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundReportingCadence', args: [s] }) as Promise<`0x${string}`>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundRequiredCredentials', args: [s] }) as Promise<readonly `0x${string}`[]>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundVisibility', args: [s] }) as Promise<`0x${string}`>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundStatus', args: [s] }) as Promise<`0x${string}`>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundMandate', args: [s] }) as Promise<string>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundMilestoneTemplate', args: [s] }) as Promise<string>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundValidatorRequirements', args: [s] }) as Promise<string>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'getRoundOpenedAt', args: [s] }) as Promise<bigint>,
      client.readContract({ address: fundRegistryAddr, abi: fundRegistryAbi, functionName: 'isSet', args: [s, SA_ROUND_POOL_AGENT_HASH] }) as Promise<boolean>,
    ])

    let poolAgent: `0x${string}` = ZERO_ADDRESS as `0x${string}`
    if (hasPoolAgent) {
      try {
        poolAgent = await client.readContract({
          address: fundRegistryAddr, abi: fundRegistryAbi,
          functionName: 'getRoundPoolAgent', args: [s],
        }) as `0x${string}`
      } catch { /* skip */ }
    }

    const roundIri = `urn:smart-agent:round:${slug}`
    const fundIri = `${SA}agent/${fundAgent.toLowerCase()}`
    const cadenceLabel = conceptToLabel(reportingCadenceHash) || reportingCadenceHash
    const visibilityLabel = conceptToLabel(visibilityHash) || 'public'
    const statusLabel = conceptToLabel(statusHash) || 'open'
    const requiredCredsJson = JSON.stringify(
      requiredCredentialsHashes.filter(h => h !== ZERO_BYTES32).map(h => conceptToLabel(h) || h)
    )

    lines.push(`<${roundIri}> a sa:Round ;`)
    lines.push(`  sa:operatedByFund <${fundIri}> ;`)
    if (poolAgent && poolAgent.toLowerCase() !== ZERO_ADDRESS) {
      const poolIri = `${SA}agent/${poolAgent.toLowerCase()}`
      lines.push(`  sa:operatedByPool <${poolIri}> ;`)
    }
    if (mandate) {
      try {
        const m = JSON.parse(mandate) as { displayName?: string }
        if (m.displayName) {
          lines.push(`  sa:displayName "${escapeTurtleString(m.displayName)}" ;`)
        }
      } catch { /* not JSON — skip */ }
      lines.push(`  sa:roundMandate "${escapeTurtleString(mandate)}" ;`)
    }
    if (milestoneTemplate) {
      lines.push(`  sa:milestoneTemplate "${escapeTurtleString(milestoneTemplate)}" ;`)
    }
    if (validatorRequirements) {
      lines.push(`  sa:validatorRequirements "${escapeTurtleString(validatorRequirements)}" ;`)
    }
    lines.push(`  sa:reportingCadence "${escapeTurtleString(cadenceLabel)}" ;`)
    lines.push(`  sa:deadline "${new Date(Number(deadline) * 1000).toISOString()}"^^xsd:dateTime ;`)
    lines.push(`  sa:decisionDate "${new Date(Number(decisionDate) * 1000).toISOString()}"^^xsd:dateTime ;`)
    lines.push(`  sa:requiredCredentials "${escapeTurtleString(requiredCredsJson)}" ;`)
    lines.push(`  sa:visibility "${visibilityLabel}" ;`)
    lines.push(`  sa:status "${statusLabel}" .`)
    lines.push('')

    // Synthetic anchor mirror so listRoundsQuery's subjectId join works.
    const asnIri = `urn:smart-agent:assertion:${slug}-opened`
    const openedAtIso = new Date(Number(openedAt) * 1000).toISOString()
    lines.push(`<${asnIri}> a sa:RoundOpenedAssertion ;`)
    lines.push(`  sa:onChainAssertionId "${escapeTurtleString(asnIri)}" ;`)
    lines.push(`  sa:subjectId "${escapeTurtleString(slug)}" ;`)
    lines.push(`  prov:generatedAtTime "${openedAtIso}"^^xsd:dateTime .`)
    lines.push('')
    emitted++
  }

  return emitted > 0 ? lines.join('\n') : ''
}

// ---------------------------------------------------------------------------
// Pool Mirror — reads org-mcp's `pools` table directly
// ---------------------------------------------------------------------------
//
// IA principle (P4): GraphDB only mirrors authoritative state; pool bodies
// live authoritatively in the pool's org-mcp tenant. v1 reads the local
// org-mcp.db file directly (single-process dev setup).
//
// Each pool is rendered as a `sa:Pool` subject with all body fields
// (mandate, accepted units/restrictions, capacity, ceiling policy, etc.)
// so the listPoolsQuery / poolDetailQuery SPARQL builders find it.
//
// PoolPledgedTotal aggregate emission:
// `sa:PoolPledgedTotalAssertion` rows live on chain (donor-less aggregate
// per IA § 2.2 / § 3.3). The class-assertion mirror at
// `emitClassAssertionsTurtle` already mirrors them when present; this
// helper just emits the body. Best-effort on snapshot freshness.

// Predicate hashes used to detect whether a subject in PoolRegistry
// belongs to a Pool (vs. some other typed-attr subject in the same store).
const SA_POOL_OPENED_AT_HASH = HASH('sa:poolOpenedAt')

// Derive pool counters from `pool_pledges` table sums (Phase 7 — replaces
// the `pools.pledged_total` cache that no longer exists). Returns a map
// keyed by pool URN. allocatedTotal is 0 in v1 (no allocation tracking yet);
// availableTotal == pledgedTotal until allocation flow ships.
async function loadPoolCounters(): Promise<Map<string, { pledged: number; allocated: number; available: number }>> {
  const out = new Map<string, { pledged: number; allocated: number; available: number }>()
  const path = await import('path')
  const fs = await import('fs')
  const cwd = process.cwd()
  const candidates = [
    path.resolve(cwd, '../org-mcp/org-mcp.db'),
    path.resolve(cwd, 'apps/org-mcp/org-mcp.db'),
    path.resolve(cwd, '../../apps/org-mcp/org-mcp.db'),
  ]
  const dbPath = candidates.find(p => fs.existsSync(p))
  if (!dbPath) return out
  let Database: new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }) => {
    prepare: (sql: string) => { all: () => unknown[] }
    close: () => void
  }
  try {
    const mod = await import('better-sqlite3')
    Database = mod.default as unknown as typeof Database
  } catch {
    return out
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  let rows: Array<{ pool_agent_id: string; cadence: string; amount: number; duration: number | null }> = []
  try {
    rows = db.prepare(
      "SELECT pool_agent_id, cadence, amount, duration FROM pool_pledges WHERE status = 'active'"
    ).all() as typeof rows
  } catch { /* table might not exist on first boot */ }
  db.close()

  const { cadenceAwareTotal } = await import('@smart-agent/sdk')
  for (const r of rows) {
    const total = cadenceAwareTotal({ cadence: r.cadence as 'one-time' | 'monthly' | 'annual', amount: r.amount, duration: r.duration ?? undefined })
    const cur = out.get(r.pool_agent_id) ?? { pledged: 0, allocated: 0, available: 0 }
    cur.pledged += total
    cur.available = Math.max(0, cur.pledged - cur.allocated)
    out.set(r.pool_agent_id, cur)
  }
  return out
}

export async function emitPoolsTurtle(opts: { poolAgentFilter?: `0x${string}` } = {}): Promise<string> {
  const poolRegistryAddr = process.env.POOL_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!poolRegistryAddr) return ''

  const client = getPublicClient()
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined

  let allSubjects: readonly `0x${string}`[]
  if (opts.poolAgentFilter) {
    // Targeted emit: pool subject = bytes32(uint160(poolAgent)).
    const padded = `0x${'0'.repeat(24)}${opts.poolAgentFilter.slice(2).toLowerCase()}` as `0x${string}`
    allSubjects = [padded]
  } else try {
    allSubjects = await client.readContract({
      address: poolRegistryAddr, abi: poolRegistryAbi,
      functionName: 'allSubjects',
    }) as readonly `0x${string}`[]
  } catch {
    return ''
  }

  const counters = await loadPoolCounters()

  const lines: string[] = []
  lines.push(`@prefix sa:   <${SA}> .`)
  lines.push(`@prefix prov: <http://www.w3.org/ns/prov#> .`)
  lines.push(`@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .`)
  lines.push('')

  let emitted = 0
  for (const s of allSubjects) {
    let isPool = false
    try {
      isPool = await client.readContract({
        address: poolRegistryAddr, abi: poolRegistryAbi,
        functionName: 'isSet', args: [s, SA_POOL_OPENED_AT_HASH],
      }) as boolean
    } catch { isPool = false }
    if (!isPool) continue

    // Pool subjects are the bytes32 form of the pool agent address.
    const poolAgentAddr = (`0x${s.slice(-40)}`).toLowerCase() as `0x${string}`

    let slug = ''
    try {
      slug = await client.readContract({
        address: poolRegistryAddr, abi: poolRegistryAbi,
        functionName: 'getPoolSlug', args: [poolAgentAddr],
      }) as string
    } catch { /* */ }
    if (!slug) continue  // skip pools opened before slug attr existed

    const [
      domainHash, governanceModelHash,
      acceptedKindsHashes, acceptedUnitsHashes,
      ceilingPolicyHash, capacityCeiling, visibilityHash,
      stewards, acceptedRestrictions,
    ] = await Promise.all([
      client.readContract({ address: poolRegistryAddr, abi: poolRegistryAbi, functionName: 'getDomain', args: [poolAgentAddr] }) as Promise<`0x${string}`>,
      client.readContract({ address: poolRegistryAddr, abi: poolRegistryAbi, functionName: 'getGovernanceModel', args: [poolAgentAddr] }) as Promise<`0x${string}`>,
      client.readContract({ address: poolRegistryAddr, abi: poolRegistryAbi, functionName: 'getAcceptedKinds', args: [poolAgentAddr] }) as Promise<readonly `0x${string}`[]>,
      client.readContract({ address: poolRegistryAddr, abi: poolRegistryAbi, functionName: 'getAcceptedUnits', args: [poolAgentAddr] }) as Promise<readonly `0x${string}`[]>,
      client.readContract({ address: poolRegistryAddr, abi: poolRegistryAbi, functionName: 'getCeilingPolicy', args: [poolAgentAddr] }) as Promise<`0x${string}`>,
      client.readContract({ address: poolRegistryAddr, abi: poolRegistryAbi, functionName: 'getCapacityCeiling', args: [poolAgentAddr] }) as Promise<bigint>,
      client.readContract({ address: poolRegistryAddr, abi: poolRegistryAbi, functionName: 'getVisibility', args: [poolAgentAddr] }) as Promise<`0x${string}`>,
      client.readContract({ address: poolRegistryAddr, abi: poolRegistryAbi, functionName: 'getStewards', args: [poolAgentAddr] }) as Promise<readonly `0x${string}`[]>,
      client.readContract({ address: poolRegistryAddr, abi: poolRegistryAbi, functionName: 'getAcceptedRestrictions', args: [poolAgentAddr] }) as Promise<string>,
    ])

    // Pool's display name lives on its agent record (AgentAccountResolver).
    let displayName = slug
    if (resolverAddr) {
      try {
        const core = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getCore', args: [poolAgentAddr],
        }) as { displayName: string }
        if (core.displayName) displayName = core.displayName
      } catch { /* */ }
    }

    const poolIri = `urn:smart-agent:pool:${slug}`
    const treasuryIri = `${SA}agent/${poolAgentAddr}`
    const ceilingLabel = conceptToLabel(ceilingPolicyHash) || ceilingPolicyHash
    const visibilityLabel = conceptToLabel(visibilityHash) || 'public'
    const governanceLabel = conceptToLabel(governanceModelHash) || governanceModelHash
    const domainLabel = conceptToLabel(domainHash) || domainHash

    lines.push(`<${poolIri}> a sa:Pool ;`)
    lines.push(`  sa:displayName "${escapeTurtleString(displayName)}" ;`)
    lines.push(`  sa:treasuryAgent <${treasuryIri}> ;`)
    if (domainLabel) {
      lines.push(`  sa:domain "${escapeTurtleString(domainLabel)}" ;`)
    }
    if (governanceLabel) {
      lines.push(`  sa:governanceModel "${escapeTurtleString(governanceLabel)}" ;`)
    }
    if (acceptedRestrictions && acceptedRestrictions !== '{}') {
      lines.push(`  sa:acceptedRestrictions "${escapeTurtleString(acceptedRestrictions)}" ;`)
    }
    for (const u of acceptedUnitsHashes) {
      const ulabel = conceptToLabel(u) || u
      lines.push(`  sa:acceptsUnit "${escapeTurtleString(ulabel)}" ;`)
    }
    for (const k of acceptedKindsHashes) {
      const klabel = conceptToLabel(k) || k
      lines.push(`  sa:acceptedKind "${escapeTurtleString(klabel)}" ;`)
    }
    if (capacityCeiling > 0n) {
      lines.push(`  sa:capacityCeiling ${capacityCeiling.toString()} ;`)
    }
    lines.push(`  sa:ceilingPolicy "${escapeTurtleString(ceilingLabel)}" ;`)
    lines.push(`  sa:visibility "${visibilityLabel}" ;`)
    if (stewards.length > 0) {
      const first = stewards[0]
      lines.push(`  sa:stewardshipAgent <${SA}agent/${first.toLowerCase()}> ;`)
      for (const st of stewards) {
        lines.push(`  sa:steward <${SA}agent/${st.toLowerCase()}> ;`)
      }
    }
    // Counters derived at sync time from pool_pledges sums (Phase 7).
    // Historical data hygiene: some rows store pool_agent_id as the pool's
    // URN (urn:smart-agent:pool:<slug>) while others store it as the
    // treasury hex address. We sum BOTH keys so totals on the pool detail
    // page reflect every pledge regardless of how it was filed.
    const cUrn = counters.get(poolIri) ?? { pledged: 0, allocated: 0, available: 0 }
    const cHex = counters.get(poolAgentAddr) ?? { pledged: 0, allocated: 0, available: 0 }
    const pledged   = cUrn.pledged   + cHex.pledged
    const allocated = cUrn.allocated + cHex.allocated
    const available = Math.max(0, pledged - allocated)
    lines.push(`  sa:pledgedTotal ${pledged} ;`)
    lines.push(`  sa:allocatedTotal ${allocated} ;`)
    lines.push(`  sa:availableTotal ${available} .`)
    lines.push('')
    emitted++
  }

  return emitted > 0 ? lines.join('\n') : ''
}

/**
 * Emit `sa:PoolPledgedTotalAssertion` rows from on-chain (best-effort).
 * v1 stub — the class-assertion mirror at `emitClassAssertionsTurtle`
 * already pulls these from the on-chain class-assertion contract when
 * pools have anchored snapshots. Returning empty here is fine; left as
 * a named export so future on-chain pool aggregates can grow into it
 * without touching the orchestrator above.
 */
export async function emitPoolPledgedTotalsTurtle(): Promise<string> {
  return ''
}

// ---------------------------------------------------------------------------
// Helper — strip @prefix block so multiple turtle fragments concatenate cleanly
// ---------------------------------------------------------------------------

function stripPrefixBlock(turtle: string): string {
  // Remove leading `@prefix ... .` lines and any blank lines that follow.
  // The combined output has its own prefix declarations from emitAgentsTurtle.
  return turtle
    .replace(/^(?:@prefix\s+\S+:\s+<[^>]+>\s*\.\s*\n?)+/gm, '')
    .replace(/^\s*\n+/, '')
}

// ---------------------------------------------------------------------------
// Per-entity incremental sync
//
// Each function emits turtle for a SINGLE subject (round, pool, agent) and
// applies it to GraphDB via a SPARQL DELETE+INSERT against the data graph.
// This replaces the per-action `scheduleKbSyncEager()` full-graph PUT,
// which was the root cause of GraphDB crashing under demo-seed load (every
// edge mutation triggered a multi-MB PUT that re-serialized the entire
// data graph). The full-graph rebuild path is still available via
// `syncOnChainToGraphDB()` for admin/initial sync.
//
// SPARQL pattern per subject:
//   DELETE WHERE { GRAPH <data> { <subject> ?p ?o } } ;
//   INSERT DATA  { GRAPH <data> { <new turtle> } }
// The DELETE drops every triple whose subject is the target IRI; the
// INSERT replaces them with the freshly-emitted ones. Anchor assertions
// (RoundOpenedAssertion, etc.) live on separate IRIs and need their own
// DELETE+INSERT — handled inline per entity.
// ---------------------------------------------------------------------------

const SHARED_PREFIXES = `PREFIX sa: <${SA}>
PREFIX sai: <${SAI}>
PREFIX sar: <${SAR}>
PREFIX eth: <${ETH}>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX p-plan: <http://purl.org/net/p-plan#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`

/**
 * Replace all triples for `subjectIri` in the data graph with the body of
 * `turtle` (which must declare those triples on the given subject).
 * Pass `extraSubjects` to also clear ancillary subjects (anchor assertions,
 * for example) in the same transaction.
 */
async function syncSubjectToGraphDB(
  subjectIri: string,
  turtle: string,
  opts: { extraSubjects?: string[] } = {},
): Promise<{ ok: boolean; message: string }> {
  if (!turtle) return { ok: false, message: 'empty turtle' }
  const { DiscoveryService } = await import('@smart-agent/discovery')
  const discovery = DiscoveryService.fromEnv()
  const client = discovery.getClient()
  const body = stripPrefixBlock(turtle)

  // SPARQL `IN` list must be comma-separated: `IN (<a>, <b>)`. Without
  // the commas GraphDB rejects the entire UPDATE with a "MALFORMED QUERY".
  const subjects = [subjectIri, ...(opts.extraSubjects ?? [])]
    .map(s => `<${s}>`)
    .join(', ')

  const sparql = `${SHARED_PREFIXES}
DELETE { GRAPH <${DATA_GRAPH}> { ?s ?p ?o } }
WHERE  { GRAPH <${DATA_GRAPH}> { ?s ?p ?o . FILTER(?s IN (${subjects})) } };
INSERT DATA { GRAPH <${DATA_GRAPH}> {
${body}
} }`
  try {
    await client.update(sparql)
    return { ok: true, message: `synced ${subjectIri}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Incrementally sync one round (and its RoundOpenedAssertion anchor) to GraphDB. */
export async function syncRoundToGraphDB(slug: string): Promise<{ ok: boolean; message: string }> {
  const turtle = await emitRoundsTurtle({ slugFilter: slug })
  if (!turtle) return { ok: false, message: `no turtle for round ${slug}` }
  return syncSubjectToGraphDB(
    `urn:smart-agent:round:${slug}`,
    turtle,
    { extraSubjects: [`urn:smart-agent:assertion:${slug}-opened`] },
  )
}

/** Incrementally sync one pool (and its PoolOpenedAssertion anchor) to GraphDB. */
export async function syncPoolToGraphDB(
  poolAgentAddress: `0x${string}`,
  slug?: string,
): Promise<{ ok: boolean; message: string }> {
  const turtle = await emitPoolsTurtle({ poolAgentFilter: poolAgentAddress })
  if (!turtle) return { ok: false, message: `no turtle for pool ${poolAgentAddress}` }
  const subjectIri = slug
    ? `urn:smart-agent:pool:${slug}`
    : `urn:smart-agent:pool:${poolAgentAddress.toLowerCase()}`
  const extras = slug ? [`urn:smart-agent:assertion:${slug}-pool-opened`] : []
  return syncSubjectToGraphDB(subjectIri, turtle, { extraSubjects: extras })
}

/**
 * Resync ALL pools' aggregates (pledgedTotal / allocatedTotal / availableTotal
 * etc.) to GraphDB. Use when a write affects a pool we can't trivially
 * resolve back to its on-chain treasury address (e.g. pledge submission
 * where the pool reference may be URN or address depending on caller).
 * The full pool set is small (~5 pools × ~30 triples), so this update
 * is still tiny relative to the multi-MB full-graph PUT we replaced.
 *
 * DELETE pattern: every subject whose IRI starts with `urn:smart-agent:pool:`
 * is wiped before INSERT. Anchor assertions (`*-pool-opened`) are not
 * mirrored as a separate subject prefix in the emit, so the per-pool
 * mirror's freshness depends on this single DELETE+INSERT.
 */
export async function syncAllPoolsToGraphDB(): Promise<{ ok: boolean; message: string }> {
  const turtle = await emitPoolsTurtle()
  if (!turtle) return { ok: false, message: 'no pool turtle (no pools on chain?)' }
  const { DiscoveryService } = await import('@smart-agent/discovery')
  const discovery = DiscoveryService.fromEnv()
  const client = discovery.getClient()
  const body = stripPrefixBlock(turtle)
  const sparql = `${SHARED_PREFIXES}
DELETE { GRAPH <${DATA_GRAPH}> { ?s ?p ?o } }
WHERE  { GRAPH <${DATA_GRAPH}> { ?s ?p ?o . FILTER(STRSTARTS(STR(?s), "urn:smart-agent:pool:")) } };
INSERT DATA { GRAPH <${DATA_GRAPH}> {
${body}
} }`
  try {
    await client.update(sparql)
    return { ok: true, message: 'synced all pools' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
