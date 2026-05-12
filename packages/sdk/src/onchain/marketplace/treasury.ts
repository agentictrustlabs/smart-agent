/**
 * Spec 005 — Personal-treasury honor + admin mark-paid helpers.
 *
 * Two settlement rails (see `specs/005-pledge-honor/settlement-rails.md`):
 *   Rail A (cryptographic, donor treasury):
 *     treasury.executeBatch([
 *       USDC.transfer(pool, amount),
 *       PledgeRegistry.recordHonor(pledgeSubj, treasury, USDC, amount)
 *     ])
 *   Rail B (attested, admin mark-paid):
 *     PledgeRegistry.markPaid(pledgeSubj, token, amount, rail, evidenceHash)
 *
 * Both rails redeem through DelegationManager with an exact-call sub-delegation
 * (CallDataHashEnforcer). These helpers build the calldata + matching caveat
 * set so the action layer can mint a session leaf that pins the exact tx.
 */

import {
  encodeFunctionData,
  keccak256,
  toHex,
  toFunctionSelector,
  type Address,
  type Hex,
  type AbiFunction,
} from 'viem'
import {
  agentAccountAbi,
  pledgeRegistryAbi,
  mockUsdcAbi,
} from '../../abi'
import {
  buildCaveat,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  encodeCallDataHashTerms,
  encodeTimestampTerms,
  encodeValueTerms,
} from '../../delegation'

// ─── Selectors ───────────────────────────────────────────────────────

function selectorFromAbi(abi: readonly unknown[], name: string): Hex {
  const fn = (abi as readonly AbiFunction[]).find(
    (it) => it && it.type === 'function' && it.name === name,
  )
  if (!fn) throw new Error(`spec005 selector: no function "${name}" in ABI`)
  return toFunctionSelector(fn)
}

export const SPEC005_SELECTORS = {
  executeBatch:      selectorFromAbi(agentAccountAbi as unknown as readonly AbiFunction[], 'executeBatch'),
  pledgeRecordHonor: selectorFromAbi(pledgeRegistryAbi, 'recordHonor'),
  pledgeMarkPaid:    selectorFromAbi(pledgeRegistryAbi, 'markPaid'),
  erc20Transfer:     selectorFromAbi(mockUsdcAbi, 'transfer'),
} as const

// ─── Payment rail concept hashes ─────────────────────────────────────

export type PaymentRail =
  | 'crypto'
  | 'bank'
  | 'check'
  | 'cash'
  | 'in-kind'
  | 'other'

const PAYMENT_RAIL_CURIE: Record<PaymentRail, string> = {
  crypto:    'sa:PaymentRailCrypto',
  bank:      'sa:PaymentRailBank',
  check:     'sa:PaymentRailCheck',
  cash:      'sa:PaymentRailCash',
  'in-kind': 'sa:PaymentRailInKind',
  other:     'sa:PaymentRailOther',
}

export function paymentRailConcept(rail: PaymentRail): Hex {
  return keccak256(toHex(PAYMENT_RAIL_CURIE[rail])) as Hex
}

// ─── Rail A — executeBatch(transfer, recordHonor) ────────────────────

export interface HonorBatchInput {
  /** Donor's personal treasury AgentAccount (the executeBatch target / delegator). */
  treasury: Address
  /** Pool AgentAccount receiving USDC. */
  pool: Address
  /** USDC (or other ERC-20) token contract. v1: MockUSDC dev token. */
  token: Address
  /** PledgeRegistry contract. */
  pledgeRegistry: Address
  /** On-chain pledge subject (keccak256 derived per PledgeRegistry._pledgeSubject). */
  pledgeSubject: Hex
  /** Token-scaled amount for the ERC-20 transfer (USDC 6-decimal: $40 → 40_000_000n). */
  tokenAmount: bigint
  /** Pledge-unit amount for the on-chain settlement ledger ($40 → 40n).
   *  This must match the unit `PledgeRegistry.submit` used for `pledgeAmount`.
   *  In v1 pledges store whole dollars (not token-scaled), so this differs
   *  from `tokenAmount` by the token's decimals factor. Required because
   *  `recordHonor` compares cumulative settlement against `pledgeAmount`
   *  → mismatched scales revert with `PledgeAmountExceedsCommitted`. */
  pledgeUnitAmount: bigint
}

/**
 * Encode the `executeBatch([transfer, recordHonor])` calldata. This is what
 * DelegationManager dispatches into `treasury.execute(treasury, 0, data)`.
 * The two inner calls execute atomically; if `transfer` reverts (insufficient
 * balance), `recordHonor` never fires.
 *
 * The two inner calls use DIFFERENT scales: `transfer` uses token decimals
 * (USDC has 6), `recordHonor` uses the pledge's unit (whole dollars in v1).
 * See HonorBatchInput docs for the reasoning.
 */
