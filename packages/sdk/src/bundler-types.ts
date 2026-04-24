/**
 * Shared types for the bundler / paymaster clients.
 *
 * ERC-4337 v0.7 packed UserOperation layout — matches the wire format each
 * standard-conforming bundler accepts via eth_sendUserOperation. We keep
 * every field optional during construction; the UserOperationBuilder fills
 * in blanks before submission.
 */

export type Hex = `0x${string}`
export type Address = `0x${string}`

export interface UserOperation {
  sender: Address
  nonce: Hex
  /** ERC-4337 v0.7 packs initCode as (factory + factoryData) fields. */
  factory?: Address
  factoryData?: Hex
  callData: Hex
  callGasLimit: Hex
  verificationGasLimit: Hex
  preVerificationGas: Hex
  maxFeePerGas: Hex
  maxPriorityFeePerGas: Hex
  /** Paymaster fields (all optional — omit for self-paying UserOps). */
  paymaster?: Address
  paymasterVerificationGasLimit?: Hex
  paymasterPostOpGasLimit?: Hex
  paymasterData?: Hex
  signature: Hex
}

/** Partial UserOp suitable for handing to a builder — only sender + callData
 *  are strictly required upstream; the rest gets estimated/signed later. */
export type UserOperationDraft =
  Pick<UserOperation, 'sender' | 'callData'>
  & Partial<UserOperation>
