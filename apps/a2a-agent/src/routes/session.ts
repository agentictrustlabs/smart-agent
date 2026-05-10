import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { localhost } from 'viem/chains'
import {
  encryptPayload,
  decryptPayload,
  randomHex,
  hashDelegation,
  agentAccountAbi,
  sessionAgentAccountFactoryAbi,
} from '@smart-agent/sdk'
import { db } from '../db'
import { sessions } from '../db/schema'
import { config } from '../config'
import { requireSession } from '../middleware/require-session'

const ERC1271_MAGIC_VALUE = '0x1626ba7e'

const session = new Hono()

// ─── POST /session/init ─────────────────────────────────────────────
// NO AUTH REQUIRED — just generates a keypair and stores it.
// The session stays 'pending' until /session/package is called
// with a valid delegation signature (which IS the authentication).
// Only returns the session ID and public key — no sensitive data.

interface StatefulSessionPolicy {
  /** Per-asset ETH/ERC-20 budget. Asset `address(0)` for native ETH. */
  spendCap?: { asset: Address; max: string }[]
  /** Rolling-window call cap. */
  rateLimit?: { windowSeconds: number; maxCalls: number }
  /** (target, selector) tuples to seed the allowlist hook. */
  allowedCalls?: { target: Address; selector: Hex }[]
}

session.post('/init', async (c) => {
  const body = await c.req.json<{
    accountAddress: string
    durationSeconds?: number
    /** Phase 3 — when true, deploy a SessionAgentAccount and route the
     *  session through `executionPath='session-account'`. The user's root
     *  delegation in /session/package is then expected to target the
     *  deployed account address rather than the session-key EOA. */
    stateful?: boolean
    /** Required iff `stateful=true`. Configures the first-party modules
     *  installed on the SessionAgentAccount at deploy time. */
    policy?: StatefulSessionPolicy
  }>()

  if (!body.accountAddress) {
    return c.json({ error: 'accountAddress is required' }, 400)
  }

  const durationSeconds = body.durationSeconds ?? 86400

  // Generate ephemeral session keypair
  const sessionPrivateKey = generatePrivateKey()
  const sessionAccount = privateKeyToAccount(sessionPrivateKey)

  const sessionId = `sa_${crypto.randomUUID().replace(/-/g, '')}`
  const expiresAt = new Date(Date.now() + durationSeconds * 1000)

  // ─── Optionally deploy a stateful SessionAgentAccount ───────────────
  let sessionAgentAccount: Address | null = null
  if (body.stateful) {
    try {
      sessionAgentAccount = await deploySessionAgentAccount({
        sessionId,
        userOwner: body.accountAddress as Address,
        sessionKeyAddress: sessionAccount.address,
        durationSeconds,
        policy: body.policy ?? {},
      })
    } catch (err) {
      return c.json(
        { error: `failed to deploy SessionAgentAccount: ${err instanceof Error ? err.message : 'unknown'}` },
        500,
      )
    }
  }

  // Encrypt and store the session private key
  const encrypted = await encryptPayload(
    { sessionPrivateKey },
    config.A2A_SESSION_SECRET,
  )

  await db.insert(sessions).values({
    id: sessionId,
    accountAddress: body.accountAddress,
    sessionKeyAddress: sessionAccount.address,
    encryptedPackage: encrypted.ciphertext,
    iv: encrypted.iv,
    status: 'pending',
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    sessionAgentAccount: sessionAgentAccount ?? undefined,
  })

  return c.json({
    sessionId,
    sessionKeyAddress: sessionAccount.address,
    sessionAgentAccount,
    durationSeconds,
    expiresAt: expiresAt.toISOString(),
  })
})

