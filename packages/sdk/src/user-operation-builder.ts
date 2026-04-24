/**
 * UserOperationBuilder — compose sender + bundler + paymaster into a single
 * send-and-wait flow. Bundler-agnostic, paymaster-agnostic.
 *
 *   const builder = new UserOperationBuilder({ bundler, paymaster, chainId })
 *   const receipt = await builder.send({
 *     sender: '0x…',
 *     callData: '0x…',
 *     nonce: '0x0',
 *     signUserOp: async (op, hash) => await signerForAccount(op, hash),
 *   })
 *
 * The builder:
 *   1. fills gas/fee fields with sensible defaults (estimated once at start)
 *   2. if a paymaster is configured, asks for a stub → estimates gas with it
 *      attached → asks for real paymasterData → merges fields
 *   3. asks the caller to sign the finalised UserOp hash
 *   4. submits via bundler and waits for receipt
 *
 * The caller owns the signing key — the builder never sees it. This is
 * intentional: it keeps the builder usable with Privy, WalletConnect,
 * passkey validators, or any other custody model.
 */

import type { BundlerClient, UserOperationReceipt } from './bundler'
import type { PaymasterClient } from './paymaster'
import type { UserOperation, UserOperationDraft, Hex, Address } from './bundler-types'

export type SignUserOpFn = (userOp: UserOperation) => Promise<Hex>

export interface UserOperationBuilderConfig {
  bundler: BundlerClient
  /** Optional: paymaster client for sponsored UserOps. Omit for self-paid. */
  paymaster?: PaymasterClient
  /** Optional: gas-price source. Pimlico exposes `pimlico_getUserOperationGasPrice`;
   *  otherwise the builder defaults to reading from `eth_gasPrice` via the bundler RPC. */
  gasPrice?: () => Promise<{ maxFeePerGas: Hex; maxPriorityFeePerGas: Hex }>
  chainId: number
}

export interface SendArgs {
  /** Raw UserOp draft — sender + callData required; everything else optional. */
  userOp: UserOperationDraft
  /** Callback that returns the 0x-prefixed signature for the finalised UserOp. */
  signUserOp: SignUserOpFn
}

export class UserOperationBuilder {
  constructor(private readonly cfg: UserOperationBuilderConfig) {}

  /**
   * End-to-end: fill → (optional sponsor) → sign → submit → wait for receipt.
   */
  async send(args: SendArgs): Promise<UserOperationReceipt> {
    const { bundler, paymaster, chainId } = this.cfg
    const entryPoint = bundler.entryPoint

    // 1. Gas pricing.
    const prices = this.cfg.gasPrice ? await this.cfg.gasPrice() : await defaultGasPrice(bundler.url)

    // 2. Assemble a draft with placeholder gas fields.
    let op: UserOperation = {
      sender: args.userOp.sender,
      nonce: args.userOp.nonce ?? ('0x0' as Hex),
      callData: args.userOp.callData,
      callGasLimit: args.userOp.callGasLimit ?? ('0x100000' as Hex),
      verificationGasLimit: args.userOp.verificationGasLimit ?? ('0x100000' as Hex),
      preVerificationGas: args.userOp.preVerificationGas ?? ('0x50000' as Hex),
      maxFeePerGas: args.userOp.maxFeePerGas ?? prices.maxFeePerGas,
      maxPriorityFeePerGas: args.userOp.maxPriorityFeePerGas ?? prices.maxPriorityFeePerGas,
      signature: args.userOp.signature ?? dummySignature(),
      factory: args.userOp.factory,
      factoryData: args.userOp.factoryData,
      paymaster: args.userOp.paymaster,
      paymasterData: args.userOp.paymasterData,
      paymasterVerificationGasLimit: args.userOp.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: args.userOp.paymasterPostOpGasLimit,
    }

    // 3. Paymaster flow (ERC-7677-style two-step).
    if (paymaster) {
      const stub = await paymaster.getPaymasterStubData(op, entryPoint, chainId)
      op = {
        ...op,
        paymaster: stub.paymaster,
        paymasterData: stub.paymasterData,
        paymasterVerificationGasLimit: stub.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: stub.paymasterPostOpGasLimit,
        // If the stub returned tentative gas, carry it forward.
        ...(stub.preVerificationGas   ? { preVerificationGas:   stub.preVerificationGas   } : {}),
        ...(stub.verificationGasLimit ? { verificationGasLimit: stub.verificationGasLimit } : {}),
        ...(stub.callGasLimit         ? { callGasLimit:         stub.callGasLimit         } : {}),
      }
    }

    // 4. Estimate gas with real paymaster fields attached.
    try {
      const est = await bundler.estimateUserOperationGas(op, entryPoint)
      op = {
        ...op,
        callGasLimit: est.callGasLimit,
        verificationGasLimit: est.verificationGasLimit,
        preVerificationGas: est.preVerificationGas,
        ...(est.paymasterVerificationGasLimit
          ? { paymasterVerificationGasLimit: est.paymasterVerificationGasLimit } : {}),
        ...(est.paymasterPostOpGasLimit
          ? { paymasterPostOpGasLimit: est.paymasterPostOpGasLimit } : {}),
      }
    } catch (e) {
      // Some providers can't estimate with a stub signature; surface but continue.
      if (!this.cfg.paymaster) throw e
    }

    // 5. Real paymaster data (signed against the final gas fields).
    if (paymaster) {
      const real = await paymaster.getPaymasterData(op, entryPoint, chainId)
      op = {
        ...op,
        paymaster: real.paymaster,
        paymasterData: real.paymasterData,
        paymasterVerificationGasLimit: real.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: real.paymasterPostOpGasLimit,
      }
    }

    // 6. Signature. The callback receives the fully-specified op and must
    //    compute `getUserOpHash(op, entryPoint, chainId)` itself, sign it,
    //    and return the signature.
    op.signature = await args.signUserOp(op)

    // 7. Submit and wait.
    const userOpHash = await bundler.sendUserOperation(op, entryPoint)
    return bundler.waitForUserOperationReceipt(userOpHash)
  }
}

async function defaultGasPrice(rpcUrl: string): Promise<{ maxFeePerGas: Hex; maxPriorityFeePerGas: Hex }> {
  // Fall back to the RPC's eth_gasPrice; set tip = 10% of total as a reasonable default.
  const r = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
  })
  const body = (await r.json()) as { result?: Hex }
  const gp = BigInt(body.result ?? '0x3b9aca00')
  const tip = gp / 10n
  return { maxFeePerGas: `0x${gp.toString(16)}`, maxPriorityFeePerGas: `0x${tip.toString(16)}` }
}

/** 65-byte zero signature, typical stub for validation-time gas estimation. */
function dummySignature(): Hex {
  return ('0x' + '00'.repeat(65)) as Hex
}
