'use server'

/**
 * Spec 005 — Rail A: Honor a pledge from the donor's personal treasury.
 *
 * Flow (server-side, v1 deployer-fallback signing — see threat-model T4):
 *
 *   1. Build the executeBatch calldata:
 *        [USDC.transfer(pool, amount),
 *         PledgeRegistry.recordHonor(pledgeSubj, treasury, USDC, amount)]
 *   2. Sign a single-hop donor_treasury → deployer delegation pinned to the
 *      exact calldata hash (CallDataHashEnforcer) with a 5-min window.
 *   3. Deployer redeems: DelegationManager.redeemDelegation([delegation],
 *      treasury, 0, executeBatchCalldata).
 *
 * Atomicity: if USDC.transfer reverts (insufficient balance), the entire
 * executeBatch reverts; no recordHonor fires (threat-model T1).
 *
 * v2 backlog: replace deployer-fallback signing with a passkey ceremony
 * on the donor's browser. The underlying delegation shape is identical.
 */

import { type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  encodeHonorBatch,
  honorBatchHash,
  buildHonorDelegationCaveats,
  ROOT_AUTHORITY,
  hashDelegation,
  delegationManagerAbi,
} from '@smart-agent/sdk'
import { getSession } from '@/lib/auth/session'
import { getPublicClient } from '@/lib/contracts'

interface HonorPledgeInput {
  /** On-chain pledge subject (keccak256 derived from poolAgent + nullifier + salt). */
  pledgeSubject: Hex
  /** Pool AgentAccount receiving USDC. */
  poolAgent: Address
  /** Token-scaled USDC amount for the ERC-20 transfer ($40 → 40_000_000n). */
  tokenAmount: bigint
  /** Pledge-unit amount for `recordHonor` ($40 → 40n). MUST match the unit
   *  the pledge was submitted in (whole dollars in v1) — otherwise the
   *  on-chain `next + externalPaid > committed` check reverts with
   *  PledgeAmountExceedsCommitted (0x02197aa9). */
  pledgeUnitAmount: bigint
}

interface HonorPledgeResult {
  ok: boolean
  txHash?: Hex
  error?: string
}

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export async function honorPledge(input: HonorPledgeInput): Promise<HonorPledgeResult> {
  const session = await getSession()
  if (!session?.smartAccountAddress) {
    return { ok: false, error: 'not signed in' }
  }
  const treasury = session.smartAccountAddress as Address

  // Resolve the user's own EOA key. Demo: `users.privateKey`.
  // Passkey/SIWE: still uses the deployer-fallback inside loadSignerForCurrentUser
  // (v1 placeholder until the passkey signing ceremony lands). Demo MUST
  // NOT touch the deployer key (P1 substrate-independence rule).
  const { loadSignerForCurrentUser } = await import('@/lib/ssi/signer')
  let signerCtx: Awaited<ReturnType<typeof loadSignerForCurrentUser>> | null = null
  try { signerCtx = await loadSignerForCurrentUser() } catch { /* not signed in */ }
  if (signerCtx?.kind !== 'eoa' || !signerCtx.userRow.privateKey) {
    return { ok: false, error: 'cannot self-sign honor delegation — no EOA key available' }
  }
  const signerKey = signerCtx.userRow.privateKey as Hex

  const token = process.env.MOCK_USDC_ADDRESS as Address | undefined
  const pledgeRegistry = process.env.PLEDGE_REGISTRY_ADDRESS as Address | undefined
  const delegationManager = process.env.DELEGATION_MANAGER_ADDRESS as Address | undefined
  const enforcers = {
    allowedTargets: process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address,
    allowedMethods: process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address,
    callDataHash:   process.env.CALLDATA_HASH_ENFORCER_ADDRESS as Address,
    timestamp:      process.env.TIMESTAMP_ENFORCER_ADDRESS as Address,
    value:          process.env.VALUE_ENFORCER_ADDRESS as Address,
  }
  if (!token || !pledgeRegistry || !delegationManager ||
      !enforcers.allowedTargets || !enforcers.allowedMethods ||
      !enforcers.callDataHash || !enforcers.timestamp || !enforcers.value) {
    return { ok: false, error: 'spec-005 env not fully configured (USDC/PledgeRegistry/DelegationManager/enforcers)' }
  }
  if (
    typeof input.tokenAmount !== 'bigint' ||
    typeof input.pledgeUnitAmount !== 'bigint'
  ) {
    return {
      ok: false,
      error: 'honor request missing tokenAmount / pledgeUnitAmount — hard-refresh the page (the action signature changed)',
    }
  }
  if (input.tokenAmount <= 0n || input.pledgeUnitAmount <= 0n) {
    return { ok: false, error: 'amount must be positive' }
  }

  // 1. Build calldata + hash.
  const honorInput = {
    treasury, pool: input.poolAgent, token, pledgeRegistry,
    pledgeSubject: input.pledgeSubject,
    tokenAmount: input.tokenAmount,
    pledgeUnitAmount: input.pledgeUnitAmount,
  }
  const callData = encodeHonorBatch(honorInput)
  const calldataHash = honorBatchHash(honorInput)

  // 2. Build delegation (donor_treasury → user-EOA) with calldataHash pinned.
  //    Sign with the user's own key (demo: users.privateKey; passkey/SIWE:
  //    placeholder via loadSignerForCurrentUser). The user's EOA must be an
  //    owner of `treasury` so ERC-1271 accepts the signature — that's the
  //    invariant we set up at AgentAccount initialize time.
  const signer = privateKeyToAccount(signerKey)
  const caveats = buildHonorDelegationCaveats({
    treasury,
    calldataHash,
    enforcers,
  })
  const salt = BigInt('0x' + crypto.randomUUID().replace(/-/g, ''))
  const dHash = hashDelegation(
    {
      delegator: treasury,
      delegate: signer.address,
      authority: ROOT_AUTHORITY as Hex,
      caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt,
    },
    CHAIN_ID,
    delegationManager,
  )
  const signature = await signer.sign({ hash: dHash })

  // 3. Submit redeem. The redeem tx is sent by the same EOA that signed
  //    the delegation (it's the delegate). For demo users this is their
  //    own EOA; we use a wallet client built from `signerKey` so the tx
  //    is signed by the user, not the deployer.
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
          delegator: treasury,
          delegate: signer.address,
          authority: ROOT_AUTHORITY as Hex,
          caveats: caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: (c.args ?? '0x') as Hex })),
          salt,
          signature,
        }],
        treasury,
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
