/**
 * Production-shape "agent registers itself" helper.
 *
 * This is the seed-time twin of the runtime flow: in production, a real
 * user comes in via passkey or MetaMask, and their FIRST action lands on
 * chain as an ERC-4337 userOp whose `sender` is their AgentAccount. That
 * userOp typically calls `AgentAccount.execute(resolver, 0, register(self, …))`,
 * which means at the resolver `msg.sender == agent` — which the new
 * resolver self-call early-return accepts without a co-owner relay.
 *
 * The demo seed reproduces that shape: each agent has its OWN owner EOA
 * (simulating the user's passkey/MetaMask wallet), and that EOA signs the
 * userOp envelope. The master signer is a CO-owner of every smart
 * account (per the factory's `serverSigner` wiring) but does NOT sign
 * user-initiated actions here — master is reserved for the bundler /
 * relay role at `EntryPoint.handleOps` submission and for future
 * session-delegation issuance.
 *
 * DEPLOY/SEED-TIME ONLY. Lives under `apps/web/src/lib/demo-seed/**`,
 * which is on the K6 allowlist in `scripts/check-no-bypass.sh`. Even
 * though this module does NOT itself read `DEPLOYER_PRIVATE_KEY` (its
 * whole point is to AVOID the deployer pattern), it co-locates with
 * the rest of the seed for symmetry.
 */

import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from 'viem'
import { foundry, sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  agentAccountAbi,
  agentAccountFactoryAbi,
  agentAccountResolverAbi,
  geoClaimRegistryAbi,
  GeoFeatureClient,
  GEO_REL_OPERATES_IN,
  GEO_REL_RESIDENT_OF,
  type GeoRelation,
} from '@smart-agent/sdk'

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

// ─── Chain + env wiring ───────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

function getChain() {
  if (CHAIN_ID === 31337) return foundry
  if (CHAIN_ID === 11155111) return sepolia
  return foundry
}

function requireEnv(name: string): Address {
  const v = process.env[name] as Address | undefined
  if (!v) throw new Error(`[agent-self-register] ${name} not set`)
  return v
}

// ─── Submitter (EntryPoint.handleOps relayer) ────────────────────────
//
// We submit handleOps via the SAME `getWalletClient()` the rest of the
// seed uses — the deployer EOA, wrapped in a process-wide nonce lock so
// concurrent boot-seed writes don't race on `getTransactionCount`. The
// relayer pays gas (the userOp's paymaster sponsors the inner call) and
// is NOT a co-owner of the agent. The userOp's own signature carries
// the authority; the relayer is purely a transport layer.
//
// In production this surface is unused: real users come through the
// a2a-agent runtime path, which already routes handleOps via
// `getMasterSigner()`. The seed-time deployer-relayer is local-dev
// only.

// ─── EntryPoint v0.7 minimal ABI ─────────────────────────────────────

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
// gas-limit / gas-fee layout (high << 128 | low).
function packTwo(high: bigint, low: bigint): Hex {
  if (high >= 2n ** 128n || low >= 2n ** 128n) throw new Error('packTwo: out of range')
  const v = (high << 128n) | low
  return ('0x' + v.toString(16).padStart(64, '0')) as Hex
}

// ─── Call-builder types ──────────────────────────────────────────────

/**
 * A single (target, value, data) call to execute from inside the agent's
 * smart account. Used to compose the userOp callData via either
 * `AgentAccount.execute(target, value, data)` (single) or
 * `AgentAccount.executeBatch([{target,value,data}, …])` (multiple).
 */
export interface AgentCall {
  target: Address
  value: bigint
  data: Hex
}

/**
 * High-level: register `smartAccount` as a first-class agent on chain.
 *
 * The whole thing lands as ONE atomic ERC-4337 userOp:
 *   sender    = smartAccount
 *   callData  = AgentAccount.execute(resolver, 0, register(self, …))
 *               or executeBatch([register, …setProperty(…)]) if `properties`
 *               is non-empty.
 *   signature = ECDSA over userOpHash, signed by `signerAccount`
 *               (the agent's OWN owner EOA — simulating passkey/MetaMask).
 *
 * If the smart account hasn't been deployed yet, the userOp's `initCode`
 * counterfactually deploys it in the same submission via
 * `AgentAccountFactory.createAccount(signerAccount.address, salt)`.
 *
 * @returns the userOp hash and the L1 tx hash that included the handleOps.
 */
