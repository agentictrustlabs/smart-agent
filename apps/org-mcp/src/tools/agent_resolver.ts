/**
 * Phase 4 — AgentAccountResolver MCP tools.
 *
 * Routes web-side resolver writes through a2a-agent's stateless-redeem
 * path so the web app no longer holds the deployer wallet for these
 * flows. Same pattern as `rounds.ts` / `pools.ts`.
 *
 * Reads are direct against the public client; writes go through
 * `callA2aRedeem`. The TOOL_POLICIES registry must list each writing
 * tool with target=AgentAccountResolver + selectors register /
 * updateCore / setStringProperty / setAddressProperty /
 * addMultiStringProperty / clearMultiStringProperty /
 * addMultiAddressProperty.
 *
 * Tools registered:
 *   - agent_resolver:register             — register or updateCore + multi-properties
 *   - agent_resolver:set_address_property — setAddressProperty for any predicate
 *   - agent_resolver:read                 — getCore + selected multi/single properties
 *   - agent_resolver:read_address_property — getAddressProperty for one predicate
 */
import { encodeFunctionData, type Address, type Hex } from 'viem'
import { randomUUID } from 'node:crypto'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import {
  agentAccountResolverAbi,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT,
  CLASS_DISCOVERY, CLASS_VALIDATOR, CLASS_EXECUTOR, CLASS_ASSISTANT, CLASS_ORACLE, CLASS_CUSTOM,
  ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
  ATL_CONTROLLER,
} from '@smart-agent/sdk'
import { callA2aRedeem } from '../lib/a2a-client.js'
import { getPublicClient } from '../lib/contracts.js'

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

const AGENT_TYPE_MAP: Record<string, `0x${string}`> = {
  person: TYPE_PERSON as `0x${string}`,
  org: TYPE_ORGANIZATION as `0x${string}`,
  ai: TYPE_AI_AGENT as `0x${string}`,
}

const AI_CLASS_MAP: Record<string, `0x${string}`> = {
  discovery: CLASS_DISCOVERY as `0x${string}`,
  validator: CLASS_VALIDATOR as `0x${string}`,
  executor: CLASS_EXECUTOR as `0x${string}`,
  assistant: CLASS_ASSISTANT as `0x${string}`,
  oracle: CLASS_ORACLE as `0x${string}`,
  custom: CLASS_CUSTOM as `0x${string}`,
}

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function requireSessionId(args: { _a2aSessionId?: string }): string {
  const id = args._a2aSessionId
  if (!id || typeof id !== 'string') {
    throw new Error('missing _a2aSessionId — Phase 1 requires routing through a2a-agent mcp-proxy')
  }
  return id
}

function requireResolverAddress(): Address {
  const addr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  if (!addr) throw new Error('org-mcp: AGENT_ACCOUNT_RESOLVER_ADDRESS not set')
  return addr
}

interface RegisterArgs {
  token: string
  agentAddress: Address
  displayName: string
  description: string
  agentType: 'person' | 'org' | 'ai'
  aiAgentClass?: string
  capabilities?: string[]
  trustModels?: string[]
  a2aEndpoint?: string
  mcpServer?: string
  _a2aSessionId?: string
}

