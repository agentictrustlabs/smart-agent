/**
 * Spec 005 + Spec 006 — Personal Treasury provisioning.
 *
 * Architectural invariant (spec-006):
 *   USDC MUST NEVER move into or out of a person smart account or
 *   organization smart account directly. Money only ever touches Treasury
 *   Service Agents (TYPE_TREASURY_AGENT). For person users that means a
 *   dedicated treasury AgentAccount, distinct from their person smart
 *   account, linked via `sa:hasPersonalTreasury`.
 *
 * Provisioning steps (idempotent):
 *
 *   1. If `sa:hasPersonalTreasury(personSA)` is already set to a non-self
 *      address, treat it as the treasury and return.
 *   2. Otherwise deploy a fresh AgentAccount via factory.createAccount with
 *      the user's EOA as `initialOwner`. The factory's serverSigner is the
 *      deployer EOA, so the deployer is automatically co-owner —
 *      that's the BOOTSTRAP signing surface only; scenario flows
 *      (pledging, honoring, releasing) are always signed by the user's EOA
 *      via the spec-005/006 delegation rails.
 *   3. Register the new treasury on AgentAccountResolver with
 *      TYPE_TREASURY_AGENT + a sensible displayName. Deployer signs (co-owner).
 *   4. Set `sa:hasPersonalTreasury(personSA) = treasury`. Deployer signs.
 *   5. Mint MockUSDC to the new treasury (dev only, $1M).
 *
 * If `ownerWallet` is missing, we fall back to the old self-link behavior
 * — degraded, suitable only for passkey/SIWE flows where the user's EOA
 * isn't available at provisioning time. Demo flows always pass it.
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem'
import {
  agentAccountResolverAbi,
  agentAccountFactoryAbi,
  mockUsdcAbi,
  TYPE_TREASURY_AGENT,
} from '@smart-agent/sdk'
import { getPublicClient, getWalletClient } from '@/lib/contracts'

const SA_HAS_PERSONAL_TREASURY = keccak256(toBytes('sa:hasPersonalTreasury'))
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const ZERO_HASH = ('0x' + '0'.repeat(64)) as Hex
// Demo users get $1M USDC so a single Maria can run many demo scenarios
// (or one Maria + 99 sibling tests) without re-minting.
const ONE_M_USDC = 1_000_000n * 10n ** 6n

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export interface ProvisionResult {
  ok: boolean
  treasuryAddress: Address
  /** Was the predicate already set to a non-self address? */
  predicateAlreadySet: boolean
  /** Was the USDC balance already at-or-above the funding threshold? */
  usdcAlreadyFunded: boolean
  /** Was the treasury already deployed before this call (or did we deploy it now)? */
  treasuryAlreadyDeployed: boolean
  /** Non-fatal errors collected during provisioning. */
  warnings: string[]
}