export async function registerAgentAsSelf(opts: {
  /** The agent's smart account address (counterfactual or already-deployed). */
  smartAccount: Address
  /** Owner EOA of the smart account (signs the userOp envelope). */
  signerAccount: PrivateKeyAccount
  /** Deterministic CREATE2 salt the factory should use if `initCode` is needed. */
  salt: bigint
  /** Display name (resolver.register's `displayName`). */
  name: string
  /** Description (resolver.register's `description`). May be empty. */
  description?: string
  /** Resolver type bytes32 (e.g., `keccak256("atl:OrganizationAgent")`). */
  agentType: Hex
  /** Optional batched property writes to land in the same userOp. */
  properties?: AgentProperty[]
  /** Optional label for debug logs. */
  label?: string
}): Promise<{ userOpHash: Hex; txHash: Hex }> {
  const resolverAddr = requireEnv('AGENT_ACCOUNT_RESOLVER_ADDRESS')
  const factoryAddr = requireEnv('AGENT_FACTORY_ADDRESS')
  const entryPointAddr = requireEnv('ENTRYPOINT_ADDRESS')
  const paymasterAddr = (process.env.PAYMASTER_ADDRESS as Address | undefined) ?? '0x0000000000000000000000000000000000000000'

  // ─── Build the inner call list ───────────────────────────────────
  const registerCall: AgentCall = {
    target: resolverAddr,
    value: 0n,
    data: encodeFunctionData({
      abi: agentAccountResolverAbi,
      functionName: 'register',
      args: [
        opts.smartAccount,
        opts.name,
        opts.description ?? '',
        opts.agentType,
        ZERO_HASH,
        '',
      ],
    }),
  }

  const propertyCalls: AgentCall[] = (opts.properties ?? []).map((p) =>
    encodePropertyCall(resolverAddr, opts.smartAccount, p),
  )

  const calls = [registerCall, ...propertyCalls]
  return submitAgentUserOp({
    smartAccount: opts.smartAccount,
    signerAccount: opts.signerAccount,
    salt: opts.salt,
    factoryAddr,
    entryPointAddr,
    paymasterAddr,
    calls,
    label: opts.label ?? `register(${opts.name})`,
  })
}

/**
 * Generic "execute a batch of calls as the agent" surface. Use when the
 * target isn't the resolver (e.g. GeoClaimRegistry.mint, where the
 * registry checks `msg.sender == subject` for self-asserted claims) but
 * the auth model still requires `msg.sender == agent`.
 *
 * The runtime equivalent is `apps/a2a-agent/src/routes/onchain-redeem.ts`
 * (Option A) — the userOp's sender is the agent, calldata is the batch
 * to execute, signature is the agent's owner-EOA over userOpHash.
 *
 * @returns the userOp hash and the L1 tx hash that included the handleOps.
 */
export async function executeCallsAsAgent(opts: {
  smartAccount: Address
  signerAccount: PrivateKeyAccount
  salt: bigint
  calls: AgentCall[]
  label?: string
}): Promise<{ userOpHash: Hex; txHash: Hex }> {
  if (opts.calls.length === 0) {
    throw new Error('[agent-self-register] executeCallsAsAgent called with empty calls[]')
  }
  const factoryAddr = requireEnv('AGENT_FACTORY_ADDRESS')
  const entryPointAddr = requireEnv('ENTRYPOINT_ADDRESS')
  const paymasterAddr = (process.env.PAYMASTER_ADDRESS as Address | undefined) ?? '0x0000000000000000000000000000000000000000'
  return submitAgentUserOp({
    smartAccount: opts.smartAccount,
    signerAccount: opts.signerAccount,
    salt: opts.salt,
    factoryAddr,
    entryPointAddr,
    paymasterAddr,
    calls: opts.calls,
    label: opts.label ?? `exec[${opts.calls.length}]`,
  })
}

/**
 * Lower-level companion to `registerAgentAsSelf`: post-registration writes
 * to the resolver (setProperty / addMultiAddressProperty / …) signed by
 * the agent's OWN owner EOA. Use when the agent is already registered
 * (typical: a second seed pass that adds geo / controller properties).
 *
 * @returns the userOp hash and the L1 tx hash that included the handleOps.
 */
