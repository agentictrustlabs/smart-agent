import type { PublicClient, WalletClient } from 'viem'
import { encodeAbiParameters, keccak256 } from 'viem'
import { delegationManagerAbi } from './abi'
import type { Delegation, Caveat, DeployedContracts } from '@smart-agent/types'
import { ROOT_AUTHORITY } from '@smart-agent/types'

export { ROOT_AUTHORITY }

export interface DelegationClientConfig {
  publicClient: PublicClient
  walletClient: WalletClient
  delegationManagerAddress: `0x${string}`
}

/**
 * Client for issuing, signing, and redeeming delegations.
 */
export class DelegationClient {
  private publicClient: PublicClient
  private walletClient: WalletClient
  private delegationManagerAddress: `0x${string}`

  constructor(config: DelegationClientConfig) {
    this.publicClient = config.publicClient
    this.walletClient = config.walletClient
    this.delegationManagerAddress = config.delegationManagerAddress
  }

  /** Issue and sign a root delegation from delegator to delegate. */
  async issueDelegation(params: {
    delegator: `0x${string}`
    delegate: `0x${string}`
    caveats: Caveat[]
    salt: bigint
  }): Promise<Delegation> {
    const delegation: Delegation = {
      delegator: params.delegator,
      delegate: params.delegate,
      authority: ROOT_AUTHORITY,
      caveats: params.caveats,
      salt: params.salt,
      signature: '0x',
    }

    // Get the delegation hash from the contract
    const hash = await this.publicClient.readContract({
      address: this.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'hashDelegation',
      args: [delegation],
    }) as `0x${string}`

    // Sign with the delegator's wallet
    const signature = await this.walletClient.signMessage({
      account: this.walletClient.account!,
      message: { raw: hash },
    })

    return { ...delegation, signature }
  }

  /** Redeem a delegation chain to execute a call. */
  async redeemDelegation(params: {
    delegations: Delegation[]
    target: `0x${string}`
    value: bigint
    data: `0x${string}`
  }): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'redeemDelegation',
      args: [params.delegations, params.target, params.value, params.data],
      chain: this.walletClient.chain,
      account: this.walletClient.account!,
    })
  }

  /** Revoke a delegation by hash. */
  async revokeDelegation(delegationHash: `0x${string}`): Promise<`0x${string}`> {
    return this.walletClient.writeContract({
      address: this.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'revokeDelegation',
      args: [delegationHash],
      chain: this.walletClient.chain,
      account: this.walletClient.account!,
    })
  }

  /** Check if a delegation has been revoked. */
  async isRevoked(delegationHash: `0x${string}`): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.delegationManagerAddress,
      abi: delegationManagerAbi,
      functionName: 'isRevoked',
      args: [delegationHash],
    })) as boolean
  }
}

// ─── Caveat Builders ────────────────────────────────────────────────

/** Encode timestamp enforcer terms — valid within a time window. */
export function encodeTimestampTerms(validAfter: number, validUntil: number): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [BigInt(validAfter), BigInt(validUntil)],
  )
}

/** Encode value enforcer terms — max ETH value per call. */
export function encodeValueTerms(maxValue: bigint): `0x${string}` {
  return encodeAbiParameters([{ type: 'uint256' }], [maxValue])
}

/** Encode allowed targets terms — restrict to specific contracts. */
export function encodeAllowedTargetsTerms(targets: `0x${string}`[]): `0x${string}` {
  return encodeAbiParameters([{ type: 'address[]' }], [targets])
}

/** Encode allowed methods terms — restrict to specific selectors. */
export function encodeAllowedMethodsTerms(selectors: `0x${string}`[]): `0x${string}` {
  return encodeAbiParameters([{ type: 'bytes4[]' }], [selectors])
}

/** Build a Caveat struct from an enforcer address and encoded terms.
 *  args defaults to '0x' (empty) — provided at redemption time by the redeemer. */
export function buildCaveat(enforcer: `0x${string}`, terms: `0x${string}`, args: `0x${string}` = '0x'): Caveat {
  return { enforcer, terms, args }
}
