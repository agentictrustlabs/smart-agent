/**
 * Spec 007 Phase B — hybrid session-init endpoint (`/session/hybrid-init`
 * + `/session/hybrid-finalize`).
 *
 * This route replaces the master-signs-userOp pattern for new sessions.
 * The old `/session/init` + `/session/package` pair is retained for
 * backward compatibility with pre-Phase-B clients; Phase C will sweep
 * the web side onto the hybrid endpoints.
 *
 * Flow:
 *
 *   1. Client POSTs `/session/hybrid-init` with:
 *      { accountAddress, scope, validUntil }
 *   2. Server classifies via `classifySessionRiskTier(scope)`.
 *   3. Variant A (low/medium):
 *      - Generate fresh session key (EOA).
 *      - Build EIP-712 Delegation struct (delegator=accountAddress,
 *        delegate=sessionKey, caveats=[Timestamp, AllowedTargets,
 *        AllowedMethods, Value]).
 *      - Return signing payload + delegationHash to client.
 *      - Client signs (passkey/EOA) → POSTs to `/session/hybrid-finalize`.
 *      - Server verifies via ERC-1271, persists signed delegation in
 *        encrypted session_store, activates session.
 *   4. Variant B (high/critical):
 *      - Generate fresh session key (EOA).
 *      - Compute sessionDelegationHash (keccak256 of EIP-712 delegation
 *        digest — Phase B § 2 step description).
 *      - Build a userOp from the user's smart account whose callData
 *        is `AgentAccount.execute(self, 0, encodeAcceptSessionDelegation(hash))`.
 *      - Return the userOp + userOpHash to client.
 *      - Client signs userOpHash → POSTs to `/session/hybrid-finalize`.
 *      - Server submits via EntryPoint.handleOps (master is relay).
 *      - On inclusion + `_acceptedSessionDelegations[hash] == true`,
 *        persist session + mark variant='B', onChainAcceptedTxHash=txHash,
 *        activate.
 *
 * Both variants persist: risk_tier, variant, session_key (encrypted),
 * delegation struct + sig (encrypted), expiry, session_delegation_hash.
 *
 * Locked design (no re-debate):
 *   - C2 Q1: Variant A session key is an EOA that calls
 *     `DelegationManager.redeemDelegation` directly as msg.sender.
 *     The session-init endpoint just persists the user-signed
 *     delegation; redemption happens later in `onchain-redeem.ts`.
 *   - D3: Master signs only the relay envelope (`handleOps`); session
 *     issuer co-signs the bundler envelope as defense-in-depth.
 *   - § D2 Q5: Caveat enforcer is authoritative; this endpoint only
 *     classifies + routes.
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { localhost } from 'viem/chains'
import {
  agentAccountAbi,
  hashDelegation,
  hashCaveats,
  delegationDomainSeparator,
  encodeTimestampTerms,
  encodeValueTerms,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  buildCaveat,
  clampSessionTtl,
  classifyRiskTier,
  variantForTier,
  type ActionDescriptor,
  type ActionRiskTier,
  type SessionVariant,
} from '@smart-agent/sdk'
import { db, sqliteHandle } from '../db'
import { sessions } from '../db/schema'
import { config } from '../config'
import { encryptSessionPackage, decryptSessionPackage } from '../auth/encryption'
import { getMasterSigner, getRelayOnlySigner } from '../auth/a2a-signer'
import { auditAppend, readCorrelationId } from '../lib/audit'
import { errorResponse } from '../lib/error-response'
import { classifySessionRiskTier } from '../lib/risk-tiers'

const sessionInit = new Hono()

const ERC1271_MAGIC_VALUE = '0x1626ba7e'

// ─── Variant A → tier mapping helper ────────────────────────────────
//
// Map our 4-tier action-risk axis onto the existing `SessionRiskTier`
// axis used by `clampSessionTtl` (`low`|`medium`|`high`|`sensitive`).
// 'critical' is novel to Phase B and maps onto 'sensitive' (4h cap)
// since the existing TTL table doesn't have a stricter bucket.
function tierForTtlClamp(tier: ActionRiskTier): 'low' | 'medium' | 'high' | 'sensitive' {
  switch (tier) {
    case 'low': return 'low'
    case 'medium': return 'medium'
    case 'high': return 'high'
    case 'critical': return 'sensitive'
  }
}

// ─── Stored session-package shape (Phase B hybrid sessions) ──────────
//
// Used by both Variant A and Variant B. The `delegation` field is the
// user-signed EIP-712 Delegation struct; for Variant B, the same struct
// is also registered on chain via `acceptSessionDelegation(hash)` and
// `sessionDelegationHashOnChain` records the hash that's been accepted.
interface HybridSessionPackage {
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
  variant: SessionVariant
  riskTier: ActionRiskTier
}

// ─── Pending-init shape (before user signs) ─────────────────────────
//
// Stored in `sessions` between `/session/hybrid-init` and
// `/session/hybrid-finalize`. The session row's `status` stays
// 'pending' until finalize completes.
interface PendingHybridInit {
  sessionPrivateKey: `0x${string}`
  sessionKeyAddress: `0x${string}`
  delegationDraft: {
    delegator: `0x${string}`
    delegate: `0x${string}`
    authority: `0x${string}`
    caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
    salt: string
  }
  delegationHash: `0x${string}`
  accountAddress: `0x${string}`
  expiresAt: string
  variant: SessionVariant
  riskTier: ActionRiskTier
  // Variant B only — the userOp the server built that the user must sign.
  variantBUserOp?: {
    sender: `0x${string}`
    nonce: string
    initCode: `0x${string}`
    callData: `0x${string}`
    accountGasLimits: `0x${string}`
    preVerificationGas: string
    gasFees: `0x${string}`
    paymasterAndData: `0x${string}`
  }
  variantBUserOpHash?: `0x${string}`
}

// ─── Request / response body shapes ─────────────────────────────────

interface HybridInitBody {
  accountAddress: Address
  scope: ActionDescriptor[]
  /** Unix seconds. Clamped to the risk-tier TTL cap. */
  validUntil: number
  metadata?: Record<string, string>
}