export async function writeAgentPropertiesAsSelf(opts: {
  smartAccount: Address
  signerAccount: PrivateKeyAccount
  salt: bigint
  properties: AgentProperty[]
  label?: string
}): Promise<{ userOpHash: Hex; txHash: Hex }> {
  if (opts.properties.length === 0) {
    throw new Error('[agent-self-register] writeAgentPropertiesAsSelf called with empty properties[]')
  }
  const resolverAddr = requireEnv('AGENT_ACCOUNT_RESOLVER_ADDRESS')
  const factoryAddr = requireEnv('AGENT_FACTORY_ADDRESS')
  const entryPointAddr = requireEnv('ENTRYPOINT_ADDRESS')
  const paymasterAddr = (process.env.PAYMASTER_ADDRESS as Address | undefined) ?? '0x0000000000000000000000000000000000000000'

  const calls = opts.properties.map((p) =>
    encodePropertyCall(resolverAddr, opts.smartAccount, p),
  )
  return submitAgentUserOp({
    smartAccount: opts.smartAccount,
    signerAccount: opts.signerAccount,
    salt: opts.salt,
    factoryAddr,
    entryPointAddr,
    paymasterAddr,
    calls,
    label: opts.label ?? `setProperties[${opts.properties.length}]`,
  })
}

// ─── Property encoding ───────────────────────────────────────────────

export type AgentProperty =
  | { kind: 'string'; predicate: Hex; value: string }
  | { kind: 'address'; predicate: Hex; value: Address }
  | { kind: 'bool'; predicate: Hex; value: boolean }
  | { kind: 'multiAddress-append'; predicate: Hex; value: Address }

function encodePropertyCall(
  resolver: Address,
  agent: Address,
  p: AgentProperty,
): AgentCall {
  switch (p.kind) {
    case 'string':
      return {
        target: resolver,
        value: 0n,
        data: encodeFunctionData({
          abi: agentAccountResolverAbi,
          functionName: 'setStringProperty',
          args: [agent, p.predicate, p.value],
        }),
      }
    case 'address':
      return {
        target: resolver,
        value: 0n,
        data: encodeFunctionData({
          abi: agentAccountResolverAbi,
          functionName: 'setAddressProperty',
          args: [agent, p.predicate, p.value],
        }),
      }
    case 'bool':
      return {
        target: resolver,
        value: 0n,
        data: encodeFunctionData({
          abi: agentAccountResolverAbi,
          functionName: 'setBoolProperty',
          args: [agent, p.predicate, p.value],
        }),
      }
    case 'multiAddress-append':
      return {
        target: resolver,
        value: 0n,
        data: encodeFunctionData({
          abi: agentAccountResolverAbi,
          functionName: 'addMultiAddressProperty',
          args: [agent, p.predicate, p.value],
        }),
      }
  }
}

// ─── UserOp build + submit ───────────────────────────────────────────

