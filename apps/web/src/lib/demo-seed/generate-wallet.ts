/**
 * Generate a real keypair for a demo user, fund it, deploy an AgentAccount,
 * and deploy + register a person agent in the on-chain resolver.
 *
 * After this, the user is indistinguishable from a legacy-connected user
 * who completed onboarding — no fallbacks needed anywhere.
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { parseEther } from 'viem'
import { keccak256, encodePacked, toBytes } from 'viem'
import { deploySmartAccount, getPublicClient, getWalletClient } from '@/lib/contracts'
import { agentAccountResolverAbi, ATL_CONTROLLER } from '@smart-agent/sdk'

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`

const TYPE_PERSON = keccak256(toBytes('atl:PersonAgent'))
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

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

  // 2. Fund from deployer (1 ETH for gas).
  //    Route through `getWalletClient()` so the funding tx goes through
  //    the process-wide deployer-lock + nonce counter — a separate viem
  //    wallet client here would race with concurrent boot-seed writes
  //    and hand out duplicate / skipped nonces.
  if (DEPLOYER_KEY) {
    const wc = getWalletClient()
    const pc = getPublicClient()
    const hash = await wc.sendTransaction({
      account: wc.account!,
      chain: wc.chain ?? null,
      to: account.address,
      value: parseEther('1'),
    })
    await pc.waitForTransactionReceipt({ hash })
  }

  // 3. Deploy AgentAccount (deployer creates, user's EOA is owner)
  const acctSalt = BigInt(Date.now() + Math.floor(Math.random() * 100000))
  const smartAccountAddress = await deploySmartAccount(account.address, acctSalt) as `0x${string}`

  // 4. Deploy person agent (separate smart account registered as person type)
  // Owner MUST be the deployer so resolver.register() passes the onlyAgentOwner check.
  // The user's EOA is tracked via ATL_CONTROLLER (set below), not as a smart-account owner.
  const deployerAddr = privateKeyToAccount(DEPLOYER_KEY).address
  const personSaltHash = keccak256(encodePacked(['string', 'address'], ['person', account.address]))
  const personSalt = BigInt(personSaltHash)
  const personAgentAddress = await deploySmartAccount(deployerAddr, personSalt) as `0x${string}`

  // 5. Register person agent in on-chain resolver (uses deployer directly, no session needed)
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (resolverAddr) {
    try {
      const wc = getWalletClient()
      const pc = getPublicClient()

      // Register in resolver
      const isReg = await pc.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'isRegistered', args: [personAgentAddress],
      }) as boolean

      if (!isReg) {
        const regHash = await wc.writeContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'register',
          args: [personAgentAddress, userName ?? 'Personal Agent', '', TYPE_PERSON, ZERO_HASH, ''],
        })
        await pc.waitForTransactionReceipt({ hash: regHash })
      }

      // Set ATL_CONTROLLER
      const ctrlHash = await wc.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'addMultiAddressProperty',
        args: [personAgentAddress, ATL_CONTROLLER as `0x${string}`, account.address],
      })
      await pc.waitForTransactionReceipt({ hash: ctrlHash })

      console.log(`[generate-wallet] Person agent registered: ${personAgentAddress} → ${account.address}`)
    } catch (err) {
      console.warn('[generate-wallet] Person agent registration failed:', err)
    }
  }

  return {
    privateKey,
    address: account.address,
    smartAccountAddress,
    personAgentAddress,
  }
}
