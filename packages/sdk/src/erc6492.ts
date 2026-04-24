/**
 * ERC-6492 counterfactual signature wrap/unwrap.
 *
 *   Wrapped format:
 *     abi.encode(factory, factoryCalldata, innerSig) || 0x6492…6492 (32 bytes)
 *
 * Clients use this to sign ON BEHALF of a smart account that hasn't been
 * deployed yet. Verifiers detect the magic suffix, call the factory to
 * deploy, then validate innerSig via ERC-1271 on the fresh account.
 *
 *  - `wrap6492` produces such a signature.
 *  - `unwrap6492` recovers (factory, factoryCalldata, innerSig) when the
 *    magic is present; returns { wrapped: false, sig } otherwise.
 *  - `is6492Signature` is a cheap magic-suffix check.
 */

import { encodeAbiParameters, decodeAbiParameters, concatHex } from 'viem'

export const ERC6492_MAGIC_SUFFIX =
  '0x6492649264926492649264926492649264926492649264926492649264926492' as const

/** Returns true iff `sig` ends with the 6492 magic 32-byte suffix. */
export function is6492Signature(sig: `0x${string}`): boolean {
  if (sig.length < 2 + 64) return false
  return sig.slice(-64).toLowerCase() === ERC6492_MAGIC_SUFFIX.slice(2)
}

/**
 * Wrap an inner signature with the ERC-6492 envelope.
 *
 * @param factory           Address that will be called to deploy the account.
 * @param factoryCalldata   Calldata executed against `factory` (e.g. createAccount(owner, salt)).
 * @param innerSig          The actual signature the account's isValidSignature accepts once deployed.
 */
export function wrap6492(
  factory: `0x${string}`,
  factoryCalldata: `0x${string}`,
  innerSig: `0x${string}`,
): `0x${string}` {
  const prefix = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes' }],
    [factory, factoryCalldata, innerSig],
  )
  return concatHex([prefix, ERC6492_MAGIC_SUFFIX])
}

export interface Unwrapped6492 {
  wrapped: true
  factory: `0x${string}`
  factoryCalldata: `0x${string}`
  innerSig: `0x${string}`
}

export interface Unwrapped6492Not {
  wrapped: false
  innerSig: `0x${string}`
}

/** Strip the 6492 envelope if present; return the raw inner sig otherwise. */
export function unwrap6492(sig: `0x${string}`): Unwrapped6492 | Unwrapped6492Not {
  if (!is6492Signature(sig)) return { wrapped: false, innerSig: sig }
  const prefix = ('0x' + sig.slice(2, sig.length - 64)) as `0x${string}`
  const [factory, factoryCalldata, innerSig] = decodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes' }],
    prefix,
  ) as [`0x${string}`, `0x${string}`, `0x${string}`]
  return { wrapped: true, factory, factoryCalldata, innerSig }
}
