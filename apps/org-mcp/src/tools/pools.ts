/**
 * Phase 1 — Pool MCP tools.
 *
 * On-chain writes are no longer signed by an org-mcp-held EOA. They are
 * forwarded to a2a-agent's `/session/:id/redeem-tx` endpoint (HMAC-authed
 * inter-service plane), where the user's signed root delegation is redeemed
 * via DelegationManager. Pool agent deploys go through
 * `/session/:id/deploy-agent`.
 *
 * Auth still has two layers:
 *   1. User-delegation token (existing) — proves the user authorized this MCP
 *      call. Verified by `requireOrgPrincipal` against the bearer's claims.
 *   2. Inter-service HMAC (Phase 1) — proves this MCP server is enrolled in
 *      the deployment. Performed inside `callA2aRedeem` against the
 *      A2A_INTERSERVICE_HMAC_KEY_ORG shared secret.
 *
 * The `_a2aSessionId` arg is injected by a2a-agent's mcp-proxy and tells
 * org-mcp which session to redeem against. MCP servers MUST NOT trust this
 * field if it arrives from any other plane.
 */
import {
  encodeFunctionData,
  keccak256,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { randomUUID } from 'node:crypto'
import {
  normalizeGovernance,
  poolRegistryAbi,
  PoolRegistryClient,
} from '@smart-agent/sdk'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { requirePoolRegistryAddress } from '../lib/contracts.js'
import { callA2aRedeem, callA2aDeployAgent, callA2aRedeemSubDelegated } from '../lib/a2a-client.js'

// Phase 2 — A2A task identifiers bind a sub-delegation to a single task
// lifecycle. The web action layer SHOULD pass a proper A2A taskId
// downstream; until that's wired we synthesize one from (mcpCallId, time)
// so each call still gets a unique task hash for the audit trail.
function generateTaskId(mcpCallId: string): string {
  return `a2a-task:${mcpCallId}:${Date.now()}`
}

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function requireA2aSessionId(args: { _a2aSessionId?: string }): string {
  const id = args._a2aSessionId
  if (!id || typeof id !== 'string') {
    throw new Error('missing _a2aSessionId — Phase 1 requires routing through a2a-agent mcp-proxy')
  }
  return id
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:create
// ───────────────────────────────────────────────────────────────────────

interface PoolCreateMandate {
  acceptedKinds: string[]
  acceptedGeo: string[]
  budgetCeiling?: number | null
  expectedAwards?: number | null
}

interface PoolCreateRestrictions {
  kinds?: string[]
  geoRoots?: string[]
  notForAdmin?: boolean
  notForDiscretionary?: boolean
}

interface PoolCreateArgs {
  token: string
  /** Canonical pool id slug (e.g. 'demo-trauma-care-pool'). */
  id: string
  /** Free-text domain slug (e.g. 'faith-network'). */
  domain: string
  governanceModel: 'fund' | 'coaching-network' | 'prayer-chain' | 'skills-bench' | 'hospitality-network'
  mandate: PoolCreateMandate
  acceptedRestrictions: PoolCreateRestrictions
  acceptedUnits: string[]
  acceptedKinds: string[]
  capacityCeiling?: number | null
  ceilingPolicy: 'block' | 'waitlist' | 'accept'
  visibility: 'public' | 'private'
  stewards: Address[]
  /** Reserved for the slim MCP counter row (private addressed-applicants list). */
  addressedMembers?: string[]
  /** Injected by a2a-agent mcp-proxy. */
  _a2aSessionId?: string
}

const createTool = {
  name: 'pool:create',
  description:
    "Deploy the pool's AgentAccount (treasury) and open the pool on chain via PoolRegistry.open. Both steps are redeemed through a2a-agent (single user root delegation, stateless-redeem path). Pool ownership is anchored to the user's AgentAccount.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      id: { type: 'string' },
      domain: { type: 'string' },
      governanceModel: { type: 'string' },
      mandate: { type: 'object' },
      acceptedRestrictions: { type: 'object' },
      acceptedUnits: { type: 'array', items: { type: 'string' } },
      acceptedKinds: { type: 'array', items: { type: 'string' } },
      capacityCeiling: { type: ['number', 'null'] },
      ceilingPolicy: { type: 'string', enum: ['block', 'waitlist', 'accept'] },
      visibility: { type: 'string', enum: ['public', 'private'] },
      stewards: { type: 'array', items: { type: 'string' } },
      addressedMembers: { type: 'array', items: { type: 'string' } },
    },
    required: [
      'token', 'id', 'domain', 'governanceModel', 'mandate',
      'acceptedRestrictions', 'acceptedUnits', 'acceptedKinds',
      'ceilingPolicy', 'visibility', 'stewards',
    ],
  },
  handler: async (args: PoolCreateArgs) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'pool:create')
    const sessionId = requireA2aSessionId(args)

    // Deterministic salt per pool id so the address is reproducible.
    const salt = BigInt(keccak256(toBytes(`pool:${args.id}`)))
    // Phase 1 — owner is the user's AgentAccount so the PoolRegistry's
    // onlyPoolOwner check passes when the redeem flows the call through
    // `_executeFromDelegator(rootDelegator = user's AgentAccount)`.
    const owner = orgPrincipal as Address
    const deploy = await callA2aDeployAgent(sessionId, {
      mcpCallId: randomUUID(),
      owner,
      salt,
    })
    const treasuryAddress = deploy.address

    const mandateJson = JSON.stringify({
      acceptedKinds: args.mandate.acceptedKinds,
      acceptedGeo: args.mandate.acceptedGeo,
      budgetCeiling: args.mandate.budgetCeiling ?? null,
      expectedAwards: args.mandate.expectedAwards ?? null,
      acceptedRestrictions: args.acceptedRestrictions,
    })
    const mandateHash = keccak256(toHex(mandateJson))

    const params = PoolRegistryClient.buildOpenParams({
      poolAgent: treasuryAddress,
      domain: args.domain,
      governanceModel: normalizeGovernance(args.governanceModel),
      mandateHash,
      mandateURI: '',
      acceptedUnits: args.acceptedUnits,
      acceptedKinds: args.mandate.acceptedKinds,
      ceilingPolicy: args.ceilingPolicy,
      capacityCeiling: args.capacityCeiling != null ? BigInt(args.capacityCeiling) : 0n,
      stewards: args.stewards,
      visibility: args.visibility,
      acceptedRestrictions: JSON.stringify(args.acceptedRestrictions ?? {}),
      slug: args.id,
    })
    const data = encodeFunctionData({
      abi: poolRegistryAbi,
      functionName: 'open',
      args: [params],
    })
    const redeem = await callA2aRedeem(sessionId, {
      mcpTool: 'pool:create',
      mcpCallId: randomUUID(),
      target: requirePoolRegistryAddress(),
      value: 0n,
      callData: data,
    })

    return mcpText({
      poolAgentId: `urn:smart-agent:pool:${args.id}`,
      treasuryAddress,
      txHash: redeem.txHash,
    })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:update_mandate
