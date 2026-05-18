/**
 * Build a SessionPermissionRequest from the live ToolPolicyRegistry.
 *
 * Server-side helper: collapses TOOL_POLICIES + the target/selector tables
 * into a versioned permission descriptor. Used by:
 *   - apps/web /sessions/permissions (page renders preview)
 *   - apps/web bootstrap path (informational; the EIP-712 signature still
 *     happens in bootstrapA2ASessionForUser using the same scope union).
 *
 * Note: this duplicates the union math that bootstrapA2ASessionForUser does
 * to compute caveats. Keep them in sync by re-using TOOL_POLICIES as the
 * single source of truth on both sides.
 */
import {
  toFunctionSelector,
  type AbiFunction,
  type Address,
  type Hex,
} from 'viem'
import {
  TOOL_POLICIES,
  POOL_REGISTRY_SELECTORS_BY_TOOL,
  FUND_REGISTRY_SELECTORS_BY_TOOL,
  AGENT_ACCOUNT_RESOLVER_SELECTORS_BY_TOOL,
  AGENT_RELATIONSHIP_SELECTORS_BY_TOOL,
  PROPOSAL_REGISTRY_SELECTORS_BY_TOOL,
  COMMITMENT_REGISTRY_SELECTORS_BY_TOOL,
  listAllowedTargetSymbols,
  resolveTargetAddress,
  isOnchainTool,
} from '../policy/tool-policies'
import {
  poolRegistryAbi,
  fundRegistryAbi,
  agentAccountFactoryAbi,
  agentAccountResolverAbi,
  agentRelationshipAbi,
  proposalRegistryAbi,
  commitmentRegistryAbi,
} from '../abi'
import type { SessionPermissionRequest } from './types'

export interface BuildSessionPermissionRequestInput {
  /** Catalog of env values that resolveTargetAddress consumes. Typically
   *  `process.env`, but explicit so the SDK isn't node-bound. */
  env: Record<string, string | undefined>
  /** Session duration in seconds. */
  durationSeconds: number
  /** Chain id the session binds to. */
  chainId: number
  /** Human-readable intent surfaced in the wallet-style prompt. */
  sessionIntent?: string
  /** Optional task group id; synthesized if absent. */
  taskGroupId?: string
}

type AbiByTarget = Record<string, readonly unknown[]>

const ABIS: AbiByTarget = {
  PoolRegistry: poolRegistryAbi as readonly unknown[],
  FundRegistry: fundRegistryAbi as readonly unknown[],
  AgentAccountFactory: agentAccountFactoryAbi as readonly unknown[],
  AgentAccountResolver: agentAccountResolverAbi as readonly unknown[],
  AgentRelationship: agentRelationshipAbi as readonly unknown[],
  ProposalRegistry: proposalRegistryAbi as readonly unknown[],
  CommitmentRegistry: commitmentRegistryAbi as readonly unknown[],
}

function selectorOf(target: string, functionName: string): Hex | null {
  const abi = ABIS[target]
  if (!abi) return null
  const fn = (abi as readonly AbiFunction[]).find(
    (it) => it && (it as AbiFunction).type === 'function' && (it as AbiFunction).name === functionName,
  )
  if (!fn) return null
  return toFunctionSelector(fn) as Hex
}

/**
 * Build the standard catalyst-network session permission request.
 *
 * The scope is the union of every TOOL_POLICY entry — same shape the root
 * delegation actually authorizes. This makes the preview a faithful
 * representation of what the user is about to sign.
 */
export function buildSessionPermissionRequest(
  input: BuildSessionPermissionRequestInput,
): SessionPermissionRequest {
  const { env, durationSeconds, chainId } = input
  const now = Math.floor(Date.now() / 1000)
  const expiresAtIso = new Date((now + durationSeconds) * 1000).toISOString()

  // Tool names — every policy, both mcp-only and on-chain. The MCP-only
  // tools still surface in the preview because the permission grant
  // also authorizes their off-chain execution under the same session
  // (verify-delegation.ts in each MCP).
  const mcpTools = Object.keys(TOOL_POLICIES).sort()

  // Targets — union of every on-chain target across policies, resolved
  // to addresses against env. Mirrors `computeAllowedTargetAddresses` in
  // a2a-session.action.ts.
  const targetSet = new Set<Address>()
  for (const sym of listAllowedTargetSymbols()) {
    const addr = resolveTargetAddress(sym, env)
    if (addr) targetSet.add(addr)
  }
  const factoryAddr = env.AGENT_FACTORY_ADDRESS as Address | undefined
  if (factoryAddr) targetSet.add(factoryAddr)
  const targets = Array.from(targetSet)

  // Selectors — union of every on-chain function name any policy may invoke.
  const selectorSet = new Set<Hex>()
  for (const [tool, fns] of Object.entries(POOL_REGISTRY_SELECTORS_BY_TOOL)) {
    if (!isOnchainTool(tool)) continue
    for (const fn of fns) {
      const sel = selectorOf('PoolRegistry', fn)
      if (sel) selectorSet.add(sel)
    }
  }
  for (const [tool, fns] of Object.entries(FUND_REGISTRY_SELECTORS_BY_TOOL)) {
    if (!isOnchainTool(tool)) continue
    for (const fn of fns) {
      const sel = selectorOf('FundRegistry', fn)
      if (sel) selectorSet.add(sel)
    }
  }
  // Bug fix: prior to this, AgentAccountResolver / AgentRelationship /
  // ProposalRegistry / CommitmentRegistry selectors were silently omitted
  // from the session permission scope, so any tool whose policy targets
  // those contracts failed with `selector 0x... not allowed` at the
  // AllowedMethodsEnforcer (e.g. relationship:emit_edge during hub-join).
  const EXTRA_TABLES: Array<[string, Record<string, string[]>]> = [
    ['AgentAccountResolver', AGENT_ACCOUNT_RESOLVER_SELECTORS_BY_TOOL],
    ['AgentRelationship', AGENT_RELATIONSHIP_SELECTORS_BY_TOOL],
    ['ProposalRegistry', PROPOSAL_REGISTRY_SELECTORS_BY_TOOL],
    ['CommitmentRegistry', COMMITMENT_REGISTRY_SELECTORS_BY_TOOL],
  ]
  for (const [target, table] of EXTRA_TABLES) {
    for (const [tool, fns] of Object.entries(table)) {
      if (!isOnchainTool(tool)) continue
      for (const fn of fns) {
        const sel = selectorOf(target, fn)
        if (sel) selectorSet.add(sel)
      }
    }
  }
  const createAccountSel = selectorOf('AgentAccountFactory', 'createAccount')
  if (createAccountSel) selectorSet.add(createAccountSel)
  const selectors = Array.from(selectorSet)

  const taskGroupId =
    input.taskGroupId ?? `session-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  return {
    schemaVersion: '1.0.0',
    sessionIntent:
      input.sessionIntent ??
      'Authorize your agent to act on community funding flows for the next session',
    taskGroupId,
    expiresAtIso,
    scope: {
      mcpTools,
      targets,
      selectors,
      maxValueWei: '0',
    },
    rules: {
      // Defaults match the Phase 1 caveat envelope. RateLimit on the root
      // delegation is deferred (Phase 2 follow-up), but we surface the
      // intended cap so the UI can preview it.
      rateLimit: { windowSeconds: 3600, maxCalls: 100 },
    },
    revocable: true,
    chainId,
  }
}
