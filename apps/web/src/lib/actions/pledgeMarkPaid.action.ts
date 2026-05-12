'use server'

/**
 * Spec 005 — Rail B: Pool admin attests an externally-paid pledge.
 *
 * Flow (server-side, v1 deployer-fallback signing):
 *
 *   1. Caller is a logged-in pool admin (caller's smart account is an owner
 *      of the pool's `fundAgent` per the existing AgentAccount ownership
 *      model). We don't re-verify ownership client-side; the on-chain
 *      `_isAccountOwner(fundAgent, msg.sender)` inside `markPaid` is the
 *      authoritative check.
 *   2. Build markPaid calldata pinned to (pledge, token, amount, rail,
 *      evidenceHash).
 *   3. Sign a single-hop `fundAgent → deployer` delegation with calldataHash
 *      caveat (CallDataHashEnforcer) + allowedTargets=[PledgeRegistry] +
 *      allowedMethods=[markPaid] + value=0 + 5-min window.
 *   4. Deployer redeems: DelegationManager.redeemDelegation([delegation],
 *      PledgeRegistry, 0, markPaidCalldata).
 *
 * Evidence: caller passes the sha256 hash of the evidence document. The
 * blob is stored separately in org-mcp via `/evidence/store` (Phase 5
 * evidence-storage doc); this action only writes the hash on chain.
 */

import { type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  encodeMarkPaid,
  markPaidHash,
  buildMarkPaidDelegationCaveats,
  ROOT_AUTHORITY,
  hashDelegation,
  delegationManagerAbi,
  type PaymentRail,
} from '@smart-agent/sdk'
import { getSession } from '@/lib/auth/session'
import { getPublicClient } from '@/lib/contracts'

interface MarkPaidInput {
  pledgeSubject: Hex
  /** AgentAccount that owns the markPaid authority — typically the pool's `fundAgent`. */
  fundAgent: Address
  /** Token denomination. For USDC settlement use MOCK_USDC_ADDRESS; for non-USDC
   *  pledges (prayer-minutes etc.) pass any non-zero address — the contract
   *  records it as a token bucket without enforcing transferability. */
  token: Address
  /** Raw amount (token-scaled for ERC-20; integer count for prayer-minutes/hours). */
  amount: bigint
  rail: PaymentRail
  /** sha256 hash of the evidence document. MUST be non-zero. */
  evidenceHash: Hex
}

interface MarkPaidResult {
  ok: boolean
  txHash?: Hex
  error?: string
}

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export async function markPledgePaid(input: MarkPaidInput): Promise<MarkPaidResult> {
  const session = await getSession()
  if (!session?.smartAccountAddress) {
    return { ok: false, error: 'not signed in' }
  }
  if (!input.evidenceHash || /^0x0+$/.test(input.evidenceHash)) {
    return { ok: false, error: 'evidenceHash required' }
  }
  if (typeof input.amount !== 'bigint') {
    return {
      ok: false,
      error: 'markPaid request missing amount — hard-refresh the page (action signature changed)',
    }
  }
  if (input.amount <= 0n) {
    return { ok: false, error: 'amount must be positive' }
  }

  // The caller must be a registered owner of `input.fundAgent` (the pool's
  // AgentAccount) — that's the on-chain auth gate for markPaid. We sign the
  // delegation with the caller's own EOA key, NOT the deployer.
  const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
  let signerCtx: Awaited<ReturnType<typeof loadSignerForCurrentUser>> | null = null
  try { signerCtx = await loadSignerForCurrentUser() } catch { /* not signed in */ }
  if (signerCtx?.kind !== 'eoa' || !signerCtx.userRow.privateKey) {
    return { ok: false, error: 'cannot self-sign markPaid delegation — no EOA key available' }
  }
  const signerKey = signerCtx.userRow.privateKey as Hex

  const pledgeRegistry = process.env.PLEDGE_REGISTRY_ADDRESS as Address | undefined
  const delegationManager = process.env.DELEGATION_MANAGER_ADDRESS as Address | undefined
  const enforcers = {
    allowedTargets: process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address,
    allowedMethods: process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address,
    callDataHash:   process.env.CALLDATA_HASH_ENFORCER_ADDRESS as Address,
    timestamp:      process.env.TIMESTAMP_ENFORCER_ADDRESS as Address,
    value:          process.env.VALUE_ENFORCER_ADDRESS as Address,
  }
  if (!pledgeRegistry || !delegationManager ||
      !enforcers.allowedTargets || !enforcers.allowedMethods ||
      !enforcers.callDataHash || !enforcers.timestamp || !enforcers.value) {
    return { ok: false, error: 'spec-005 env not fully configured' }
  }

  const markInput = {
    pledgeRegistry,
    pledgeSubject: input.pledgeSubject,
    token: input.token,
    amount: input.amount,
    rail: input.rail,
    evidenceHash: input.evidenceHash,
  }
  const callData = encodeMarkPaid(markInput)
  const calldataHash = markPaidHash(markInput)

  const signer = privateKeyToAccount(signerKey)
  const caveats = buildMarkPaidDelegationCaveats({
    pledgeRegistry,
    calldataHash,
    enforcers,
  })
  const salt = BigInt('0x' + crypto.randomUUID().replace(/-/g, ''))
  const dHash = hashDelegation(
    {
      delegator: input.fundAgent,
      delegate: signer.address,
      authority: ROOT_AUTHORITY as Hex,
      caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt,
    },
    CHAIN_ID,
    delegationManager,
  )
  const signature = await signer.sign({ hash: dHash })

  const { createWalletClient, http: httpTransport } = await import('viem')
  const { foundry, sepolia } = await import('viem/chains')
  const chain = CHAIN_ID === 11155111 ? sepolia : foundry
  const wallet = createWalletClient({
    account: signer,
    chain,
    transport: httpTransport(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
  })
  const pub = getPublicClient()
  try {
    const txHash = await wallet.writeContract({
      address: delegationManager,
      abi: delegationManagerAbi,
      functionName: 'redeemDelegation',
      args: [
        [{
          delegator: input.fundAgent,
          delegate: signer.address,
          authority: ROOT_AUTHORITY as Hex,
          caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: (c.args ?? '0x') as Hex })),
          salt,
          signature,
        }],
        pledgeRegistry,
        0n,
        callData,
      ],
    })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
    if (receipt.status !== 'success') {
      return { ok: false, error: `tx reverted (${txHash})`, txHash }
    }
    return { ok: true, txHash }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
