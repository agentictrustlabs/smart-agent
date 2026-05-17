/**
 * Phase 1 — On-chain redeem endpoints (stateless-redeem path).
 *
 * These endpoints are how MCP servers ask a2a-agent to redeem the user's
 * signed root delegation on chain. They are the ONLY paths through which
 * a routine on-chain write (pool:create, pool:update_mandate, round:open,
 * round:set_status, etc.) reaches DelegationManager.redeemDelegation.
 *
 *   POST /session/:id/redeem-tx     — generic redeem of (target, value, callData)
 *   POST /session/:id/deploy-agent  — wrapper around AgentAccountFactory.createAccount
 *
 * Auth: HMAC inter-service signature (`requireInterServiceAuth`). MCPs sign
 * the request body with their shared secret; the path's :id binds the
 * signature to a specific session.
 *
 * Authorization (per request):
 *   1. Session must exist + be active + not expired.
 *   2. The requested `mcpTool` must have a TOOL_POLICIES entry whose
 *      executionPath is 'stateless-redeem'.
 *   3. The requested `target` must resolve to one of the policy's allowed
 *      target symbols (PoolRegistry / FundRegistry / AgentAccountFactory)
 *      via `resolveTargetAddress(env)`.
 *   4. The requested 4-byte selector must be in the policy's selector list
 *      (resolved at the boundary from the function name registry).
 *
 * Audit: one ExecutionReceipt row per call (apps/a2a-agent/db/execution_audit).
 *   - status='pending' at submit
 *   - status='denied' on policy violation (HTTP 403)
 *   - status='completed' + txHash on inclusion
 *   - status='reverted' + errorReason on revert
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  http,
  keccak256,
  toBytes,
  toFunctionSelector,
  type AbiFunction,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
// KMS K4 PR-1 — master EOA now routes through the signer wrapper. The
// surrounding viem call shape (walletClient.writeContract /
// signMessage / signTransaction) is unchanged — `getMasterSigner()`
// returns a viem `LocalAccount` indistinguishable from
// `privateKeyToAccount(...)`.
import { getMasterSigner } from '../auth/a2a-signer'
import { localhost } from 'viem/chains'
import {
  agentAccountAbi,
  buildCaveat,
  delegationManagerAbi,
  agentAccountFactoryAbi,
  poolRegistryAbi,
  fundRegistryAbi,
  hashDelegation,
  encodeTimestampTerms,
  encodeValueTerms,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  encodeTaskBindingTerms,
  encodeCallDataHashTerms,
  TOOL_POLICIES,
  POOL_REGISTRY_SELECTORS_BY_TOOL,
  FUND_REGISTRY_SELECTORS_BY_TOOL,
  AGENT_ACCOUNT_RESOLVER_SELECTORS_BY_TOOL,
  COMMITMENT_REGISTRY_SELECTORS_BY_TOOL,
  PROPOSAL_REGISTRY_SELECTORS_BY_TOOL,
  agentAccountResolverAbi,
  commitmentRegistryAbi,
  proposalRegistryAbi,
  resolveTargetAddress,
  type ToolPolicy,
} from '@smart-agent/sdk'
import { encodeFunctionData } from 'viem'
import { db } from '../db'
import { sessions, executionAudit } from '../db/schema'
import { config } from '../config'
import { requireInterServiceAuth } from '../auth/inter-service'
import { getExecutorForTool } from '../lib/tool-executors'
import { decryptSessionPackage } from '../auth/encryption'
import { auditFinalize, readCorrelationId, auditDeny } from '../lib/audit'

const onchainRedeem = new Hono()

// ─── Stored session-package shape ────────────────────────────────────
// Set by /session/package; same shape mcp-proxy decrypts.
interface StoredSessionPackage {
  sessionPrivateKey: `0x${string}`
  sessionKeyAddress: `0x${string}`
  delegation: {
    delegator: `0x${string}`
    delegate: `0x${string}`
    authority: `0x${string}`
    caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}`; args?: `0x${string}` }>
    salt: string
    signature: `0x${string}`
  }
  accountAddress: `0x${string}`
  expiresAt: string
}

interface RedeemTxBody {
  mcpTool: string
  mcpCallId: string
  a2aTaskId?: string
  target: Address
  /** Decimal string of wei. */
  value: string
  callData: Hex
}

interface DeployAgentBody {
  mcpCallId: string
  owner: Address
  /** Decimal string. */
  salt: string
}

const ABIS: Record<string, readonly unknown[]> = {
  PoolRegistry: poolRegistryAbi as readonly unknown[],
  FundRegistry: fundRegistryAbi as readonly unknown[],
  AgentAccountFactory: agentAccountFactoryAbi as readonly unknown[],
  AgentAccountResolver: agentAccountResolverAbi as readonly unknown[],
  CommitmentRegistry: commitmentRegistryAbi as readonly unknown[],
  ProposalRegistry: proposalRegistryAbi as readonly unknown[],
}

function selectorFor(target: keyof typeof ABIS, functionName: string): `0x${string}` {
  const abi = ABIS[target]
  if (!abi) throw new Error(`No ABI for target ${target}`)
  const fn = (abi as readonly AbiFunction[]).find(
    (it) => it && it.type === 'function' && it.name === functionName,
  )
  if (!fn) throw new Error(`ABI for ${target} is missing function "${functionName}"`)
  return toFunctionSelector(fn)
}

function policyAllowedSelectors(toolId: string, policy: ToolPolicy): Set<`0x${string}`> {
  const out = new Set<`0x${string}`>()
  // Function names for this tool, resolved against the per-target selector tables.
  const tryAdd = (target: keyof typeof ABIS, fns: string[] | undefined) => {
    if (!fns) return
    for (const fn of fns) {
      try {
        out.add(selectorFor(target, fn))
      } catch {
        /* skip — ABI missing the function */
      }
    }
  }
  if (policy.allowedTargets.includes('PoolRegistry')) {
    tryAdd('PoolRegistry', POOL_REGISTRY_SELECTORS_BY_TOOL[toolId])
  }
  if (policy.allowedTargets.includes('FundRegistry')) {
    tryAdd('FundRegistry', FUND_REGISTRY_SELECTORS_BY_TOOL[toolId])
  }
  if (policy.allowedTargets.includes('AgentAccountResolver')) {
    tryAdd('AgentAccountResolver', AGENT_ACCOUNT_RESOLVER_SELECTORS_BY_TOOL[toolId])
  }
  if (policy.allowedTargets.includes('CommitmentRegistry')) {
    tryAdd('CommitmentRegistry', COMMITMENT_REGISTRY_SELECTORS_BY_TOOL[toolId])
  }
  if (policy.allowedTargets.includes('ProposalRegistry')) {
    tryAdd('ProposalRegistry', PROPOSAL_REGISTRY_SELECTORS_BY_TOOL[toolId])
  }
  return out
}

