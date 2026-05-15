/**
 * Phase 4 — FundRegistry read-only MCP tools.
 *
 * Used by web actions to look up round metadata via the MCP plane rather
 * than reading directly from chain. Lets the action layer ask "what's the
 * pool for this round" before composing a commitment or release. READ-only
 * tools — no a2a-redeem hop.
 *
 * Tools registered:
 *   - fund_registry:get_round_fund_agent  — fundAgent for a round
 *   - fund_registry:get_round_status      — current round status (CURIE label)
 *   - fund_registry:list_rounds_by_pool   — scan FundRegistry.allSubjects()
 *                                            and filter by poolAgent
 */
import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { fundRegistryAbi, roundSubjectFor } from '@smart-agent/sdk'
import { requireFundRegistryAddress, getPublicClient } from '../lib/contracts.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function slugOf(roundIdOrSubject: string): string {
  return roundIdOrSubject.startsWith('urn:smart-agent:round:')
    ? roundIdOrSubject.slice('urn:smart-agent:round:'.length)
    : roundIdOrSubject
}

function subjectOf(roundId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(roundId)) return roundId as Hex
  return roundSubjectFor(slugOf(roundId))
}

const STATUS_LABEL: Record<string, string> = {
  [keccak256(toHex('sa:RoundOpen')).toLowerCase()]:     'open',
  [keccak256(toHex('sa:RoundReview')).toLowerCase()]:   'review',
  [keccak256(toHex('sa:RoundDecided')).toLowerCase()]:  'decided',
  [keccak256(toHex('sa:RoundClosed')).toLowerCase()]:   'closed',
  [keccak256(toHex('sa:RoundCanceled')).toLowerCase()]: 'canceled',
}

// ─── Tool: fund_registry:get_round_fund_agent ──────────────────────────

const getRoundFundAgentTool = {
  name: 'fund_registry:get_round_fund_agent',
  description:
    "Read the fund agent (operator AgentAccount) for a round from FundRegistry.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:   { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'fund_registry:get_round_fund_agent')
    const target = requireFundRegistryAddress()
    const pub = getPublicClient()
    try {
      const fundAgent = await pub.readContract({
        address: target,
        abi: fundRegistryAbi,
        functionName: 'getRoundFundAgent',
        args: [subjectOf(args.roundId)],
      }) as Address
      return mcpText({ roundId: args.roundId, fundAgent })
    } catch (e) {
      return mcpText({ roundId: args.roundId, fundAgent: null, error: (e as Error).message })
    }
  },
}

// ─── Tool: fund_registry:get_round_status ──────────────────────────────

const getRoundStatusTool = {
  name: 'fund_registry:get_round_status',
  description: "Read the current status of a round from FundRegistry.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:   { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'fund_registry:get_round_status')
    const target = requireFundRegistryAddress()
    const pub = getPublicClient()
    try {
      const statusHash = await pub.readContract({
        address: target,
        abi: fundRegistryAbi,
        functionName: 'getRoundStatus',
        args: [subjectOf(args.roundId)],
      }) as Hex
      const label = STATUS_LABEL[statusHash.toLowerCase()] ?? 'unknown'
      return mcpText({ roundId: args.roundId, status: label, statusHash })
    } catch (e) {
      return mcpText({ roundId: args.roundId, status: null, error: (e as Error).message })
    }
  },
}

// ─── Tool: fund_registry:list_rounds_by_pool ───────────────────────────

const listRoundsByPoolTool = {
  name: 'fund_registry:list_rounds_by_pool',
  description:
    "Enumerate every round whose pool agent equals the given address. Scans FundRegistry.allSubjects() and filters by getRoundPoolAgent.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:     { type: 'string' },
      poolAgent: { type: 'string' },
      limit:     { type: 'integer' },
    },
    required: ['token', 'poolAgent'],
  },
  handler: async (args: { token: string; poolAgent: Address; limit?: number }) => {
    await requireOrgPrincipal(args.token, args, 'fund_registry:list_rounds_by_pool')
    const target = requireFundRegistryAddress()
    const pub = getPublicClient()
    const limit = args.limit ?? 50
    let subjects: Hex[] = []
    try {
      subjects = await pub.readContract({
        address: target, abi: fundRegistryAbi, functionName: 'allSubjects',
      }) as Hex[]
    } catch {
      return mcpText({ rounds: [] })
    }
    const wanted = args.poolAgent.toLowerCase()
    const rows: Array<{ roundSubject: Hex; slug: string; status: string; fundAgent: Address }> = []
    for (const subj of subjects) {
      try {
        const [poolAgent, fundAgent, slug, statusHash] = await Promise.all([
          pub.readContract({ address: target, abi: fundRegistryAbi, functionName: 'getRoundPoolAgent', args: [subj] }) as Promise<Address>,
          pub.readContract({ address: target, abi: fundRegistryAbi, functionName: 'getRoundFundAgent', args: [subj] }) as Promise<Address>,
          pub.readContract({ address: target, abi: fundRegistryAbi, functionName: 'getRoundSlug',     args: [subj] }) as Promise<string>,
          pub.readContract({ address: target, abi: fundRegistryAbi, functionName: 'getRoundStatus',   args: [subj] }) as Promise<Hex>,
        ])
        if ((poolAgent ?? '').toLowerCase() !== wanted) continue
        rows.push({
          roundSubject: subj,
          slug,
          status: STATUS_LABEL[(statusHash ?? '').toLowerCase()] ?? 'unknown',
          fundAgent,
        })
        if (rows.length >= limit) break
      } catch { /* skip */ }
    }
    void toBytes  // keep import used in some future-paths
    return mcpText({ rounds: rows })
  },
}

export const fundRegistryReadTools = {
  'fund_registry:get_round_fund_agent': getRoundFundAgentTool,
  'fund_registry:get_round_status': getRoundStatusTool,
  'fund_registry:list_rounds_by_pool': listRoundsByPoolTool,
}
