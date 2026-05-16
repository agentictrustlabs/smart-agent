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
import { agentAccountResolverAbi, ATL_CONTROLLER, ATL_PRIMARY_NAME } from '@smart-agent/sdk'

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`

const TYPE_PERSON = keccak256(toBytes('atl:PersonAgent'))
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

/** Turn a display name like "Pastor David Chen" into a DNS-safe slug
 *  "pastor-david-chen" suitable as the leftmost label of a primary name.
 *  Falls back to a deterministic hash-derived slug when the input is
 *  empty or produces nothing legal after stripping. The A2A URL resolver
 *  derives the host slug from the leftmost label of `ATL_PRIMARY_NAME`,
 *  so this slug must match `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`. */
function deriveSlug(name: string | undefined, agentAddress: `0x${string}`): string {
  const fromName = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  if (fromName) return fromName
  // Deterministic, address-derived fallback. Always shaped as a valid DNS label.
  return `agent-${agentAddress.slice(2, 10).toLowerCase()}`
}

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

  // 5. Register person agent in on-chain resolver (uses deployer directly, no session needed).
  //
  //    The three on-chain properties below — `register`, `ATL_CONTROLLER`,
  //    `ATL_PRIMARY_NAME` — are ALL required for a person agent to be a
  //    first-class principal in the system:
  //      • `register` lands the agent in AgentAccountResolver so other
  //        property writes don't revert with `NotRegistered`.
  //      • `ATL_CONTROLLER` ties the user's EOA to the smart account so
  //        `getOrgsForPersonAgent` / KB sync can reverse-resolve ownership.
  //      • `ATL_PRIMARY_NAME` is what the A2A URL resolver reads to derive
  //        the per-agent host slug (`<slug>.agent.localhost:3100`) — without
  //        it, every `callMcp()` for this user 401s with
  //        "A2A endpoint unresolvable: no primary name registered".
  //
  //    Each step is idempotent at the read-first level so a re-run does
  //    not pile on duplicate controllers or overwrite a correct name.
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  const slug = deriveSlug(userName, personAgentAddress)
  const primaryName = `${slug}.agent`
  if (resolverAddr) {
    try {
      const wc = getWalletClient()
      const pc = getPublicClient()

      // 5a. Register (skip if already registered).
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

      // 5b. ATL_CONTROLLER — skip if the EOA is already in the multi-address
      //     list, otherwise re-runs append duplicate copies of the same key.
      const existingControllers = await pc.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getMultiAddressProperty',
        args: [personAgentAddress, ATL_CONTROLLER as `0x${string}`],
      }) as readonly `0x${string}`[]
      const alreadyController = existingControllers.some(
        a => a.toLowerCase() === account.address.toLowerCase(),
      )
      if (!alreadyController) {
        const ctrlHash = await wc.writeContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'addMultiAddressProperty',
          args: [personAgentAddress, ATL_CONTROLLER as `0x${string}`, account.address],
        })
        await pc.waitForTransactionReceipt({ hash: ctrlHash })
      }

      // 5c. ATL_PRIMARY_NAME — skip if already set to the same value.
      //     Mandatory: this is what the A2A URL resolver reads. If this
      //     write fails we throw — the agent is unusable without it and a
      //     silent warn would surface as a downstream 401 instead.
      const existingPrimary = await pc.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [personAgentAddress, ATL_PRIMARY_NAME as `0x${string}`],
      }) as string
      if (existingPrimary !== primaryName) {
        const nameHash = await wc.writeContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'setStringProperty',
          args: [personAgentAddress, ATL_PRIMARY_NAME as `0x${string}`, primaryName],
        })
        await pc.waitForTransactionReceipt({ hash: nameHash })
      }

      console.log(`[generate-wallet] Person agent registered: ${personAgentAddress} → ${account.address} (primary=${primaryName})`)

      // 5d. Register the USER'S smart account too. Many web actions
      //     (SSI credential issuance, list_intents, etc.) route via the
      //     smart account address — NOT the deployer-owned person agent.
      //     Without ATL_PRIMARY_NAME on the smart account, those routes
      //     throw "A2A endpoint not resolvable: no primary name
      //     registered" mid-flow (e.g. chapter 9 proposal-apply →
      //     ssi_create_wallet_action). Slug = `<base>-sa.agent` to
      //     keep it distinct from the person agent's `<base>.agent`.
      const saSlug = `${slug}-sa`
      const saPrimaryName = `${saSlug}.agent`
      const isSaReg = await pc.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'isRegistered', args: [smartAccountAddress],
      }) as boolean
      if (!isSaReg) {
        const saRegHash = await wc.writeContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'register',
          args: [smartAccountAddress, userName ?? 'Personal Account', '', TYPE_PERSON, ZERO_HASH, ''],
        })
        await pc.waitForTransactionReceipt({ hash: saRegHash })
      }
      const existingSaPrimary = await pc.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [smartAccountAddress, ATL_PRIMARY_NAME as `0x${string}`],
      }) as string
      if (existingSaPrimary !== saPrimaryName) {
        const saNameHash = await wc.writeContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'setStringProperty',
          args: [smartAccountAddress, ATL_PRIMARY_NAME as `0x${string}`, saPrimaryName],
        })
        await pc.waitForTransactionReceipt({ hash: saNameHash })
      }
      console.log(`[generate-wallet] Smart account registered: ${smartAccountAddress} → ${account.address} (primary=${saPrimaryName})`)
    } catch (err) {
      // Make this loud — without these three writes the person agent
      // cannot route A2A traffic, and the symptom appears far downstream
      // as a silent `callMcp` 401. Demo seed runs swallow this at the
      // boot-seed level, but the log line is unambiguous.
      console.error(
        `[generate-wallet] Person agent registration failed for ${personAgentAddress} (primary=${primaryName}):`,
        err instanceof Error ? err.message : err,
      )
      throw err
    }
  } else {
    throw new Error(
      '[generate-wallet] AGENT_ACCOUNT_RESOLVER_ADDRESS not set — cannot register person agent',
    )
  }

  return {
    privateKey,
    address: account.address,
    smartAccountAddress,
    personAgentAddress,
  }
}
