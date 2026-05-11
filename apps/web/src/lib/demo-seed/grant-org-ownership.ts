'use server'

/**
 * Grant user smart accounts as ERC-4337 owners of org AgentAccounts.
 *
 * Boot-seed creates `ORGANIZATION_GOVERNANCE + ROLE_OWNER` edges in the
 * relationship graph, but that's only metadata — the user's smart account
 * is NOT actually an owner of the org's AgentAccount. Without this step,
 * the unified delegation flow can't redeem on-chain via the org as
 * fund/pool agent: `FundRegistry.openRound`'s `onlyFundOwner(fundAgent)`
 * check calls `fundAgent.isOwner(msg.sender)` where msg.sender is the
 * user's smart account (the redeem's rootDelegator), and returns false.
 *
 * This module fills the gap. Mechanism: deployer (already an ERC-1271
 * owner of every org via boot-seed) signs a tightly-scoped delegation
 * `org → deployerEOA` with caveats `[Timestamp, AllowedTargets([org]),
 * AllowedMethods([addOwner])]`, then redeems it through
 * `DelegationManager.redeemDelegation`. The redeem flow makes msg.sender
 * to `org.execute` = DelegationManager (passes `_requireForExecute`),
 * which then calls `org.addOwner(userSmartAccount)` from self (passes
 * `onlySelf`).
 *
 * Idempotent: skips pairs where the user is already an owner.
 */

import {
  createWalletClient, createPublicClient, http,
  encodeFunctionData, encodeAbiParameters, toFunctionSelector,
  keccak256, encodePacked,
  type Address, type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  delegationManagerAbi, agentAccountAbi, ROOT_AUTHORITY,
} from '@smart-agent/sdk'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

export interface OrgOwnerPair {
  orgAddress: Address
  userSmartAccount: Address
  /** Label for logging; e.g. 'Maria → Catalyst Network'. */
  label?: string
}

/**
 * For each pair, ensure `userSmartAccount` is registered as an owner of
 * `orgAddress`'s AgentAccount. Returns the count of pairs newly granted
 * (already-owners are skipped silently).
 */
export async function grantOrgOwnershipBatch(pairs: OrgOwnerPair[]): Promise<number> {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
  const dm = process.env.DELEGATION_MANAGER_ADDRESS as Address | undefined
  const timestampEnforcer = process.env.TIMESTAMP_ENFORCER_ADDRESS as Address | undefined
  const targetsEnforcer = process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address | undefined
  const methodsEnforcer = process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address | undefined
  if (!deployerKey || !dm || !timestampEnforcer || !targetsEnforcer || !methodsEnforcer) {
    console.warn('[grant-org-ownership] missing env (DEPLOYER_PRIVATE_KEY / DELEGATION_MANAGER_ADDRESS / TIMESTAMP_ENFORCER_ADDRESS / ALLOWED_TARGETS_ENFORCER_ADDRESS / ALLOWED_METHODS_ENFORCER_ADDRESS)')
    return 0
  }

  const account = privateKeyToAccount(deployerKey)
  const wallet = createWalletClient({ account, chain: undefined, transport: http(RPC_URL) })
  const pub = createPublicClient({ chain: undefined, transport: http(RPC_URL) })
  const addOwnerSelector = toFunctionSelector('addOwner(address)')

  let granted = 0
  for (const pair of pairs) {
    const { orgAddress, userSmartAccount } = pair
    const label = pair.label ?? `${userSmartAccount} → ${orgAddress}`
    try {
      const already = await pub.readContract({
        address: orgAddress, abi: agentAccountAbi, functionName: 'isOwner',
        args: [userSmartAccount],
      }) as boolean
      if (already) {
        console.log(`[grant-org-ownership] ✓ ${label} (already owner)`)
        continue
      }

      const now = Math.floor(Date.now() / 1000)
      const validUntil = now + 600
      const timestampTerms = encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }],
        [BigInt(now - 60), BigInt(validUntil)],
      )
      const targetsTerms = encodeAbiParameters([{ type: 'address[]' }], [[orgAddress]])
      const methodsTerms = encodeAbiParameters([{ type: 'bytes4[]' }], [[addOwnerSelector]])

      const caveats = [
        { enforcer: timestampEnforcer, terms: timestampTerms, args: '0x' as Hex },
        { enforcer: targetsEnforcer,   terms: targetsTerms,   args: '0x' as Hex },
        { enforcer: methodsEnforcer,   terms: methodsTerms,   args: '0x' as Hex },
      ]
      const salt = BigInt(keccak256(encodePacked(
        ['address', 'address', 'uint256'],
        [orgAddress, userSmartAccount, BigInt(now)],
      )))

      const unsigned = {
        delegator: orgAddress,
        delegate:  account.address as Address,
        authority: ROOT_AUTHORITY as Hex,
        caveats,
        salt,
        signature: '0x' as Hex,
      }
      const digest = await pub.readContract({
        address: dm, abi: delegationManagerAbi, functionName: 'hashDelegation',
        args: [unsigned],
      }) as Hex
      const signature = await account.signMessage({ message: { raw: digest } })
      const signed = { ...unsigned, signature }

      const innerData = encodeFunctionData({
        abi: agentAccountAbi, functionName: 'addOwner', args: [userSmartAccount],
      })

      const tx = await wallet.writeContract({
        address: dm, abi: delegationManagerAbi, functionName: 'redeemDelegation',
        args: [[signed], orgAddress, 0n, innerData],
        chain: undefined,
      })
      await pub.waitForTransactionReceipt({ hash: tx })
      console.log(`[grant-org-ownership] ✓ ${label} (tx ${tx})`)
      granted++
    } catch (err) {
      console.warn(`[grant-org-ownership] ! ${label}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return granted
}
