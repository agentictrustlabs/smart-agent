/**
 * Spec 004 v2 — MatchInitiation moved fully on chain
 * (`MatchInitiationRegistry`). The person-mcp SQL mirror
 * (`match_initiations`) is dropped; org-mcp's
 * match_initiation:* tools own the on-chain write path. Person-mcp
 * keeps these tool names for ABI back-compat but stubs every handler
 * to "moved on chain".
 */

import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

const movedOnChain = {
  ok: false as const,
  error: 'match_initiation:* moved fully on chain (MatchInitiationRegistry) in spec 004 v2. Call org-mcp match_initiation:create instead.',
}

function makeStub(name: string) {
  return {
    name,
    description: `STUB — ${name} moved to org-mcp + MatchInitiationRegistry on chain (spec 004 v2).`,
    inputSchema: { type: 'object' as const, properties: { token: { type: 'string' } }, required: ['token'] },
    handler: async (args: { token: string }) => {
      await requirePrincipal(args.token, name)
      return mcpText(movedOnChain)
    },
  }
}

export const matchInitiationsTools = {
  'match_initiation:create':     makeStub('match_initiation:create'),
  'match_initiation:supersede':  makeStub('match_initiation:supersede'),
  'match_initiation:consume':    makeStub('match_initiation:consume'),
  'match_initiation:read': {
    name: 'match_initiation:read',
    description: 'STUB — match_initiation data on chain; reads from GraphDB once R8 sync ships.',
    inputSchema: { type: 'object' as const, properties: { token: { type: 'string' } }, required: ['token'] },
    handler: async (args: { token: string }) => {
      await requirePrincipal(args.token, 'match_initiation:read')
      return mcpText({ initiations: [] })
    },
  },
}