interface HybridFinalizeBody {
  sessionId: string
  /** Variant A: user-signed EIP-712 delegation signature.
   *  Variant B: user-signed userOpHash signature. */
  signature: Hex
}

// ─── ROOT_AUTHORITY constant (matches DelegationManager.sol) ────────
const ROOT_AUTHORITY: Hex = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

// ─── Helper: chain config ───────────────────────────────────────────
function getChain() {
  return { ...localhost, id: config.CHAIN_ID }
}

// ─── Helper: pack two uint128 values into a bytes32 ─────────────────
function packTwo(high: bigint, low: bigint): `0x${string}` {
  if (high >= 2n ** 128n || low >= 2n ** 128n) throw new Error('packTwo: out of range')
  const v = (high << 128n) | low
  return ('0x' + v.toString(16).padStart(64, '0')) as `0x${string}`
}

// ─── Minimal EntryPoint v0.7 ABI ─────────────────────────────────────
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

// ─── Build the caveat array from scope ──────────────────────────────
//
// We derive a session delegation's caveats from the declared scope:
//   - TimestampEnforcer: validUntil
//   - AllowedTargetsEnforcer: union of every target address the scope
//     touches (resolved from `args.target` if provided)
//   - AllowedMethodsEnforcer: union of every selector the scope touches
//   - ValueEnforcer: max value = 0 (no ETH movement at the session
//     boundary; spec 005 pledge honor moves ERC20, not ETH)
//
// If the scope doesn't declare specific targets/selectors, we omit
// those enforcers (the on-chain DelegationManager will validate only
// what's present). The web side is expected to declare scope precisely;
// the a2a-agent doesn't infer.
interface ScopeArgsWithTargets {
  target?: Address
  selectors?: Hex[]
}