// ───────────────────────────────────────────────────────────────────────

interface UpdateMandateArgs {
  token: string
  poolAgent: Address
  newMandateHash: Hex
  newMandateURI?: string
  _a2aSessionId?: string
}

const updateMandateTool = {
  name: 'pool:update_mandate',
  description:
    "Update a pool's mandate hash (and optional URI) on chain via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgent: { type: 'string' },
      newMandateHash: { type: 'string' },
      newMandateURI: { type: 'string' },
    },
    required: ['token', 'poolAgent', 'newMandateHash'],
  },
  handler: async (args: UpdateMandateArgs) => {
    await requireOrgPrincipal(args.token, args, 'pool:update_mandate')
    const sessionId = requireA2aSessionId(args)
    const data = encodeFunctionData({
      abi: poolRegistryAbi,
      functionName: 'updateMandate',
      args: [args.poolAgent, args.newMandateHash, args.newMandateURI ?? ''],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'pool:update_mandate',
      mcpCallId: randomUUID(),
      target: requirePoolRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:rotate_stewards
// ───────────────────────────────────────────────────────────────────────

interface RotateStewardsArgs {
  token: string
  poolAgent: Address
  newStewards: Address[]
  _a2aSessionId?: string
}

const rotateStewardsTool = {
  name: 'pool:rotate_stewards',
  description:
    "Rotate the steward set on chain via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgent: { type: 'string' },
      newStewards: { type: 'array', items: { type: 'string' } },
    },
    required: ['token', 'poolAgent', 'newStewards'],
  },
  handler: async (args: RotateStewardsArgs) => {
    await requireOrgPrincipal(args.token, args, 'pool:rotate_stewards')
    const sessionId = requireA2aSessionId(args)
    const data = encodeFunctionData({
      abi: poolRegistryAbi,
      functionName: 'rotateStewards',
      args: [args.poolAgent, args.newStewards],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'pool:rotate_stewards',
      mcpCallId: randomUUID(),
      target: requirePoolRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:close
// ───────────────────────────────────────────────────────────────────────
// Phase 2 — sub-delegated path. Per ToolPolicyRegistry, `pool:close` is
// tier 'sensitive' with executionPath='sub-delegated'. a2a-agent mints a
// per-call D_sub (POOL_LIFECYCLE executor family) bound to (target,
// selector, value, callData, taskId, 60s window) and revokes it after
// submit.

interface CloseArgs {
  token: string
  poolAgent: Address
  a2aTaskId?: string
  _a2aSessionId?: string
}

const closeTool = {
  name: 'pool:close',
  description:
    "Close a pool on chain (sa:poolClosedAt). Routes via a2a-agent's sub-delegated path: per-call D_sub bound to the calldata hash + 60s window + POOL_LIFECYCLE executor, revoked after submit.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgent: { type: 'string' },
      a2aTaskId: { type: 'string' },
    },
    required: ['token', 'poolAgent'],
  },
  handler: async (args: CloseArgs) => {
    await requireOrgPrincipal(args.token, args, 'pool:close')
    const sessionId = requireA2aSessionId(args)
    const data = encodeFunctionData({
      abi: poolRegistryAbi,
      functionName: 'close',
      args: [args.poolAgent],
    })
    const mcpCallId = randomUUID()
    const r = await callA2aRedeemSubDelegated(sessionId, {
      mcpTool: 'pool:close',
      mcpCallId,
      a2aTaskId: args.a2aTaskId ?? generateTaskId(mcpCallId),
      target: requirePoolRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: pool:set_accepted_restrictions
// ───────────────────────────────────────────────────────────────────────

interface SetRestrictionsArgs {
  token: string
  poolAgent: Address
  restrictionsJson: string
  _a2aSessionId?: string
}

const setAcceptedRestrictionsTool = {
  name: 'pool:set_accepted_restrictions',
  description:
    "Persist the pool's accepted-restrictions JSON on chain via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgent: { type: 'string' },
      restrictionsJson: { type: 'string' },
    },
    required: ['token', 'poolAgent', 'restrictionsJson'],
  },
  handler: async (args: SetRestrictionsArgs) => {
    await requireOrgPrincipal(args.token, args, 'pool:set_accepted_restrictions')
    const sessionId = requireA2aSessionId(args)
    const data = encodeFunctionData({
      abi: poolRegistryAbi,
      functionName: 'setAcceptedRestrictions',
      args: [args.poolAgent, args.restrictionsJson],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'pool:set_accepted_restrictions',
      mcpCallId: randomUUID(),
      target: requirePoolRegistryAddress(),
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

export const poolsTools = {
  'pool:create': createTool,
  'pool:update_mandate': updateMandateTool,
  'pool:rotate_stewards': rotateStewardsTool,
  'pool:close': closeTool,
  'pool:set_accepted_restrictions': setAcceptedRestrictionsTool,
}