function policyAllowedTargets(
  policy: ToolPolicy,
  env: Record<string, string | undefined>,
): Address[] {
  const out: Address[] = []
  for (const sym of policy.allowedTargets) {
    const addr = resolveTargetAddress(sym, env)
    if (addr) out.push(addr.toLowerCase() as Address)
  }
  return out
}

function getChain() {
  return { ...localhost, id: config.CHAIN_ID }
}

function rootGrantHashFromPkg(pkg: StoredSessionPackage): Hex {
  // EIP-712 delegation hash matches DelegationManager._hashDelegation.
  return hashDelegation(
    {
      delegator: pkg.delegation.delegator,
      delegate: pkg.delegation.delegate,
      authority: pkg.delegation.authority,
      caveats: pkg.delegation.caveats.map((c) => ({
        enforcer: c.enforcer,
        terms: c.terms,
      })),
      salt: pkg.delegation.salt,
    },
    config.CHAIN_ID,
    config.DELEGATION_MANAGER_ADDRESS,
  )
}

async function loadActiveSessionPackage(
  sessionId: string,
): Promise<{ pkg: StoredSessionPackage; row: typeof sessions.$inferSelect } | { error: string; status: 400 | 401 | 404 }> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!row) return { error: 'session not found', status: 404 }
  if (row.status !== 'active') return { error: `session not active (status=${row.status})`, status: 401 }
  if (new Date(row.expiresAt) < new Date()) return { error: 'session expired', status: 401 }
  if (!row.encryptedPackage || !row.iv) return { error: 'session missing encrypted package', status: 400 }
  // KMS migration K0+K1 — `decryptSessionPackage` binds AAD on both the
  // KMS provider's aadContext and the AES-GCM additionalData (Hardening
  // §1.5 #8 trip-wire preserved). Pre-existing legacy rows route via the
  // 'legacy' keyVersion fallback.
  const pkg = await decryptSessionPackage<StoredSessionPackage>(
    {
      encryptedPackage: row.encryptedPackage,
      iv: row.iv,
      encryptedDataKey: row.encryptedDataKey,
      keyVersion: row.keyVersion,
      kmsKeyId: row.kmsKeyId,
    },
    {
      sessionId: row.id,
      accountAddress: row.accountAddress,
      chainId: config.CHAIN_ID,
      expiresAt: row.expiresAt,
    },
  )
  return { pkg, row }
}

function extractSelector(callData: Hex): `0x${string}` {
  if (typeof callData !== 'string' || !callData.startsWith('0x') || callData.length < 10) {
    throw new Error('callData too short to extract selector')
  }
  return callData.slice(0, 10).toLowerCase() as `0x${string}`
}