function buildSessionCaveats(
  scope: ActionDescriptor[],
  validUntil: number,
): Array<{ enforcer: `0x${string}`; terms: `0x${string}` }> {
  const caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }> = []

  // Always include TimestampEnforcer.
  if (config.TIMESTAMP_ENFORCER_ADDRESS.toLowerCase() !==
      '0x0000000000000000000000000000000000000000') {
    caveats.push({
      enforcer: config.TIMESTAMP_ENFORCER_ADDRESS,
      terms: encodeTimestampTerms(0, validUntil),
    })
  }

  // Collect targets + selectors from scope.args (when provided by caller).
  const targets = new Set<string>()
  const selectors = new Set<string>()
  for (const action of scope) {
    const args = action.args as ScopeArgsWithTargets | undefined
    if (args?.target) targets.add(args.target.toLowerCase())
    if (args?.selectors) for (const s of args.selectors) selectors.add(s.toLowerCase())
  }

  if (targets.size > 0 &&
      config.ALLOWED_TARGETS_ENFORCER_ADDRESS.toLowerCase() !==
        '0x0000000000000000000000000000000000000000') {
    caveats.push({
      enforcer: config.ALLOWED_TARGETS_ENFORCER_ADDRESS,
      terms: encodeAllowedTargetsTerms(
        Array.from(targets).map((t) => t as `0x${string}`),
      ),
    })
  }
  if (selectors.size > 0 &&
      config.ALLOWED_METHODS_ENFORCER_ADDRESS.toLowerCase() !==
        '0x0000000000000000000000000000000000000000') {
    caveats.push({
      enforcer: config.ALLOWED_METHODS_ENFORCER_ADDRESS,
      terms: encodeAllowedMethodsTerms(
        Array.from(selectors).map((s) => s as `0x${string}`),
      ),
    })
  }

  // Value cap: always 0 wei. ETH movement is not part of the session-key
  // surface in v1; payments use ERC-20 (see Spec 005 Pledge Honor).
  if (config.VALUE_ENFORCER_ADDRESS.toLowerCase() !==
      '0x0000000000000000000000000000000000000000') {
    caveats.push({
      enforcer: config.VALUE_ENFORCER_ADDRESS,
      terms: encodeValueTerms(0n),
    })
  }

  return caveats
}

