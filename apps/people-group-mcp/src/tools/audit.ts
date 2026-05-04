/**
 * Sponsor-only audit-log read (ADR-PG-6).
 *
 * Sponsor can read rows where principal == sponsor_principal.
 * Delegated readers cannot read the audit log even for their own accesses
 * (would expose other delegates' activity on the same data).
 * Curators cannot read T2 rows period.
 */

import { eq, and, gte, lte } from 'drizzle-orm'
import { db } from '../db/index.js'
import { pgAuditLog } from '../db/schema.js'
import { requirePrincipal, AuthError } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const auditTools = {
  list_audit_log: {
    name: 'list_audit_log',
    description:
      'Sponsor read of pg_audit_log. Returns rows where principal == caller principal. '
      + 'Filter by accessing_agent (incident review), since/until timestamps. '
      + 'NOT available via cross-delegation — sponsor only.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        accessingAgent: { type: 'string' },
        sinceISO: { type: 'string' },
        untilISO: { type: 'string' },
        includeArchived: { type: 'boolean' },
      },
      required: ['token'],
    },
    handler: async (args: {
      token: string
      accessingAgent?: string
      sinceISO?: string
      untilISO?: string
      includeArchived?: boolean
    }) => {
      let principal: string
      try {
        const ctx = await requirePrincipal({
          token: args.token, toolName: 'list_audit_log', argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      const wheres = [eq(pgAuditLog.principal, principal)]
      if (args.sinceISO) wheres.push(gte(pgAuditLog.at, args.sinceISO))
      if (args.untilISO) wheres.push(lte(pgAuditLog.at, args.untilISO))
      let rows = db.select().from(pgAuditLog).where(and(...wheres)).all()
      if (args.accessingAgent) {
        const a = args.accessingAgent.toLowerCase()
        rows = rows.filter(r => r.accessingAgent.toLowerCase() === a)
      }
      if (!args.includeArchived) {
        rows = rows.filter(r => !r.archivedAt)
      }
      // Order by at desc.
      rows.sort((a, b) => b.at.localeCompare(a.at))
      // Cap at 1000 rows; UI paginates by sinceISO/untilISO.
      return mcpText({ entries: rows.slice(0, 1000), truncated: rows.length > 1000 })
    },
  },
}
