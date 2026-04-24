import { verifyTypedData } from 'viem'
import type { WalletAction } from './types'
import { WalletActionTypes, walletActionDomain } from './types'

export interface VerifyPrivyActionInput {
  action: WalletAction
  signature: `0x${string}`
  expectedSigner: `0x${string}`
  chainId: number
  verifyingContract: `0x${string}`
  /** Current time in seconds since epoch. Injectable for testing. */
  nowSeconds?: bigint
  /** Maximum action lifetime (seconds). Rejects envelopes with expiresAt > now + maxAgeSec. */
  maxAgeSec?: bigint
}

export interface VerifyPrivyActionResult {
  ok: boolean
  reason?: string
}

export async function verifyPrivyAction(
  input: VerifyPrivyActionInput,
): Promise<VerifyPrivyActionResult> {
  const now = input.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000))
  const maxAge = input.maxAgeSec ?? 300n

  if (input.action.expiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }
  if (input.action.expiresAt > now + maxAge) {
    return { ok: false, reason: 'expiresAt beyond max allowed lifetime' }
  }

  const ok = await verifyTypedData({
    address: input.expectedSigner,
    domain: walletActionDomain(input.chainId, input.verifyingContract),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: input.action,
    signature: input.signature,
  })

  return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' }
}