// ─── POST /session/hybrid-init ──────────────────────────────────────
sessionInit.post('/hybrid-init', async (c) => {
  let body: HybridInitBody
  try {
    body = (await c.req.json()) as HybridInitBody
  } catch {
    return c.json({ error: 'malformed JSON body' }, 400)
  }

  // Validation.
  if (!body.accountAddress || !/^0x[a-fA-F0-9]{40}$/.test(body.accountAddress)) {
    return c.json({ error: 'accountAddress required (0x-address)' }, 400)
  }
  if (!Array.isArray(body.scope)) {
    return c.json({ error: 'scope required (array of ActionDescriptor)' }, 400)
  }
  if (typeof body.validUntil !== 'number' || body.validUntil <= 0) {
    return c.json({ error: 'validUntil required (unix seconds)' }, 400)
  }

  // Classify risk tier + choose variant.
  const riskTier = classifySessionRiskTier(body.scope)
  const variant: SessionVariant = variantForTier(riskTier)

  // Clamp validUntil to the TTL cap for the chosen tier.
  const nowSec = Math.floor(Date.now() / 1000)
  const requestedDurationSec = Math.max(0, body.validUntil - nowSec)
  const clampedDurationSec = clampSessionTtl(requestedDurationSec, tierForTtlClamp(riskTier))
  const expiresAt = new Date((nowSec + clampedDurationSec) * 1000).toISOString()
  const validUntilFinal = nowSec + clampedDurationSec

  // Generate fresh session key.
  const sessionPrivateKey = generatePrivateKey()
  const sessionAccount = privateKeyToAccount(sessionPrivateKey)
  const sessionId = `sa_${crypto.randomUUID().replace(/-/g, '')}`

  // Gasless-from-the-user: fund the session key with enough ETH for
  // ~100 redeem txs. The session key is the EVM tx sender at
  // `DM.redeemDelegation` time (Phase 1 chained-delegation), so it must
  // hold ETH — but the user never pays gas.
  //
  // Dev path (anvil): use the `anvil_setBalance` cheat-code — free, no
  // relay drain. The relay-signer's balance gets depleted fast otherwise
  // (each new session keeps 0.1 ETH, so 50 sessions = 5 ETH gone).
  //
  // Prod path (real chain): replace this with a paymaster userOp at
  // redeem time — paymaster sponsors gas, the session key holds none.
  // Out of scope for the local dev stack; tracked alongside the Option A
  // userOp pipeline plan (`output/CHAINED-DELEGATION-RESTORATION-PLAN.md`).
  if (process.env.NODE_ENV !== 'production') {
    try {
      // 1 ETH in hex, lowercase, no leading zeros after 0x — anvil's
      // `anvil_setBalance` is strict about the literal.
      const oneEth = '0xde0b6b3a7640000'
      const res = await fetch(config.RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'anvil_setBalance',
          params: [sessionAccount.address, oneEth],
        }),
      })
      const json = await res.json() as { error?: { message: string }; result?: unknown }
      if (json.error) {
        return c.json({ error: `Failed to fund session key (anvil_setBalance): ${json.error.message}` }, 502)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: `Failed to fund session key for gas: ${msg}` }, 502)
    }
  }

  // Build the D_root delegation — Phase 1 chained-delegation shape
  // (canonical, 2026-05-10; see `output/phase1-delegation-summary.md`):
  //
  //   delegator = user's AgentAccount
  //   delegate  = sessionKey EOA   (a2a-agent's per-session authority for
  //                                  this user; the user trusts a2a-agent
  //                                  via this delegation)
  //   caveats   = [Timestamp, AllowedTargets, AllowedMethods, Value,
  //                McpToolScope]
  //
  // For LOW-VALUE tools, sessionKey redeems D_root directly:
  //   DM.redeemDelegation([D_root], target, value, data)
  //   msg.sender = sessionKey = D_root.delegate ✓
  //
  // For HIGH-VALUE tools (Phase 2), sessionKey mints a per-call D_sub
  // delegating to a per-tool-family executor; executor redeems the
  // 2-hop chain. See `output/phase2-delegation-summary.md`.
  //
  // The leaf `delegate` of D_root is intentionally NOT the user's smart
  // account. The verify gates in `verify-delegation.ts` /
  // `delegation-token.ts` accept this shape. See
  // `output/CHAINED-DELEGATION-RESTORATION-PLAN.md` for unwind history.
  const saltHex = keccak256(toBytes(`hybrid-salt:${sessionId}`))
  const salt = BigInt(saltHex).toString()

  const caveats = buildSessionCaveats(body.scope, validUntilFinal)
  const delegationDraft = {
    delegator: body.accountAddress.toLowerCase() as `0x${string}`,
    delegate: sessionAccount.address.toLowerCase() as `0x${string}`,
    authority: ROOT_AUTHORITY,
    caveats,
    salt,
  }

  const delegationHash = hashDelegation(
    {
      delegator: delegationDraft.delegator,
      delegate: delegationDraft.delegate,
      authority: delegationDraft.authority,
      caveats: delegationDraft.caveats,
      salt: delegationDraft.salt,
    },
    config.CHAIN_ID,
    config.DELEGATION_MANAGER_ADDRESS,
  )

  // Build the pending-init pack.
  const pending: PendingHybridInit = {
    sessionPrivateKey,
    sessionKeyAddress: sessionAccount.address.toLowerCase() as `0x${string}`,
    delegationDraft,
    delegationHash,
    accountAddress: body.accountAddress.toLowerCase() as `0x${string}`,
    expiresAt,
    variant,
    riskTier,
  }

  let variantBResponse: { userOp: object; userOpHash: Hex } | null = null

  // Variant B branch — build the userOp.
  if (variant === 'B') {
    // The session-delegation hash registered on chain IS the
    // delegationHash. AgentAccount's `_acceptedSessionDelegations`
    // mapping is keyed by this hash; the DelegationManager's
    // redemption path verifies the off-chain signature AND consults
    // this mapping when a Variant B session is in play (the consult
    // is performed off-chain by the caveat-evaluator; the on-chain
    // checking happens via the standard caveat enforcer + the
    // off-chain redeem-policy check).
    //
    // Build the userOp: sender=user account, callData= execute(self, 0,
    // encodeAcceptSessionDelegation(delegationHash)). This routes
    // through onlySelf since execute() bottoms at `target.call`
    // where target=self.
    const acceptCallData = encodeFunctionData({
      abi: agentAccountAbi,
      functionName: 'acceptSessionDelegation',
      args: [delegationHash],
    })
    const innerCallData = encodeFunctionData({
      abi: agentAccountAbi,
      functionName: 'execute',
      args: [body.accountAddress, 0n, acceptCallData],
    })

    const pub = createPublicClient({ chain: getChain(), transport: http(config.RPC_URL) })
    const nonce = (await pub.readContract({
      address: config.ENTRYPOINT_ADDRESS,
      abi: entryPointMinimalAbi,
      functionName: 'getNonce',
      args: [body.accountAddress, 0n],
    })) as bigint

    const verificationGasLimit = 500_000n
    const callGasLimit = 2_000_000n
    const accountGasLimits = packTwo(verificationGasLimit, callGasLimit)
    const preVerificationGas = 100_000n
    const maxPriorityFeePerGas = 1n
    const maxFeePerGas = 1_000_000_000n
    const gasFees = packTwo(maxPriorityFeePerGas, maxFeePerGas)

    const paymasterAndData: Hex = (config.PAYMASTER_ADDRESS.toLowerCase() !==
      '0x0000000000000000000000000000000000000000')
      ? `0x${config.PAYMASTER_ADDRESS.slice(2)}${(100_000n).toString(16).padStart(32, '0')}${(50_000n).toString(16).padStart(32, '0')}` as Hex
      : '0x' as Hex

    const op = {
      sender: body.accountAddress,
      nonce,
      initCode: '0x' as Hex,
      callData: innerCallData,
      accountGasLimits,
      preVerificationGas,
      gasFees,
      paymasterAndData,
      signature: '0x' as Hex,
    }

    const userOpHash = (await pub.readContract({
      address: config.ENTRYPOINT_ADDRESS,
      abi: entryPointMinimalAbi,
      functionName: 'getUserOpHash',
      args: [op],
    })) as Hex

    pending.variantBUserOp = {
      sender: op.sender,
      nonce: op.nonce.toString(),
      initCode: op.initCode,
      callData: op.callData,
      accountGasLimits: op.accountGasLimits,
      preVerificationGas: op.preVerificationGas.toString(),
      gasFees: op.gasFees,
      paymasterAndData: op.paymasterAndData,
    }
    pending.variantBUserOpHash = userOpHash

    variantBResponse = {
      userOp: pending.variantBUserOp,
      userOpHash,
    }
  }

  // Encrypt + persist the pending-init pack. The session row stays
  // 'pending' until finalize completes.
  const sessionMeta = {
    sessionId,
    accountAddress: body.accountAddress,
    chainId: config.CHAIN_ID,
    expiresAt,
  }
  const encrypted = await encryptSessionPackage(pending, sessionMeta)

  await db.insert(sessions).values({
    id: sessionId,
    accountAddress: body.accountAddress.toLowerCase(),
    sessionKeyAddress: sessionAccount.address.toLowerCase(),
    encryptedPackage: encrypted.ciphertext,
    iv: encrypted.iv,
    encryptedDataKey: encrypted.encryptedDataKey,
    keyVersion: encrypted.keyVersion,
    kmsKeyId: encrypted.kmsKeyId,
    status: 'pending',
    expiresAt,
    createdAt: new Date().toISOString(),
    variant,
    riskTier,
    sessionDelegationHash: delegationHash,
  })

  // Audit row.
  try {
    await auditAppend({
      rootGrantHash: '',
      sessionId,
      sessionPrincipal: sessionAccount.address,
      mcpServer: 'a2a-agent',
      mcpTool: 'session:hybrid-init',
      eventType: 'session-create',
      executionPath: 'mcp-only',
      target: body.accountAddress,
      status: 'completed',
      correlationId: readCorrelationId(c),
      mcpCallId: `session-hybrid-init:${sessionId}`,
    })
  } catch (err) {
    console.error('[session/hybrid-init audit] failed:', err)
  }

  if (variant === 'A') {
    // Build the EIP-712 typed-data signing payload for the client.
    const caveatsHash = hashCaveats(delegationDraft.caveats)
    return c.json({
      variant: 'A',
      sessionId,
      sessionKeyAddress: sessionAccount.address,
      delegationHash,
      riskTier,
      validUntil: validUntilFinal,
      signingPayload: {
        domain: {
          name: 'AgentDelegationManager',
          version: '1',
          chainId: config.CHAIN_ID,
          verifyingContract: config.DELEGATION_MANAGER_ADDRESS,
        },
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          Delegation: [
            { name: 'delegator', type: 'address' },
            { name: 'delegate', type: 'address' },
            { name: 'authority', type: 'bytes32' },
            { name: 'caveatsHash', type: 'bytes32' },
            { name: 'salt', type: 'uint256' },
          ],
        },
        primaryType: 'Delegation',
        message: {
          delegator: delegationDraft.delegator,
          delegate: delegationDraft.delegate,
          authority: delegationDraft.authority,
          caveatsHash,
          salt,
        },
      },
    })
  } else {
    // Variant B.
    if (!variantBResponse) {
      // Defensive — Variant B always builds a userOp above.
      return c.json({ error: 'internal: Variant B userOp build failed' }, 500)
    }
    return c.json({
      variant: 'B',
      sessionId,
      sessionKeyAddress: sessionAccount.address,
      sessionDelegationHash: delegationHash,
      riskTier,
      validUntil: validUntilFinal,
      userOp: variantBResponse.userOp,
      userOpHash: variantBResponse.userOpHash,
    })
  }
})

