'use server'

/**
 * Grant user smart accounts as ERC-4337 owners of org / personAgent /
 * pool AgentAccounts.
 *
 * Boot-seed creates `ORGANIZATION_GOVERNANCE + ROLE_OWNER` edges in the
 * relationship graph, but that's only metadata — the user's smart account
 * is NOT actually a co-owner of the org's AgentAccount. Without this
 * step, the unified delegation flow can't redeem on-chain via the org as
 * fund / pool agent: `FundRegistry.openRound`'s `onlyFundOwner(fundAgent)`
 * check calls `fundAgent.isOwner(msg.sender)` where msg.sender is the
 * user's smart account (the redeem's rootDelegator), and returns false.
 *
 * After the seed-as-self refactor, orgs are owned by *deterministic
 * EOAs* derived from their seed label (e.g. `catalyst:catalystNoco`),
 * NOT by the deployer. We therefore can't sign a `org → deployer`
 * delegation any more — that whole branch is gone. Instead, this module
 * makes the ORG SIGN FOR ITSELF: we look up the org's owner EOA via
 * `resolveAgentIdentity` and submit a userOp from the org's smart
 * account that calls `address(this).addOwner(userSmartAccount)`.
 *
 * `AgentAccount.addOwner` is `onlySelf` (line 548 of
 * `packages/contracts/src/AgentAccount.sol`) — the only authorized
 * `msg.sender` is `address(this)`. The userOp routes through
 * `EntryPoint.handleOps` → `AgentAccount.execute(self, 0, addOwner(user))`,
 * which lands `msg.sender == address(this)` at `addOwner`. No
 * DelegationManager indirection required.
 *
 * Idempotent: skips pairs where the user is already an owner.
 */

import { createPublicClient, encodeFunctionData, http, type Address } from 'viem'
import { agentAccountAbi } from '@smart-agent/sdk'
import { executeCallsAsAgent, resolveAgentIdentity } from './agent-self-register'

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
  const pub = createPublicClient({ chain: undefined, transport: http(RPC_URL) })

  let granted = 0
  for (const pair of pairs) {
    const { orgAddress, userSmartAccount } = pair
    const label = pair.label ?? `${userSmartAccount} → ${orgAddress}`
    try {
      // Cheap idempotency check — `isOwner` is a free view.
      const already = await pub.readContract({
        address: orgAddress, abi: agentAccountAbi, functionName: 'isOwner',
        args: [userSmartAccount],
      }) as boolean
      if (already) {
        console.log(`[grant-org-ownership] ✓ ${label} (already owner)`)
        continue
      }

      // Resolve the *target* agent's owner EOA + salt so the userOp's
      // `sender` is `orgAddress` and `msg.sender` at `addOwner` resolves
      // to `address(this)` — which is the only path past `onlySelf`.
      const identity = await resolveAgentIdentity(orgAddress)
      if (!identity) {
        console.warn(`[grant-org-ownership] ! ${label}: no identity for ${orgAddress} — cannot sign as the agent itself`)
        continue
      }

      const addOwnerCall = encodeFunctionData({
        abi: agentAccountAbi, functionName: 'addOwner', args: [userSmartAccount],
      })

      await executeCallsAsAgent({
        smartAccount: orgAddress,
        signerAccount: identity.eoa,
        salt: identity.salt,
        // Self-call: the AgentAccount executes addOwner on itself. The
        // `_requireForExecute` allowlist (BaseAccount) lets the
        // EntryPoint reach `execute`; `execute` performs the inner call
        // with `msg.sender == address(this)`, satisfying `onlySelf`.
        calls: [{ target: orgAddress, value: 0n, data: addOwnerCall }],
        label: `grant-org-ownership:addOwner(${label})`,
      })
      console.log(`[grant-org-ownership] ✓ ${label} (granted)`)
      granted++
    } catch (err) {
      console.warn(`[grant-org-ownership] ! ${label}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return granted
}
