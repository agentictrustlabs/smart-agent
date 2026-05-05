import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { orgIntents, orgNeeds, orgOfferings, orgOutcomes } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

const VISIBILITIES = ['private', 'public', 'public-coarse', 'off-chain'] as const

const INTENT_ASSERTION_CLASS = 'sa:IntentAssertion'

/**
 * Emit a class assertion on chain via the ClassAssertion contract. Returns
 * the on-chain assertionId or null when visibility forbids anchoring.
 *
 * Mirrors apps/person-mcp/src/tools/intents.ts. Relayer model (v1) uses
 * DEPLOYER_PRIVATE_KEY; the org's principal is in the payload, not msg.sender.
 */
async function emitOnChainAssertion(
  orgPrincipal: string,
  intentKind: string,
  payload: Record<string, unknown>,
  visibility: string,
  intentId: string,
): Promise<string | null> {
  if (visibility !== 'public' && visibility !== 'public-coarse') return null

  const rpcUrl = process.env.RPC_URL
  const contractAddress = process.env.CLASS_ASSERTION_ADDRESS as Address | undefined
  const operatorKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
  if (!rpcUrl || !contractAddress || !operatorKey) {
    console.warn('[org-mcp/intents] on-chain emit skipped — missing RPC_URL, CLASS_ASSERTION_ADDRESS, or DEPLOYER_PRIVATE_KEY')
    return null
  }

  const onChainPayload = visibility === 'public'
    ? { orgPrincipal, intentKind, ...payload, visibility }
    : { orgPrincipal, intentKind, kind: payload.kind, geoBucket: typeof payload.geo === 'string' ? payload.geo.split('/').slice(0, 2).join('/') : undefined, visibility }

  try {
    const result = await emitClassAssertion(
      { rpcUrl, contractAddress, operatorPrivateKey: operatorKey },
      {
        classIri: INTENT_ASSERTION_CLASS,
        subjectIri: `urn:smart-agent:org-intent:${intentId}`,
        payload: onChainPayload,
      },
    )
    return result.assertionId
  } catch (err) {
    console.error('[org-mcp/intents] on-chain emit failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export const orgIntentsTools = {
  list_org_intents: {
    name: 'list_org_intents',
    description: 'List intents for the authenticated org (sees all visibilities).',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, direction: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string; direction?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'list_org_intents')
      let rows = db.select().from(orgIntents).where(eq(orgIntents.orgPrincipal, orgPrincipal)).all()
      if (args.direction) rows = rows.filter(r => r.direction === args.direction)
      return mcpText({ intents: rows })
    },
  },

  express_org_intent: {
    name: 'express_org_intent',
    description: 'Express an org-side intent. Public/public-coarse trigger an on-chain assertion mint via the org session signer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        direction: { type: 'string', enum: ['receive', 'give'] },
        visibility: { type: 'string' },
        kind: { type: 'string' },
        addressedTo: { type: 'string' },
        summary: { type: 'string' },
        context: { type: 'string' },
        priority: { type: 'string' },
        expiresAt: { type: 'string' },
        requirements: { type: 'string' },
        capabilities: { type: 'string' },
        capacity: { type: 'integer' },
        geo: { type: 'string' },
        timeWindow: { type: 'string' },
      },
      required: ['token', 'direction', 'kind', 'summary'],
    },
    handler: async (args: {
      token: string
      direction: 'receive' | 'give'
      visibility?: typeof VISIBILITIES[number]
      kind: string
      addressedTo?: string
      summary: string
      context?: string
      priority?: string
      expiresAt?: string
      requirements?: string
      capabilities?: string
      capacity?: number
      geo?: string
      timeWindow?: string
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'express_org_intent')
      const visibility = args.visibility ?? 'private'
      if (!VISIBILITIES.includes(visibility)) {
        throw new Error(`invalid visibility: ${visibility}`)
      }
      const now = new Date().toISOString()
      const intentId = randomUUID()

      const onChainAssertionId = (visibility === 'public' || visibility === 'public-coarse')
        ? await emitOnChainAssertion(orgPrincipal, args.kind, {
            direction: args.direction,
            summary: args.summary,
            geo: args.geo,
            kind: args.kind,
          }, visibility, intentId)
        : null

      const intentRow = {
        id: intentId,
        orgPrincipal,
        direction: args.direction,
        visibility,
        kind: args.kind,
        addressedTo: args.addressedTo ?? null,
        summary: args.summary,
        context: args.context ?? null,
        status: 'expressed',
        priority: args.priority ?? null,
        expiresAt: args.expiresAt ?? null,
        onChainAssertionId,
        createdAt: now,
        updatedAt: now,
      }
      db.insert(orgIntents).values(intentRow).run()

      let projection: unknown = null
      if (args.direction === 'receive') {
        const need = {
          id: randomUUID(),
          orgPrincipal,
          intentId,
          kind: args.kind,
          requirements: args.requirements ?? null,
          status: 'open',
          visibility,
          geo: args.geo ?? null,
          capacityNeeded: args.capacity ?? null,
          onChainAssertionId,
          createdAt: now,
        }
        db.insert(orgNeeds).values(need).run()
        projection = need
      } else {
        const offering = {
          id: randomUUID(),
          orgPrincipal,
          intentId,
          kind: args.kind,
          capabilities: args.capabilities ?? null,
          capacity: args.capacity ?? null,
          visibility,
          geo: args.geo ?? null,
          timeWindow: args.timeWindow ?? null,
          onChainAssertionId,
          createdAt: now,
        }
        db.insert(orgOfferings).values(offering).run()
        projection = offering
      }

      return mcpText({ intent: intentRow, projection })
    },
  },

  withdraw_org_intent: {
    name: 'withdraw_org_intent',
    description: 'Withdraw an org intent.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'withdraw_org_intent')
      const r = db.update(orgIntents)
        .set({ status: 'withdrawn', updatedAt: new Date().toISOString() })
        .where(and(eq(orgIntents.id, args.id), eq(orgIntents.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ updated: r.changes > 0 })
    },
  },

  list_org_outcomes: {
    name: 'list_org_outcomes',
    description: 'List outcomes for the authenticated org.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, intentId: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string; intentId?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'list_org_outcomes')
      let rows = db.select().from(orgOutcomes).where(eq(orgOutcomes.orgPrincipal, orgPrincipal)).all()
      if (args.intentId) rows = rows.filter(r => r.intentId === args.intentId)
      return mcpText({ outcomes: rows })
    },
  },

  // ─── intent:bump_ack_count — system-delegation primitive (specs 001 & 003) ──
  // Increments / decrements the live_acknowledgement_count column on an
  // org-tenanted intent. Issued by the artifact-creator's MCP (e.g., a
  // proposer's MCP at GrantProposal.submit / withdraw). Owner-routing is
  // preserved: the caller authenticates as the intent owner via a
  // bridged session + cross-delegation. The tool name IS the scope string
  // (see packages/sdk/src/marketplace-scopes.ts) — the MCP_TOOL_SCOPE
  // enforcer gates on the scope name verbatim.
  'intent:bump_ack_count': {
    name: 'intent:bump_ack_count',
    description: "Apply a signed delta (+1 / -1) to an intent's live_acknowledgement_count and (de)transition its status across the 0↔1 boundary. System-delegation scope.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        intentId: { type: 'string' },
        delta: { type: 'integer', enum: [1, -1] },
      },
      required: ['token', 'intentId', 'delta'],
    },
    handler: async (args: { token: string; intentId: string; delta: 1 | -1 }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'intent:bump_ack_count')
      if (args.delta !== 1 && args.delta !== -1) {
        throw new Error('delta must be +1 or -1')
      }
      const rows = db.select().from(orgIntents)
        .where(and(eq(orgIntents.id, args.intentId), eq(orgIntents.orgPrincipal, orgPrincipal)))
        .all()
      if (rows.length === 0) {
        throw new Error(`intent ${args.intentId} not found for principal`)
      }
      const cur = rows[0].liveAcknowledgementCount ?? 0
      const next = Math.max(0, cur + args.delta)
      const now = new Date().toISOString()
      // Status transitions on the 0↔1 boundary per IA § 3.10.
      let nextStatus = rows[0].status
      if (cur === 0 && next === 1 && nextStatus === 'expressed') nextStatus = 'acknowledged'
      else if (cur === 1 && next === 0 && nextStatus === 'acknowledged') nextStatus = 'expressed'
      db.update(orgIntents)
        .set({ liveAcknowledgementCount: next, status: nextStatus, updatedAt: now })
        .where(and(eq(orgIntents.id, args.intentId), eq(orgIntents.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ intentId: args.intentId, liveAcknowledgementCount: next, status: nextStatus })
    },
  },
}