export async function ensurePersonalTreasury(
  smartAccountAddress: Address,
  ownerWallet?: Address,
): Promise<ProvisionResult> {
  const out: ProvisionResult = {
    ok: true,
    treasuryAddress: smartAccountAddress, // overwritten below
    predicateAlreadySet: false,
    usdcAlreadyFunded: false,
    treasuryAlreadyDeployed: false,
    warnings: [],
  }

  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  const factory = process.env.AGENT_FACTORY_ADDRESS as Address | undefined
  if (!resolver) {
    out.warnings.push('AGENT_ACCOUNT_RESOLVER_ADDRESS not set — provisioning aborted')
    out.ok = false
    return out
  }
  const pub = getPublicClient()
  const wallet = getWalletClient()

  // 1. Idempotency check — already linked to a separate treasury?
  let existing: Address = ZERO_ADDRESS
  try {
    existing = (await pub.readContract({
      address: resolver, abi: agentAccountResolverAbi,
      functionName: 'getAddressProperty',
      args: [smartAccountAddress, SA_HAS_PERSONAL_TREASURY],
    })) as Address
  } catch { /* not set yet */ }
  const isSelfLink = existing && existing.toLowerCase() === smartAccountAddress.toLowerCase()
  const isUnset = !existing || existing.toLowerCase() === ZERO_ADDRESS.toLowerCase()
  if (existing && !isSelfLink && !isUnset) {
    out.treasuryAddress = existing
    out.predicateAlreadySet = true
    out.treasuryAlreadyDeployed = true
    // Still ensure funding for an existing treasury.
    await fundTreasury(out, existing, pub, wallet)
    return out
  }

  // 2. Deploy treasury OR fall back to self-link if owner unknown.
  if (!factory) {
    out.warnings.push('AGENT_FACTORY_ADDRESS not set — falling back to self-link')
    await selfLinkPath(out, smartAccountAddress, pub, wallet, resolver)
    return out
  }
  if (!ownerWallet) {
    // No EOA known — degraded mode. Keep the v1 self-link so the rest of
    // the system stays consistent (passkey/SIWE before the ceremony lands).
    out.warnings.push('ownerWallet not provided — using v1 self-link (no separate treasury deployed)')
    await selfLinkPath(out, smartAccountAddress, pub, wallet, resolver)
    return out
  }

  // Deterministic treasury address derived from the person SA.
  const salt = BigInt(keccak256(toBytes(`personal-treasury:${smartAccountAddress.toLowerCase()}`)))
  let treasury: Address
  try {
    treasury = (await pub.readContract({
      address: factory, abi: agentAccountFactoryAbi,
      functionName: 'getAddress', args: [ownerWallet, salt],
    })) as Address
  } catch (e) {
    out.warnings.push(`factory.getAddress failed: ${(e as Error).message.slice(0, 200)}`)
    out.ok = false
    return out
  }

  // Already deployed?
  const code = await pub.getCode({ address: treasury })
  if (!code || code === '0x') {
    try {
      const deployTx = await wallet.writeContract({
        address: factory, abi: agentAccountFactoryAbi,
        functionName: 'createAccount', args: [ownerWallet, salt],
      })
      await pub.waitForTransactionReceipt({ hash: deployTx })
    } catch (e) {
      out.warnings.push(`treasury deploy failed: ${(e as Error).message.slice(0, 200)}`)
      out.ok = false
      return out
    }
  } else {
    out.treasuryAlreadyDeployed = true
  }
  out.treasuryAddress = treasury

  // 3. Register on AgentAccountResolver (deployer is co-owner via serverSigner).
  try {
    const isReg = (await pub.readContract({
      address: resolver, abi: agentAccountResolverAbi,
      functionName: 'isRegistered', args: [treasury],
    })) as boolean
    if (!isReg) {
      await wallet.writeContract({
        address: resolver, abi: agentAccountResolverAbi,
        functionName: 'register',
        args: [
          treasury,
          `Personal Treasury (${smartAccountAddress.slice(0, 8)}…)`,
          `Personal treasury for person ${smartAccountAddress} — holds USDC. Distinct from the person smart account.`,
          TYPE_TREASURY_AGENT,
          ZERO_HASH,
          '',
        ],
      })
    }
  } catch (e) {
    out.warnings.push(`treasury register failed: ${(e as Error).message.slice(0, 200)}`)
  }

  // 4. Link person → treasury via sa:hasPersonalTreasury.
  try {
    await wallet.writeContract({
      address: resolver, abi: agentAccountResolverAbi,
      functionName: 'setAddressProperty',
      args: [smartAccountAddress, SA_HAS_PERSONAL_TREASURY, treasury],
    })
  } catch (e) {
    out.warnings.push(`setAddressProperty failed: ${(e as Error).message.slice(0, 200)}`)
    out.ok = false
  }

  // 5. Mint USDC into the treasury.
  await fundTreasury(out, treasury, pub, wallet)
  return out
}

/**
 * v1 fallback when we can't deploy a separate treasury (no factory or
 * unknown owner wallet). Sets sa:hasPersonalTreasury(self) = self and
 * mints USDC into the person smart account — known degraded state.
 */
async function selfLinkPath(
  out: ProvisionResult,
  smartAccountAddress: Address,
  pub: ReturnType<typeof getPublicClient>,
  wallet: ReturnType<typeof getWalletClient>,
  resolver: Address,
): Promise<void> {
  out.treasuryAddress = smartAccountAddress
  try {
    const current = (await pub.readContract({
      address: resolver, abi: agentAccountResolverAbi,
      functionName: 'getAddressProperty',
      args: [smartAccountAddress, SA_HAS_PERSONAL_TREASURY],
    })) as Address
    if (current && current.toLowerCase() === smartAccountAddress.toLowerCase()) {
      out.predicateAlreadySet = true
    } else {
      await wallet.writeContract({
        address: resolver, abi: agentAccountResolverAbi,
        functionName: 'setAddressProperty',
        args: [smartAccountAddress, SA_HAS_PERSONAL_TREASURY, smartAccountAddress],
      })
    }
  } catch (e) {
    out.warnings.push(`self-link write failed: ${(e as Error).message.slice(0, 200)}`)
    out.ok = false
  }
  await fundTreasury(out, smartAccountAddress, pub, wallet)
}

/**
 * Top up the given treasury address with $1M MockUSDC (dev only).
 */
async function fundTreasury(
  out: ProvisionResult,
  target: Address,
  pub: ReturnType<typeof getPublicClient>,
  wallet: ReturnType<typeof getWalletClient>,
): Promise<void> {
  if (CHAIN_ID !== 31337) {
    out.warnings.push(`chainId=${CHAIN_ID} — MockUSDC mint skipped (dev-only)`)
    return
  }
  const mockUsdc = process.env.MOCK_USDC_ADDRESS as Address | undefined
  if (!mockUsdc) {
    out.warnings.push('MOCK_USDC_ADDRESS not set — run fresh-start.sh to deploy MockUSDC')
    return
  }
  try {
    const bal = (await pub.readContract({
      address: mockUsdc, abi: mockUsdcAbi,
      functionName: 'balanceOf', args: [target],
    })) as bigint
    if (bal >= ONE_M_USDC) {
      out.usdcAlreadyFunded = true
    } else {
      const topUp = ONE_M_USDC - bal
      await wallet.writeContract({
        address: mockUsdc, abi: mockUsdcAbi,
        functionName: 'mint', args: [target, topUp],
      })
    }
  } catch (e) {
    out.warnings.push(`USDC mint failed: ${(e as Error).message.slice(0, 200)}`)
    out.ok = false
  }
}

