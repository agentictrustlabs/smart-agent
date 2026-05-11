/**
 * Spec 004 v2 — PoolPledge moved fully on chain (PledgeRegistry). The
 * person-mcp SQL mirror (`pool_pledges`) is dropped; donors call
 * org-mcp's pool_pledge:* tools, which redeem through the spec-004
 * chained delegation. Person-mcp keeps the tool names for ABI
 * back-compat, but every handler stubs to "moved on chain".
 */

import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

const movedOnChain = {
  ok: false as const,
  error: 'pool_pledge:* moved fully on chain (PledgeRegistry) in spec 004 v2. Use org-mcp pool_pledge:submit/amend/stop with the chained delegation; person-mcp no longer carries pool-pledge state.',
}

function makeStub(name: string) {
  return {
    name,
    description: `STUB — ${name} moved to org-mcp + PledgeRegistry on chain (spec 004 v2).`,
    inputSchema: { type: 'object' as const, properties: { token: { type: 'string' } }, required: ['token'] },
    handler: async (args: { token: string }) => {
      await requirePrincipal(args.token, name)
      return mcpText(movedOnChain)
    },
  }
}

export const poolPledgesTools = {
  'pool_pledge:submit':    makeStub('pool_pledge:submit'),
  'pool_pledge:amend':     makeStub('pool_pledge:amend'),
  'pool_pledge:stop':      makeStub('pool_pledge:stop'),
  'pool_pledge:auto_stop': makeStub('pool_pledge:auto_stop'),
  'pool_pledge:read_self': {
    name: 'pool_pledge:read_self',
    description: 'STUB — pool_pledge data on chain (PledgeRegistry); reads from GraphDB once R8 sync ships.',
    inputSchema: { type: 'object' as const, properties: { token: { type: 'string' } }, required: ['token'] },
    handler: async (args: { token: string }) => {
      await requirePrincipal(args.token, 'pool_pledge:read_self')
      return mcpText({ pledges: [] })
    },
  },
}
