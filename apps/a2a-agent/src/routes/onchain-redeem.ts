/**
 * Spec 007 Phase B — on-chain redeem endpoints (hybrid-session model).
 *
 * Two surfaces:
 *
 *   POST /session/:id/redeem-via-account — every on-chain write (Phase B
 *     uses the session-key-signs-L1-tx pattern; the master EOA is NOT
 *     involved in the redeem signature path).
 *   POST /session/:id/deploy-agent       — AgentAccountFactory.createAccount
 *     (permissionless on chain; uses the master EOA as the broadcast
 *     account via `getRelayOnlySigner()`).
 *
 * Phase B redeem flow (per Phase B § 2 + C2 Q1 lock-in):
 *
 *   1. Resolve the session via /session-store + DB.
 *   2. The session's persisted delegation (Variant A or Variant B) has
 *      delegate = sessionKey (the EOA generated at /session/hybrid-init).
 *   3. Build an L1 transaction whose `to=DelegationManager`,
 *      `data=redeemDelegation([d, ...], target, value, callData)`.
 *   4. **The session key signs the L1 tx**. msg.sender at
 *      DelegationManager is the session key — which equals the leaf
 *      delegation's delegate. `_validateDelegation`'s
 *      `if (i==0 && d.delegate != msg.sender) revert InvalidDelegate`
 *      passes.
 *   5. The session key broadcasts via `eth_sendRawTransaction` (viem
 *      `walletClient.sendTransaction`). Master EOA has NO role on the
 *      redeem path.
 *
 * For **Variant B** sessions the same flow applies; the additional
 * gate is `_acceptedSessionDelegations[delegationHash] == true` which
 * was established at /session/hybrid-finalize.
 *
 * **Master compromise isolation**: master cannot sign anything that
 * recovers to a user owner (Phase A dropped co-ownership) AND it has
 * no signing role in this redeem path. A master compromise can pay
 * gas as a relay (deploy-agent path only) but cannot authorise any
 * user action.
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
// KMS K4 PR-1 — master EOA now routes through the signer wrapper.
// Phase B — master is RELAY-ONLY on the deploy-agent path; the redeem
// path uses the session-key directly (Spec 007 § Step 4). Importing
// both flavors: getRelayOnlySigner() for handleOps / direct broadcast,
// getMasterSigner() retained for backward-compat call sites that are
// being phased out.
import { getMasterSigner, getRelayOnlySigner } from '../auth/a2a-signer'
import { privateKeyToAccount } from 'viem/accounts'
import { checkActionAgainstSession } from '../lib/policy-gate'
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
//
// Shape evolved across phases:
//   - Pre-Phase-B (`/session/package` flow): delegation.delegate ==
//     accountAddress (the smart account itself). Redeemed via userOp
//     with master signing as co-owner. POST-PHASE-A this is broken
//     because master is no longer an owner.
//   - Phase B (`/session/hybrid-init` flow): delegation.delegate ==
//     sessionKeyAddress (the EOA generated at session-init). Redeemed
//     by the session key signing an L1 tx directly. The session row's
//     `variant` column is set to 'A' or 'B' for these sessions.
//
// The redeem path inspects the session row's `variant` column to decide:
//   - variant in ('A', 'B') → session-key direct path (new)
//   - variant IS NULL       → legacy shape → 401 with re-bootstrap msg
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
  // Phase B — set for hybrid sessions; undefined for legacy.
  variant?: 'A' | 'B'
  riskTier?: 'low' | 'medium' | 'high' | 'critical'
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
// Phase 1 chained-delegation redeem (canonical, 2026-05-10; see
// `output/phase1-delegation-summary.md` § "`POST /session/:id/redeem-tx`"
// — this endpoint inherits that wire).
//
// One-hop redemption for LOW-VALUE tools:
//
//   1. HMAC-authed (`requireInterServiceAuth`) — caller is an MCP server.
//   2. Look up the session (must be active + unexpired).
//   3. Validate target + selector against `TOOL_POLICIES[mcpTool]`.
//   4. Decrypt the session package; build a viem wallet from
//      `sessionPrivateKey` — the sessionKey IS the leaf delegate of
//      D_root, and the EVM tx sender at DM.redeemDelegation, so
//      `msg.sender == D_root.delegate` and the chain validates.
//   5. Write a pending ExecutionReceipt; submit
//      `DM.redeemDelegation([D_root], target, value, callData)`.
//   6. Finalize the receipt on success/revert.
//
// HIGH-VALUE tools route to `/redeem-subdelegated` (Phase 2) instead,
// which mints a per-call D_sub from the session key to a per-tool-family
// executor and submits the 2-hop chain.
//
// There is no master-signer co-sign at runtime. `getRelayOnlySigner()`
// exists only to pay gas for Variant B `handleOps` during session
// acceptance (a separate flow from the redeem here).
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
      // Phase B — default chain is the session's own root delegation.
      // The leaf delegation's `delegate` MUST be the session key
      // (pkg.sessionKeyAddress) so that the session key calling
      // `DelegationManager.redeemDelegation` as msg.sender satisfies
      // the `i==0 && d.delegate != msg.sender` check.
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

    // ─── Spec 007 Phase B — hybrid session gate ────────────────────────
    // Pre-Phase-B sessions (`/session/package`) had delegate=accountAddress
    // and were redeemed via userOp with master as co-owner. Post-Phase-A
    // that path no longer validates because master is not in the owner
    // set. We require the session to have been bootstrapped via the
    // hybrid endpoint (variant is 'A' or 'B').
    if (pkg.variant !== 'A' && pkg.variant !== 'B') {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'session:legacy-shape-unsupported',
        publicMessage:
          'Session was minted before Phase B (no variant column); ' +
          'master is no longer an owner so the legacy redemption path ' +
          'cannot validate. Re-bootstrap via /session/hybrid-init.',
        status: 401,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
        sessionPrincipal: pkg.sessionKeyAddress,
      })
    }

    // Phase B off-chain policy gate — does the session's variant cover
    // the action's risk tier? The on-chain caveat enforcer is the
    // authoritative gate (§ D2 Q5); this is the early-fail UX path.
    const policyDecision = checkActionAgainstSession(
      { route: body.mcpTool, args: { target: body.target, selectors: [selector] } },
      pkg.variant,
    )
    if (!policyDecision.ok) {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'policy:risk-tier-mismatch',
        publicMessage: policyDecision.message,
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

    // Variant B — confirm the on-chain acceptance is still in place.
    // A finalize that didn't land would have left this false; we
    // re-check here so a redeem against a non-accepted session fails
    // cleanly instead of failing inside DelegationManager.
    if (pkg.variant === 'B') {
      const probeClient = createPublicClient({
        chain: getChain(),
        transport: http(config.RPC_URL),
      })
      const sessionDelegationHash = rootGrantHashFromPkg(pkg)
      const accepted = (await probeClient.readContract({
        address: pkg.accountAddress,
        abi: agentAccountAbi,
        functionName: 'hasAcceptedSessionDelegation',
        args: [sessionDelegationHash],
      })) as boolean
      if (!accepted) {
        return denyAndAudit(c, {
          route: '/session/:id/redeem-via-account',
          reason: 'session:variant-b-not-accepted-onchain',
          publicMessage:
            'Variant B session delegation is not accepted on chain. ' +
            'Re-finalize via /session/hybrid-finalize.',
          status: 401,
          executionPath: 'session-account',
          sessionId,
          mcpServer,
          mcpCallId: body.mcpCallId,
          sessionPrincipal: pkg.sessionKeyAddress,
        })
      }
    }

    // ─── Phase B — Build and submit the L1 tx as the session key ───────
    //
    // C2 Q1 lock-in: the session-key EOA calls
    // `DelegationManager.redeemDelegation(...)` directly. msg.sender at
    // DelegationManager equals the session key, which equals the leaf
    // delegation's `delegate` — the `_validateDelegation` check passes.
    //
    // No userOp; no master signing of authority material. Master has
    // NO role on this path.
    const valueWei = BigInt(body.value)

    const pub = createPublicClient({ chain: getChain(), transport: http(config.RPC_URL) })

    // Construct the session-key signer from the encrypted package's
    // private key. The key never leaves this process; it was set at
    // /session/hybrid-init, encrypted under the KMS data key, and
    // decrypted just now via `decryptSessionPackage`.
    const sessionKeyAccount = privateKeyToAccount(pkg.sessionPrivateKey)
    if (
      sessionKeyAccount.address.toLowerCase() !==
      pkg.sessionKeyAddress.toLowerCase()
    ) {
      return denyAndAudit(c, {
        route: '/session/:id/redeem-via-account',
        reason: 'session:lookup-failed',
        publicMessage:
          'session key address mismatch — encrypted package is corrupt',
        status: 500,
        executionPath: 'session-account',
        sessionId,
        mcpServer,
        mcpCallId: body.mcpCallId,
      })
    }

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
      toolExecutor: pkg.sessionKeyAddress,
    })

    try {
      // The session key signs the L1 tx and is also the broadcasting
      // account. Its balance pays the gas. For Variant B the on-chain
      // acceptance gate has already been verified above.
      const wallet = createWalletClient({
        account: sessionKeyAccount,
        chain: getChain(),
        transport: http(config.RPC_URL),
      })
      const txHash = await wallet.writeContract({
        address: config.DELEGATION_MANAGER_ADDRESS,
        abi: delegationManagerAbi,
        functionName: 'redeemDelegation',
        args: [chainStructs, body.target, valueWei, body.callData],
        account: sessionKeyAccount,
        chain: wallet.chain ?? null,
      })
      const r = await pub.waitForTransactionReceipt({ hash: txHash })
      const ok = r.status === 'success'

      await auditFinalize(receiptId, {
        status: ok ? 'completed' : 'reverted',
        txHash,
        errorReason: ok ? '' : 'redeem reverted',
      })

      if (!ok) {
        return denyAndAudit(c, {
          route: '/session/:id/redeem-via-account',
          reason: 'tx:handle-ops-reverted',
          publicMessage: 'redeemDelegation reverted',
          status: 502,
          skipAudit: true,
          executionPath: 'session-account',
          sessionId,
          mcpServer,
          extra: { txHash, executionReceiptId: receiptId },
        })
      }
      return c.json({
        txHash,
        executionReceiptId: receiptId,
        sessionAgentAccount: userAgentAccount,
        sessionKey: pkg.sessionKeyAddress,
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
      // Phase B § Step 4 — use the relay-only flavor for broadcast. The
      // factory's `createAccount(owner, salt)` is permissionless on
      // chain, so master can broadcast as the gas-paying EOA. The
      // relay-only flavor blocks message-signing so an accidental
      // future use of this signer to forge a user-authority signature
      // throws loud.
      const relay = await getRelayOnlySigner()
      const wallet = createWalletClient({
        account: relay.account,
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
        account: relay.account,
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
// (e.g. callData arg-snapshot decoding in audit rows; userOp helpers
// retained for Phase C migration of any remaining userOp-routed calls).
void decodeAbiParameters
void entryPointMinimalAbi
void packTwo
void getMasterSigner

export { onchainRedeem }