async function submitAgentUserOp(opts: {
  smartAccount: Address
  signerAccount: PrivateKeyAccount
  salt: bigint
  factoryAddr: Address
  entryPointAddr: Address
  paymasterAddr: Address
  calls: AgentCall[]
  label: string
}): Promise<{ userOpHash: Hex; txHash: Hex }> {
  if (opts.calls.length === 0) {
    throw new Error('[agent-self-register] submitAgentUserOp called with empty calls[]')
  }

  const pub = createPublicClient({ chain: getChain(), transport: http(RPC_URL) })

  // ─── Counterfactual init code ──────────────────────────────────
  // If the smart account has no bytecode, deploy it in this same userOp
  // via the factory. initCode layout: factoryAddr (20 bytes) ||
  // factory.createAccount(initialOwner, salt) calldata.
  const code = await pub.getCode({ address: opts.smartAccount })
  let initCode: Hex = '0x'
  if (!code || code === '0x') {
    const factoryCallData = encodeFunctionData({
      abi: agentAccountFactoryAbi,
      functionName: 'createAccount',
      args: [opts.signerAccount.address, opts.salt],
    })
    initCode = (opts.factoryAddr + factoryCallData.slice(2)) as Hex

    // Sanity: assert the factory's counterfactual address matches what
    // we'll set as `sender`. A mismatch here is a salt/owner mistake at
    // the caller and would surface as @AA13 initCode did not deploy
    // sender during validation — pre-empt with a clearer error.
    const counterfactual = await pub.readContract({
      address: opts.factoryAddr,
      abi: agentAccountFactoryAbi,
      functionName: 'getAddress',
      args: [opts.signerAccount.address, opts.salt],
    }) as Address
    if (counterfactual.toLowerCase() !== opts.smartAccount.toLowerCase()) {
      throw new Error(
        `[agent-self-register] ${opts.label}: counterfactual address mismatch — ` +
        `factory.getAddress(${opts.signerAccount.address}, ${opts.salt}) = ${counterfactual} ` +
        `but smartAccount was passed as ${opts.smartAccount}. ` +
        `Either smartAccount is wrong, or initialOwner/salt don't match this factory.`,
      )
    }
  }

  // ─── Build inner execute callData ──────────────────────────────
  // Single call → AgentAccount.execute(target, value, data).
  // Multi-call → AgentAccount.executeBatch([{target,value,data}, …]).
  const innerCallData: Hex = opts.calls.length === 1
    ? encodeFunctionData({
        abi: agentAccountAbi,
        functionName: 'execute',
        args: [opts.calls[0].target, opts.calls[0].value, opts.calls[0].data],
      })
    : encodeFunctionData({
        abi: agentAccountAbi,
        functionName: 'executeBatch',
        args: [opts.calls.map((c) => ({ target: c.target, value: c.value, data: c.data }))],
      })

  // ─── Gas + fees ────────────────────────────────────────────────
  // Generous limits for seed-time correctness over efficiency.
  // executeBatch with N writes can spend a lot, especially on first-
  // deploy paths where initCode contributes ~500k.
  const verificationGasLimit = 1_500_000n
  const callGasLimit = 5_000_000n
  const accountGasLimits = packTwo(verificationGasLimit, callGasLimit)
  const preVerificationGas = 200_000n
  const maxPriorityFeePerGas = 1n
  const maxFeePerGas = 1_000_000_000n // 1 gwei (local dev)
  const gasFees = packTwo(maxPriorityFeePerGas, maxFeePerGas)

  // ─── Paymaster (dev: SmartAgentPaymaster, accept-all in dev mode) ──
  const paymasterAndData: Hex = (opts.paymasterAddr.toLowerCase() !==
    '0x0000000000000000000000000000000000000000')
    ? `0x${opts.paymasterAddr.slice(2)}${(200_000n).toString(16).padStart(32, '0')}${(50_000n).toString(16).padStart(32, '0')}` as Hex
    : '0x' as Hex

  // ─── Nonce ────────────────────────────────────────────────────
  const nonce = (await pub.readContract({
    address: opts.entryPointAddr,
    abi: entryPointMinimalAbi,
    functionName: 'getNonce',
    args: [opts.smartAccount, 0n],
  })) as bigint

  const op = {
    sender: opts.smartAccount,
    nonce,
    initCode,
    callData: innerCallData,
    accountGasLimits,
    preVerificationGas,
    gasFees,
    paymasterAndData,
    signature: '0x' as Hex,
  }

  // ─── userOpHash + sign ──────────────────────────────────────────
  const userOpHash = (await pub.readContract({
    address: opts.entryPointAddr,
    abi: entryPointMinimalAbi,
    functionName: 'getUserOpHash',
    args: [op],
  })) as Hex

  // `AgentAccount._verifyEcdsa` tries the raw hash first then falls back
  // to the eth-signed wrap, so signMessage({message:{raw: …}}) (which
  // applies the EIP-191 prefix) is accepted by the contract. This is
  // the SAME wire form as `apps/a2a-agent/src/routes/onchain-redeem.ts`,
  // proven against EntryPoint v0.8.
  const signature = await opts.signerAccount.signMessage({ message: { raw: userOpHash } })
  const signedOp = { ...op, signature }

  // ─── Submit via relayer (deployer EOA pays gas) ─────────────────
  // The relayer is NOT a co-owner of the agent — they don't sign the
  // op, they only call handleOps. The userOp's own signature carries
  // the authority. handleOps' `beneficiary` is the relayer too so the
  // tiny gas refund (if any) doesn't disappear.
  //
  // CRITICAL: route through `getWalletClient()` (NOT a bare viem wallet)
  // so the handleOps tx shares the process-wide deployer-nonce counter.
  // Bare wallets race with other deployer-signed writes (boot-seed runs
  // dozens of these in parallel/back-to-back) and trip "nonce too low"
  // — exactly the pattern we hit on first run.
  const { getWalletClient } = await import('@/lib/contracts')
  const wallet = getWalletClient()
  const relayerAddr = wallet.account!.address as Address

  const txHash = await wallet.writeContract({
    address: opts.entryPointAddr,
    abi: entryPointMinimalAbi,
    functionName: 'handleOps',
    args: [[signedOp], relayerAddr],
  })
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    throw new Error(`[agent-self-register] ${opts.label}: handleOps reverted (tx=${txHash}, userOpHash=${userOpHash})`)
  }
  return { userOpHash, txHash }
}

