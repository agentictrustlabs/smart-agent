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

import { getPublicClient, getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  classAssertionAbi,
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

  const turtle = await emitAgentsTurtle()
  if (!turtle) {
    return { success: false, message: 'No agents found or resolver not configured.' }
  }

  const agentCount = (turtle.match(/a sa:(PersonAgent|OrganizationAgent|AIAgentAccount|HubAgent)/g) ?? []).length
  console.log(`[ontology-sync] Emitted ${agentCount} agents. Uploading to GraphDB...`)

  const discovery = DiscoveryService.fromEnv()
  const client = discovery.getClient()

  try {
    // Upload agent data
    await client.uploadTurtle(turtle, DATA_GRAPH)
    console.log(`[ontology-sync] Agent data uploaded: ${agentCount} agents`)

    // Upload T-Box (ontology schema) from docs/ontology/tbox/*.ttl
    try {
      const fs = await import('fs')
      const path = await import('path')
      const tboxDir = path.resolve(process.cwd(), '../../docs/ontology/tbox')
      const cboxDir = path.resolve(process.cwd(), '../../docs/ontology/cbox')

      // Recursively collect *.ttl from a dir (handles tbox/shacl/)
      const findTurtleFiles = (dir: string): string[] => {
        if (!fs.existsSync(dir)) return []
        const out: string[] = []
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) out.push(...findTurtleFiles(full))
          else if (entry.isFile() && entry.name.endsWith('.ttl')) out.push(full)
        }
        return out
      }

      // Collect T-Box files (recursive — picks up tbox/shacl/)
      const tboxFiles = findTurtleFiles(tboxDir)
      if (tboxFiles.length > 0) {
        let tboxTurtle = ''
        for (const file of tboxFiles) {
          tboxTurtle += fs.readFileSync(file, 'utf-8') + '\n'
        }
        if (tboxTurtle) {
          await client.uploadTurtle(tboxTurtle, TBOX_GRAPH)
          console.log(`[ontology-sync] T-Box uploaded: ${tboxFiles.length} files to ${TBOX_GRAPH}`)
        }
      }

      // Collect C-Box files (recursive)
      const cboxFiles = findTurtleFiles(cboxDir)
      if (cboxFiles.length > 0) {
        let cboxTurtle = ''
        for (const file of cboxFiles) {
          cboxTurtle += fs.readFileSync(file, 'utf-8') + '\n'
        }
        if (cboxTurtle) {
          await client.uploadTurtle(cboxTurtle, CBOX_GRAPH)
          console.log(`[ontology-sync] C-Box uploaded: ${cboxFiles.length} files to ${CBOX_GRAPH}`)
        }
      }
    } catch (schemaErr) {
      console.warn('[ontology-sync] Schema upload failed (non-fatal):', schemaErr instanceof Error ? schemaErr.message : schemaErr)
    }

    console.log(`[ontology-sync] Sync complete: ${agentCount} agents + schema uploaded.`)

    // Mirror ClassAssertion events (intent-marketplace + sa:IntentAssertion)
    try {
      const assertionTurtle = await emitClassAssertionsTurtle()
      if (assertionTurtle) {
        await client.uploadTurtle(assertionTurtle, DATA_GRAPH)
        const ct = (assertionTurtle.match(/ a sa:(IntentAssertion|MatchInitiationAssertion|PledgeAssertion|PoolPledgedTotalAssertion|RoundOpenedAssertion|RoundClosedAssertion)\b/g) ?? []).length
        console.log(`[ontology-sync] Class assertions mirrored: ${ct}`)
      }
    } catch (caErr) {
      console.warn('[ontology-sync] Class-assertion mirror failed (non-fatal):', caErr instanceof Error ? caErr.message : caErr)
    }

    return { success: true, message: `Uploaded ${agentCount} agents + ontology schema to GraphDB`, agentCount }
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
