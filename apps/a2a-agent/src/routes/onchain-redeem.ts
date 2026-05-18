/**
 * Option A (ERC-4337-only redeem) — on-chain redeem endpoints.
 *
 * These endpoints are how MCP servers ask a2a-agent to redeem the user's
 * signed root delegation on chain. There are now exactly TWO surfaces:
 *
 *   POST /session/:id/redeem-via-account — every on-chain write
 *   POST /session/:id/deploy-agent       — AgentAccountFactory.createAccount
 *
 * The legacy `/redeem-tx`, `/redeem-with-chain`, and `/redeem-subdelegated`
 * routes were deleted: they submitted via session-signer / executor EOAs
 * that have no ETH by design. Under Option A, every redeem routes through
 * ERC-4337 EntryPoint.handleOps with the master EOA as the bundler /
 * gas payer.
 *
 * The flow per redeem call:
 *
 *   1. Build a UserOperation:
 *        sender    = user's AgentAccount (= session row's accountAddress)
 *        callData  = AgentAccount.execute(
 *                      DelegationManager,
 *                      0,
 *                      DelegationManager.redeemDelegation(chain, target, value, data),
 *                    )
 *        signature = ECDSA over userOpHash, signed by the master signer
 *                    (registered as serverSigner / co-owner of every
 *                     AgentAccount minted via the factory).
 *   2. EntryPoint.handleOps([op], beneficiary=master) executes:
 *        EntryPoint → AgentAccount.execute(...)   — passes _requireForExecute
 *                                                   (msg.sender = EntryPoint).
 *        AgentAccount → DelegationManager.redeemDelegation(...)  — passes the
 *                                                   InvalidDelegate check
 *                                                   because the LEAF
 *                                                   delegation's `delegate`
 *                                                   is the smart account
 *                                                   itself = msg.sender.
 *        DelegationManager enforces every caveat, then
 *          → AgentAccount.execute(target, value, data) — passes
 *                                                   _requireForExecute
 *                                                   (msg.sender =
 *                                                    _delegationManager).
 *   3. The master EOA pays the gas; session-signer EOAs never need ETH.
 *
 * Auth: HMAC inter-service signature (`requireInterServiceAuth`). MCPs sign
 * the request body with their shared secret; the path's :id binds the
 * signature to a specific session.
 *
 * Authorization (per request):
 *   1. Session must exist + be active + not expired.
 *   2. The requested `mcpTool` must have a TOOL_POLICIES entry whose
 *      executionPath is NOT `mcp-only` (an on-chain tool).
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
// KMS K4 PR-1 — master EOA now routes through the signer wrapper. The
// surrounding viem call shape (walletClient.writeContract /
// signMessage / signTransaction) is unchanged — `getMasterSigner()`
// returns a viem `LocalAccount` indistinguishable from
// `privateKeyToAccount(...)`.
import { getMasterSigner } from '../auth/a2a-signer'
import { localhost } from 'viem/chains'
import {
  agentAccountAbi,
  delegationManagerAbi,
  agentAccountFactoryAbi,
  poolRegistryAbi,
  fundRegistryAbi,
  hashDelegation,
  TOOL_POLICIES,
  POOL_REGISTRY_SELECTORS_BY_TOOL,
  FUND_REGISTRY_SELECTORS_BY_TOOL,
  AGENT_ACCOUNT_RESOLVER_SELECTORS_BY_TOOL,
  AGENT_RELATIONSHIP_SELECTORS_BY_TOOL,
  COMMITMENT_REGISTRY_SELECTORS_BY_TOOL,
  PROPOSAL_REGISTRY_SELECTORS_BY_TOOL,
  agentAccountResolverAbi,
  agentRelationshipAbi,
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
import { decryptSessionPackage } from '../auth/encryption'
import { auditFinalize, readCorrelationId, denyAndAudit } from '../lib/audit'
import type { AuditDenyReason } from '../lib/audit-deny-reasons'
import { MARKETPLACE_TOOL_IDS, resolveMarketplaceEnabled } from '../lib/policy-startup'

/**
 * Sprint 5 P0-8 — marketplace tools are 503'd at the route boundary
 * when `MARKETPLACE_ENABLED=false` (the default). The companion boot
 * gate (`assertMarketplacePolicy`) refuses to start when the flag is
 * `true` and any marketplace tool lacks selectors, so by the time
 * `isMarketplaceToolDisabled` returns `true` we know the operator
 * has explicitly NOT opted into marketplace traffic for this deploy.
 *
 * Single helper used by every policy-lookup site in this module so a
 * future marketplace tool added to TOOL_POLICIES is gated automatically.
 */