// ─── Helpers used by callers ─────────────────────────────────────────

/**
 * Deterministically derive an EOA from a stable string label (e.g. an
 * org slug like `globalchurch-network`). Used so re-runs of the seed
 * produce the same EOA → same smart-account counterfactual address.
 *
 * The label is hashed via keccak256 to a 32-byte private key. Different
 * label namespaces (people / orgs / hubs / treasuries) MUST embed their
 * namespace in the label string to avoid collisions.
 */
export function deterministicEoaFromLabel(label: string): PrivateKeyAccount {
  const pk = keccak256(toBytes(label)) as Hex
  return privateKeyToAccount(pk)
}

/**
 * Compute the counterfactual smart-account address the factory would
 * mint for `(initialOwner, salt)`. Mirror of the on-chain
 * `factory.getAddress(...)` view so callers can pre-compute the address
 * before issuing the userOp.
 */
export async function getCounterfactualAddress(
  initialOwner: Address,
  salt: bigint,
): Promise<Address> {
  const factoryAddr = requireEnv('AGENT_FACTORY_ADDRESS')
  const pub = createPublicClient({ chain: getChain(), transport: http(RPC_URL) })
  return (await pub.readContract({
    address: factoryAddr,
    abi: agentAccountFactoryAbi,
    functionName: 'getAddress',
    args: [initialOwner, salt],
  })) as Address
}

/**
 * Mint a GeoClaim with `msg.sender == subject`. Routes the
 * `GeoClaimRegistry.mint(...)` call through a userOp from the subject
 * smart account; GeoClaimRegistry's `_isAuthorized` then sees
 * `msg.sender == subjectAgent` directly and accepts the write.
 *
 * The pre-refactor pattern called `mint(...)` from the deployer EOA,
 * which only worked while the deployer was an `_owner` of every agent
 * (initialOwner of factory-deployed AgentAccounts). After we changed
 * org/person initialOwners to deterministic-from-label / user EOAs,
 * the deployer is no longer authorized — every geo claim has to go
 * through the agent itself.
 *
 * Idempotent: a re-run produces the same `(subject, featureId,
 * relation, nonce)` tuple, so the contract's `ClaimExists` revert
 * is the canonical guard. We catch + swallow it here.
 */
