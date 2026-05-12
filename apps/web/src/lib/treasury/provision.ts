/**
 * Spec 005 — Personal-treasury provisioning.
 *
 * v1 invariant (per plan.md § Goals + Invariants — "Reuse, don't duplicate"):
 * the user's AgentAccount IS their personal treasury. No second account is
 * deployed. Provisioning is two idempotent server-side writes:
 *
 *   1. Set `sa:hasPersonalTreasury(personSubject) = smartAccountAddress` on
 *      AgentAccountResolver — links the person agent to their treasury for
 *      readers (UI, GraphDB sync). Self-referential by design in v1.
 *
 *   2. Mint 100k MockUSDC to the smart account, gated on `chainId === 31337`.
 *      Off-chain dev-only guard; the MockUSDC contract itself has an open
 *      mint, but production deploys (separate script) don't include
 *      MockUSDC. See threat-model.md § T7.
 *
 * Called at:
 *   - apps/web/src/app/api/auth/passkey-signup/route.ts (after AgentAccount deploy + addPasskey)
 *   - apps/web/src/app/api/auth/siwe-verify/route.ts (after AgentAccount ensure)
 *   - apps/web/src/lib/demo-seed/* (for demo users)
 *
 * Idempotent — repeated calls no-op once provisioned. Failures are logged
 * but do NOT block the auth flow; the user simply lands without USDC and
 * can be funded later via the dashboard.
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem'
import {
  agentAccountResolverAbi,
  mockUsdcAbi,
} from '@smart-agent/sdk'
import { getPublicClient, getWalletClient } from '@/lib/contracts'

const SA_HAS_PERSONAL_TREASURY = keccak256(toBytes('sa:hasPersonalTreasury'))
const HUNDRED_K_USDC = 100_000n * 10n ** 6n // 100,000 USDC (6 decimals)

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

interface ProvisionResult {
  ok: boolean
  treasuryAddress: Address
  /** Was the predicate already set? */
  predicateAlreadySet: boolean
  /** Was the USDC balance already at-or-above the funding threshold? */
  usdcAlreadyFunded: boolean
  /** Non-fatal errors collected during provisioning. */
  warnings: string[]
}

/**
 * Ensure a person agent has `sa:hasPersonalTreasury` set + MockUSDC seed.
 * Returns the treasury address (= smartAccountAddress in v1) and a per-step
 * status so the caller can log meaningfully.
 */
export async function ensurePersonalTreasury(
  smartAccountAddress: Address,
): Promise<ProvisionResult> {
  const out: ProvisionResult = {
    ok: true,
    treasuryAddress: smartAccountAddress,
    predicateAlreadySet: false,
    usdcAlreadyFunded: false,
    warnings: [],
  }

  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
  if (!resolver) {
    out.warnings.push('AGENT_ACCOUNT_RESOLVER_ADDRESS not set — predicate write skipped')
    out.ok = false
    return out
  }
  const pub = getPublicClient()
  const wallet = getWalletClient()

  // 1. Predicate: sa:hasPersonalTreasury(person) = smartAccount.
  //    The smart account is the person agent's own subject; the resolver
  //    writes a self-referential link. Idempotent: read first.
  try {
    const current = (await pub.readContract({
      address: resolver,
      abi: agentAccountResolverAbi,
      functionName: 'getAddressProperty',
      args: [smartAccountAddress, SA_HAS_PERSONAL_TREASURY],
    })) as Address
    if (current && current.toLowerCase() === smartAccountAddress.toLowerCase()) {
      out.predicateAlreadySet = true
    } else {
      await wallet.writeContract({
        address: resolver,
        abi: agentAccountResolverAbi,
        functionName: 'setAddressProperty',
        args: [smartAccountAddress, SA_HAS_PERSONAL_TREASURY, smartAccountAddress],
      })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    out.warnings.push(`predicate write failed: ${msg}`)
    out.ok = false
  }

  // 2. MockUSDC mint — dev-only.
  if (CHAIN_ID !== 31337) {
    out.warnings.push(`chainId=${CHAIN_ID} — MockUSDC mint skipped (dev-only)`)
    return out
  }
  const mockUsdc = process.env.MOCK_USDC_ADDRESS as Address | undefined
  if (!mockUsdc) {
    out.warnings.push('MOCK_USDC_ADDRESS not set — run fresh-start.sh to deploy MockUSDC')
    return out
  }
  try {
    const bal = (await pub.readContract({
      address: mockUsdc,
      abi: mockUsdcAbi,
      functionName: 'balanceOf',
      args: [smartAccountAddress],
    })) as bigint
    if (bal >= HUNDRED_K_USDC) {
      out.usdcAlreadyFunded = true
    } else {
      const topUp = HUNDRED_K_USDC - bal
      await wallet.writeContract({
        address: mockUsdc,
        abi: mockUsdcAbi,
        functionName: 'mint',
        args: [smartAccountAddress, topUp],
      })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    out.warnings.push(`USDC mint failed: ${msg}`)
    out.ok = false
  }

  return out
}

/**
 * Manual top-up endpoint helper (called by dashboard "Fund treasury" button).
 * Always mints the delta to bring the balance up to 100k. Dev-only guard
 * matches `ensurePersonalTreasury`.
 */
export async function fundLocalTreasury(
  smartAccountAddress: Address,
): Promise<{ ok: boolean; newBalance: bigint; error?: string }> {
  if (CHAIN_ID !== 31337) {
    return { ok: false, newBalance: 0n, error: `chainId=${CHAIN_ID} — dev-only` }
  }
  const mockUsdc = process.env.MOCK_USDC_ADDRESS as Address | undefined
  if (!mockUsdc) {
    return { ok: false, newBalance: 0n, error: 'MOCK_USDC_ADDRESS not set' }
  }
  const pub = getPublicClient()
  const wallet = getWalletClient()
  try {
    const bal = (await pub.readContract({
      address: mockUsdc, abi: mockUsdcAbi, functionName: 'balanceOf', args: [smartAccountAddress],
    })) as bigint
    if (bal >= HUNDRED_K_USDC) {
      return { ok: true, newBalance: bal }
    }
    await wallet.writeContract({
      address: mockUsdc, abi: mockUsdcAbi, functionName: 'mint',
      args: [smartAccountAddress, HUNDRED_K_USDC - bal],
    })
    const newBal = (await pub.readContract({
      address: mockUsdc, abi: mockUsdcAbi, functionName: 'balanceOf', args: [smartAccountAddress],
    })) as bigint
    return { ok: true, newBalance: newBal }
  } catch (e) {
    return { ok: false, newBalance: 0n, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Read-only USDC balance lookup. Used by dashboard widget + readers. */
export async function readUsdcBalance(
  smartAccountAddress: Address,
): Promise<{ balance: bigint; tokenAddress: Address | null }> {
  const mockUsdc = process.env.MOCK_USDC_ADDRESS as Address | undefined
  if (!mockUsdc) return { balance: 0n, tokenAddress: null }
  const pub = getPublicClient()
  try {
    const bal = (await pub.readContract({
      address: mockUsdc, abi: mockUsdcAbi, functionName: 'balanceOf', args: [smartAccountAddress],
    })) as bigint
    return { balance: bal, tokenAddress: mockUsdc }
  } catch {
    return { balance: 0n, tokenAddress: mockUsdc }
  }
}

/** Hex-encoded predicate constant exported for downstream readers. */
export const SA_HAS_PERSONAL_TREASURY_HEX: Hex = SA_HAS_PERSONAL_TREASURY