const registerTool = {
  name: 'agent_resolver:register',
  description:
    "Register an agent on AgentAccountResolver, or update its core metadata if already registered, then apply optional multi/single-string properties (capabilities, trustModels, a2aEndpoint, mcpServer). Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      agentAddress: { type: 'string' },
      displayName: { type: 'string' },
      description: { type: 'string' },
      agentType: { type: 'string', enum: ['person', 'org', 'ai'] },
      aiAgentClass: { type: 'string' },
      capabilities: { type: 'array', items: { type: 'string' } },
      trustModels: { type: 'array', items: { type: 'string' } },
      a2aEndpoint: { type: 'string' },
      mcpServer: { type: 'string' },
    },
    required: ['token', 'agentAddress', 'displayName', 'agentType'],
  },
  handler: async (args: RegisterArgs) => {
    await requireOrgPrincipal(args.token, args, 'agent_resolver:register')
    const sessionId = requireSessionId(args)
    const resolver = requireResolverAddress()
    const pub = getPublicClient()

    const agentType = AGENT_TYPE_MAP[args.agentType] ?? TYPE_PERSON
    const agentClass = args.aiAgentClass
      ? (AI_CLASS_MAP[args.aiAgentClass] ?? ZERO_BYTES32)
      : ZERO_BYTES32

    const isReg = await pub.readContract({
      address: resolver,
      abi: agentAccountResolverAbi,
      functionName: 'isRegistered',
      args: [args.agentAddress],
    }) as boolean

    const txs: Array<{ kind: string; txHash: Hex }> = []

    // 1. register / updateCore
    const coreData = isReg
      ? encodeFunctionData({
          abi: agentAccountResolverAbi,
          functionName: 'updateCore',
          args: [args.agentAddress, args.displayName, args.description ?? '', agentType, agentClass],
        })
      : encodeFunctionData({
          abi: agentAccountResolverAbi,
          functionName: 'register',
          args: [args.agentAddress, args.displayName, args.description ?? '', agentType, agentClass, ''],
        })
    const coreRes = await callA2aRedeem(sessionId, {
      mcpTool: 'agent_resolver:register',
      mcpCallId: randomUUID(),
      target: resolver,
      value: 0n,
      callData: coreData,
    })
    txs.push({ kind: isReg ? 'updateCore' : 'register', txHash: coreRes.txHash })

    // 2. Multi-string properties (capabilities / trustModels) — clear-then-add.
    const setMultiStrings = async (predicate: `0x${string}`, values: string[]) => {
      const clearData = encodeFunctionData({
        abi: agentAccountResolverAbi,
        functionName: 'clearMultiStringProperty',
        args: [args.agentAddress, predicate],
      })
      const clearRes = await callA2aRedeem(sessionId, {
        mcpTool: 'agent_resolver:register',
        mcpCallId: randomUUID(),
        target: resolver,
        value: 0n,
        callData: clearData,
      })
      txs.push({ kind: 'clearMulti', txHash: clearRes.txHash })
      for (const v of values) {
        if (!v.trim()) continue
        const addData = encodeFunctionData({
          abi: agentAccountResolverAbi,
          functionName: 'addMultiStringProperty',
          args: [args.agentAddress, predicate, v.trim()],
        })
        const r = await callA2aRedeem(sessionId, {
          mcpTool: 'agent_resolver:register',
          mcpCallId: randomUUID(),
          target: resolver,
          value: 0n,
          callData: addData,
        })
        txs.push({ kind: 'addMulti', txHash: r.txHash })
      }
    }
    if (args.capabilities && args.capabilities.length > 0) {
      await setMultiStrings(ATL_CAPABILITY as `0x${string}`, args.capabilities)
    }
    if (args.trustModels && args.trustModels.length > 0) {
      await setMultiStrings(ATL_SUPPORTED_TRUST as `0x${string}`, args.trustModels)
    }

    // 3. Single-string endpoint properties.
    const setStringProp = async (predicate: `0x${string}`, value: string) => {
      const d = encodeFunctionData({
        abi: agentAccountResolverAbi,
        functionName: 'setStringProperty',
        args: [args.agentAddress, predicate, value],
      })
      const r = await callA2aRedeem(sessionId, {
        mcpTool: 'agent_resolver:register',
        mcpCallId: randomUUID(),
        target: resolver,
        value: 0n,
        callData: d,
      })
      txs.push({ kind: 'setString', txHash: r.txHash })
    }
    if (args.a2aEndpoint) await setStringProp(ATL_A2A_ENDPOINT as `0x${string}`, args.a2aEndpoint)
    if (args.mcpServer)   await setStringProp(ATL_MCP_SERVER as `0x${string}`,   args.mcpServer)

    return mcpText({ ok: true as const, txs, agentAddress: args.agentAddress })
  },
}

interface SetStringPropertyArgs {
  token: string
  agentAddress: Address
  predicate: Hex
  value: string
  _a2aSessionId?: string
}

