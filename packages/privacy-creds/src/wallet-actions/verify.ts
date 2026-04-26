import { verifyTypedData, hashTypedData, type Client } from 'viem'
import { readContract, getCode } from 'viem/actions'
import type { WalletAction } from './types'
import { WalletActionTypes, walletActionDomain } from './types'

const ERC1271_MAGIC = '0x1626ba7e' as const

const erc1271Abi = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ type: 'bytes4' }],
  },
] as const

export interface VerifyWalletActionInput {
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

export interface VerifyWalletActionResult {
  ok: boolean
  reason?: string
}

export async function verifyWalletAction(
  input: VerifyWalletActionInput,
): Promise<VerifyWalletActionResult> {
  const now = input.nowSeconds ?? BigInt(Math.floor(Date.now() / 1000))
  const maxAge = input.maxAgeSec ?? 300n

  if (input.action.expiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }
  if (input.action.expiresAt > now + maxAge) {
    return { ok: false, reason: 'expiresAt beyond max allowed lifetime' }
  }

  // If the expectedSigner has bytecode (it's a smart account), call
  // isValidSignature directly. viem's verifyTypedData(mode='auto') tries
  // ERC-1271 first but on failure falls through to ECDSA recover, which
  // throws `invalid signature length` for our 0x01-prefixed packed passkey
  // signatures. Going straight to ERC-1271 avoids that throw.
  if (input.client) {
    try {
      const code = await getCode(input.client, { address: input.expectedSigner })
      if (code && code !== '0x') {
        const hash = hashTypedData({
          domain: walletActionDomain(input.chainId, input.verifyingContract),
          types: WalletActionTypes,
          primaryType: 'WalletAction',
          message: input.action,
        })
        try {
          const result = await readContract(input.client, {
            address: input.expectedSigner,
            abi: erc1271Abi,
            functionName: 'isValidSignature',
            args: [hash, input.signature],
          })
          return result === ERC1271_MAGIC
            ? { ok: true }
            : { ok: false, reason: 'ERC-1271 rejected' }
        } catch (e) {
          return { ok: false, reason: `ERC-1271 call failed: ${(e as Error).message}` }
        }
      }
    } catch {
      // getCode failed — fall through to viem's auto path below.
    }
  }

  // EOA path: viem's verifyTypedData handles ECDSA recovery and ERC-1271 fallback.
  try {
    const ok = await verifyTypedData({
      address: input.expectedSigner,
      domain: walletActionDomain(input.chainId, input.verifyingContract),
      types: WalletActionTypes,
      primaryType: 'WalletAction',
      message: input.action,
      signature: input.signature,
      ...(input.client ? { client: input.client as Parameters<typeof verifyTypedData>[0] extends infer P ? P extends { client?: infer C } ? C : never : never } : {}),
    })
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' }
  } catch (e) {
    return { ok: false, reason: `verify error: ${(e as Error).message}` }
  }
}
