import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  orgWorkItems,
  engagementProviderState,
  engagementSessions,
  engagementTranches,
  engagementPolicies,
  policySigners,
} from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const orgWorkItemsTools = {
  list_org_work_items: {
    name: 'list_org_work_items',
    description: 'List work items assigned to the authenticated org.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        status: { type: 'string' },
        entitlementId: { type: 'string' },
      },
      required: ['token'],
    },
    handler: async (args: { token: string; status?: string; entitlementId?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'list_org_work_items')
      let rows = db.select().from(orgWorkItems).where(eq(orgWorkItems.orgPrincipal, orgPrincipal)).all()
      if (args.status) rows = rows.filter(r => r.status === args.status)
      if (args.entitlementId) rows = rows.filter(r => r.entitlementId === args.entitlementId)
      return mcpText({ workItems: rows })
    },
  },

  create_org_work_item: {
    name: 'create_org_work_item',
    description: 'Create a work item assigned to the authenticated org.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        entitlementId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        dueAt: { type: 'string' },
      },
      required: ['token', 'entitlementId', 'title'],
    },
    handler: async (args: { token: string; entitlementId: string; title: string; description?: string; dueAt?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'create_org_work_item')
      const row = {
        id: randomUUID(),
        orgPrincipal,
        entitlementId: args.entitlementId,
        title: args.title,
        description: args.description ?? null,
        dueAt: args.dueAt ?? null,
        status: 'open',
        resolvedAt: null,
        resolvedByActivityId: null,
        createdAt: new Date().toISOString(),
      }
      db.insert(orgWorkItems).values(row).run()
      return mcpText({ workItem: row })
    },
  },

  resolve_org_work_item: {
    name: 'resolve_org_work_item',
    description: 'Mark an org work item resolved.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        resolvedByActivityId: { type: 'string' },
      },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string; resolvedByActivityId?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'resolve_org_work_item')
      const r = db.update(orgWorkItems)
        .set({
          status: 'resolved',
          resolvedAt: new Date().toISOString(),
          resolvedByActivityId: args.resolvedByActivityId ?? null,
        })
        .where(and(eq(orgWorkItems.id, args.id), eq(orgWorkItems.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ resolved: r.changes > 0 })
    },
  },
}