const setStringPropertyTool = {
  name: 'agent_resolver:set_string_property',
  description:
    "Set a typed string attribute on AgentAccountResolver (e.g. ATL_PRIMARY_NAME, ATL_NAME_LABEL). Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      agentAddress: { type: 'string' },
      predicate: { type: 'string' },
      value: { type: 'string' },
    },
    required: ['token', 'agentAddress', 'predicate', 'value'],
  },
  handler: async (args: SetStringPropertyArgs) => {
    await requireOrgPrincipal(args.token, args, 'agent_resolver:set_string_property')
    const sessionId = requireSessionId(args)
    const resolver = requireResolverAddress()
    const data = encodeFunctionData({
      abi: agentAccountResolverAbi,
      functionName: 'setStringProperty',
      args: [args.agentAddress, args.predicate, args.value],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'agent_resolver:set_string_property',
      mcpCallId: randomUUID(),
      target: resolver,
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

interface AddMultiAddressPropertyArgs {
  token: string
  agentAddress: Address
  predicate: Hex
  value: Address
  _a2aSessionId?: string
}

const addMultiAddressPropertyTool = {
  name: 'agent_resolver:add_multi_address_property',
  description:
    "Append an address to a multi-address property on AgentAccountResolver (e.g. ATL_CONTROLLER for adding a wallet to the controllers list). Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      agentAddress: { type: 'string' },
      predicate: { type: 'string' },
      value: { type: 'string' },
    },
    required: ['token', 'agentAddress', 'predicate', 'value'],
  },
  handler: async (args: AddMultiAddressPropertyArgs) => {
    await requireOrgPrincipal(args.token, args, 'agent_resolver:add_multi_address_property')
    const sessionId = requireSessionId(args)
    const resolver = requireResolverAddress()
    const data = encodeFunctionData({
      abi: agentAccountResolverAbi,
      functionName: 'addMultiAddressProperty',
      args: [args.agentAddress, args.predicate, args.value],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'agent_resolver:add_multi_address_property',
      mcpCallId: randomUUID(),
      target: resolver,
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

interface SetAddressPropertyArgs {
  token: string
  agentAddress: Address
  predicate: Hex
  value: Address
  _a2aSessionId?: string
}

const setAddressPropertyTool = {
  name: 'agent_resolver:set_address_property',
  description:
    "Set a typed address attribute on AgentAccountResolver (e.g. hasTreasury, hasController via the multi-property tool). Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      agentAddress: { type: 'string' },
      predicate: { type: 'string' },
      value: { type: 'string' },
    },
    required: ['token', 'agentAddress', 'predicate', 'value'],
  },
  handler: async (args: SetAddressPropertyArgs) => {
    await requireOrgPrincipal(args.token, args, 'agent_resolver:set_address_property')
    const sessionId = requireSessionId(args)
    const resolver = requireResolverAddress()
    const data = encodeFunctionData({
      abi: agentAccountResolverAbi,
      functionName: 'setAddressProperty',
      args: [args.agentAddress, args.predicate, args.value],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'agent_resolver:set_address_property',
      mcpCallId: randomUUID(),
      target: resolver,
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

interface ReadArgs {
  token: string
  agentAddress: Address
}

const readTool = {
  name: 'agent_resolver:read',
  description:
    "Read an agent's core record from AgentAccountResolver (displayName, description, agentType, agentClass, active, plus controllers and well-known string properties).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      agentAddress: { type: 'string' },
    },
    required: ['token', 'agentAddress'],
  },
  handler: async (args: ReadArgs) => {
    await requireOrgPrincipal(args.token, args, 'agent_resolver:read')
    const resolver = requireResolverAddress()
    const pub = getPublicClient()
    const [core, controllers, capabilities, trustModels, a2aEndpoint, mcpServer] = await Promise.all([
      pub.readContract({
        address: resolver, abi: agentAccountResolverAbi,
        functionName: 'getCore', args: [args.agentAddress],
      }).catch(() => null),
      pub.readContract({
        address: resolver, abi: agentAccountResolverAbi,
        functionName: 'getMultiAddressProperty',
        args: [args.agentAddress, ATL_CONTROLLER as `0x${string}`],
      }).catch(() => [] as readonly string[]),
      pub.readContract({
        address: resolver, abi: agentAccountResolverAbi,
        functionName: 'getMultiStringProperty',
        args: [args.agentAddress, ATL_CAPABILITY as `0x${string}`],
      }).catch(() => [] as readonly string[]),
      pub.readContract({
        address: resolver, abi: agentAccountResolverAbi,
        functionName: 'getMultiStringProperty',
        args: [args.agentAddress, ATL_SUPPORTED_TRUST as `0x${string}`],
      }).catch(() => [] as readonly string[]),
      pub.readContract({
        address: resolver, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [args.agentAddress, ATL_A2A_ENDPOINT as `0x${string}`],
      }).catch(() => ''),
      pub.readContract({
        address: resolver, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [args.agentAddress, ATL_MCP_SERVER as `0x${string}`],
      }).catch(() => ''),
    ])
    return mcpText({
      agentAddress: args.agentAddress,
      core,
      controllers,
      capabilities,
      trustModels,
      a2aEndpoint,
      mcpServer,
    })
  },
}

interface ReadAddressPropertyArgs {
  token: string
  agentAddress: Address
  predicate: Hex
}

const readAddressPropertyTool = {
  name: 'agent_resolver:read_address_property',
  description:
    "Read a typed address attribute on AgentAccountResolver (e.g. hasTreasury) for an agent.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      agentAddress: { type: 'string' },
      predicate: { type: 'string' },
    },
    required: ['token', 'agentAddress', 'predicate'],
  },
  handler: async (args: ReadAddressPropertyArgs) => {
    await requireOrgPrincipal(args.token, args, 'agent_resolver:read_address_property')
    const resolver = requireResolverAddress()
    const pub = getPublicClient()
    const value = await pub.readContract({
      address: resolver, abi: agentAccountResolverAbi,
      functionName: 'getAddressProperty',
      args: [args.agentAddress, args.predicate],
    }) as Address
    return mcpText({ agentAddress: args.agentAddress, predicate: args.predicate, value })
  },
}

export const agentResolverTools = {
  'agent_resolver:register': registerTool,
  'agent_resolver:set_string_property': setStringPropertyTool,
  'agent_resolver:set_address_property': setAddressPropertyTool,
  'agent_resolver:add_multi_address_property': addMultiAddressPropertyTool,
  'agent_resolver:read': readTool,
  'agent_resolver:read_address_property': readAddressPropertyTool,
}
