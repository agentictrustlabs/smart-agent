import { verifyTypedData, type Client } from 'viem'
import type { WalletAction } from './types'
import { WalletActionTypes, walletActionDomain } from './types'

export interface VerifyPrivyActionInput {
  action: WalletAction
  signature: `0x${string}`
  /**
   * Address that produced the signature. May be:
   *   - an EOA (ECDSA path, no `client` required)
   *   - a smart account (ERC-1271 path; requires `client` so we can call
   *     `isValidSignature` — and the smart account's _verifyWebAuthn picks up
   *     0x01-prefixed passkey signatures transparently).
   */
  expectedSigner: `0x${string}`
  chainId: number
  verifyingContract: `0x${string}`
  /** Current time in seconds since epoch. Injectable for testing. */
  nowSeconds?: bigint
  /** Maximum action lifetime (seconds). Rejects envelopes with expiresAt > now + maxAgeSec. */
  maxAgeSec?: bigint
  /**
   * Optional public client. Required when `expectedSigner` is a contract
   * (smart-account / ERC-1271 verification path). Plain EOA verification
   * works without it. Typed as the wide `Client` to accept any viem client
   * variant; viem's verifyTypedData only uses it for `readContract`.
   */
  client?: Client
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
    // viem's verifyTypedData accepts a wider client; we type ours loosely above.
    ...(input.client ? { client: input.client as Parameters<typeof verifyTypedData>[0] extends infer P ? P extends { client?: infer C } ? C : never : never } : {}),
  })

  return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' }
}
