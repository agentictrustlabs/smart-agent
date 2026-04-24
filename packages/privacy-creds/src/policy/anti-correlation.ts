import { keccak256, toBytes } from 'viem'

/**
 * Deterministic pairwise handle for a given (holderWalletId, verifierId).
 * Returned as a hex string; the holder presents this instead of any stable
 * global identifier.
 */
export function pairwiseHandle(holderWalletId: string, verifierId: string): `0x${string}` {
  return keccak256(toBytes(`pw:${holderWalletId}:${verifierId}`))
}