export async function mintSelfGeoClaim(opts: {
  subject: Address
  signerAccount: PrivateKeyAccount
  salt: bigint
  cityKey: string                    // "us/colorado/loveland"
  relation: GeoRelation              // 'operatesIn' | 'residentOf' | …
  confidence: number                 // 0..100
  logPrefix?: string                 // for warn() messages
}): Promise<void> {
  const featReg = process.env.GEO_FEATURE_REGISTRY_ADDRESS as Address | undefined
  const claimReg = process.env.GEO_CLAIM_REGISTRY_ADDRESS as Address | undefined
  if (!featReg || !claimReg) return

  const pub = createPublicClient({ chain: getChain(), transport: http(RPC_URL) })
  const [country, region, city] = opts.cityKey.split('/')
  const featureId = GeoFeatureClient.featureIdFor({ countryCode: country, region, city })
  const featureClient = new GeoFeatureClient(pub, featReg)

  let version: bigint
  try {
    const latest = await featureClient.getLatest(featureId)
    version = latest.version
  } catch {
    console.warn(`${opts.logPrefix ?? '[geo]'} feature ${opts.cityKey} not published yet — skip claim for ${opts.subject}`)
    return
  }
  if (version === 0n) return

  // Map the friendly relation label to the on-chain bytes32. Only the
  // two we currently seed; loud failure for unknown relations so we
  // don't silently emit malformed claims.
  let relHash: Hex
  if (opts.relation === 'operatesIn') relHash = GEO_REL_OPERATES_IN as Hex
  else if (opts.relation === 'residentOf') relHash = GEO_REL_RESIDENT_OF as Hex
  else {
    console.warn(`${opts.logPrefix ?? '[geo]'} unsupported relation ${opts.relation} — skip`)
    return
  }

  const nonceLabel = `seed:${opts.subject.toLowerCase()}|${opts.cityKey}|${opts.relation}|v1`
  const nonce = keccak256(toBytes(nonceLabel)) as Hex
  const evidenceCommit = keccak256(toBytes(`evidence:${nonceLabel}`)) as Hex
  const VIS_PUBLIC = 0 // GEO_VISIBILITY.Public
  const ZERO: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
  const POLICY_ID = keccak256(toBytes('smart-agent.geo-overlap.v1')) as Hex

  const mintCallData = encodeFunctionData({
    abi: geoClaimRegistryAbi,
    functionName: 'mint',
    args: [
      opts.subject,         // subjectAgent
      opts.subject,         // issuer (self-asserted)
      featureId,
      version,
      relHash,
      VIS_PUBLIC,
      evidenceCommit,
      ZERO,                 // edgeId
      ZERO,                 // assertionId
      opts.confidence,
      POLICY_ID,
      0n,                   // validAfter
      0n,                   // validUntil
      nonce,
    ],
  })

  try {
    await executeCallsAsAgent({
      smartAccount: opts.subject,
      signerAccount: opts.signerAccount,
      salt: opts.salt,
      calls: [{ target: claimReg, value: 0n, data: mintCallData }],
      label: `${opts.logPrefix ?? '[geo]'}:mintGeoClaim(${opts.cityKey})`,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/ClaimExists/.test(msg)) {
      console.warn(`${opts.logPrefix ?? '[geo]'} geo-claim mint failed for ${opts.subject} → ${opts.cityKey}:`, msg.slice(0, 200))
    }
  }
}

/**
 * Look up the demo user's owner EOA + person-agent salt from the local
 * users DB. Returns `null` if the user isn't a demo user (no stored key)
 * — e.g. a real passkey/MetaMask user who came through onboarding.
 *
 * Used by seed code that needs to act AS a person agent (e.g. minting a
 * geo claim where `_isAuthorized(personAgent)` requires `msg.sender ==
 * personAgent`, so we need a userOp from the person agent signed by the
 * user's EOA).
 *
 * Salt derivation MUST match the scheme in `generate-wallet.ts`:
 *   personSalt = uint256(keccak256(abi.encodePacked("person", userEoa)))
 */
export async function loadDemoUserAgentIdentity(
  personAgentAddress: Address,
): Promise<{ eoa: PrivateKeyAccount; salt: bigint } | null> {
  // Lazy import — this module is consumed in environments without
  // Next.js' database wiring (e.g. unit tests), and we want
  // `loadDemoUserAgentIdentity` to be the only DB-touching surface.
  const { db, schema } = await import('@/db')
  // Drizzle's `eq` is case-sensitive on text columns; load all demo
  // users and filter by lowercase to avoid checksum-mismatch misses.
  const rows = await db.select()
    .from(schema.localUserAccounts)
    .all()
  const target = personAgentAddress.toLowerCase()
  const row = rows.find((r) =>
    typeof r.personAgentAddress === 'string' &&
    r.personAgentAddress.toLowerCase() === target,
  )
  if (!row || !row.privateKey) return null
  const eoa = privateKeyToAccount(row.privateKey as Hex)
  // Recompute salt from `eoa.address` per generate-wallet's scheme.
  const { encodePacked } = await import('viem')
  const personSaltHash = keccak256(encodePacked(['string', 'address'], ['person', eoa.address as Address]))
  return { eoa, salt: BigInt(personSaltHash) }
}

// ─── Shared cross-seeder agent identity registry ─────────────────────
//
// The seed-time twin of an "agent owns itself" world needs every seed
// file to publish the (eoa, salt) pair it used to deploy a smart account
// so that downstream seeders (mcp data, skill claims, ownership grants,
// runtime grant-org-ownership during demo login) can submit userOps
// signed by that smart account's own EOA.
//
// Each per-hub seed file already maintains its own in-module
// `agentIdentities` Map. We expose a process-global mirror here so a
// completely different module can resolve an agent's owner EOA without
// either (a) sharing module state or (b) re-deriving labels from a
// static catalog.
//
// In addition to the cache, `resolveAgentIdentity` knows the
// deterministic label scheme used by the four refactored seed-onchain
// files. If the cache misses (e.g. because a different Node process or
// HMR reload runs `seed-mcp-data` without having just re-run the hub
// seed), we replay the labels and CREATE2-recompute the addresses they
// would have produced. This is exactly the same derivation the seed
// files do, so it's strictly consistent.

interface SeedAgentIdentity {
  eoa: PrivateKeyAccount
  salt: bigint
}

const IDENTITY_CACHE: Map<string, SeedAgentIdentity> = (() => {
  const g = globalThis as { __seedAgentIdentityCache?: Map<string, SeedAgentIdentity> }
  if (!g.__seedAgentIdentityCache) g.__seedAgentIdentityCache = new Map()
  return g.__seedAgentIdentityCache
})()

/**
 * Publish a (smartAccount → owner EOA, salt) mapping so that any other
 * seed module can later resolve the same identity without re-deriving
 * it. Seed files should call this from their local `deploy()` helper
 * right after `getCounterfactualAddress`.
 */
export function rememberAgentIdentity(
  smartAccount: Address,
  identity: SeedAgentIdentity,
): void {
  IDENTITY_CACHE.set(smartAccount.toLowerCase(), identity)
}

/**
 * Static catalog of every well-known seed label → numeric salt pair used
 * by the four refactored hub seed scripts. Order doesn't matter — the
 * resolver scans the whole list and picks the entry whose factory
 * counterfactual matches the input address.
 *
 * MUST stay in sync with `await deploy(<label>, <salt>)` calls in:
 *   - seed-catalyst-onchain.ts (both full and minimal mode)
 *   - seed-cil-onchain.ts
 *   - seed-globalchurch-onchain.ts
 *   - seed-disciple-networks-onchain.ts
 *
 * The treasury label scheme (`catalyst:treasury:<orgName>` with salt
 * 400000 + orgSalt) is folded in by enumerating the (orgName, orgSalt)
 * pairs from the catalyst seed.
 */
interface SeedLabelEntry {
  label: string
  salt: number
}

const CATALYST_TREASURY_ORGS: ReadonlyArray<{ name: string; salt: number }> = [
  { name: 'Catalyst NoCo Network',   salt: 200001 },
  { name: 'Fort Collins Network',    salt: 200002 },
  { name: 'Wellington Circle',       salt: 200003 },
  { name: 'Laporte Circle',          salt: 200004 },
  { name: 'Timnath Circle',          salt: 200005 },
  { name: 'Loveland Circle',         salt: 200006 },
  { name: 'Berthoud Circle',         salt: 200007 },
  { name: 'Johnstown Circle',        salt: 200008 },
  { name: 'Red Feather Circle',      salt: 200009 },
  { name: 'Senegal Wolof Outreach',  salt: 200014 },
]

const SEED_LABEL_CATALOG: ReadonlyArray<SeedLabelEntry> = [
  // catalyst
  { label: 'catalyst:catalystNoco',         salt: 200001 },
  { label: 'catalyst:fortCollinsNetwork',   salt: 200002 },
  { label: 'catalyst:grpWellington',        salt: 200003 },
  { label: 'catalyst:grpLaporte',           salt: 200004 },
  { label: 'catalyst:grpTimnath',           salt: 200005 },
  { label: 'catalyst:grpLoveland',          salt: 200006 },
  { label: 'catalyst:grpBerthoud',          salt: 200007 },
  { label: 'catalyst:grpJohnstown',         salt: 200008 },
  { label: 'catalyst:grpRedFeather',        salt: 200009 },
  { label: 'catalyst:senegalWolofOutreach', salt: 200014 },
  { label: 'catalyst:analytics',            salt: 210001 },
  { label: 'catalyst:hub',                  salt: 290001 },
  // catalyst treasuries (label = `catalyst:treasury:${orgName}`, salt = 400000 + orgSalt)
  ...CATALYST_TREASURY_ORGS.map(o => ({
    label: `catalyst:treasury:${o.name}`,
    salt: 400000 + o.salt,
  })),
  // cil
  { label: 'cil:cil',         salt: 400001 },
  { label: 'cil:ilad',        salt: 400002 },
  { label: 'cil:ravah',       salt: 400003 },
  { label: 'cil:afiaMarket',  salt: 400004 },
  { label: 'cil:kossiRepair', salt: 400005 },
  { label: 'cil:lomeCluster', salt: 400006 },
  { label: 'cil:wave1',       salt: 400007 },
  { label: 'cil:wave2',       salt: 400008 },
  { label: 'cil:hub',         salt: 490001 },
  // globalchurch
  { label: 'globalchurch:network',         salt: 300001 },
  { label: 'globalchurch:graceChurch',     salt: 300002 },
  { label: 'globalchurch:sbc',             salt: 300003 },
  { label: 'globalchurch:ecfa',            salt: 300004 },
  { label: 'globalchurch:wycliffe',        salt: 300005 },
  { label: 'globalchurch:ncf',             salt: 300006 },
  { label: 'globalchurch:youthMinistry',   salt: 300007 },
  { label: 'globalchurch:smallGroups',     salt: 300008 },
  { label: 'globalchurch:missionsTeam',    salt: 300009 },
  { label: 'globalchurch:hub',             salt: 390001 },
  // disciple-networks
  { label: 'disciple-networks:frontRange',  salt: 600001 },
  { label: 'disciple-networks:plains',      salt: 600101 },
  { label: 'disciple-networks:denverMetro', salt: 600201 },
]

/** True once the catalog has been replayed into IDENTITY_CACHE. */
let catalogIndexed = false

async function indexCatalogIfNeeded(): Promise<void> {
  if (catalogIndexed) return
  // Pre-compute the smart-account address each catalog label would
  // produce and stuff the cache so subsequent lookups are O(1). We
  // tolerate `getCounterfactualAddress` failing (e.g. AGENT_FACTORY
  // address missing) — the resolver will simply miss in that case.
  for (const entry of SEED_LABEL_CATALOG) {
    const eoa = deterministicEoaFromLabel(entry.label)
    try {
      const addr = await getCounterfactualAddress(eoa.address, BigInt(entry.salt))
      const key = addr.toLowerCase()
      if (!IDENTITY_CACHE.has(key)) {
        IDENTITY_CACHE.set(key, { eoa, salt: BigInt(entry.salt) })
      }
    } catch {
      // Best-effort. If the factory isn't available, callers will hit
      // the same env gap when they try to submit a userOp.
    }
  }
  catalogIndexed = true
}

/**
 * Look up the (eoa, salt) tuple that owns `smartAccount`.
 *
 * Resolution order:
 *   1. In-memory cache populated by `rememberAgentIdentity` (the
 *      `deploy()` helper in each seed file calls this).
 *   2. Demo user database — matches against `personAgentAddress` so seed
 *      code can act AS a demo person agent (e.g. minting their own skill
 *      claims).
 *   3. Static label catalog — every well-known seed label/salt pair is
 *      pre-computed once and stuffed into the cache. Covers org / hub /
 *      treasury / AI agent accounts deployed by the four seed-onchain
 *      files.
 *
 * Returns `null` if no strategy succeeds — caller should warn loudly,
 * not silently swallow.
 */
export async function resolveAgentIdentity(
  smartAccount: Address,
): Promise<SeedAgentIdentity | null> {
  const key = smartAccount.toLowerCase()

  // (1) cache
  const cached = IDENTITY_CACHE.get(key)
  if (cached) return cached

  // (2) demo user DB (matches personAgentAddress)
  const demo = await loadDemoUserAgentIdentity(smartAccount)
  if (demo) {
    IDENTITY_CACHE.set(key, demo)
    return demo
  }

  // (3) static catalog
  await indexCatalogIfNeeded()
  const reindexed = IDENTITY_CACHE.get(key)
  if (reindexed) return reindexed

  return null
}
