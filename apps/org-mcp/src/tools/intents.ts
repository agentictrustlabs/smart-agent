import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { orgIntents, orgNeeds, orgOfferings, orgOutcomes } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

const VISIBILITIES = ['private', 'public', 'public-coarse', 'off-chain'] as const

// Stub for the on-chain emit. See person-mcp/src/tools/intents.ts for the
// matching stub. Phase 4 will implement: build IntentAssertion → sign with org
// session signer → submit via DelegationManager.makeAssertion.
async function emitOnChainAssertion(
  _orgPrincipal: string,
  _kind: string,
  _payload: Record<string, unknown>,
  _visibility: string,
): Promise<string | null> {
  return null
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
          }, visibility)
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
}
