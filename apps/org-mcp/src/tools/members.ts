import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { detachedMembers } from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

// list_members / upsert_member dropped: org membership lives on-chain in
// AgentRelationship edges. Web reads via DiscoveryService.getOutgoingEdges;
// no MCP tool was needed here (zero callers existed).

export const membersTools = {
  list_detached_members: {
    name: 'list_detached_members',
    description: 'List detached members (people tracked without on-chain identity).',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'list_detached_members')
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
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'add_detached_member')
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
      const orgPrincipal = await requireOrgPrincipal(args.token, args, 'delete_detached_member')
      const r = db.delete(detachedMembers)
        .where(and(eq(detachedMembers.id, args.id), eq(detachedMembers.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ deleted: r.changes > 0 })
    },
  },
}