// ─── POST /session/:id/redeem-tx ─────────────────────────────────────
onchainRedeem.post('/:id/redeem-tx', requireInterServiceAuth(), async (c) => {
  const sessionId = c.req.param('id')
  const ctx = c.get('interService' as never) as { service: string; bodyRaw: string } | undefined
  const bodyRaw = ctx?.bodyRaw ?? (await c.req.text())
  const mcpServer = ctx?.service ?? 'unknown'
  let body: RedeemTxBody
  try {
    body = JSON.parse(bodyRaw) as RedeemTxBody
  } catch {
    await auditDeny(c, {
      route: '/session/:id/redeem-tx',
      executionPath: 'stateless-redeem',
      sessionId,
      mcpServer,
      reason: 'invalid JSON body',
    })
    return c.json({ error: 'invalid JSON body' }, 400)
  }

  // ─── Policy lookup ─────────────────────────────────────────────────
  const policy = TOOL_POLICIES[body.mcpTool]
  if (!policy) {
    await auditDeny(c, {
      route: '/session/:id/redeem-tx',
      executionPath: 'stateless-redeem',
      sessionId,
      mcpServer,
      reason: `unknown tool: ${body.mcpTool}`,
      mcpCallId: body.mcpCallId,
    })
    return c.json({ error: `unknown tool: ${body.mcpTool}` }, 403)
  }
  if (policy.executionPath !== 'stateless-redeem') {
    await auditDeny(c, {
      route: '/session/:id/redeem-tx',
      executionPath: 'stateless-redeem',
      sessionId,
      mcpServer,
      reason: `tool ${body.mcpTool} requires path ${policy.executionPath}, not stateless-redeem`,
      mcpCallId: body.mcpCallId,
    })
    return c.json({ error: `tool ${body.mcpTool} requires path ${policy.executionPath}, not stateless-redeem` }, 403)
  }

  // ─── Resolve session ───────────────────────────────────────────────
  const sess = await loadActiveSessionPackage(sessionId)
  if ('error' in sess) {
    await auditDeny(c, {
      route: '/session/:id/redeem-tx',
      executionPath: 'stateless-redeem',
      sessionId,
      mcpServer,
      reason: sess.error,
      mcpCallId: body.mcpCallId,
    })
    return c.json({ error: sess.error }, sess.status)
  }
  const { pkg } = sess

  // ─── Validate target / selector against policy ────────────────────
  const env = process.env as Record<string, string | undefined>
  const allowedTargets = policyAllowedTargets(policy, env)
  const targetLower = body.target.toLowerCase() as Address
  if (!allowedTargets.includes(targetLower)) {
    await writeReceipt({
      c,
      pkg,
      sessionId,
      mcpServer,
      body,
      executionPath: 'stateless-redeem',
      status: 'denied',
      errorReason: `target ${body.target} not in policy allowed targets`,
    })
    return c.json({ error: `target not allowed for ${body.mcpTool}` }, 403)
  }

  let selector: `0x${string}`
  try {
    selector = extractSelector(body.callData)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
  const allowedSelectors = policyAllowedSelectors(body.mcpTool, policy)
  if (!allowedSelectors.has(selector)) {
    await writeReceipt({
      c,
      pkg,
      sessionId,
      mcpServer,
      body,
      executionPath: 'stateless-redeem',
      status: 'denied',
      errorReason: `selector ${selector} not in policy allowed selectors`,
    })
    return c.json({ error: `selector ${selector} not allowed for ${body.mcpTool}` }, 403)
  }

  // ─── Enforce policy.maxValueWei (off-chain twin of ValueEnforcer) ──
  // The ToolPolicy carries a per-tool wei cap. Until now it was only
  // declared, never read by redeem handlers. Defense in depth — the
  // on-chain ValueEnforcer also bounds value via the user's signed
  // delegation, but policy.maxValueWei reflects the operator's intent.
  {
    const requestedValue = BigInt(body.value)
    if (policy.maxValueWei !== undefined && requestedValue > policy.maxValueWei) {
      await writeReceipt({
        c,
        pkg,
        sessionId,
        mcpServer,
        body,
        executionPath: 'stateless-redeem',
        status: 'denied',
        errorReason: `value ${requestedValue} exceeds tool maxValueWei ${policy.maxValueWei}`,
      })
      return c.json({ error: `value ${requestedValue} exceeds tool maxValueWei ${policy.maxValueWei}` }, 400)
    }
  }

  // ─── Insert pending receipt ────────────────────────────────────────
  const receiptId = await writeReceipt({
    c,
    pkg,
    sessionId,
    mcpServer,
    body,
    executionPath: 'stateless-redeem',
    status: 'pending',
  })

  // ─── Submit redeem ─────────────────────────────────────────────────
  try {
    const sessionAccount = privateKeyToAccount(pkg.sessionPrivateKey)
    const wallet = createWalletClient({
      account: sessionAccount,
      chain: getChain(),
      transport: http(config.RPC_URL),
    })
    const pub = createPublicClient({ chain: getChain(), transport: http(config.RPC_URL) })

    // Rehydrate the stored delegation into the redeem struct.
    const struct = {
      delegator: pkg.delegation.delegator,
      delegate: pkg.delegation.delegate,
      authority: pkg.delegation.authority,
      caveats: pkg.delegation.caveats.map((c) => ({
        enforcer: c.enforcer,
        terms: c.terms,
        args: (c.args ?? '0x') as Hex,
      })),
      salt: BigInt(pkg.delegation.salt),
      signature: pkg.delegation.signature,
    }
    const valueWei = BigInt(body.value)

    const txHash = await wallet.writeContract({
      address: config.DELEGATION_MANAGER_ADDRESS,
      abi: delegationManagerAbi,
      functionName: 'redeemDelegation',
      args: [[struct], body.target, valueWei, body.callData],
      account: sessionAccount,
      chain: wallet.chain ?? null,
    })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    const ok = receipt.status === 'success'

    await auditFinalize(receiptId, {
      status: ok ? 'completed' : 'reverted',
      txHash,
      errorReason: ok ? '' : 'transaction reverted',
    })

    if (!ok) return c.json({ error: 'tx reverted', txHash, executionReceiptId: receiptId }, 502)
    return c.json({ txHash, executionReceiptId: receiptId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditFinalize(receiptId, { status: 'reverted', errorReason: msg.slice(0, 1000) })
    return c.json({ error: `redeem failed: ${msg}` }, 500)
  }
})

// ─── POST /session/:id/deploy-agent ──────────────────────────────────
onchainRedeem.post('/:id/deploy-agent', requireInterServiceAuth(), async (c) => {
  const sessionId = c.req.param('id')
  const ctx = c.get('interService' as never) as { service: string; bodyRaw: string } | undefined
  const bodyRaw = ctx?.bodyRaw ?? (await c.req.text())
  let body: DeployAgentBody
  try {
    body = JSON.parse(bodyRaw) as DeployAgentBody
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  const mcpServer = ctx?.service ?? 'unknown'

  const sess = await loadActiveSessionPackage(sessionId)
  if ('error' in sess) return c.json({ error: sess.error }, sess.status)
  const { pkg } = sess

  const factory = process.env.AGENT_FACTORY_ADDRESS as Address | undefined
  if (!factory) return c.json({ error: 'AGENT_FACTORY_ADDRESS not set on a2a-agent' }, 500)

  // Audit prefill — best-effort selector capture.
  let selectorHex: Hex | null = null
  try {
    selectorHex = selectorFor('AgentAccountFactory', 'createAccount')
  } catch { /* non-fatal */ }

  const callDataPreviewHash: Hex = keccak256(toBytes(`deploy-agent:${body.owner}:${body.salt}`))

  const receiptId = await writeReceipt({
    c,
    pkg,
    sessionId,
    mcpServer,
    body: {
      mcpTool: 'deploy-agent',
      mcpCallId: body.mcpCallId,
      a2aTaskId: '',
      target: factory,
      value: '0',
      callData: '0x' as Hex,
    },
    executionPath: 'stateless-redeem',
    status: 'pending',
    overrideSelector: selectorHex,
    overrideCallDataHash: callDataPreviewHash,
  })

  try {
    const sessionAccount = privateKeyToAccount(pkg.sessionPrivateKey)
    const wallet = createWalletClient({
      account: sessionAccount,
      chain: getChain(),
      transport: http(config.RPC_URL),
    })
    const pub = createPublicClient({ chain: getChain(), transport: http(config.RPC_URL) })

    const salt = BigInt(body.salt)
    const txHash = await wallet.writeContract({
      address: factory,
      abi: agentAccountFactoryAbi,
      functionName: 'createAccount',
      args: [body.owner, salt],
      account: sessionAccount,
      chain: wallet.chain ?? null,
    })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })

    const deployedAddress = await pub.readContract({
      address: factory,
      abi: agentAccountFactoryAbi,
      functionName: 'getAddress',
      args: [body.owner, salt],
    }) as Address

    const ok = receipt.status === 'success'
    await auditFinalize(receiptId, {
      status: ok ? 'completed' : 'reverted',
      txHash,
      errorReason: ok ? '' : 'transaction reverted',
    })

    if (!ok) return c.json({ error: 'tx reverted', txHash, executionReceiptId: receiptId }, 502)
    return c.json({ address: deployedAddress, txHash, executionReceiptId: receiptId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditFinalize(receiptId, { status: 'reverted', errorReason: msg.slice(0, 1000) })
    return c.json({ error: `deploy-agent failed: ${msg}` }, 500)
  }
})

// ─── POST /session/:id/redeem-with-chain ─────────────────────────────
//
// Spec 004 (auth-model b2) — chained redeem for marketplace tools.
//
// Where `/redeem-tx` redeems `pkg.delegation` directly (msg.sender at the
// target = the session's account holder), `/redeem-with-chain` ignores
// `pkg.delegation` and redeems a caller-supplied chain. The leaf of the
// chain MUST have `delegate == sessionKeyAddress` so DelegationManager
// accepts the redeemer.
//
// Typical chain at credential issuance time:
//   chain = [
//     {                                    // D_admin_holder (signed by admin AA)
//       delegator: admin AgentAccount,
//       delegate:  holder AgentAccount,
//       authority: ROOT,
//       caveats:   [AllowedTargets([GrantProposalRegistry]),
//                   AllowedMethods([submit,edit,withdraw])],
//       …
//     },
//     {                                    // D_holder_session (freshly minted)
//       delegator: holder AgentAccount,
//       delegate:  sessionKeyAddress,
//       authority: hash(D_admin_holder),
//       caveats:   [Timestamp(short)],
//       …
//     },
//   ]
//
// At dispatch, DelegationManager walks the chain root-down, ending at
// `admin.execute(target, value, callData)`. msg.sender at the registry =
// admin AgentAccount, so `_isAccountOwner(fundAgent, msg.sender)` passes
// (admin is registered as owner of fund/pool via the standard
// pool:create / fund:open path).
//
// Auth: HMAC inter-service (same as the other endpoints).
// Authorization: TOOL_POLICIES target/selector gate (defense in depth);
// the rest of the chain's caveats already constrain on chain.
interface ChainCaveat {
  enforcer: `0x${string}`
  terms: `0x${string}`
  args?: `0x${string}`
}
interface ChainDelegationStruct {
  delegator: `0x${string}`
  delegate: `0x${string}`
  authority: `0x${string}`
  caveats: ChainCaveat[]
  salt: string
  signature: `0x${string}`
}
interface RedeemWithChainBody {
  mcpTool: string
  mcpCallId: string
  a2aTaskId?: string
  target: Address
  value: string
  callData: Hex
  chain: ChainDelegationStruct[]
}

onchainRedeem.post('/:id/redeem-with-chain', requireInterServiceAuth(), async (c) => {
  const sessionId = c.req.param('id')
  const ctx = c.get('interService' as never) as { service: string; bodyRaw: string } | undefined
  const bodyRaw = ctx?.bodyRaw ?? (await c.req.text())
  let body: RedeemWithChainBody
  try {
    body = JSON.parse(bodyRaw) as RedeemWithChainBody
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  const mcpServer = ctx?.service ?? 'unknown'

  if (!Array.isArray(body.chain) || body.chain.length === 0) {
    return c.json({ error: 'chain must be a non-empty array of signed delegations' }, 400)
  }

  // Policy lookup — same gate as redeem-tx (defense in depth).
  const policy = TOOL_POLICIES[body.mcpTool]
  if (!policy) {
    return c.json({ error: `unknown tool: ${body.mcpTool}` }, 403)
  }
  if (policy.executionPath !== 'stateless-redeem') {
    return c.json({ error: `tool ${body.mcpTool} requires path ${policy.executionPath}, not stateless-redeem` }, 403)
  }

  // Resolve session.
  const sess = await loadActiveSessionPackage(sessionId)
  if ('error' in sess) return c.json({ error: sess.error }, sess.status)
  const { pkg } = sess

  // Chain ordering: DelegationManager expects [leaf, …, root] — index 0
  // is the LEAF, which must delegate to the session key (the EOA we sign
  // the redeem tx with). The previous chain[last] check was backwards.
  const leaf = body.chain[0]
  if (leaf.delegate.toLowerCase() !== pkg.sessionKeyAddress.toLowerCase()) {
    return c.json({
      error: `chain leaf delegate (${leaf.delegate}) must equal session key (${pkg.sessionKeyAddress})`,
    }, 400)
  }

  // Validate target / selector against policy (defense in depth — the
  // chain's own caveats already constrain on chain).
  const env = process.env as Record<string, string | undefined>
  const allowedTargets = policyAllowedTargets(policy, env)
  const targetLower = body.target.toLowerCase() as Address
  if (!allowedTargets.includes(targetLower)) {
    return c.json({ error: `target not allowed for ${body.mcpTool}` }, 403)
  }
  let selector: `0x${string}`
  try {
    selector = extractSelector(body.callData)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
  const allowedSelectors = policyAllowedSelectors(body.mcpTool, policy)
  if (!allowedSelectors.has(selector)) {
    return c.json({ error: `selector ${selector} not allowed for ${body.mcpTool}` }, 403)
  }

  // Enforce policy.maxValueWei (off-chain twin of ValueEnforcer).
  {
    const requestedValue = BigInt(body.value)
    if (policy.maxValueWei !== undefined && requestedValue > policy.maxValueWei) {
      await writeReceipt({
        c,
        pkg,
        sessionId,
        mcpServer,
        body: {
          mcpTool: body.mcpTool,
          mcpCallId: body.mcpCallId,
          a2aTaskId: body.a2aTaskId ?? '',
          target: body.target,
          value: body.value,
          callData: body.callData,
        },
        executionPath: 'stateless-redeem',
        status: 'denied',
        errorReason: `value ${requestedValue} exceeds tool maxValueWei ${policy.maxValueWei}`,
      })
      return c.json({ error: `value ${requestedValue} exceeds tool maxValueWei ${policy.maxValueWei}` }, 400)
    }
  }

  // Receipt.
  const receiptId = await writeReceipt({
    c,
    pkg,
    sessionId,
    mcpServer,
    body: {
      mcpTool: body.mcpTool,
      mcpCallId: body.mcpCallId,
      a2aTaskId: body.a2aTaskId ?? '',
      target: body.target,
      value: body.value,
      callData: body.callData,
    },
    executionPath: 'stateless-redeem',
    status: 'pending',
  })

  // Submit DelegationManager.redeemDelegation(chain, target, value, callData)
  // — signed by the session key. The on-chain validators run for each
  // chain element; the leaf's delegate-msg.sender check uses the session
  // key (which we just confirmed matches above).
  try {
    const sessionAccount = privateKeyToAccount(pkg.sessionPrivateKey)
    const wallet = createWalletClient({
      account: sessionAccount,
      chain: getChain(),
      transport: http(config.RPC_URL),
    })
    const pub = createPublicClient({ chain: getChain(), transport: http(config.RPC_URL) })

    const structs = body.chain.map((d) => ({
      delegator: d.delegator,
      delegate: d.delegate,
      authority: d.authority,
      caveats: d.caveats.map((cav) => ({
        enforcer: cav.enforcer,
        terms: cav.terms,
        args: (cav.args ?? '0x') as Hex,
      })),
      salt: BigInt(d.salt),
      signature: d.signature,
    }))
    const valueWei = BigInt(body.value)

    const txHash = await wallet.writeContract({
      address: config.DELEGATION_MANAGER_ADDRESS,
      abi: delegationManagerAbi,
      functionName: 'redeemDelegation',
      args: [structs, body.target, valueWei, body.callData],
      account: sessionAccount,
      chain: wallet.chain ?? null,
    })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    const ok = receipt.status === 'success'

    await auditFinalize(receiptId, {
      status: ok ? 'completed' : 'reverted',
      txHash,
      errorReason: ok ? '' : 'transaction reverted',
    })

    if (!ok) return c.json({ error: 'tx reverted', txHash, executionReceiptId: receiptId }, 502)
    return c.json({ txHash, executionReceiptId: receiptId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditFinalize(receiptId, { status: 'reverted', errorReason: msg.slice(0, 1000) })
    return c.json({ error: `redeem-with-chain failed: ${msg}` }, 500)
  }
})

// ─── POST /session/:id/redeem-subdelegated ───────────────────────────
//
// Phase 2 — sub-delegated execution path for sensitive-tier tools.
//
// Flow per call:
//   1. Validate the requested tool's policy is `executionPath='sub-delegated'`.
//   2. Validate target/selector match the policy (defense in depth — same
//      gate that the user's root delegation already enforces on-chain).
//   3. Resolve the per-tool executor identity from
//      `getExecutorForTool(toolId)`. This is the LEAF delegate of D_sub.
//   4. Mint D_sub:
//        delegator = sessionKeyAddress    (the LEAF of D_root)
//        delegate  = executor.address
//        authority = hash(D_root)
//        caveats   = [
//          Timestamp(now, now + 60s),                       // tight window
//          AllowedTargets([target]),
//          AllowedMethods([selector]),
//          Value(callValueWei),
//          CallDataHashEnforcer(keccak256(callData)),       // runtime gate
//          TaskBindingEnforcer(keccak256(toBytes(taskId))), // audit tag
//        ]
//      Signed with sessionPrivateKey (ECDSA over hashDelegation, which the
//      DelegationManager._validateSignature verifies for EOA delegators).
//   5. Build the redeem chain [D_sub, D_root] and submit
//      DelegationManager.redeemDelegation as msg.sender = executor.address.
//   6. Best-effort revoke hash(D_sub) immediately after submit from the
//      session key (matches the user's delegator authority chain — see
//      gotcha note in phase2-delegation-summary.md).
//   7. Audit row: executionPath='sub-delegated', toolGrantHash=hash(D_sub),
//      toolExecutor=executor.address, plus the standard root/session
//      metadata.
//
// On any error before submit, audit row is written with status='denied'
// + errorReason. On revert, status='reverted'.
onchainRedeem.post('/:id/redeem-subdelegated', requireInterServiceAuth(), async (c) => {
  const sessionId = c.req.param('id')
  const ctx = c.get('interService' as never) as { service: string; bodyRaw: string } | undefined
  const bodyRaw = ctx?.bodyRaw ?? (await c.req.text())
  let body: RedeemTxBody
  try {
    body = JSON.parse(bodyRaw) as RedeemTxBody
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  const mcpServer = ctx?.service ?? 'unknown'

  // ─── Policy lookup ─────────────────────────────────────────────────
  const policy = TOOL_POLICIES[body.mcpTool]
  if (!policy) {
    return c.json({ error: `unknown tool: ${body.mcpTool}` }, 403)
  }
  if (policy.executionPath !== 'sub-delegated') {
    return c.json(
      { error: `tool ${body.mcpTool} requires path ${policy.executionPath}, not sub-delegated` },
      403,
    )
  }
  if (!body.a2aTaskId || body.a2aTaskId.length === 0) {
    return c.json({ error: 'a2aTaskId is required for sub-delegated path' }, 400)
  }

  // ─── Resolve session ───────────────────────────────────────────────
  const sess = await loadActiveSessionPackage(sessionId)
  if ('error' in sess) return c.json({ error: sess.error }, sess.status)
  const { pkg } = sess

  // ─── Validate target / selector against policy ────────────────────
  const env = process.env as Record<string, string | undefined>
  const allowedTargets = policyAllowedTargets(policy, env)
  const targetLower = body.target.toLowerCase() as Address
  if (!allowedTargets.includes(targetLower)) {
    await writeReceipt({
      c,
      pkg,
      sessionId,
      mcpServer,
      body,
      executionPath: 'sub-delegated',
      status: 'denied',
      errorReason: `target ${body.target} not in policy allowed targets`,
    })
    return c.json({ error: `target not allowed for ${body.mcpTool}` }, 403)
  }

  let selector: `0x${string}`
  try {
    selector = extractSelector(body.callData)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
  const allowedSelectors = policyAllowedSelectors(body.mcpTool, policy)
  if (!allowedSelectors.has(selector)) {
    await writeReceipt({
      c,
      pkg,
      sessionId,
      mcpServer,
      body,
      executionPath: 'sub-delegated',
      status: 'denied',
      errorReason: `selector ${selector} not in policy allowed selectors`,
    })
    return c.json({ error: `selector ${selector} not allowed for ${body.mcpTool}` }, 403)
  }

  // ─── Enforce policy.maxValueWei (off-chain twin of ValueEnforcer) ──
  {
    const requestedValue = BigInt(body.value)
    if (policy.maxValueWei !== undefined && requestedValue > policy.maxValueWei) {
      await writeReceipt({
        c,
        pkg,
        sessionId,
        mcpServer,
        body,
        executionPath: 'sub-delegated',
        status: 'denied',
        errorReason: `value ${requestedValue} exceeds tool maxValueWei ${policy.maxValueWei}`,
      })
      return c.json({ error: `value ${requestedValue} exceeds tool maxValueWei ${policy.maxValueWei}` }, 400)
    }
  }

  // ─── Resolve executor identity ─────────────────────────────────────
  // K5 — `getExecutorForTool` now returns a viem `LocalAccount` backed
  // by either the dev hex key (local-aes) or the per-tool AWS KMS key
  // (aws-kms). The `account` field replaces the legacy
  // `privateKeyToAccount(executor.privateKey)` construction below.
  let executor: Awaited<ReturnType<typeof getExecutorForTool>>
  try {
    executor = await getExecutorForTool(body.mcpTool)
  } catch (e) {
    await writeReceipt({
      c,
      pkg,
      sessionId,
      mcpServer,
      body,
      executionPath: 'sub-delegated',
      status: 'denied',
      errorReason: (e as Error).message,
    })
    return c.json({ error: (e as Error).message }, 500)
  }

  // ─── Mint + sign D_sub ─────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000)
  const windowEnd = now + 60 // 60-second tight window
  const valueWei = BigInt(body.value)
  const callDataHash = keccak256(body.callData)
  const taskIdHash = keccak256(toBytes(body.a2aTaskId))

  const subCaveats = [
    buildCaveat(config.TIMESTAMP_ENFORCER_ADDRESS, encodeTimestampTerms(now, windowEnd)),
    buildCaveat(config.ALLOWED_TARGETS_ENFORCER_ADDRESS, encodeAllowedTargetsTerms([body.target])),
    buildCaveat(config.ALLOWED_METHODS_ENFORCER_ADDRESS, encodeAllowedMethodsTerms([selector])),
    buildCaveat(config.VALUE_ENFORCER_ADDRESS, encodeValueTerms(valueWei)),
    buildCaveat(config.CALLDATA_HASH_ENFORCER_ADDRESS, encodeCallDataHashTerms(callDataHash)),
    buildCaveat(config.TASK_BINDING_ENFORCER_ADDRESS, encodeTaskBindingTerms(taskIdHash)),
  ]

  // D_root.delegator -> D_root.delegate (= sessionKeyAddress).
  // D_sub.delegator = sessionKeyAddress, D_sub.delegate = executor.address,
  // authority = hash(D_root).
  const rootHash = rootGrantHashFromPkg(pkg)
  const subSalt = BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(8))).toString('hex')}`)
  const subDelegationForHash = {
    delegator: pkg.sessionKeyAddress,
    delegate: executor.address,
    authority: rootHash,
    caveats: subCaveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
    salt: subSalt,
  }
  const subHash = hashDelegation(
    subDelegationForHash,
    config.CHAIN_ID,
    config.DELEGATION_MANAGER_ADDRESS,
  )

  const sessionAccount = privateKeyToAccount(pkg.sessionPrivateKey)
  const subSignature = await sessionAccount.signMessage({ message: { raw: subHash } })

  // Receipt prefill (before submit so we always have a row on revert).
  const receiptId = await writeReceipt({
    c,
    pkg,
    sessionId,
    mcpServer,
    body,
    executionPath: 'sub-delegated',
    status: 'pending',
    toolGrantHash: subHash,
    toolExecutor: executor.address,
    overrideSelector: selector,
    overrideCallDataHash: callDataHash,
  })

  // ─── Submit redeem chain ───────────────────────────────────────────
  try {
    // K5 — `executor.account` is the K5-built viem `LocalAccount`
    // (signed by AWS KMS in prod, by the local hex key in dev).
    const executorAccount = executor.account
    const wallet = createWalletClient({
      account: executorAccount,
      chain: getChain(),
      transport: http(config.RPC_URL),
    })
    const pub = createPublicClient({ chain: getChain(), transport: http(config.RPC_URL) })

    const dSubStruct = {
      delegator: pkg.sessionKeyAddress,
      delegate: executor.address,
      authority: rootHash,
      caveats: subCaveats.map((c) => ({
        enforcer: c.enforcer,
        terms: c.terms,
        args: (c.args ?? '0x') as Hex,
      })),
      salt: subSalt,
      signature: subSignature,
    }
    const dRootStruct = {
      delegator: pkg.delegation.delegator,
      delegate: pkg.delegation.delegate,
      authority: pkg.delegation.authority,
      caveats: pkg.delegation.caveats.map((c) => ({
        enforcer: c.enforcer,
        terms: c.terms,
        args: (c.args ?? '0x') as Hex,
      })),
      salt: BigInt(pkg.delegation.salt),
      signature: pkg.delegation.signature,
    }

    // Chain order: leaf first, root last (per DelegationManager validation).
    const txHash = await wallet.writeContract({
      address: config.DELEGATION_MANAGER_ADDRESS,
      abi: delegationManagerAbi,
      functionName: 'redeemDelegation',
      args: [[dSubStruct, dRootStruct], body.target, valueWei, body.callData],
      account: executorAccount,
      chain: wallet.chain ?? null,
    })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    const ok = receipt.status === 'success'

    // ─── Best-effort post-submit revoke of D_sub ─────────────────────
    //
    // Single-use semantics: even though the 60s Timestamp + the
    // CallDataHashEnforcer already prevent reuse for a different call,
    // we explicitly revoke hash(D_sub) so a leaked session key can't
    // re-issue the SAME calldata within the window. Signed by the
    // session key — DelegationManager.revokeDelegation has no
    // authorization gate so any caller works, but signing from the
    // session key keeps the audit trail clean.
    let revokeTxHash: Hex | null = null
    let revokeError: string | null = null
    if (ok) {
      try {
        const sessionWallet = createWalletClient({
          account: sessionAccount,
          chain: getChain(),
          transport: http(config.RPC_URL),
        })
        revokeTxHash = await sessionWallet.writeContract({
          address: config.DELEGATION_MANAGER_ADDRESS,
          abi: delegationManagerAbi,
          functionName: 'revokeDelegation',
          args: [subHash],
          account: sessionAccount,
          chain: sessionWallet.chain ?? null,
        })
        // Don't await receipt — fire-and-forget so latency doesn't pile up.
        // The revocation will land on the next block, which is fine: the
        // call we just submitted already consumed the unique calldata
        // hash, so even a same-block second submission would revert at
        // the CallDataHashEnforcer level if it could even get past the
        // timestamp window.
      } catch (e) {
        revokeError = e instanceof Error ? e.message : String(e)
      }
    }

    await auditFinalize(receiptId, {
      status: ok ? 'completed' : 'reverted',
      txHash,
      errorReason: ok
        ? (revokeError ? `submit-ok; revoke-failed: ${revokeError.slice(0, 500)}` : '')
        : 'transaction reverted',
    })

    if (!ok) {
      return c.json({ error: 'tx reverted', txHash, executionReceiptId: receiptId }, 502)
    }
    return c.json({
      txHash,
      executionReceiptId: receiptId,
      toolGrantHash: subHash,
      toolExecutor: executor.address,
      revokeTxHash,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditFinalize(receiptId, { status: 'reverted', errorReason: msg.slice(0, 1000) })
    return c.json({ error: `redeem-subdelegated failed: ${msg}` }, 500)
  }
})

// ─── Helper: write an audit row ──────────────────────────────────────
interface ReceiptInput {
  pkg: StoredSessionPackage
  sessionId: string
  mcpServer: string
  body: RedeemTxBody
  executionPath: 'mcp-only' | 'stateless-redeem' | 'sub-delegated' | 'session-account'
  status: 'completed' | 'reverted' | 'denied' | 'pending'
  errorReason?: string
  overrideSelector?: Hex | null
  overrideCallDataHash?: Hex | null
  toolGrantHash?: Hex | null
  toolExecutor?: Address | null
  /**
   * Hardening Phase 1D — cross-service correlation id. Either passed
   * explicitly OR resolved via `c` (Hono context) if that field is
   * provided. Every audit row carries the same id from the web edge
   * down to the chain receipt so a security investigator can join
   * web → a2a → chain on a single value.
   */
  correlationId?: string | null
  /** Hono context — used to default `correlationId` when not explicit. */
  c?: import('hono').Context
}

async function writeReceipt(input: ReceiptInput): Promise<number> {
  const { pkg, sessionId, mcpServer, body, executionPath, status } = input
  let selector: Hex | null = input.overrideSelector ?? null
  let callDataHash: Hex | null = input.overrideCallDataHash ?? null
  if (!selector) {
    try { selector = extractSelector(body.callData) } catch { selector = null }
  }
  if (!callDataHash) {
    try { callDataHash = keccak256(body.callData) } catch { callDataHash = null }
  }
  const rootGrantHash = rootGrantHashFromPkg(pkg)
  // Hardening Phase 1D — every audit row carries the correlation id set
  // at the web edge so the full web→a2a→chain trail joins on a single
  // value. Reads from `c.var.correlationId` when present (see
  // middleware/correlation-id.ts).
  const correlationId =
    input.correlationId ?? (input.c ? readCorrelationId(input.c) : null) ?? null
  const inserted = await db.insert(executionAudit).values({
    rootGrantHash,
    sessionId,
    sessionPrincipal: pkg.sessionKeyAddress,
    a2aTaskId: body.a2aTaskId ?? '',
    mcpServer,
    mcpTool: body.mcpTool,
    mcpCallId: body.mcpCallId,
    executionPath,
    toolGrantHash: input.toolGrantHash ?? null,
    toolExecutor: input.toolExecutor ?? null,
    target: body.target,
    selector,
    callDataHash,
    valueWei: body.value,
    txHash: null,
    userOpHash: null,
    status,
    errorReason: input.errorReason ?? '',
    receivedAt: new Date().toISOString(),
    finalizedAt: null,
    correlationId,
  }).returning({ id: executionAudit.id })
  return inserted[0]!.id
}

// ─── POST /session/:id/redeem-via-account ────────────────────────────
//
// Phase 3 — stateful session-account execution path.
//
// Routes when `TOOL_POLICIES[mcpTool].executionPath === 'session-account'`.
// The session has a deployed SessionAgentAccount whose installed first-party
// modules enforce spend caps, rate limits, and target/selector allowlists at
// every call.
//
// Flow per call:
//   1. Validate the requested tool's policy is `executionPath='session-account'`.
//   2. Validate the session has a `sessionAgentAccount` recorded (set at
//      /session/init when `stateful=true`).
//   3. Build a 4337 UserOperation:
//        sender   = sessionAgentAccount
//        callData = AgentAccount.execute(target, value, data)
//        nonce    = pulled from EntryPoint
//        signature = ECDSA over userOpHash, signed by sessionPrivateKey
//          (the session EOA is the owner of the SessionAgentAccount, so
//           AgentAccount._validateSignature accepts via standard ECDSA path).
//   4. Submit EntryPoint.handleOps([op], beneficiary=executor) AS the
//      self-bundler (a2a-agent's master EOA pays gas).
//   5. Hooks installed on the account (SpendCap, RateLimit, Allowlist)
//      execute pre/post the inner call and revert on policy violations.
//   6. Write ExecutionReceipt with executionPath='session-account' and
//      userOpHash populated.
//
// For local dev there is no external bundler — this endpoint IS the bundler.
onchainRedeem.post('/:id/redeem-via-account', requireInterServiceAuth(), async (c) => {
  const sessionId = c.req.param('id')
  const ctx = c.get('interService' as never) as { service: string; bodyRaw: string } | undefined
  const bodyRaw = ctx?.bodyRaw ?? (await c.req.text())
  let body: RedeemTxBody
  try {
    body = JSON.parse(bodyRaw) as RedeemTxBody
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400)
  }
  const mcpServer = ctx?.service ?? 'unknown'

  // ─── Policy lookup ─────────────────────────────────────────────────
  const policy = TOOL_POLICIES[body.mcpTool]
  if (!policy) {
    return c.json({ error: `unknown tool: ${body.mcpTool}` }, 403)
  }
  if (policy.executionPath !== 'session-account') {
    return c.json(
      { error: `tool ${body.mcpTool} requires path ${policy.executionPath}, not session-account` },
      403,
    )
  }

  // ─── Resolve session ───────────────────────────────────────────────
  const sess = await loadActiveSessionPackage(sessionId)
  if ('error' in sess) return c.json({ error: sess.error }, sess.status)
  const { pkg, row } = sess
  if (!row.sessionAgentAccount) {
    return c.json({ error: 'session has no SessionAgentAccount; was /session/init called with stateful=true?' }, 400)
  }
  const sessionAgentAccount = row.sessionAgentAccount as Address

  // ─── Validate target/selector against policy ───────────────────────
  const env = process.env as Record<string, string | undefined>
  const allowedTargets = policyAllowedTargets(policy, env)
  const targetLower = body.target.toLowerCase() as Address
  if (allowedTargets.length > 0 && !allowedTargets.includes(targetLower)) {
    await writeReceipt({
      c, pkg, sessionId, mcpServer, body,
      executionPath: 'session-account', status: 'denied',
      errorReason: `target ${body.target} not in policy allowed targets`,
    })
    return c.json({ error: `target not allowed for ${body.mcpTool}` }, 403)
  }
  let selector: `0x${string}`
  try { selector = extractSelector(body.callData) } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
  const allowedSelectors = policyAllowedSelectors(body.mcpTool, policy)
  if (!allowedSelectors.has(selector)) {
    await writeReceipt({
      c, pkg, sessionId, mcpServer, body,
      executionPath: 'session-account', status: 'denied',
      errorReason: `selector ${selector} not in policy allowed selectors`,
    })
    return c.json({ error: `selector ${selector} not allowed for ${body.mcpTool}` }, 403)
  }

  // ─── Enforce policy.maxValueWei (off-chain twin of ValueEnforcer) ──
  {
    const requestedValue = BigInt(body.value)
    if (policy.maxValueWei !== undefined && requestedValue > policy.maxValueWei) {
      await writeReceipt({
        c, pkg, sessionId, mcpServer, body,
        executionPath: 'session-account', status: 'denied',
        errorReason: `value ${requestedValue} exceeds tool maxValueWei ${policy.maxValueWei}`,
      })
      return c.json({ error: `value ${requestedValue} exceeds tool maxValueWei ${policy.maxValueWei}` }, 400)
    }
  }

  // ─── Build the inner execute() callData ────────────────────────────
  // AgentAccount.execute(target, value, data)
  const innerCallData = encodeFunctionData({
    abi: agentAccountAbi,
    functionName: 'execute',
    args: [body.target, BigInt(body.value), body.callData],
  })

  // ─── Build the 4337 UserOperation ──────────────────────────────────
  const pub = createPublicClient({ chain: getChain(), transport: http(config.RPC_URL) })
  const sessionAccount = privateKeyToAccount(pkg.sessionPrivateKey)

  // Pull the next nonce from EntryPoint (key=0).
  const nonce = (await pub.readContract({
    address: config.ENTRYPOINT_ADDRESS,
    abi: entryPointMinimalAbi,
    functionName: 'getNonce',
    args: [sessionAgentAccount, 0n],
  })) as bigint

  // Pack gas limits + fees per EntryPoint v0.7 layout:
  //   accountGasLimits = abi.encodePacked(verificationGasLimit << 128 | callGasLimit)
  //   gasFees          = abi.encodePacked(maxPriorityFeePerGas << 128 | maxFeePerGas)
  const verificationGasLimit = 500_000n
  const callGasLimit = 1_500_000n
  const accountGasLimits = packTwo(verificationGasLimit, callGasLimit)
  const preVerificationGas = 100_000n
  const maxPriorityFeePerGas = 1n
  const maxFeePerGas = 1_000_000_000n // 1 gwei (local dev)
  const gasFees = packTwo(maxPriorityFeePerGas, maxFeePerGas)

  const op = {
    sender: sessionAgentAccount,
    nonce,
    initCode: '0x' as Hex, // SessionAgentAccount already deployed
    callData: innerCallData,
    accountGasLimits,
    preVerificationGas,
    gasFees,
    paymasterAndData: '0x' as Hex,
    signature: '0x' as Hex, // to be filled below
  }

  // EntryPoint v0.7 userOpHash = keccak256(abi.encode(packedHash, address(entryPoint), chainId))
  // For simplicity, we delegate to the EntryPoint's view function if available;
  // many deployments expose getUserOpHash().
  const userOpHash = (await pub.readContract({
    address: config.ENTRYPOINT_ADDRESS,
    abi: entryPointMinimalAbi,
    functionName: 'getUserOpHash',
    args: [op],
  })) as Hex

  // Sign the userOpHash with the session EOA (it's an owner of the
  // SessionAgentAccount → ECDSA path in _validateSignature accepts).
  const signature = await sessionAccount.signMessage({ message: { raw: userOpHash } })
  const signedOp = { ...op, signature }

  // ─── Submit via the self-bundler (master EOA pays gas) ────────────
  const receiptId = await writeReceipt({
    c, pkg, sessionId, mcpServer, body,
    executionPath: 'session-account', status: 'pending',
    overrideSelector: selector,
    overrideCallDataHash: keccak256(body.callData),
    toolExecutor: sessionAgentAccount,
  })

  try {
    const masterEoa = await getMasterSigner()
    const wallet = createWalletClient({
      account: masterEoa,
      chain: getChain(),
      transport: http(config.RPC_URL),
    })
    const txHash = await wallet.writeContract({
      address: config.ENTRYPOINT_ADDRESS,
      abi: entryPointMinimalAbi,
      functionName: 'handleOps',
      args: [[signedOp], masterEoa.address],
      account: masterEoa,
      chain: wallet.chain ?? null,
    })
    const r = await pub.waitForTransactionReceipt({ hash: txHash })
    const ok = r.status === 'success'

    await auditFinalize(receiptId, {
      status: ok ? 'completed' : 'reverted',
      txHash,
      userOpHash,
      errorReason: ok ? '' : 'handleOps reverted',
    })

    if (!ok) return c.json({ error: 'handleOps reverted', txHash, userOpHash, executionReceiptId: receiptId }, 502)
    return c.json({
      txHash,
      userOpHash,
      executionReceiptId: receiptId,
      sessionAgentAccount,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await auditFinalize(receiptId, { status: 'reverted', errorReason: msg.slice(0, 1000) })
    return c.json({ error: `redeem-via-account failed: ${msg}` }, 500)
  }
})

// ─── Minimal EntryPoint v0.7 ABI ────────────────────────────────────
const entryPointMinimalAbi = [
  {
    type: 'function', name: 'getNonce',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getUserOpHash',
    inputs: [
      { name: 'userOp', type: 'tuple', components: [
        { name: 'sender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'initCode', type: 'bytes' },
        { name: 'callData', type: 'bytes' },
        { name: 'accountGasLimits', type: 'bytes32' },
        { name: 'preVerificationGas', type: 'uint256' },
        { name: 'gasFees', type: 'bytes32' },
        { name: 'paymasterAndData', type: 'bytes' },
        { name: 'signature', type: 'bytes' },
      ]},
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'handleOps',
    inputs: [
      { name: 'ops', type: 'tuple[]', components: [
        { name: 'sender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'initCode', type: 'bytes' },
        { name: 'callData', type: 'bytes' },
        { name: 'accountGasLimits', type: 'bytes32' },
        { name: 'preVerificationGas', type: 'uint256' },
        { name: 'gasFees', type: 'bytes32' },
        { name: 'paymasterAndData', type: 'bytes' },
        { name: 'signature', type: 'bytes' },
      ]},
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// Pack two uint128-sized values into a single bytes32 for ERC-4337 v0.7
// gas-limit / gas-fee layout: high(verification or priority) || low(call or max).
function packTwo(high: bigint, low: bigint): `0x${string}` {
  if (high >= 2n ** 128n || low >= 2n ** 128n) throw new Error('packTwo: out of range')
  const v = (high << 128n) | low
  return ('0x' + v.toString(16).padStart(64, '0')) as `0x${string}`
}

// Suppress unused import warning — decodeAbiParameters is exported for future
// use (e.g., decoding callData arg snapshots in audit rows). Phase 2 will use it.
void decodeAbiParameters

export { onchainRedeem }