/**
 * Manual top-up endpoint helper (called by dashboard "Fund treasury" button).
 * Resolves the treasury via sa:hasPersonalTreasury and tops it up to $1M.
 */
export async function fundLocalTreasury(
  smartAccountAddress: Address,
): Promise<{ ok: boolean; newBalance: bigint; treasury: Address; error?: string }> {
  if (CHAIN_ID !== 31337) {
    return { ok: false, newBalance: 0n, treasury: smartAccountAddress, error: `chainId=${CHAIN_ID} — dev-only` }
  }
  const mockUsdc = process.env.MOCK_USDC_ADDRESS as Address | undefined
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  if (!mockUsdc) {
    return { ok: false, newBalance: 0n, treasury: smartAccountAddress, error: 'MOCK_USDC_ADDRESS not set' }
  }
  const pub = getPublicClient()
  const wallet = getWalletClient()

  // Resolve target = sa:hasPersonalTreasury or fall back to person SA itself.
  let target: Address = smartAccountAddress
  if (resolver) {
    try {
      const t = (await pub.readContract({
        address: resolver, abi: agentAccountResolverAbi,
        functionName: 'getAddressProperty',
        args: [smartAccountAddress, SA_HAS_PERSONAL_TREASURY],
      })) as Address
      if (t && t.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) target = t
    } catch { /* fall back to self */ }
  }

  try {
    const bal = (await pub.readContract({
      address: mockUsdc, abi: mockUsdcAbi, functionName: 'balanceOf', args: [target],
    })) as bigint
    if (bal >= ONE_M_USDC) {
      return { ok: true, newBalance: bal, treasury: target }
    }
    await wallet.writeContract({
      address: mockUsdc, abi: mockUsdcAbi, functionName: 'mint',
      args: [target, ONE_M_USDC - bal],
    })
    const newBal = (await pub.readContract({
      address: mockUsdc, abi: mockUsdcAbi, functionName: 'balanceOf', args: [target],
    })) as bigint
    return { ok: true, newBalance: newBal, treasury: target }
  } catch (e) {
    return { ok: false, newBalance: 0n, treasury: target, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Read-only USDC balance lookup. Reads the *treasury* balance — resolves
 *  through sa:hasPersonalTreasury so callers get the architecturally
 *  correct number even if they pass the person SA. */
const SA_HAS_TREASURY = keccak256(toBytes('sa:hasTreasury'))

export async function readUsdcBalance(
  smartAccountAddress: Address,
): Promise<{ balance: bigint; tokenAddress: Address | null; treasury: Address }> {
  const mockUsdc = process.env.MOCK_USDC_ADDRESS as Address | undefined
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  if (!mockUsdc) return { balance: 0n, tokenAddress: null, treasury: smartAccountAddress }
  const pub = getPublicClient()
  let target: Address = smartAccountAddress
  if (resolver) {
    // Resolve through the treasury pointer in priority order (matches
    // `sa:hasTreasury → sa:hasPersonalTreasury → self` declared in
    // packages/sdk/src/predicates.ts). Orgs / pools / funds set
    // `sa:hasTreasury`; persons set `sa:hasPersonalTreasury`; either
    // wins over the smart account itself.
    for (const predicate of [SA_HAS_TREASURY, SA_HAS_PERSONAL_TREASURY]) {
      try {
        const t = (await pub.readContract({
          address: resolver, abi: agentAccountResolverAbi,
          functionName: 'getAddressProperty',
          args: [smartAccountAddress, predicate],
        })) as Address
        if (t && t.toLowerCase() !== ZERO_ADDRESS.toLowerCase()
              && t.toLowerCase() !== smartAccountAddress.toLowerCase()) {
          target = t
          break
        }
      } catch { /* try the next predicate */ }
    }
  }
  try {
    const bal = (await pub.readContract({
      address: mockUsdc, abi: mockUsdcAbi, functionName: 'balanceOf', args: [target],
    })) as bigint
    return { balance: bal, tokenAddress: mockUsdc, treasury: target }
  } catch {
    return { balance: 0n, tokenAddress: mockUsdc, treasury: target }
  }
}

/** Hex-encoded predicate constant exported for downstream readers. */
export const SA_HAS_PERSONAL_TREASURY_HEX: Hex = SA_HAS_PERSONAL_TREASURY
