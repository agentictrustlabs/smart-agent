/**
 * viem `LocalAccount` adapter over `A2AKeyProvider.signA2AAction` (KMS K4 §6).
 *
 * Wraps a "signer backend" (local-secp256k1 in dev; AWS KMS asymmetric
 * `ECC_SECG_P256K1` in prod — landing in PR-2) as a viem `LocalAccount`
 * indistinguishable at the call site from `privateKeyToAccount(...)`. Every
 * viem consumer — `createWalletClient({ account })`, `walletClient.writeContract`,
 * `sendTransaction`, `signMessage`, `signTypedData` — works unchanged when
 * the account is swapped from `privateKeyToAccount` to `createKmsAccount`.
 *
 * The adapter computes the authoritative digest for each signing surface
 * itself — `hashMessage` for EIP-191, `hashTypedData` for EIP-712, and
 * `keccak256(serializeTransaction(tx, undefined))` for the EIP-1559 /
 * legacy transaction pre-image — and passes the 32-byte digest to the
 * backend via the `digest` field of `signA2AAction`. The backend signs
 * the bytes verbatim and returns `r || s || v` with `v = recovery + 27`;
 * viem's serializers normalize `v` per transaction type (legacy EIP-155
 * recomputes `v = chainId*2 + 35 + recovery`; EIP-1559 wants `yParity`).
 *
 * Latency: every method is one backend round-trip. With the local-secp256k1
 * backend (PR-1) that's microseconds. With AWS KMS (PR-2) it's ~30–50 ms.
 * The current master-EOA call site (`onchain-redeem.ts:1241`) signs once
 * per user action; the budget is comfortable.
 *
 * See `KMS-IMPLEMENTATION-PLAN.md` K4 §6 for the design rationale and the
 * "prior art" survey of the @rumblefishdev/hardhat-kms-signer pattern.
 */
import {
  hashMessage,
  hashTypedData,
  keccak256,
  serializeTransaction,
  toHex,
  type Hex,
  type LocalAccount,
  type Signature,
} from 'viem'
import { toAccount } from 'viem/accounts'
import type { A2AKeyProvider } from './types'

/**
 * The shape `createKmsAccount` consumes. Any provider that implements
 * `signA2AAction` plus an address accessor satisfies it.
 *
 * `signA2AAction` is required (non-optional) here — the wrapper cannot
 * function with a backend that only implements envelope encryption.
 * Construction-time validation in `apps/a2a-agent/src/auth/key-provider.ts`
 * (`buildSignerBackend`) ensures we never reach this code with a backend
 * that lacks the method.
 */
export interface KmsAccountBackend {
  signA2AAction: NonNullable<A2AKeyProvider['signA2AAction']>
  getSignerAddress(): Promise<`0x${string}`>
}

export interface CreateKmsAccountOptions {
  /**
   * Optional sessionId emitted into the `signA2AAction` audit fields.
   * Defaults to `'master-eoa'` for the master-EOA call site. The KMS
   * digest path ignores these — they exist for the structured-log /
   * CloudTrail filter trail in PR-2.
   */
  sessionId?: string
  /**
   * Optional chainId emitted into audit fields. Not used by viem's
   * serializers (they derive chainId from `tx.chainId` themselves) — this
   * is purely for the audit-tuple log line.
   */
  chainId?: number
}

const EMPTY_PAYLOAD = new Uint8Array(0)

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error('hex string has odd length')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('invalid hex character')
    out[i] = byte
  }
  return out
}

/**
 * Split a 65-byte `r || s || v` signature into a viem `Signature` object
 * with `{r, s, v, yParity}`. viem's transaction serializers accept either
 * `v` (legacy 27/28) or `yParity` (0/1); we emit both so every serializer
 * variant works.
 */
function splitSignature(sig: Uint8Array): Signature {
  if (sig.length !== 65) {
    throw new Error(`splitSignature: expected 65-byte signature (got ${sig.length})`)
  }
  const r = toHex(sig.slice(0, 32))
  const s = toHex(sig.slice(32, 64))
  const vByte = sig[64]!
  // We always emit v = recovery + 27 (27 or 28). yParity = recovery.
  const yParity = vByte === 28 ? 1 : 0
  return {
    r,
    s,
    v: BigInt(vByte),
    yParity,
  } as Signature
}