// ─── Stateful session-account deploy helper ──────────────────────────
//
// Calls SessionAgentAccountFactory.deploySession with:
//   - validators: [ECDSASessionValidator] keyed to the session EOA
//   - hooks:      [SpendCapHook?, RateLimitHook?, TargetSelectorAllowlistHook?]
//                 depending on which fields are present in the policy
// Signed from the a2a-agent master EOA (config.A2A_MASTER_EOA_PRIVATE_KEY).
// Returns the deployed account address.
async function deploySessionAgentAccount(input: {
  sessionId: string
  userOwner: Address
  sessionKeyAddress: Address
  durationSeconds: number
  policy: StatefulSessionPolicy
}): Promise<Address> {
  const masterEoa = privateKeyToAccount(config.A2A_MASTER_EOA_PRIVATE_KEY)
  const chain = { ...localhost, id: config.CHAIN_ID }
  const wallet = createWalletClient({ account: masterEoa, chain, transport: http(config.RPC_URL) })
  const pub = createPublicClient({ chain, transport: http(config.RPC_URL) })

  const validators: Address[] = []
  const validatorInits: Hex[] = []
  const hooks: Address[] = []
  const hookInits: Hex[] = []

  // Always install the ECDSASessionValidator pinned to this session EOA.
  if (config.ECDSA_SESSION_VALIDATOR_ADDRESS !== '0x0000000000000000000000000000000000000000') {
    validators.push(config.ECDSA_SESSION_VALIDATOR_ADDRESS)
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + input.durationSeconds)
    validatorInits.push(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address' },
          { type: 'uint256' },
        ],
        [keccak256(toBytes(input.sessionId)), input.sessionKeyAddress, expiresAt],
      ),
    )
  }

  // Optional hooks.
  if (input.policy.spendCap && input.policy.spendCap.length > 0) {
    if (config.SPEND_CAP_HOOK_ADDRESS !== '0x0000000000000000000000000000000000000000') {
      hooks.push(config.SPEND_CAP_HOOK_ADDRESS)
      const assets = input.policy.spendCap.map((s) => s.asset)
      const budgets = input.policy.spendCap.map((s) => BigInt(s.max))
      hookInits.push(
        encodeAbiParameters(
          [{ type: 'address[]' }, { type: 'uint256[]' }],
          [assets, budgets],
        ),
      )
    }
  }
  if (input.policy.rateLimit) {
    if (config.RATE_LIMIT_HOOK_ADDRESS !== '0x0000000000000000000000000000000000000000') {
      hooks.push(config.RATE_LIMIT_HOOK_ADDRESS)
      hookInits.push(
        encodeAbiParameters(
          [{ type: 'uint256' }, { type: 'uint256' }],
          [BigInt(input.policy.rateLimit.windowSeconds), BigInt(input.policy.rateLimit.maxCalls)],
        ),
      )
    }
  }
  if (input.policy.allowedCalls && input.policy.allowedCalls.length > 0) {
    if (config.TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS !== '0x0000000000000000000000000000000000000000') {
      hooks.push(config.TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS)
      const targets = input.policy.allowedCalls.map((c) => c.target)
      const selectors = input.policy.allowedCalls.map((c) => c.selector)
      hookInits.push(
        encodeAbiParameters(
          [{ type: 'address[]' }, { type: 'bytes4[]' }],
          [targets, selectors],
        ),
      )
    }
  }

  // Salt = keccak256(userOwner, sessionId) for deterministic, collision-free deploys.
  const salt = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes32' }],
      [input.userOwner, keccak256(toBytes(input.sessionId))],
    ),
  )

  const txHash = await wallet.writeContract({
    address: config.SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS,
    abi: sessionAgentAccountFactoryAbi,
    functionName: 'deploySession',
    args: [input.userOwner, salt, validators, validatorInits, hooks, hookInits],
    account: masterEoa,
    chain: wallet.chain ?? null,
  })
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    throw new Error('deploySession reverted')
  }
  // Read counterfactual address — matches deployed address.
  const account = (await pub.readContract({
    address: config.SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS,
    abi: sessionAgentAccountFactoryAbi,
    functionName: 'getAddress',
    args: [input.userOwner, salt],
  })) as Address
  void toHex
  return account
}

// ─── POST /session/package ──────────────────────────────────────────
// SELF-AUTHENTICATING — the delegation signature proves the caller
// controls the delegator's smart account (verified via ERC-1271).
// No bearer token required. The signature IS the authentication.