export const engagementTools = {
  init_engagement_provider_state: {
    name: 'init_engagement_provider_state',
    description: 'Initialize provider-side state for an entitlement (typically called by an on-chain event listener).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        entitlementId: { type: 'string' },
        capacityRemaining: { type: 'integer' },
        internalAssignee: { type: 'string' },
      },
      required: ['token', 'entitlementId'],
    },
    handler: async (args: { token: string; entitlementId: string; capacityRemaining?: number; internalAssignee?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'init_engagement_provider_state')
      const row = {
        entitlementId: args.entitlementId,
        orgPrincipal,
        capacityRemaining: args.capacityRemaining ?? null,
        providerNotes: null,
        internalAssignee: args.internalAssignee ?? null,
        updatedAt: new Date().toISOString(),
      }
      db.insert(engagementProviderState).values(row).onConflictDoUpdate({
        target: engagementProviderState.entitlementId,
        set: {
          capacityRemaining: row.capacityRemaining,
          internalAssignee: row.internalAssignee,
          updatedAt: row.updatedAt,
        },
      }).run()
      return mcpText({ state: row })
    },
  },

  schedule_engagement_session: {
    name: 'schedule_engagement_session',
    description: 'Schedule a session for an engagement.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        entitlementId: { type: 'string' },
        scheduledAt: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['token', 'entitlementId', 'scheduledAt'],
    },
    handler: async (args: { token: string; entitlementId: string; scheduledAt: string; notes?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'schedule_engagement_session')
      const row = {
        id: randomUUID(),
        entitlementId: args.entitlementId,
        orgPrincipal,
        scheduledAt: args.scheduledAt,
        occurredAt: null,
        status: 'scheduled',
        notes: args.notes ?? null,
      }
      db.insert(engagementSessions).values(row).run()
      return mcpText({ session: row })
    },
  },

  list_engagement_sessions: {
    name: 'list_engagement_sessions',
    description: 'List sessions for the authenticated org (optionally filtered by entitlement).',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, entitlementId: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string; entitlementId?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'list_engagement_sessions')
      let rows = db.select().from(engagementSessions).where(eq(engagementSessions.orgPrincipal, orgPrincipal)).all()
      if (args.entitlementId) rows = rows.filter(r => r.entitlementId === args.entitlementId)
      return mcpText({ sessions: rows })
    },
  },

  schedule_engagement_tranche: {
    name: 'schedule_engagement_tranche',
    description: 'Schedule a money tranche for an engagement.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        entitlementId: { type: 'string' },
        scheduledAt: { type: 'string' },
        amountCents: { type: 'integer' },
        currency: { type: 'string' },
        gatedOnReportId: { type: 'string' },
      },
      required: ['token', 'entitlementId', 'scheduledAt', 'amountCents'],
    },
    handler: async (args: {
      token: string
      entitlementId: string
      scheduledAt: string
      amountCents: number
      currency?: string
      gatedOnReportId?: string
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'schedule_engagement_tranche')
      const row = {
        id: randomUUID(),
        entitlementId: args.entitlementId,
        orgPrincipal,
        scheduledAt: args.scheduledAt,
        amountCents: args.amountCents,
        currency: args.currency ?? 'XOF',
        status: 'pending',
        releasedAt: null,
        gatedOnReportId: args.gatedOnReportId ?? null,
      }
      db.insert(engagementTranches).values(row).run()
      return mcpText({ tranche: row })
    },
  },

  release_engagement_tranche: {
    name: 'release_engagement_tranche',
    description: 'Mark an engagement tranche as released.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'release_engagement_tranche')
      const r = db.update(engagementTranches)
        .set({ status: 'released', releasedAt: new Date().toISOString() })
        .where(and(eq(engagementTranches.id, args.id), eq(engagementTranches.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ released: r.changes > 0 })
    },
  },

  attach_engagement_policy: {
    name: 'attach_engagement_policy',
    description: 'Attach a governance policy document to an engagement.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        entitlementId: { type: 'string' },
        policyType: { type: 'string' },
        documentUri: { type: 'string' },
        version: { type: 'string' },
        signaturesRequired: { type: 'integer' },
      },
      required: ['token', 'entitlementId', 'policyType'],
    },
    handler: async (args: {
      token: string
      entitlementId: string
      policyType: string
      documentUri?: string
      version?: string
      signaturesRequired?: number
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'attach_engagement_policy')
      const row = {
        id: randomUUID(),
        entitlementId: args.entitlementId,
        orgPrincipal,
        policyType: args.policyType,
        documentUri: args.documentUri ?? null,
        version: args.version ?? null,
        signaturesRequired: args.signaturesRequired ?? 1,
        createdAt: new Date().toISOString(),
      }
      db.insert(engagementPolicies).values(row).run()
      return mcpText({ policy: row })
    },
  },

  add_policy_signer: {
    name: 'add_policy_signer',
    description: 'Record a policy signer (with optional signedAt timestamp).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        policyId: { type: 'string' },
        signerAgent: { type: 'string' },
        role: { type: 'string' },
        signedAt: { type: 'string' },
      },
      required: ['token', 'policyId', 'signerAgent'],
    },
    handler: async (args: { token: string; policyId: string; signerAgent: string; role?: string; signedAt?: string }) => {
      await requireOrgPrincipal(args.token, args, 'add_policy_signer')
      const row = {
        id: randomUUID(),
        policyId: args.policyId,
        signerAgent: args.signerAgent.toLowerCase(),
        role: args.role ?? null,
        signedAt: args.signedAt ?? null,
      }
      db.insert(policySigners).values(row).run()
      return mcpText({ signer: row })
    },
  },
}
