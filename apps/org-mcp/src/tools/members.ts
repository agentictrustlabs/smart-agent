import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { orgMembers, detachedMembers } from '../db/schema.js'
import { requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const membersTools = {
  list_members: {
    name: 'list_members',
    description: 'List org members (with private metadata). On-chain edges anchor identity; this table holds the private side.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'list_members')
      const rows = db.select().from(orgMembers).where(eq(orgMembers.orgPrincipal, orgPrincipal)).all()
      return mcpText({ members: rows })
    },
  },

  upsert_member: {
    name: 'upsert_member',
    description: 'Insert or update a private member record (paired with an on-chain edge).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        memberAgent: { type: 'string' },
        role: { type: 'string' },
        joinedAt: { type: 'string' },
        leftAt: { type: 'string' },
        edgeId: { type: 'string' },
        internalNotes: { type: 'string' },
      },
      required: ['token', 'memberAgent'],
    },
    handler: async (args: {
      token: string
      memberAgent: string
      role?: string
      joinedAt?: string
      leftAt?: string
      edgeId?: string
      internalNotes?: string
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'upsert_member')
      const memberAgent = args.memberAgent.toLowerCase()
      const existing = db.select().from(orgMembers)
        .where(and(eq(orgMembers.orgPrincipal, orgPrincipal), eq(orgMembers.memberAgent, memberAgent)))
        .all()

      if (existing.length === 0) {
        const row = {
          id: randomUUID(),
          orgPrincipal,
          memberAgent,
          role: args.role ?? null,
          joinedAt: args.joinedAt ?? new Date().toISOString(),
          leftAt: args.leftAt ?? null,
          edgeId: args.edgeId ?? null,
          internalNotes: args.internalNotes ?? null,
        }
        db.insert(orgMembers).values(row).run()
        return mcpText({ member: row })
      }
      const updates: Record<string, string | null> = {}
      if (args.role !== undefined) updates.role = args.role
      if (args.leftAt !== undefined) updates.leftAt = args.leftAt
      if (args.edgeId !== undefined) updates.edgeId = args.edgeId
      if (args.internalNotes !== undefined) updates.internalNotes = args.internalNotes
      db.update(orgMembers).set(updates)
        .where(and(eq(orgMembers.orgPrincipal, orgPrincipal), eq(orgMembers.memberAgent, memberAgent)))
        .run()
      return mcpText({ updated: true, id: existing[0].id })
    },
  },

  list_detached_members: {
    name: 'list_detached_members',
    description: 'List detached members (people tracked without on-chain identity).',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'list_detached_members')
      const rows = db.select().from(detachedMembers).where(eq(detachedMembers.orgPrincipal, orgPrincipal)).all()
      return mcpText({ detached: rows })
    },
  },

  add_detached_member: {
    name: 'add_detached_member',
    description: 'Add a detached member (no on-chain identity).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        displayName: { type: 'string' },
        contactInfoEncrypted: { type: 'string' },
        assignedNodeId: { type: 'string' },
        role: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['token', 'displayName'],
    },
    handler: async (args: {
      token: string
      displayName: string
      contactInfoEncrypted?: string
      assignedNodeId?: string
      role?: string
      notes?: string
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'add_detached_member')
      const now = new Date().toISOString()
      const row = {
        id: randomUUID(),
        orgPrincipal,
        displayName: args.displayName,
        contactInfoEncrypted: args.contactInfoEncrypted ?? null,
        trackedSince: now,
        notes: args.notes ?? null,
        assignedNodeId: args.assignedNodeId ?? null,
        role: args.role ?? null,
        createdBy: orgPrincipal,
        createdAt: now,
      }
      db.insert(detachedMembers).values(row).run()
      return mcpText({ member: row })
    },
  },

  delete_detached_member: {
    name: 'delete_detached_member',
    description: 'Delete a detached member by id.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'delete_detached_member')
      const r = db.delete(detachedMembers)
        .where(and(eq(detachedMembers.id, args.id), eq(detachedMembers.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ deleted: r.changes > 0 })
    },
  },
}
