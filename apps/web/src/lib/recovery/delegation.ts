/**
 * Helpers for building the per-account recovery delegation.
 *
 * The smart account creates ONE delegation at first passkey enrollment:
 *
 *   delegator: account
 *   delegate:  serverEOA               (the bootstrap server, now acting as a recovery guardian)
 *   authority: ROOT_AUTHORITY
 *   caveats:
 *     - RecoveryEnforcer({ guardians: [serverEOA], threshold: 1, delaySeconds })
 *     - AllowedTargets([account])
 *     - AllowedMethods([addPasskey, removePasskey])
 *
 * Signed by the new passkey (not the server EOA) so it remains valid after
 * the bootstrap server is removed from `_owners`. The delegation lets the
 * server, after the timelock and an OAuth-verified user re-authentication,
 * call `account.addPasskey(...)` for a fresh device.
 */

import {
  encodeAllowedMethodsTerms,
  encodeAllowedTargetsTerms,
  encodeRecoveryTerms,
  buildCaveat,
  hashDelegation,
  ROOT_AUTHORITY,
  agentAccountAbi,
} from '@smart-agent/sdk'
import { toFunctionSelector } from 'viem'

export const DEFAULT_RECOVERY_DELAY_SECONDS = Number(
  process.env.RECOVERY_DELAY_SECONDS ?? '60', // dev default; bump for production
)

interface RecoveryDelegation {
  delegator: `0x${string}`
  delegate: `0x${string}`
  authority: `0x${string}`
  caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
  salt: bigint
  /** Pre-computed EIP-712 delegation hash — what the new passkey must sign. */
  hash: `0x${string}`
}

interface BuildArgs {
  accountAddress: `0x${string}`
  serverEOA: `0x${string}`
  enforcers: {
    recovery: `0x${string}`
    allowedTargets: `0x${string}`
    allowedMethods: `0x${string}`
  }
  chainId: number
  delegationManager: `0x${string}`
  delaySeconds?: number
}

export function buildRecoveryDelegation(args: BuildArgs): RecoveryDelegation {
  const delaySeconds = args.delaySeconds ?? DEFAULT_RECOVERY_DELAY_SECONDS

  const recoveryTerms = encodeRecoveryTerms([args.serverEOA], 1, delaySeconds)
  const targetsTerms = encodeAllowedTargetsTerms([args.accountAddress])
  const methodsTerms = encodeAllowedMethodsTerms([
    toFunctionSelector(agentAccountAbi.find(x => x.type === 'function' && x.name === 'addPasskey')!),
    toFunctionSelector(agentAccountAbi.find(x => x.type === 'function' && x.name === 'removePasskey')!),
  ])

  const caveats = [
    buildCaveat(args.enforcers.recovery, recoveryTerms),
    buildCaveat(args.enforcers.allowedTargets, targetsTerms),
    buildCaveat(args.enforcers.allowedMethods, methodsTerms),
  ]

  // Deterministic salt isn't required, but a fresh per-provision salt makes
  // re-provisioning (e.g., rotating delaySeconds) easy.
  const salt = BigInt('0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'))

  const delegation = {
    delegator: args.accountAddress,
    delegate: args.serverEOA,
    authority: ROOT_AUTHORITY as `0x${string}`,
    caveats,
    salt,
  }
  const hash = hashDelegation(delegation, args.chainId, args.delegationManager)
  return { ...delegation, hash }
}

/**
 * The intent hash a recovery flow targets. Must match RecoveryEnforcer's
 * canonical formula: keccak256("smart-agent.recovery.v1", chainId, delegator, target, value, callData).
 */
export { computeRecoveryIntentHash } from '@smart-agent/sdk'
