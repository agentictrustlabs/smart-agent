/**
 * Generate a real keypair for a demo user, fund it, deploy an AgentAccount,
 * and deploy + register a person agent in the on-chain resolver.
 *
 * After this, the user is indistinguishable from a Privy-connected user
 * who completed onboarding — no fallbacks needed anywhere.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, createPublicClient, http, parseEther } from 'viem'
import { localhost } from 'viem/chains'
import { keccak256, encodePacked } from 'viem'
import { deploySmartAccount } from '@/lib/contracts'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import { addAgentController } from '@/lib/agent-resolver'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`

/**
 * Generate a new wallet, fund it, deploy an AgentAccount, and deploy
 * a person agent registered in the on-chain resolver.
 */
export async function generateDemoWallet(userName?: string): Promise<{
  privateKey: `0x${string}`
  address: `0x${string}`
  smartAccountAddress: `0x${string}`
  personAgentAddress: `0x${string}`
}> {
  // 1. Generate keypair
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)

  // 2. Fund from deployer (1 ETH for gas)
  if (DEPLOYER_KEY) {
    const deployerAccount = privateKeyToAccount(DEPLOYER_KEY)
    const walletClient = createWalletClient({
      account: deployerAccount,
      chain: { ...localhost, id: CHAIN_ID },
      transport: http(RPC_URL),
    })
    const publicClient = createPublicClient({
      chain: { ...localhost, id: CHAIN_ID },
      transport: http(RPC_URL),
    })

    const hash = await walletClient.sendTransaction({
      to: account.address,
      value: parseEther('1'),
    })
    await publicClient.waitForTransactionReceipt({ hash })
  }

  // 3. Deploy AgentAccount (deployer creates, user's EOA is owner)
  const acctSalt = BigInt(Date.now() + Math.floor(Math.random() * 100000))
  const smartAccountAddress = await deploySmartAccount(account.address, acctSalt) as `0x${string}`

  // 4. Deploy person agent (separate smart account registered as person type)
  const personSaltHash = keccak256(encodePacked(['string', 'address'], ['person', account.address]))
  const personSalt = BigInt(personSaltHash)
  const personAgentAddress = await deploySmartAccount(account.address, personSalt) as `0x${string}`

  // 5. Register person agent in on-chain resolver
  try {
    await registerAgentMetadata({
      agentAddress: personAgentAddress,
      displayName: userName ? `${userName}'s Agent` : 'Personal Agent',
      description: '',
      agentType: 'person',
    })
    await addAgentController(personAgentAddress, account.address)
  } catch (err) {
    console.warn('[generate-wallet] Person agent registration failed:', err)
  }

  return {
    privateKey,
    address: account.address,
    smartAccountAddress,
    personAgentAddress,
  }
}