session.post('/package', async (c) => {
  const body = await c.req.json<{
    sessionId: string
    delegation: {
      delegator: string
      delegate: string
      authority: string
      caveats: Array<{ enforcer: string; terms: string }>
      salt: string
      signature: string
    }
  }>()

  if (!body.sessionId || !body.delegation?.signature) {
    return c.json({ error: 'sessionId and signed delegation required' }, 400)
  }

  // Find the pending session
  const [pendingSession] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, body.sessionId))
    .limit(1)

  if (!pendingSession) {
    return c.json({ error: 'Session not found' }, 404)
  }

  if (pendingSession.status !== 'pending') {
    return c.json({ error: 'Session already activated or revoked' }, 400)
  }

  // Verify delegation.delegate matches the session key we generated
  if (!pendingSession.sessionKeyAddress ||
      body.delegation.delegate.toLowerCase() !== pendingSession.sessionKeyAddress.toLowerCase()) {
    return c.json({ error: 'Delegation delegate does not match session key' }, 400)
  }

  // Verify delegation.delegator matches the account address on the session
  if (body.delegation.delegator.toLowerCase() !== pendingSession.accountAddress.toLowerCase()) {
    return c.json({ error: 'Delegation delegator does not match session account' }, 400)
  }

  // ─── ERC-1271: Verify the delegation signature on-chain ─────────
  // This is the authentication — proves the caller controls the delegator's smart account.
  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.CHAIN_ID },
    transport: http(config.RPC_URL),
  })

  const delegationHash = hashDelegation(
    {
      delegator: body.delegation.delegator as `0x${string}`,
      delegate: body.delegation.delegate as `0x${string}`,
      authority: body.delegation.authority as `0x${string}`,
      caveats: body.delegation.caveats.map(c => ({
        enforcer: c.enforcer as `0x${string}`,
        terms: c.terms as `0x${string}`,
      })),
      salt: body.delegation.salt,
    },
    config.CHAIN_ID,
    config.DELEGATION_MANAGER_ADDRESS,
  )

  try {
    const result = await publicClient.readContract({
      address: body.delegation.delegator as `0x${string}`,
      abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [delegationHash, body.delegation.signature as `0x${string}`],
    })

    if (result !== ERC1271_MAGIC_VALUE) {
      // Detailed diagnostics so we can see WHY a passkey signature is
      // rejected. Helpful when the OS picker offered a credential whose
      // digest isn't in the account's _passkeys mapping, or when the
      // clientDataJSON challenge doesn't decode to the delegation hash.
      const sig = body.delegation.signature as `0x${string}`
      const sigPrefix = sig.slice(0, 4) // '0x01' for WebAuthn, plain for ECDSA
      let diag = ''
      if (sigPrefix === '0x01') {
        try {
          // Decode the WebAuthn assertion struct to see which digest the
          // client submitted vs what's actually registered on the account.
          const { decodeAbiParameters } = await import('viem')
          const [a] = decodeAbiParameters(
            [{ type: 'tuple', components: [
              { name: 'authenticatorData',  type: 'bytes'   },
              { name: 'clientDataJSON',     type: 'string'  },
              { name: 'challengeIndex',     type: 'uint256' },
              { name: 'typeIndex',          type: 'uint256' },
              { name: 'r',                  type: 'uint256' },
              { name: 's',                  type: 'uint256' },
              { name: 'credentialIdDigest', type: 'bytes32' },
            ]}],
            ('0x' + sig.slice(4)) as `0x${string}`,
          ) as unknown as [{ credentialIdDigest: string; clientDataJSON: string }]
          const passkeyCount = await publicClient.readContract({
            address: body.delegation.delegator as `0x${string}`,
            abi: agentAccountAbi,
            functionName: 'passkeyCount',
          }) as bigint
          const stored = await publicClient.readContract({
            address: body.delegation.delegator as `0x${string}`,
            abi: agentAccountAbi,
            functionName: 'getPasskey',
            args: [a.credentialIdDigest as `0x${string}`],
          }) as readonly [bigint, bigint]
          diag = ` (sig path=passkey, account passkeyCount=${passkeyCount}, submitted digest=${a.credentialIdDigest}, getPasskey(digest)=(${stored[0]}, ${stored[1]}), clientDataJSON=${a.clientDataJSON.slice(0, 80)}…, hash=${delegationHash})`
        } catch (e) {
          diag = ` (assertion decode failed: ${(e as Error).message})`
        }
      } else {
        diag = ` (sig path=ECDSA, prefix=${sigPrefix})`
      }
      console.warn('[session/package] ERC-1271 rejected', diag)
      return c.json({ error: `Delegation signature invalid — ERC-1271 rejected${diag}` }, 401)
    }
  } catch (err) {
    return c.json({ error: `ERC-1271 verification failed: ${err instanceof Error ? err.message : 'unknown'}` }, 401)
  }

  // ─── Signature verified — activate the session ──────────────────

  if (!pendingSession.encryptedPackage || !pendingSession.iv) {
    return c.json({ error: 'Session missing encrypted data' }, 500)
  }

  // Decrypt stored session private key
  const storedData = await decryptPayload<{ sessionPrivateKey: string }>(
    { ciphertext: pendingSession.encryptedPackage, iv: pendingSession.iv },
    config.A2A_SESSION_SECRET,
  )

  // Build full session package and re-encrypt
  const fullPackage = {
    sessionPrivateKey: storedData.sessionPrivateKey,
    sessionKeyAddress: pendingSession.sessionKeyAddress,
    delegation: body.delegation,
    accountAddress: pendingSession.accountAddress,
    expiresAt: pendingSession.expiresAt,
  }

  const encrypted = await encryptPayload(fullPackage, config.A2A_SESSION_SECRET)

  // Activate
  await db
    .update(sessions)
    .set({
      encryptedPackage: encrypted.ciphertext,
      iv: encrypted.iv,
      status: 'active',
    })
    .where(eq(sessions.id, body.sessionId))

  return c.json({ status: 'active', sessionId: body.sessionId })
})

// ─── GET /session/:id ───────────────────────────────────────────────

session.get('/:id', requireSession, async (c) => {
  const authSession = c.get('session')
  const id = c.req.param('id')

  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)

  if (!row) return c.json({ error: 'Session not found' }, 404)
  if (row.accountAddress !== authSession.accountAddress) return c.json({ error: 'Forbidden' }, 403)

  return c.json({
    id: row.id,
    accountAddress: row.accountAddress,
    sessionKeyAddress: row.sessionKeyAddress,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  })
})

// ─── DELETE /session/:id ────────────────────────────────────────────

session.delete('/:id', requireSession, async (c) => {
  const authSession = c.get('session')
  const id = c.req.param('id')

  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)

  if (!row) return c.json({ error: 'Session not found' }, 404)
  if (row.accountAddress !== authSession.accountAddress) return c.json({ error: 'Forbidden' }, 403)

  await db.update(sessions).set({ status: 'revoked' }).where(eq(sessions.id, id))
  return c.json({ status: 'revoked' })
})

export { session }
