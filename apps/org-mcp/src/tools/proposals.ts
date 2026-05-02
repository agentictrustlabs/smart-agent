import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { proposals } from '../db/schema.js'
import { requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const proposalsTools = {
  list_proposals: {
    name: 'list_proposals',
    description: 'List proposals for the authenticated org. On-chain governance is canonical; this is the off-chain detail cache.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, status: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string; status?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'list_proposals')
      let rows = db.select().from(proposals).where(eq(proposals.orgPrincipal, orgPrincipal)).all()
      if (args.status) rows = rows.filter(r => r.status === args.status)
      return mcpText({ proposals: rows })
    },
  },

  create_proposal: {
    name: 'create_proposal',
    description: 'Create a proposal record (off-chain detail). Caller is expected to also submit AgentControl.propose() on-chain.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        kind: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        proposerAgent: { type: 'string' },
        targetAddress: { type: 'string' },
        quorumRequired: { type: 'integer' },
      },
      required: ['token', 'kind', 'title'],
    },
    handler: async (args: {
      token: string
      kind: string
      title: string
      description?: string
      proposerAgent?: string
      targetAddress?: string
      quorumRequired?: number
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'create_proposal')
      const row = {
        id: randomUUID(),
        orgPrincipal,
        kind: args.kind,
        title: args.title,
        description: args.description ?? null,
        proposerAgent: args.proposerAgent ?? null,
        targetAddress: args.targetAddress ?? null,
        quorumRequired: args.quorumRequired ?? 2,
        votesFor: 0,
        votesAgainst: 0,
        status: 'open',
        onChainProposalId: null,
        executedAt: null,
        createdAt: new Date().toISOString(),
      }
      db.insert(proposals).values(row).run()
      return mcpText({ proposal: row })
    },
  },

  set_proposal_status: {
    name: 'set_proposal_status',
    description: 'Update a proposal\'s cached status (kept in sync with on-chain).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        status: { type: 'string' },
        votesFor: { type: 'integer' },
        votesAgainst: { type: 'integer' },
        onChainProposalId: { type: 'string' },
        executedAt: { type: 'string' },
      },
      required: ['token', 'id', 'status'],
    },
    handler: async (args: {
      token: string
      id: string
      status: string
      votesFor?: number
      votesAgainst?: number
      onChainProposalId?: string
      executedAt?: string
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'set_proposal_status')
      const updates: Record<string, string | number | null> = { status: args.status }
      if (args.votesFor !== undefined) updates.votesFor = args.votesFor
      if (args.votesAgainst !== undefined) updates.votesAgainst = args.votesAgainst
      if (args.onChainProposalId !== undefined) updates.onChainProposalId = args.onChainProposalId
      if (args.executedAt !== undefined) updates.executedAt = args.executedAt
      const r = db.update(proposals).set(updates)
        .where(and(eq(proposals.id, args.id), eq(proposals.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ updated: r.changes > 0 })
    },
  },
}
