/**
 * Phase 4 — AgentRelationship MCP tools (person-mcp).
 *
 * The web app previously called `createRelationship` / `confirmRelationship`
 * / `rejectRelationship` directly against the deployer wallet for personal
 * trust-graph writes (e.g., HAS_MEMBER on join, OWNERSHIP on org create).
 * Those writes now route through person-mcp tools, which forward to
 * a2a-agent's stateless-redeem path so the user's own session EOA is the
 * signer.
 *
 * Tools registered:
 *   - relationship:emit_edge       — createEdge + optional initial roles
 *   - relationship:set_edge_status — setEdgeStatus (propose / confirm /
 *                                     activate / reject / revoke)
 *   - relationship:list_outgoing   — read-only: edges where subject = self
 *
 * Auth: tools require a person-mcp delegation token. Tool-scope caveats in
 * the session delegation gate which relationships the caller can write
 * (added to TOOL_POLICIES with target=AgentRelationship +
 * createEdge/setEdgeStatus/addRole selectors).
 */
import { encodeFunctionData, type Address, type Hex } from 'viem'
import { randomUUID } from 'node:crypto'
import { requirePrincipal } from '../auth/principal-context.js'
import { agentRelationshipAbi } from '@smart-agent/sdk'
import { callA2aRedeem } from '../lib/a2a-client.js'
import {
  requireAgentRelationshipAddress,
  getPublicClient,
} from '../lib/contracts.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function requireSessionId(args: { _a2aSessionId?: string }): string {
  const id = args._a2aSessionId
  if (!id || typeof id !== 'string') {
    throw new Error('missing _a2aSessionId — Phase 1 requires routing through a2a-agent mcp-proxy')
  }
  return id
}

// ─── Tool: relationship:emit_edge ──────────────────────────────────────

interface EmitEdgeArgs {
  token: string
  subject: Address
  object: Address
  relationshipType: Hex      // bytes32 — typically a SDK constant like HAS_MEMBER
  roles?: Hex[]              // bytes32 role ids; e.g. [ROLE_MEMBER]
  metadataURI?: string
  _a2aSessionId?: string
}

const emitEdgeTool = {
  name: 'relationship:emit_edge',
  description:
    "Create a new relationship edge on AgentRelationship (subject → object with type and optional initial roles). Returns the computed edgeId. Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:            { type: 'string' },
      subject:          { type: 'string' },
      object:           { type: 'string' },
      relationshipType: { type: 'string' },
      roles:            { type: 'array', items: { type: 'string' } },
      metadataURI:      { type: 'string' },
    },
    required: ['token', 'subject', 'object', 'relationshipType'],
  },
  handler: async (args: EmitEdgeArgs) => {
    await requirePrincipal(args.token, 'relationship:emit_edge')
    const sessionId = requireSessionId(args)
    const target = requireAgentRelationshipAddress()
    const pub = getPublicClient()

    // Idempotency check — if the edge already exists, just add any missing
    // roles (mirrors the prior web-side createRelationship helper).
    const edgeId = await pub.readContract({
      address: target,
      abi: agentRelationshipAbi,
      functionName: 'computeEdgeId',
      args: [args.subject, args.object, args.relationshipType],
    }) as Hex
    const exists = await pub.readContract({
      address: target,
      abi: agentRelationshipAbi,
      functionName: 'edgeExists',
      args: [edgeId],
    }) as boolean

    const txs: Array<{ kind: string; txHash: Hex }> = []
    if (!exists) {
      const data = encodeFunctionData({
        abi: agentRelationshipAbi,
        functionName: 'createEdge',
        args: [
          args.subject,
          args.object,
          args.relationshipType,
          (args.roles ?? []),
          args.metadataURI ?? '',
        ],
      })
      const r = await callA2aRedeem(sessionId, {
        mcpTool: 'relationship:emit_edge',
        mcpCallId: randomUUID(),
        target,
        value: 0n,
        callData: data,
      })
      txs.push({ kind: 'createEdge', txHash: r.txHash })
    } else if (args.roles && args.roles.length > 0) {
      // Edge already exists — add any roles that aren't yet present.
      for (const role of args.roles) {
        const hasRole = await pub.readContract({
          address: target, abi: agentRelationshipAbi,
          functionName: 'hasRole', args: [edgeId, role],
        }) as boolean
        if (hasRole) continue
        const data = encodeFunctionData({
          abi: agentRelationshipAbi,
          functionName: 'addRole',
          args: [edgeId, role],
        })
        const r = await callA2aRedeem(sessionId, {
          mcpTool: 'relationship:emit_edge',
          mcpCallId: randomUUID(),
          target,
          value: 0n,
          callData: data,
        })
        txs.push({ kind: 'addRole', txHash: r.txHash })
      }
    }
    return mcpText({ ok: true as const, edgeId, exists, txs })
  },
}

