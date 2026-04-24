/**
 * External bundler client — ERC-4337 v0.7 JSON-RPC methods.
 *
 * Works with any bundler that implements the standard spec (Pimlico,
 * Stackup, Alchemy, Biconomy, Candide, Voltaire, Skandha, …). No assumption
 * of a local in-process bundler; just point BUNDLER_URL at the endpoint of
 * your choice.
 *
 *   const bundler = new BundlerClient({ url: process.env.BUNDLER_URL! })
 *   const hash = await bundler.sendUserOperation(userOp, entryPoint)
 *   const receipt = await bundler.waitForUserOperationReceipt(hash)
 */

import type { UserOperation, Hex, Address } from './bundler-types'

export interface BundlerConfig {
  url: string
  /** Optional API key header name/value (e.g. Pimlico's ?apikey=). */
  headers?: Record<string, string>
  /** ERC-4337 EntryPoint address to use. Defaults to v0.7. */
  entryPoint?: Address
  /** Poll interval in ms for waitForUserOperationReceipt. Default 1500. */
  pollIntervalMs?: number
  /** Max wait in ms. Default 120 s. */
  timeoutMs?: number
}

export interface UserOperationReceipt {
  userOpHash: Hex
  entryPoint: Address
  sender: Address
  nonce: Hex
  paymaster?: Address
  actualGasCost: Hex
  actualGasUsed: Hex
  success: boolean
  reason?: string
  receipt: {
    transactionHash: Hex
    blockNumber: Hex
    blockHash: Hex
  }
  logs: unknown[]
}

export interface GasEstimate {
  preVerificationGas: Hex
  verificationGasLimit: Hex
  callGasLimit: Hex
  paymasterVerificationGasLimit?: Hex
  paymasterPostOpGasLimit?: Hex
}

/** Thin JSON-RPC wrapper — serialisable, cache-friendly. */
export class BundlerClient {
  readonly url: string
  readonly entryPoint: Address
  private readonly headers: Record<string, string>
  private readonly pollIntervalMs: number
  private readonly timeoutMs: number

  constructor(cfg: BundlerConfig) {
    this.url = cfg.url
    this.entryPoint = cfg.entryPoint ?? ('0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address)
    this.headers = cfg.headers ?? {}
    this.pollIntervalMs = cfg.pollIntervalMs ?? 1500
    this.timeoutMs = cfg.timeoutMs ?? 120_000
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const r = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (!r.ok) throw new Error(`bundler HTTP ${r.status}: ${await r.text()}`)
    const body = (await r.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } }
    if (body.error) {
      throw new BundlerRpcError(method, body.error.code, body.error.message, body.error.data)
    }
    return body.result as T
  }

  // ─── ERC-4337 standard methods ───────────────────────────────────

  async supportedEntryPoints(): Promise<Address[]> {
    return this.rpc<Address[]>('eth_supportedEntryPoints', [])
  }

  async chainId(): Promise<number> {
    const hex = await this.rpc<Hex>('eth_chainId', [])
    return Number.parseInt(hex, 16)
  }

  async estimateUserOperationGas(userOp: UserOperation, entryPoint?: Address): Promise<GasEstimate> {
    return this.rpc<GasEstimate>('eth_estimateUserOperationGas', [userOp, entryPoint ?? this.entryPoint])
  }

  /** Submit a fully signed UserOperation; returns its userOpHash. */
  async sendUserOperation(userOp: UserOperation, entryPoint?: Address): Promise<Hex> {
    return this.rpc<Hex>('eth_sendUserOperation', [userOp, entryPoint ?? this.entryPoint])
  }

  async getUserOperationReceipt(userOpHash: Hex): Promise<UserOperationReceipt | null> {
    return this.rpc<UserOperationReceipt | null>('eth_getUserOperationReceipt', [userOpHash])
  }

  async getUserOperationByHash(userOpHash: Hex): Promise<{
    userOperation: UserOperation
    entryPoint: Address
    blockNumber: Hex
    blockHash: Hex
    transactionHash: Hex
  } | null> {
    return this.rpc('eth_getUserOperationByHash', [userOpHash])
  }

  /** Poll until the bundler reports a receipt or the timeout fires. */
  async waitForUserOperationReceipt(userOpHash: Hex): Promise<UserOperationReceipt> {
    const deadline = Date.now() + this.timeoutMs
    while (Date.now() < deadline) {
      const r = await this.getUserOperationReceipt(userOpHash)
      if (r) return r
      await sleep(this.pollIntervalMs)
    }
    throw new Error(`waitForUserOperationReceipt: timeout after ${this.timeoutMs}ms (userOpHash=${userOpHash})`)
  }
}

export class BundlerRpcError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(`bundler ${method} error ${code}: ${message}`)
    this.name = 'BundlerRpcError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
