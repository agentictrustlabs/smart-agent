import type { PublicClient, WalletClient } from 'viem'
import { encodeFunctionData } from 'viem'
import { agentRootAccountAbi, agentAccountFactoryAbi } from './abi'
import type { CreateAgentAccountParams } from '@smart-agent/types'

export interface AgentAccountClientConfig {
  publicClient: PublicClient
  walletClient: WalletClient
  factoryAddress: `0x${string}`
}

/**
 * Client for deploying and interacting with AgentRootAccount instances.
 */
export class AgentAccountClient {
  private publicClient: PublicClient
  private walletClient: WalletClient
  private factoryAddress: `0x${string}`

  constructor(config: AgentAccountClientConfig) {
    this.publicClient = config.publicClient
    this.walletClient = config.walletClient
    this.factoryAddress = config.factoryAddress
  }

  /** Get the counterfactual address before deployment. */
  async getAddress(owner: `0x${string}`, salt: bigint): Promise<`0x${string}`> {
    return (await this.publicClient.readContract({
      address: this.factoryAddress,
      abi: agentAccountFactoryAbi,
      functionName: 'getAddress',
      args: [owner, salt],
    })) as `0x${string}`
  }

  /** Deploy a new AgentRootAccount (or return existing). */
  async createAccount(params: CreateAgentAccountParams): Promise<`0x${string}`> {
    const hash = await this.walletClient.writeContract({
      address: this.factoryAddress,
      abi: agentAccountFactoryAbi,
      functionName: 'createAccount',
      args: [params.owner, params.salt],
      chain: this.walletClient.chain,
      account: this.walletClient.account!,
    })

    await this.publicClient.waitForTransactionReceipt({ hash })
    return this.getAddress(params.owner, params.salt)
  }

  /** Check if an address is an owner. */
  async isOwner(accountAddress: `0x${string}`, address: `0x${string}`): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: accountAddress,
      abi: agentRootAccountAbi,
      functionName: 'isOwner',
      args: [address],
    })) as boolean
  }

  /** Get the current nonce. */
  async getNonce(accountAddress: `0x${string}`): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: accountAddress,
      abi: agentRootAccountAbi,
      functionName: 'getNonce',
    })) as bigint
  }

  /** Encode an execute call for use in a UserOperation's callData. */
  encodeExecute(target: `0x${string}`, value: bigint, data: `0x${string}`): `0x${string}` {
    return encodeFunctionData({
      abi: agentRootAccountAbi,
      functionName: 'execute',
      args: [target, value, data],
    })
  }

  /** Encode a batch execute call. */
  encodeExecuteBatch(calls: Array<{ target: `0x${string}`; value: bigint; data: `0x${string}` }>): `0x${string}` {
    return encodeFunctionData({
      abi: agentRootAccountAbi,
      functionName: 'executeBatch',
      args: [calls],
    })
  }
}
