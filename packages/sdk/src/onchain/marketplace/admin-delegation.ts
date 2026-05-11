/**
 * Spec 004 (b2) — Admin → holder → session chain helpers.
 *
 * The chained-delegation auth model for AnonCreds-gated marketplace
 * writes needs three signed deliverables:
 *
 *   1. A long-lived `admin → holder` root delegation, signed by the
 *      round/pool admin at credential-issuance time, scoped via caveats
 *      to the relevant registry's allowed targets + selectors.
 *
 *   2. A short-lived `holder → session` leaf delegation, signed by the
 *      holder at action time, with `authority = hash(admin → holder)`
 *      so DelegationManager threads the two together.
 *
 *   3. A redeem call that submits the chain `[admin→holder, holder→session]`
 *      with the session's private key (handled by a2a-agent's
 *      `/redeem-with-chain` endpoint).
 *
 * This file builds (1) and (2). Both are pure functions — no PublicClient,
 * no on-chain reads, no wallet client. Callers pass private keys directly,
 * which lets:
 *
 *   - the demo seed script sign on each demo user's behalf (their
 *     privateKey is in the `web.users` table);
 *   - the credential-issuance MCP tool sign on the admin's behalf
 *     (caller passes the admin's session-key signature via a separate
 *     dedicated path — TODO);
 *   - a real-user web action sign locally and pass the result up via
 *     the action layer.
 */

import { toFunctionSelector, type Address, type Hex, type AbiFunction } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  buildCaveat,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  encodeTimestampTerms,
  hashDelegation,
} from '../../delegation'
import { ROOT_AUTHORITY } from '@smart-agent/types'
import {
  voteRegistryAbi,
  grantProposalRegistryAbi,
  pledgeRegistryAbi,
} from '../../abi'

// ─── Registry method-selector lookups ────────────────────────────────
//
// Selectors are pulled from each registry's ABI so they stay in sync
// when the contracts evolve. We could rely on the canonical-string
// approach (keccak256("submit((…))").slice(0,4)) but ABI-driven gives
// us a compile-time guarantee that the function exists.

function selectorFromAbi(abi: readonly unknown[], name: string): Hex {
  const fn = (abi as readonly AbiFunction[]).find(
    (it) => it && it.type === 'function' && it.name === name,
  )
  if (!fn) throw new Error(`spec004 selector: no function "${name}" in ABI`)
  return toFunctionSelector(fn)
}

export const SPEC004_SELECTORS = {
  voteCast: selectorFromAbi(voteRegistryAbi, 'castVote'),
  grantProposalSubmit: selectorFromAbi(grantProposalRegistryAbi, 'submit'),
  grantProposalEdit: selectorFromAbi(grantProposalRegistryAbi, 'edit'),
  grantProposalWithdraw: selectorFromAbi(grantProposalRegistryAbi, 'withdraw'),
  pledgeSubmit: selectorFromAbi(pledgeRegistryAbi, 'submit'),
  pledgeAmend: selectorFromAbi(pledgeRegistryAbi, 'amend'),
  pledgeStop: selectorFromAbi(pledgeRegistryAbi, 'stop'),
} as const


// ─── Caveat builders ─────────────────────────────────────────────────

export interface AdminDelegationScope {
  registryAddress: Address
  /** Function selectors the holder is allowed to call. */
  methodSelectors: Hex[]
  /** Unix seconds; admin delegation valid from. Defaults to now. */
  validAfter?: number
  /** Unix seconds; admin delegation valid until. Defaults to now + 1 year. */
  validUntil?: number
  /** Caveat enforcer addresses; supplied by the caller from their deployed contracts. */
  enforcers: {
    allowedTargets: Address
    allowedMethods: Address
    timestamp: Address
  }
}

export function buildAdminDelegationCaveats(scope: AdminDelegationScope) {
  const now = Math.floor(Date.now() / 1000)
  const validAfter = scope.validAfter ?? now - 60        // 1-min skew
  const validUntil = scope.validUntil ?? now + 31_536_000 // 1 year
  return [
    buildCaveat(scope.enforcers.allowedTargets, encodeAllowedTargetsTerms([scope.registryAddress])),
    buildCaveat(scope.enforcers.allowedMethods, encodeAllowedMethodsTerms(scope.methodSelectors)),
    buildCaveat(scope.enforcers.timestamp, encodeTimestampTerms(validAfter, validUntil)),
  ]
}