function isMarketplaceToolDisabled(toolId: string): boolean {
  if (!MARKETPLACE_TOOL_IDS.has(toolId)) return false
  return !resolveMarketplaceEnabled(process.env)
}

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

interface RedeemViaAccountBody {
  mcpTool: string
  mcpCallId: string
  a2aTaskId?: string
  target: Address
  /** Decimal string of wei. */
  value: string
  callData: Hex
  /**
   * Optional delegation chain. When present, used as the chain handed
   * to `DelegationManager.redeemDelegation([leaf, ..., root], …)`.
   * Index 0 is the LEAF (its `delegate` MUST equal the user's smart
   * account = the userOp `sender` = msg.sender at DelegationManager).
   * When absent, the redeem uses `[pkg.delegation]` (the session's own
   * stored root delegation).
   */
  chain?: ChainDelegationStruct[]
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
  AgentRelationship: agentRelationshipAbi as readonly unknown[],
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
  if (policy.allowedTargets.includes('AgentRelationship')) {
    tryAdd('AgentRelationship', AGENT_RELATIONSHIP_SELECTORS_BY_TOOL[toolId])
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
  // §1.5 #8 trip-wire preserved).
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

/**
 * P0-4 — map the (small) set of free-form session-error strings produced
 * by `loadActiveSessionPackage` onto a stable `session:*` reason literal
 * drawn from `AUDIT_DENY_REASONS`. Keeps the deny-row vocabulary closed
 * without forcing the session helper to surface typed errors itself.
 */
function sessionErrorToReason(err: string): AuditDenyReason {
  if (err === 'session not found') return 'session:not-found'
  if (err.startsWith('session not active')) return 'session:not-active'
  if (err === 'session expired') return 'session:expired'
  if (err.startsWith('session missing encrypted package')) return 'session:missing-package'
  return 'session:lookup-failed'
}

function extractSelector(callData: Hex): `0x${string}` {
  if (typeof callData !== 'string' || !callData.startsWith('0x') || callData.length < 10) {
    throw new Error('callData too short to extract selector')
  }
  return callData.slice(0, 10).toLowerCase() as `0x${string}`
}

// ─── POST /session/:id/redeem-via-account ────────────────────────────
//
// The ONLY redeem endpoint. Every on-chain write a tool performs is
// submitted via ERC-4337:
//
//   sender    = user's AgentAccount (the session's accountAddress)
//   callData  = AgentAccount.execute(
//                 DelegationManager, 0,
//                 redeemDelegation(chain, target, value, data),
//               )
//   signature = ECDSA over userOpHash by the master signer
//
// Master EOA pays gas via EntryPoint.handleOps; session-signer EOAs
// never hold ETH.
onchainRedeem.post('/:id/redeem-via-account', requireInterServiceAuth(), async (c) => {
  const sessionId = c.req.param('id')
  const ctx = c.get('interService' as never) as { service: string; bodyRaw: string } | undefined
  const bodyRaw = ctx?.bodyRaw ?? (await c.req.text())
  const mcpServer = ctx?.service ?? 'unknown'
  try {
    let body: RedeemViaAccountBody
    try {
      body = JSON.parse(bodyRaw) as RedeemViaAccountBody
    } catch {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'fields:malformed-json',
        status: 400,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
      })
    }

    // ─── Policy lookup ─────────────────────────────────────────────────
    const policy = TOOL_POLICIES[body.mcpTool]
    if (!policy) {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'policy:unknown-tool',
        publicMessage: `unknown tool: ${body.mcpTool}`,
        status: 403,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
      })
    }
    // Sprint 5 P0-8 — marketplace tools 503 unless MARKETPLACE_ENABLED=true.
    if (isMarketplaceToolDisabled(body.mcpTool)) {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'policy:marketplace-disabled',
        publicMessage: `marketplace tool ${body.mcpTool} is disabled (MARKETPLACE_ENABLED=false)`,
        status: 503,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
      })
    }
    // Option A unification: every non-mcp-only tool routes here. Tools
    // with `mcp-only` have no on-chain side and must not be submitted.
    if (policy.executionPath === 'mcp-only') {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'policy:wrong-execution-path',
        publicMessage: `tool ${body.mcpTool} is mcp-only and has no on-chain side`,
        status: 403,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
      })
    }

    // ─── Resolve session ───────────────────────────────────────────────
    const sess = await loadActiveSessionPackage(sessionId)
    if ('error' in sess) {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: sessionErrorToReason(sess.error),
        publicMessage: sess.error,
        status: sess.status,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
      })
    }
    const { pkg, row } = sess
    // Option A: the user's own AgentAccount IS the redeemer. No separate
    // SessionAgentAccount is needed; the session row's `accountAddress`
    // (set at /session/init) is the userOp `sender`.
    const userAgentAccount = row.accountAddress as Address

    // ─── Validate target/selector against policy ───────────────────────
    const env = process.env as Record<string, string | undefined>
    const allowedTargets = policyAllowedTargets(policy, env)
    const targetLower = body.target.toLowerCase() as Address
    if (allowedTargets.length > 0 && !allowedTargets.includes(targetLower)) {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'policy:target-not-allowed',
        publicMessage: `target not allowed for ${body.mcpTool}`,
        status: 403,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
        target: body.target,
        sessionPrincipal: pkg.sessionKeyAddress,
      })
    }
    let selector: `0x${string}`
    try { selector = extractSelector(body.callData) } catch (e) {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'validation:invalid-call-data',
        publicMessage: (e as Error).message,
        status: 400,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
        sessionPrincipal: pkg.sessionKeyAddress,
      })
    }
    const allowedSelectors = policyAllowedSelectors(body.mcpTool, policy)
    if (!allowedSelectors.has(selector)) {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'policy:selector-not-allowed',
        publicMessage: `selector ${selector} not allowed for ${body.mcpTool}`,
        status: 403,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
        target: body.target,
        selector,
        sessionPrincipal: pkg.sessionKeyAddress,
      })
    }

    // ─── Enforce policy.maxValueWei (off-chain twin of ValueEnforcer) ──
    {
      const requestedValue = BigInt(body.value)
      if (policy.maxValueWei !== undefined && requestedValue > policy.maxValueWei) {
        return denyAndAudit(c, {
          route: '/session/:id/redeem-via-account',
          reason: 'policy:value-exceeds-cap',
          publicMessage: `value ${requestedValue} exceeds tool maxValueWei ${policy.maxValueWei}`,
          status: 400,
          executionPath: 'session-account',
          sessionId,
          mcpServer,
          mcpCallId: body.mcpCallId,
          target: body.target,
          selector,
          sessionPrincipal: pkg.sessionKeyAddress,
        })
      }
    }

    // ─── Resolve the delegation chain ──────────────────────────────────
    // Caller may pass an explicit `chain` (e.g. the AnonCreds-gated
    // admin→holder→smartAccount chain). When omitted, use the session's
    // own root delegation as a 1-element chain.
    let chainStructs: Array<{
      delegator: `0x${string}`
      delegate: `0x${string}`
      authority: `0x${string}`
      caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}`; args: Hex }>
      salt: bigint
      signature: `0x${string}`
    }>
    if (body.chain && Array.isArray(body.chain)) {
      if (body.chain.length === 0) {
        return denyAndAudit(c, {
          route: '/session/:id/redeem-via-account',
          reason: 'validation:chain-empty',
          publicMessage: 'chain must be a non-empty array of signed delegations',
          status: 400,
          executionPath: 'session-account',
          sessionId,
          mcpServer,
          mcpCallId: body.mcpCallId,
          sessionPrincipal: pkg.sessionKeyAddress,
        })
      }
      // Leaf (index 0) must delegate to the user's smart account — the
      // userOp sender = msg.sender at the DelegationManager call.
      const leaf = body.chain[0]
      if (leaf.delegate.toLowerCase() !== userAgentAccount.toLowerCase()) {
        return denyAndAudit(c, {
          route: '/session/:id/redeem-via-account',
          reason: 'validation:chain-leaf-delegate-mismatch',
          publicMessage: `chain leaf delegate (${leaf.delegate}) must equal smart account (${userAgentAccount})`,
          status: 400,
          executionPath: 'session-account',
          sessionId,
          mcpServer,
          mcpCallId: body.mcpCallId,
          sessionPrincipal: pkg.sessionKeyAddress,
        })
      }
      chainStructs = body.chain.map((d) => ({
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
    } else {
      // Default: use the session's stored root delegation. Under Option A
      // its `delegate` is the smart account itself — pkg.delegation.delegate
      // == accountAddress == userAgentAccount, which satisfies the
      // InvalidDelegate check at DelegationManager.
      chainStructs = [{
        delegator: pkg.delegation.delegator,
        delegate: pkg.delegation.delegate,
        authority: pkg.delegation.authority,
        caveats: pkg.delegation.caveats.map((cav) => ({
          enforcer: cav.enforcer,
          terms: cav.terms,
          args: (cav.args ?? '0x') as Hex,
        })),
        salt: BigInt(pkg.delegation.salt),
        signature: pkg.delegation.signature,
      }]
    }

    // ─── Build the inner execute() callData ────────────────────────────
    // The user's AgentAccount calls DelegationManager.redeemDelegation,
    // which validates the chain + caveats and re-enters
    // AgentAccount.execute(target, value, data). The double-execute is
    // exactly the ERC-7710 dispatch — DelegationManager's call back into
    // the account is permitted by _requireForExecute (msg.sender =
    // _delegationManager).
    const valueWei = BigInt(body.value)
    const redeemCallData = encodeFunctionData({
      abi: delegationManagerAbi,
      functionName: 'redeemDelegation',
      args: [chainStructs, body.target, valueWei, body.callData],
    })
    const innerCallData = encodeFunctionData({
      abi: agentAccountAbi,
      functionName: 'execute',
      args: [config.DELEGATION_MANAGER_ADDRESS, 0n, redeemCallData],
    })

    // ─── Build the 4337 UserOperation ──────────────────────────────────
    const pub = createPublicClient({ chain: getChain(), transport: http(config.RPC_URL) })

    // Pull the next nonce from EntryPoint (key=0).
    const nonce = (await pub.readContract({
      address: config.ENTRYPOINT_ADDRESS,
      abi: entryPointMinimalAbi,
      functionName: 'getNonce',
      args: [userAgentAccount, 0n],
    })) as bigint

    // Pack gas limits + fees per EntryPoint v0.7 layout:
    //   accountGasLimits = abi.encodePacked(verificationGasLimit << 128 | callGasLimit)
    //   gasFees          = abi.encodePacked(maxPriorityFeePerGas << 128 | maxFeePerGas)
    const verificationGasLimit = 500_000n
    const callGasLimit = 2_000_000n
    const accountGasLimits = packTwo(verificationGasLimit, callGasLimit)
    const preVerificationGas = 100_000n
    const maxPriorityFeePerGas = 1n
    const maxFeePerGas = 1_000_000_000n // 1 gwei (local dev)
    const gasFees = packTwo(maxPriorityFeePerGas, maxFeePerGas)

    // ERC-4337 v0.7 paymasterAndData layout:
    //   address (20 bytes) || verificationGasLimit (uint128) || postOpGasLimit (uint128) || extra
    // SmartAgentPaymaster is deployed + staked + deposited at Deploy.s.sol.
    // Dev posture: accept-all (BasePaymaster._validatePaymasterUserOp returns
    // valid for any sender). Production hardening flips _dev=false + populates
    // the accept-list — see output/PAYMASTER-INTEGRATION-PLAN.md §4.
    const paymasterAndData: Hex = (config.PAYMASTER_ADDRESS.toLowerCase() !==
      '0x0000000000000000000000000000000000000000')
      ? `0x${config.PAYMASTER_ADDRESS.slice(2)}${(100_000n).toString(16).padStart(32, '0')}${(50_000n).toString(16).padStart(32, '0')}` as Hex
      : '0x' as Hex

    const op = {
      sender: userAgentAccount,
      nonce,
      initCode: '0x' as Hex, // AgentAccount already deployed
      callData: innerCallData,
      accountGasLimits,
      preVerificationGas,
      gasFees,
      paymasterAndData,
      signature: '0x' as Hex, // to be filled below
    }

    // userOpHash from EntryPoint view function.
    const userOpHash = (await pub.readContract({
      address: config.ENTRYPOINT_ADDRESS,
      abi: entryPointMinimalAbi,
      functionName: 'getUserOpHash',
      args: [op],
    })) as Hex

    // ─── Sign the userOpHash ──────────────────────────────────────────
    // The master signer is registered as serverSigner / co-owner on every
    // AgentAccount minted via AgentAccountFactory (factory passes it as
    // the second initialize() arg). AgentAccount._validateSignature
    // recovers the ECDSA signer and checks _owners[recovered] — the
    // master signer satisfies that gate without needing the user's
    // private key at runtime.
    //
    // The session-signer EOA's role is purely off-chain (MCP auth proof
    // of session liveness via the encrypted package); it never signs an
    // on-chain transaction.
    const masterEoa = await getMasterSigner()
    const signature = await masterEoa.signMessage({ message: { raw: userOpHash } })
    const signedOp = { ...op, signature }

    // ─── Submit via the self-bundler (master EOA pays gas) ────────────
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
      executionPath: 'session-account',
      status: 'pending',
      overrideSelector: selector,
      overrideCallDataHash: keccak256(body.callData),
      toolExecutor: userAgentAccount,
    })

    try {
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

      if (!ok) {
        return denyAndAudit(c, {
          route: '/session/:id/redeem-via-account',
          reason: 'tx:handle-ops-reverted',
          publicMessage: 'handleOps reverted',
          status: 502,
          skipAudit: true,
          executionPath: 'session-account',
          sessionId,
          mcpServer,
          extra: { txHash, userOpHash, executionReceiptId: receiptId },
        })
      }
      return c.json({
        txHash,
        userOpHash,
        executionReceiptId: receiptId,
        sessionAgentAccount: userAgentAccount,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await auditFinalize(receiptId, { status: 'reverted', errorReason: msg.slice(0, 1000) })
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'error:redeem-via-account-failed',
        publicMessage: `redeem-via-account failed: ${msg}`,
        status: 500,
        skipAudit: true,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return denyAndAudit(c, {
      route: '/session/:id/redeem-via-account',
      reason: 'error:unhandled',
      publicMessage: msg,
      status: 500,
      executionPath: 'session-account',
      sessionId,
      mcpServer,
    })
  }
})

// ─── POST /session/:id/deploy-agent ──────────────────────────────────
//
// AgentAccountFactory.createAccount(owner, salt). There is no on-chain
// auth check on the factory — `(owner, salt)` is a deterministic CREATE2
// triplet; anyone can call it for any (owner, salt) that hasn't been
// minted yet. We therefore submit directly from the master EOA (the
// funded operator account, registered as serverSigner) — consistent
// with Option A's "master EOA is the SOLE on-chain submitter" model.
onchainRedeem.post('/:id/deploy-agent', requireInterServiceAuth(), async (c) => {
  const sessionId = c.req.param('id')
  const ctx = c.get('interService' as never) as { service: string; bodyRaw: string } | undefined
  const bodyRaw = ctx?.bodyRaw ?? (await c.req.text())
  const mcpServer = ctx?.service ?? 'unknown'
  try {
    let body: DeployAgentBody
    try {
      body = JSON.parse(bodyRaw) as DeployAgentBody
    } catch {
      return denyAndAudit(c, {
        route: '/session/:id/deploy-agent',
        reason: 'fields:malformed-json',
        status: 400,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
      })
    }

    const sess = await loadActiveSessionPackage(sessionId)
    if ('error' in sess) {
      return denyAndAudit(c, {
        route: '/session/:id/deploy-agent',
        reason: sessionErrorToReason(sess.error),
        publicMessage: sess.error,
        status: sess.status,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
      })
    }
    const { pkg } = sess

    const factory = process.env.AGENT_FACTORY_ADDRESS as Address | undefined
    if (!factory) {
      return denyAndAudit(c, {
        route: '/session/:id/deploy-agent',
        reason: 'env:agent-factory-not-set',
        publicMessage: 'AGENT_FACTORY_ADDRESS not set on a2a-agent',
        status: 500,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
        sessionPrincipal: pkg.sessionKeyAddress,
      })
    }

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
      executionPath: 'session-account',
      status: 'pending',
      overrideSelector: selectorHex,
      overrideCallDataHash: callDataPreviewHash,
    })

    try {
      const masterEoa = await getMasterSigner()
      const wallet = createWalletClient({
        account: masterEoa,
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
        account: masterEoa,
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

      if (!ok) {
        return denyAndAudit(c, {
          route: '/session/:id/deploy-agent',
          reason: 'tx:reverted',
          publicMessage: 'tx reverted',
          status: 502,
          skipAudit: true,
          executionPath: 'session-account',
          sessionId,
          mcpServer,
          extra: { txHash, executionReceiptId: receiptId },
        })
      }
      return c.json({ address: deployedAddress, txHash, executionReceiptId: receiptId })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await auditFinalize(receiptId, { status: 'reverted', errorReason: msg.slice(0, 1000) })
      return denyAndAudit(c, {
        route: '/session/:id/deploy-agent',
        reason: 'error:deploy-agent-failed',
        publicMessage: `deploy-agent failed: ${msg}`,
        status: 500,
        skipAudit: true,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return denyAndAudit(c, {
      route: '/session/:id/deploy-agent',
      reason: 'error:unhandled',
      publicMessage: msg,
      status: 500,
      executionPath: 'session-account',
      sessionId,
      mcpServer,
    })
  }
})

// ─── Helper: write an audit row ──────────────────────────────────────
interface ReceiptBody {
  mcpTool: string
  mcpCallId: string
  a2aTaskId?: string
  target: Address
  value: string
  callData: Hex
}
interface ReceiptInput {
  pkg: StoredSessionPackage
  sessionId: string
  mcpServer: string
  body: ReceiptBody
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

// Suppress unused-import sigils — kept exported for forward compat
// (e.g. callData arg-snapshot decoding in audit rows).
void decodeAbiParameters

export { onchainRedeem }