/**
 * Build a viem `LocalAccount` backed by a `KmsAccountBackend`.
 *
 * The returned account is the documented drop-in for `privateKeyToAccount`.
 * Caches `signerAddress` via one upfront backend call; subsequent signing
 * operations do not re-fetch the address.
 *
 * `publicKey` on the returned account is set to `'0x'` because the master-
 * EOA wrapper never needs to expose it (every viem path used by Smart Agent
 * goes through `address` + the three `sign*` methods). If a future caller
 * needs the public key, extend the backend interface with `getPublicKey()`
 * and surface it here.
 */
export async function createKmsAccount(
  backend: KmsAccountBackend,
  opts: CreateKmsAccountOptions = {},
): Promise<LocalAccount> {
  const address = await backend.getSignerAddress()
  const sessionId = opts.sessionId ?? 'master-eoa'
  const chainIdStr = String(opts.chainId ?? 0)

  // Internal: hand a 32-byte digest to the backend and return the viem-
  // shaped 65-byte hex signature ('0x{r}{s}{v}'). All three viem signing
  // surfaces converge here.
  async function signDigest(digest: Uint8Array, actionId: string): Promise<Hex> {
    if (digest.length !== 32) {
      throw new Error(`createKmsAccount: digest must be 32 bytes (got ${digest.length})`)
    }
    const { signature } = await backend.signA2AAction({
      canonicalPayload: EMPTY_PAYLOAD,
      accountAddress: address,
      chainId: chainIdStr,
      sessionId,
      actionId,
      digest,
    })
    if (signature.length !== 65) {
      throw new Error(
        `createKmsAccount: backend returned ${signature.length}-byte signature (expected 65)`,
      )
    }
    return toHex(signature)
  }

  const account = toAccount({
    address,
    async sign({ hash }) {
      // viem's CustomSource.sign signs a pre-computed 32-byte hash. Used
      // by signAuthorization and some lower-level call sites.
      return signDigest(hexToBytes(hash), 'sign')
    },
    async signMessage({ message }) {
      // EIP-191. `hashMessage` adds the "\x19Ethereum Signed Message:\n…"
      // prefix and keccak256s the result.
      const digest = hexToBytes(hashMessage(message))
      return signDigest(digest, 'signMessage')
    },
    async signTypedData(typedData) {
      // EIP-712. `hashTypedData` builds the domainSeparator + structHash
      // and emits `keccak256("\x19\x01" || domainSeparator || structHash)`.
      const digest = hexToBytes(hashTypedData(typedData as Parameters<typeof hashTypedData>[0]))
      return signDigest(digest, 'signTypedData')
    },
    async signTransaction(transaction, { serializer = serializeTransaction } = {}) {
      // Build the unsigned transaction pre-image. For EIP-4844 we exclude
      // sidecars from the signing payload (matches viem's privateKeyToAccount).
      const signable =
        (transaction as { type?: string }).type === 'eip4844'
          ? { ...(transaction as object), sidecars: false }
          : transaction
      // viem's `serializeTransaction` is sync; user serializers may be
      // async (`MaybePromise<Hex>`). Await covers both.
      const unsignedHex = (await serializer(signable as Parameters<typeof serializer>[0])) as Hex
      const digest = hexToBytes(keccak256(unsignedHex))
      const sigHex = await signDigest(digest, 'signTransaction')
      const sigBytes = hexToBytes(sigHex)
      const signature = splitSignature(sigBytes)
      // viem's serializer bakes the chainId into the v / yParity per
      // transaction type:
      //   - legacy (no chainId): v = recovery + 27
      //   - EIP-155 (chainId set, type=='legacy'): v = chainId*2 + 35 + recovery
      //   - EIP-1559/2930/2718 typed: yParity = recovery (v unused on wire)
      // We pass {r, s, v=27|28, yParity=0|1} and the serializer picks the right form.
      const finalHex = (await serializer(
        transaction as Parameters<typeof serializer>[0],
        signature,
      )) as Hex
      return finalHex
    },
  })

  // viem's `LocalAccount` requires `publicKey: Hex` (see node_modules viem
  // accounts/types.ts). We don't expose it from the backend — every call
  // site we care about uses `address` + the sign methods. Emit '0x' as a
  // placeholder; if a future surface needs the public key, extend backends
  // to expose `getPublicKey()` and thread it through here.
  return {
    ...account,
    publicKey: '0x',
    source: 'kms',
  } as LocalAccount
}
