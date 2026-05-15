/**
 * Phase 4 — AgentAccountFactory.createAccount via MCP.
 *
 * Routes the smart-account deploy through a2a-agent's
 * `/session/:id/deploy-agent` endpoint so the web app no longer holds the
 * deployer wallet for this flow.
 *
 * Tool registered:
 *   - agent:deploy — deploy or return-already-deployed for (owner, salt).
 */
import { type Address } from 'viem'
import { randomUUID } from 'node:crypto'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { callA2aDeployAgent } from '../lib/a2a-client.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function requireSessionId(args: { _a2aSessionId?: string }): string {
  const id = args._a2aSessionId
  if (!id || typeof id !== 'string') {
    throw new Error('missing _a2aSessionId — Phase 1 requires routing through a2a-agent mcp-proxy')
  }
  return id
}

interface DeployArgs {
  token: string
  owner: Address
  /** Decimal or hex string for the salt. */
  salt: string
  _a2aSessionId?: string
}

const deployTool = {
  name: 'agent:deploy',
  description:
    "Deploy a smart account (AgentAccount) via AgentAccountFactory.createAccount, routed through a2a-agent's /session/:id/deploy-agent endpoint. Returns the (counterfactual) address — re-running on the same (owner, salt) is a no-op.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      owner: { type: 'string' },
      salt:  { type: 'string' },
    },
    required: ['token', 'owner', 'salt'],
  },
  handler: async (args: DeployArgs) => {
    await requireOrgPrincipal(args.token, args, 'agent:deploy')
    const sessionId = requireSessionId(args)
    const salt = args.salt.startsWith('0x') ? BigInt(args.salt) : BigInt(args.salt)
    const r = await callA2aDeployAgent(sessionId, {
      mcpCallId: randomUUID(),
      owner: args.owner,
      salt,
    })
    return mcpText({ ok: true as const, address: r.address, txHash: r.txHash })
  },
}

export const agentDeployTools = {
  'agent:deploy': deployTool,
}