// ─── POST /session/hybrid-finalize ──────────────────────────────────
sessionInit.post('/hybrid-finalize', async (c) => {
  let body: HybridFinalizeBody
  try {
    body = (await c.req.json()) as HybridFinalizeBody
  } catch {
    return c.json({ error: 'malformed JSON body' }, 400)
  }
  if (!body.sessionId || !body.signature) {
    return c.json({ error: 'sessionId and signature required' }, 400)
  }

  // Resolve the pending session row.
  const [row] = await db.select().from(sessions).where(eq(sessions.id, body.sessionId)).limit(1)
  if (!row) {
    return c.json({ error: 'session not found' }, 404)
  }
  if (row.status !== 'pending') {
    return c.json({ error: `session not pending (status=${row.status})` }, 400)
  }
  if (!row.encryptedPackage || !row.iv) {
    return c.json({ error: 'pending session missing encrypted package' }, 500)
  }
  if (new Date(row.expiresAt) < new Date()) {
    return c.json({ error: 'session expired' }, 401)
  }

  // Decrypt the pending pack.
  const sessionMeta = {
    sessionId: row.id,
    accountAddress: row.accountAddress,
    chainId: config.CHAIN_ID,
    expiresAt: row.expiresAt,
  }
  const pending = await decryptSessionPackage<PendingHybridInit>(
    {
      encryptedPackage: row.encryptedPackage,
      iv: row.iv,
      encryptedDataKey: row.encryptedDataKey,
      keyVersion: row.keyVersion,
      kmsKeyId: row.kmsKeyId,
    },
    sessionMeta,
  )

  const publicClient = createPublicClient({
    chain: getChain(),
    transport: http(config.RPC_URL),
  })

  if (pending.variant === 'A') {
    // Variant A — verify ERC-1271 signature over the delegationHash
    // against the user's smart account.
    let result: `0x${string}`
    try {
      result = (await publicClient.readContract({
        address: pending.accountAddress,
        abi: agentAccountAbi,
        functionName: 'isValidSignature',
        args: [pending.delegationHash, body.signature],
      })) as `0x${string}`
    } catch (err) {
      return errorResponse(c, {
        publicMessage: 'Delegation signature invalid',
        logMessage: '[session/hybrid-finalize] ERC-1271 verification threw',
        logFields: {
          sessionId: body.sessionId,
          errorMessage: err instanceof Error ? err.message : 'unknown',
        },
        status: 401,
      })
    }
    if (result !== ERC1271_MAGIC_VALUE) {
      return errorResponse(c, {
        publicMessage: 'Delegation signature invalid',
        logMessage: '[session/hybrid-finalize] ERC-1271 rejected',
        logFields: {
          sessionId: body.sessionId,
          delegationHash: pending.delegationHash,
        },
        status: 401,
      })
    }

    // Persist the active session pack with the signed delegation.
    const activePackage: HybridSessionPackage = {
      sessionPrivateKey: pending.sessionPrivateKey,
      sessionKeyAddress: pending.sessionKeyAddress,
      delegation: {
        delegator: pending.delegationDraft.delegator,
        delegate: pending.delegationDraft.delegate,
        authority: pending.delegationDraft.authority,
        caveats: pending.delegationDraft.caveats.map((cv) => ({
          enforcer: cv.enforcer,
          terms: cv.terms,
        })),
        salt: pending.delegationDraft.salt,
        signature: body.signature,
      },
      accountAddress: pending.accountAddress,
      expiresAt: pending.expiresAt,
      variant: 'A',
      riskTier: pending.riskTier,
    }
    const encrypted = await encryptSessionPackage(activePackage, sessionMeta)
    await db
      .update(sessions)
      .set({
        encryptedPackage: encrypted.ciphertext,
        iv: encrypted.iv,
        encryptedDataKey: encrypted.encryptedDataKey,
        keyVersion: encrypted.keyVersion,
        kmsKeyId: encrypted.kmsKeyId,
        status: 'active',
      })
      .where(eq(sessions.id, body.sessionId))

    try {
      await auditAppend({
        rootGrantHash: pending.delegationHash,
        sessionId: body.sessionId,
        sessionPrincipal: pending.sessionKeyAddress,
        mcpServer: 'a2a-agent',
        mcpTool: 'session:hybrid-finalize',
        eventType: 'session-package',
        executionPath: 'mcp-only',
        target: pending.accountAddress,
        status: 'completed',
        correlationId: readCorrelationId(c),
        mcpCallId: `session-hybrid-finalize:${body.sessionId}`,
      })
    } catch (err) {
      console.error('[session/hybrid-finalize audit] failed:', err)
    }

    return c.json({ status: 'active', sessionId: body.sessionId, variant: 'A' })
  }

  // Variant B branch.
  if (!pending.variantBUserOp || !pending.variantBUserOpHash) {
    return c.json({ error: 'Variant B userOp not staged' }, 500)
  }

  // Attach the user signature to the staged userOp.
  const signedOp = {
    sender: pending.variantBUserOp.sender,
    nonce: BigInt(pending.variantBUserOp.nonce),
    initCode: pending.variantBUserOp.initCode,
    callData: pending.variantBUserOp.callData,
    accountGasLimits: pending.variantBUserOp.accountGasLimits,
    preVerificationGas: BigInt(pending.variantBUserOp.preVerificationGas),
    gasFees: pending.variantBUserOp.gasFees,
    paymasterAndData: pending.variantBUserOp.paymasterAndData,
    signature: body.signature,
  }

  // Submit via EntryPoint.handleOps; master is RELAY-ONLY (Phase B §
  // Step 4). The relay-only signer's signMessage throws — only its
  // signTransaction is live for paying L1 gas. viem's
  // `writeContract` invokes `signTransaction` on the underlying
  // account when broadcasting; the relay-only wrapper exposes that
  // surface explicitly.
  let txHash: `0x${string}`
  try {
    const relay = await getRelayOnlySigner()
    const wallet = createWalletClient({
      account: relay.account, // underlying LocalAccount used for tx broadcast
      chain: getChain(),
      transport: http(config.RPC_URL),
    })
    txHash = await wallet.writeContract({
      address: config.ENTRYPOINT_ADDRESS,
      abi: entryPointMinimalAbi,
      functionName: 'handleOps',
      args: [[signedOp], relay.address],
      account: relay.account,
      chain: wallet.chain ?? null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: `Variant B userOp submission failed: ${msg}` }, 502)
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    return c.json({ error: 'Variant B handleOps reverted', txHash }, 502)
  }

  // Verify on-chain acceptance.
  const accepted = (await publicClient.readContract({
    address: pending.accountAddress,
    abi: agentAccountAbi,
    functionName: 'hasAcceptedSessionDelegation',
    args: [pending.delegationHash],
  })) as boolean
  if (!accepted) {
    return c.json({
      error: 'Variant B on-chain registration did not land',
      txHash,
    }, 502)
  }

  // For Variant B we still persist the user-signed delegation for
  // off-chain ERC-1271 checks at redeem time — but the on-chain
  // `_acceptedSessionDelegations` mapping is the load-bearing gate.
  // Phase B Variant B redemption assumes the on-chain acceptance has
  // already happened (this finalize confirmed it).
  //
  // We DO NOT have the user's EIP-712 signature for Variant B — the
  // user signed the userOpHash, not the delegation directly. That's
  // fine: the on-chain acceptance is the authority binding. The
  // signature field on the persisted delegation is set to '0x' so a
  // later redemption path knows to consult the on-chain mapping
  // instead of attempting ERC-1271 verification.
  const activePackage: HybridSessionPackage = {
    sessionPrivateKey: pending.sessionPrivateKey,
    sessionKeyAddress: pending.sessionKeyAddress,
    delegation: {
      delegator: pending.delegationDraft.delegator,
      delegate: pending.delegationDraft.delegate,
      authority: pending.delegationDraft.authority,
      caveats: pending.delegationDraft.caveats.map((cv) => ({
        enforcer: cv.enforcer,
        terms: cv.terms,
      })),
      salt: pending.delegationDraft.salt,
      // Phase B Variant B — `signature: '0x'` is the marker that the
      // delegation's authority is bound on chain (not via off-chain
      // ERC-1271). The redemption path checks
      // `hasAcceptedSessionDelegation(hash)` instead of replaying an
      // ECDSA recovery.
      signature: '0x',
    },
    accountAddress: pending.accountAddress,
    expiresAt: pending.expiresAt,
    variant: 'B',
    riskTier: pending.riskTier,
  }
  const encrypted = await encryptSessionPackage(activePackage, sessionMeta)
  await db
    .update(sessions)
    .set({
      encryptedPackage: encrypted.ciphertext,
      iv: encrypted.iv,
      encryptedDataKey: encrypted.encryptedDataKey,
      keyVersion: encrypted.keyVersion,
      kmsKeyId: encrypted.kmsKeyId,
      status: 'active',
      onChainAcceptedTxHash: txHash,
    })
    .where(eq(sessions.id, body.sessionId))

  try {
    await auditAppend({
      rootGrantHash: pending.delegationHash,
      sessionId: body.sessionId,
      sessionPrincipal: pending.sessionKeyAddress,
      mcpServer: 'a2a-agent',
      mcpTool: 'session:hybrid-finalize',
      eventType: 'session-package',
      executionPath: 'session-account',
      target: pending.accountAddress,
      status: 'completed',
      correlationId: readCorrelationId(c),
      mcpCallId: `session-hybrid-finalize:${body.sessionId}`,
    })
  } catch (err) {
    console.error('[session/hybrid-finalize audit] failed:', err)
  }

  return c.json({
    status: 'active',
    sessionId: body.sessionId,
    variant: 'B',
    onChainAcceptedTxHash: txHash,
  })
})

export { sessionInit }

// Suppress unused-import sigils.
void sqliteHandle
void getMasterSigner
void toFunctionSelector
void buildCaveat
void delegationDomainSeparator
void classifyRiskTier