// ─── Tool: relationship:set_edge_status ────────────────────────────────

interface SetEdgeStatusArgs {
  token: string
  edgeId: Hex
  /** AgentRelationship status enum: 1 PROPOSED · 2 CONFIRMED · 3 ACTIVE ·
   *  5 REVOKED · 6 REJECTED. */
  newStatus: 1 | 2 | 3 | 5 | 6
  _a2aSessionId?: string
}

const setEdgeStatusTool = {
  name: 'relationship:set_edge_status',
  description:
    "Update an edge's status on AgentRelationship (propose → confirmed → active → revoked/rejected). Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:     { type: 'string' },
      edgeId:    { type: 'string' },
      newStatus: { type: 'integer', enum: [1, 2, 3, 5, 6] },
    },
    required: ['token', 'edgeId', 'newStatus'],
  },
  handler: async (args: SetEdgeStatusArgs) => {
    await requirePrincipal(args.token, 'relationship:set_edge_status')
    const sessionId = requireSessionId(args)
    const target = requireAgentRelationshipAddress()
    const data = encodeFunctionData({
      abi: agentRelationshipAbi,
      functionName: 'setEdgeStatus',
      args: [args.edgeId, args.newStatus],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'relationship:set_edge_status',
      mcpCallId: randomUUID(),
      target,
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash, edgeId: args.edgeId, newStatus: args.newStatus })
  },
}

// ─── Tool: relationship:list_outgoing ──────────────────────────────────

interface ListOutgoingArgs {
  token: string
  subject: Address
  /** Optional filter by relationshipType (bytes32). */
  relationshipType?: Hex
}

const listOutgoingTool = {
  name: 'relationship:list_outgoing',
  description:
    "List all relationship edges where the given subject is the source. Optional filter by relationshipType.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:            { type: 'string' },
      subject:          { type: 'string' },
      relationshipType: { type: 'string' },
    },
    required: ['token', 'subject'],
  },
  handler: async (args: ListOutgoingArgs) => {
    await requirePrincipal(args.token, 'relationship:list_outgoing')
    const target = requireAgentRelationshipAddress()
    const pub = getPublicClient()
    let edgeIds: Hex[] = []
    try {
      edgeIds = await pub.readContract({
        address: target, abi: agentRelationshipAbi,
        functionName: 'getEdgesBySubject', args: [args.subject],
      }) as Hex[]
    } catch {
      return mcpText({ edges: [] })
    }
    const wantType = args.relationshipType?.toLowerCase()
    const out: Array<Record<string, unknown>> = []
    for (const id of edgeIds) {
      try {
        const e = await pub.readContract({
          address: target, abi: agentRelationshipAbi,
          functionName: 'getEdge', args: [id],
        }) as {
          edgeId: Hex; subject: Address; object_: Address
          relationshipType: Hex; status: number; createdBy: Address
          createdAt: bigint; updatedAt: bigint; metadataURI: string
        }
        if (wantType && e.relationshipType.toLowerCase() !== wantType) continue
        const roles = await pub.readContract({
          address: target, abi: agentRelationshipAbi,
          functionName: 'getRoles', args: [id],
        }).catch(() => [] as readonly Hex[]) as readonly Hex[]
        out.push({
          edgeId: e.edgeId,
          subject: e.subject,
          object: e.object_,
          relationshipType: e.relationshipType,
          status: e.status,
          createdBy: e.createdBy,
          createdAt: Number(e.createdAt),
          updatedAt: Number(e.updatedAt),
          metadataURI: e.metadataURI,
          roles,
        })
      } catch { /* skip */ }
    }
    return mcpText({ edges: out })
  },
}

export const relationshipTools = {
  'relationship:emit_edge': emitEdgeTool,
  'relationship:set_edge_status': setEdgeStatusTool,
  'relationship:list_outgoing': listOutgoingTool,
}
