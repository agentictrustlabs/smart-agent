import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { intents, needs, offerings } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'
import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

// Visibility tiers per IA P4:
//   private       → MCP only; no on-chain emit
//   public        → MCP + emit on-chain assertion (full public fields)
//   public-coarse → MCP + emit on-chain assertion (kind, geo, capacity bucket only)
//   off-chain     → MCP only; explicitly never publishable
const VISIBILITIES = ['private', 'public', 'public-coarse', 'off-chain'] as const

// Class IRI for intent assertions. The on-chain → GraphDB sync uses this
// to know how to render the public mirror.
const INTENT_ASSERTION_CLASS = 'sa:IntentAssertion'

/**
 * Emit a class assertion on chain via the ClassAssertion contract. Returns
 * the on-chain assertionId or null when visibility forbids anchoring.
 *
 * Relayer model (v1): we use DEPLOYER_PRIVATE_KEY as the operator key. The
 * principal is recorded in the payload, not as msg.sender. See
 * packages/sdk/src/class-assertion-emit.ts for the design rationale.
 */
async function emitOnChainAssertion(
  principal: string,
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
    console.warn('[person-mcp/intents] on-chain emit skipped — missing RPC_URL, CLASS_ASSERTION_ADDRESS, or DEPLOYER_PRIVATE_KEY')
    return null
  }

  // For public-coarse, redact identifying detail (summary, exact geo).
  const onChainPayload = visibility === 'public'
    ? { principal, intentKind, ...payload, visibility }
    : { principal, intentKind, kind: payload.kind, geoBucket: typeof payload.geo === 'string' ? payload.geo.split('/').slice(0, 2).join('/') : undefined, visibility }

  try {
    const result = await emitClassAssertion(
      { rpcUrl, contractAddress, operatorPrivateKey: operatorKey },
      {
        classIri: INTENT_ASSERTION_CLASS,
        subjectIri: `urn:smart-agent:intent:${intentId}`,
        payload: onChainPayload,
      },
    )
    return result.assertionId
  } catch (err) {
    console.error('[person-mcp/intents] on-chain emit failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export const intentsTools = {
  list_intents: {
    name: 'list_intents',
    description: 'List intents for the authenticated principal (sees all visibilities).',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, direction: { type: 'string' }, status: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string; direction?: string; status?: string }) => {
      const principal = await requirePrincipal(args.token, 'list_intents')
      let rows = db.select().from(intents).where(eq(intents.principal, principal)).all()
      if (args.direction) rows = rows.filter(r => r.direction === args.direction)
      if (args.status) rows = rows.filter(r => r.status === args.status)
      return mcpText({ intents: rows })
    },
  },

  get_intent: {
    name: 'get_intent',
    description: 'Get an intent by id (must be owned by the authenticated principal).',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'get_intent')
      const rows = db.select().from(intents)
        .where(and(eq(intents.id, args.id), eq(intents.principal, principal)))
        .all()
      if (rows.length === 0) return mcpText({ intent: null })
      const intent = rows[0]
      const projection = intent.direction === 'receive'
        ? db.select().from(needs).where(eq(needs.intentId, intent.id)).all()
        : db.select().from(offerings).where(eq(offerings.intentId, intent.id)).all()
      return mcpText({ intent, projection })
    },
  },

  express_intent: {
    name: 'express_intent',
    description: 'Express an intent (with visibility-driven on-chain mint for public/public-coarse).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        direction: { type: 'string', enum: ['receive', 'give'] },
        visibility: { type: 'string', enum: ['private', 'public', 'public-coarse', 'off-chain'] },
        kind: { type: 'string' },
        addressedTo: { type: 'string' },
        summary: { type: 'string' },
        context: { type: 'string', description: 'JSON string' },
        priority: { type: 'string' },
        expiresAt: { type: 'string' },
        // projection fields
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
      const principal = await requirePrincipal(args.token, 'express_intent')
      const visibility = args.visibility ?? 'private'
      if (!VISIBILITIES.includes(visibility)) {
        throw new Error(`invalid visibility: ${visibility}`)
      }
      const now = new Date().toISOString()
      const intentId = randomUUID()

      const onChainAssertionId = (visibility === 'public' || visibility === 'public-coarse')
        ? await emitOnChainAssertion(principal, args.kind, {
            direction: args.direction,
            summary: args.summary,
            geo: args.geo,
            kind: args.kind,
          }, visibility, intentId)
        : null

      const intentRow = {
        id: intentId,
        principal,
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
      db.insert(intents).values(intentRow).run()

      // Project to needs or offerings
      let projection: unknown = null
      if (args.direction === 'receive') {
        const need = {
          id: randomUUID(),
          principal,
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
        db.insert(needs).values(need).run()
        projection = need
      } else {
        const offering = {
          id: randomUUID(),
          principal,
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
        db.insert(offerings).values(offering).run()
        projection = offering
      }

      return mcpText({ intent: intentRow, projection })
    },
  },

  withdraw_intent: {
    name: 'withdraw_intent',
    description: 'Withdraw (set status=withdrawn) an intent owned by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'withdraw_intent')
      // TODO Phase 4: if intent had a public on-chain assertion, emit a revoke
      const r = db.update(intents)
        .set({ status: 'withdrawn', updatedAt: new Date().toISOString() })
        .where(and(eq(intents.id, args.id), eq(intents.principal, principal)))
        .run()
      return mcpText({ updated: r.changes > 0 })
    },
  },
}
