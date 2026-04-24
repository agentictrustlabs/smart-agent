/**
 * External paymaster client — ERC-7677 `pm_*` methods, compatible with
 * Pimlico, Stackup, Alchemy, Biconomy, Candide, and the ERC-7677 reference
 * implementation.
 *
 *   const paymaster = new PaymasterClient({ url: process.env.PAYMASTER_URL! })
 *   const stub = await paymaster.getPaymasterStubData(userOp, entryPoint, chainId)
 *   // ...estimate gas with the stub attached, then:
 *   const signed = await paymaster.getPaymasterData(userOp, entryPoint, chainId)
 *
 * Some providers (Pimlico) also expose `pm_sponsorUserOperation` — a single
 * call that returns stub + data together. We support both shapes.
 */

import type { UserOperation, Hex, Address } from './bundler-types'

export interface PaymasterConfig {
  url: string
  headers?: Record<string, string>
  /** Optional context object passed through to the paymaster (spec: any JSON). */
  context?: Record<string, unknown>
}

export interface PaymasterStubData {
  paymaster: Address
  paymasterData: Hex
  paymasterVerificationGasLimit: Hex
  paymasterPostOpGasLimit: Hex
  /** Optional — some paymasters return tentative gas numbers that the caller
   *  should pass into estimateUserOperationGas for a final read. */
  preVerificationGas?: Hex
  verificationGasLimit?: Hex
  callGasLimit?: Hex
}

export interface PaymasterData {
  paymaster: Address
  paymasterData: Hex
  paymasterVerificationGasLimit: Hex
  paymasterPostOpGasLimit: Hex
}

export interface SponsorUserOperationResponse {
  paymaster: Address
  paymasterData: Hex
  paymasterVerificationGasLimit: Hex
  paymasterPostOpGasLimit: Hex
  /** Gas fields are typically returned only by the combined `pm_sponsorUserOperation` call. */
  preVerificationGas: Hex
  verificationGasLimit: Hex
  callGasLimit: Hex
}

export class PaymasterClient {
  readonly url: string
  private readonly headers: Record<string, string>
  private readonly context: Record<string, unknown> | undefined

  constructor(cfg: PaymasterConfig) {
    this.url = cfg.url
    this.headers = cfg.headers ?? {}
    this.context = cfg.context
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const r = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (!r.ok) throw new Error(`paymaster HTTP ${r.status}: ${await r.text()}`)
    const body = (await r.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } }
    if (body.error) {
      throw new PaymasterRpcError(method, body.error.code, body.error.message, body.error.data)
    }
    return body.result as T
  }

  /** ERC-7677: return placeholder paymaster data so the caller can estimate
   *  gas with the same paymaster attached. The returned paymasterData is
   *  typically a dummy signature of the right length. */
  async getPaymasterStubData(
    userOp: UserOperation,
    entryPoint: Address,
    chainId: number,
  ): Promise<PaymasterStubData> {
    return this.rpc<PaymasterStubData>('pm_getPaymasterStubData', [
      userOp, entryPoint, toHex(chainId), this.context ?? {},
    ])
  }

  /** ERC-7677: sign the finalised UserOp (gas limits included) and return
   *  the real paymasterData to plug into the final send. */
  async getPaymasterData(
    userOp: UserOperation,
    entryPoint: Address,
    chainId: number,
  ): Promise<PaymasterData> {
    return this.rpc<PaymasterData>('pm_getPaymasterData', [
      userOp, entryPoint, toHex(chainId), this.context ?? {},
    ])
  }

  /** Pimlico-style one-shot: returns paymaster fields + gas in one call. */
  async sponsorUserOperation(
    userOp: UserOperation,
    entryPoint: Address,
  ): Promise<SponsorUserOperationResponse> {
    const extraParam = this.context ? [this.context] : []
    return this.rpc<SponsorUserOperationResponse>('pm_sponsorUserOperation', [
      userOp, entryPoint, ...extraParam,
    ])
  }
}

export class PaymasterRpcError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(`paymaster ${method} error ${code}: ${message}`)
    this.name = 'PaymasterRpcError'
  }
}

function toHex(n: number): `0x${string}` {
  return `0x${n.toString(16)}`
}