export function encodeHonorBatch(input: HonorBatchInput): Hex {
  const transferData = encodeFunctionData({
    abi: mockUsdcAbi,
    functionName: 'transfer',
    args: [input.pool, input.tokenAmount],
  })
  const recordHonorData = encodeFunctionData({
    abi: pledgeRegistryAbi,
    functionName: 'recordHonor',
    args: [input.pledgeSubject, input.treasury, input.token, input.pledgeUnitAmount],
  })
  return encodeFunctionData({
    abi: agentAccountAbi,
    functionName: 'executeBatch',
    args: [[
      { target: input.token,          value: 0n, data: transferData },
      { target: input.pledgeRegistry, value: 0n, data: recordHonorData },
    ]],
  })
}

/** keccak256 of the executeBatch calldata — pinned into CallDataHashEnforcer. */
export function honorBatchHash(input: HonorBatchInput): Hex {
  return keccak256(encodeHonorBatch(input)) as Hex
}

// ─── Rail B — PledgeRegistry.markPaid ────────────────────────────────

export interface MarkPaidInput {
  pledgeRegistry: Address
  pledgeSubject: Hex
  token: Address
  /** Pledge-unit amount (whole dollars in v1) — must match the scale
   *  PledgeRegistry.submit used for `pledgeAmount`. See `HonorBatchInput`. */
  amount: bigint
  rail: PaymentRail
  /** sha256 of the evidence document. MUST be non-zero (contract enforces). */
  evidenceHash: Hex
}

export function encodeMarkPaid(input: MarkPaidInput): Hex {
  return encodeFunctionData({
    abi: pledgeRegistryAbi,
    functionName: 'markPaid',
    args: [
      input.pledgeSubject,
      input.token,
      input.amount,
      paymentRailConcept(input.rail),
      input.evidenceHash,
    ],
  })
}

export function markPaidHash(input: MarkPaidInput): Hex {
  return keccak256(encodeMarkPaid(input)) as Hex
}

// ─── Caveat builders ─────────────────────────────────────────────────

export interface HonorDelegationCaveatScope {
  /** The treasury AgentAccount address (delegator). */
  treasury: Address
  /** Hash of the executeBatch calldata. */
  calldataHash: Hex
  /** Caveat enforcer contract addresses (from deployed contracts). */
  enforcers: {
    allowedTargets: Address
    allowedMethods: Address
    callDataHash:   Address
    timestamp:      Address
    value:          Address
  }
  /** Unix seconds; defaults to now − 60s. */
  validAfter?: number
  /** Unix seconds; defaults to now + 5 min. */
  validUntil?: number
}

/**
 * Caveats for a donor-treasury → session honor delegation:
 *   - target = treasury (only the treasury's executeBatch is callable)
 *   - selector = executeBatch
 *   - calldataHash = exact hash of the prepared batch
 *   - value = 0
 *   - timestamp = ~5-min window
 */
export function buildHonorDelegationCaveats(scope: HonorDelegationCaveatScope) {
  const now = Math.floor(Date.now() / 1000)
  const validAfter = scope.validAfter ?? now - 60
  const validUntil = scope.validUntil ?? now + 300
  return [
    buildCaveat(scope.enforcers.allowedTargets, encodeAllowedTargetsTerms([scope.treasury])),
    buildCaveat(scope.enforcers.allowedMethods, encodeAllowedMethodsTerms([SPEC005_SELECTORS.executeBatch])),
    buildCaveat(scope.enforcers.callDataHash,   encodeCallDataHashTerms(scope.calldataHash)),
    buildCaveat(scope.enforcers.value,          encodeValueTerms(0n)),
    buildCaveat(scope.enforcers.timestamp,      encodeTimestampTerms(validAfter, validUntil)),
  ]
}

export interface MarkPaidDelegationCaveatScope {
  pledgeRegistry: Address
  calldataHash: Hex
  enforcers: {
    allowedTargets: Address
    allowedMethods: Address
    callDataHash:   Address
    timestamp:      Address
    value:          Address
  }
  validAfter?: number
  validUntil?: number
}

/**
 * Caveats for an admin → session markPaid delegation:
 *   - target = PledgeRegistry
 *   - selector = markPaid
 *   - calldataHash = exact hash of the markPaid call
 *   - value = 0
 *   - timestamp = ~5-min window
 */
export function buildMarkPaidDelegationCaveats(scope: MarkPaidDelegationCaveatScope) {
  const now = Math.floor(Date.now() / 1000)
  const validAfter = scope.validAfter ?? now - 60
  const validUntil = scope.validUntil ?? now + 300
  return [
    buildCaveat(scope.enforcers.allowedTargets, encodeAllowedTargetsTerms([scope.pledgeRegistry])),
    buildCaveat(scope.enforcers.allowedMethods, encodeAllowedMethodsTerms([SPEC005_SELECTORS.pledgeMarkPaid])),
    buildCaveat(scope.enforcers.callDataHash,   encodeCallDataHashTerms(scope.calldataHash)),
    buildCaveat(scope.enforcers.value,          encodeValueTerms(0n)),
    buildCaveat(scope.enforcers.timestamp,      encodeTimestampTerms(validAfter, validUntil)),
  ]
}