// ─── Signed delegations ──────────────────────────────────────────────

export interface SignedDelegation {
  delegator: Address
  delegate: Address
  authority: Hex
  caveats: Array<{ enforcer: Address; terms: Hex; args?: Hex }>
  salt: string
  signature: Hex
}

interface SignRootArgs {
  delegator: Address
  delegate: Address
  caveats: Array<{ enforcer: Address; terms: Hex; args?: Hex }>
  salt: bigint
  chainId: number
  delegationManagerAddress: Address
  /** The signer's EOA private key. The signer MUST be registered as an
   *  owner of the delegator AgentAccount so ERC-1271 verification passes
   *  inside DelegationManager._validateSignature. */
  signerPrivateKey: Hex
}

/**
 * Sign an `admin → holder` root delegation. ROOT_AUTHORITY = 0x0…0.
 * The returned struct is ready to be passed in a redeem chain.
 */
export async function signRootDelegation(args: SignRootArgs): Promise<SignedDelegation> {
  const hash = hashDelegation(
    {
      delegator: args.delegator,
      delegate: args.delegate,
      authority: ROOT_AUTHORITY as Hex,
      caveats: args.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt: args.salt,
    },
    args.chainId,
    args.delegationManagerAddress,
  )
  const signer = privateKeyToAccount(args.signerPrivateKey)
  const signature = (await signer.signMessage({ message: { raw: hash } })) as Hex
  return {
    delegator: args.delegator,
    delegate: args.delegate,
    authority: ROOT_AUTHORITY as Hex,
    caveats: args.caveats.map((c) => ({
      enforcer: c.enforcer,
      terms: c.terms,
      args: c.args ?? ('0x' as Hex),
    })),
    salt: args.salt.toString(),
    signature,
  }
}

interface SignChildArgs extends Omit<SignRootArgs, 'caveats'> {
  /** Parent delegation hash; this becomes the `authority` field. */
  parentHash: Hex
  /** Child caveats (typically a short timestamp window only). */
  caveats: Array<{ enforcer: Address; terms: Hex; args?: Hex }>
}

/**
 * Sign a child delegation whose authority is the parent's hash. Used to
 * mint `holder → session` leaves that thread under an `admin → holder`
 * root, so DelegationManager validates the chain end-to-end.
 */
export async function signChildDelegation(args: SignChildArgs): Promise<SignedDelegation> {
  const hash = hashDelegation(
    {
      delegator: args.delegator,
      delegate: args.delegate,
      authority: args.parentHash,
      caveats: args.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt: args.salt,
    },
    args.chainId,
    args.delegationManagerAddress,
  )
  const signer = privateKeyToAccount(args.signerPrivateKey)
  const signature = (await signer.signMessage({ message: { raw: hash } })) as Hex
  return {
    delegator: args.delegator,
    delegate: args.delegate,
    authority: args.parentHash,
    caveats: args.caveats.map((c) => ({
      enforcer: c.enforcer,
      terms: c.terms,
      args: c.args ?? ('0x' as Hex),
    })),
    salt: args.salt.toString(),
    signature,
  }
}

/**
 * Compute the parent hash to thread a child delegation under. Wraps
 * `hashDelegation` for the common shape.
 */
export function delegationHash(
  d: { delegator: Address; delegate: Address; authority: Hex; caveats: Array<{ enforcer: Address; terms: Hex }>; salt: string | bigint },
  chainId: number,
  delegationManagerAddress: Address,
): Hex {
  return hashDelegation(
    {
      delegator: d.delegator,
      delegate: d.delegate,
      authority: d.authority,
      caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt: typeof d.salt === 'string' ? BigInt(d.salt) : d.salt,
    },
    chainId,
    delegationManagerAddress,
  ) as Hex
}
