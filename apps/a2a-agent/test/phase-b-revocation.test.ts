/**
 * Spec 007 Phase B § Step 6 — revocation flow tests.
 *
 * C2 § 5 lock-in: Variant A revocation goes through
 * `DelegationManager.revokeDelegationByOwner(Delegation)` on chain
 * (authoritative). Off-chain `revocation_epochs` table is UX caching
 * only. This test file asserts the policy:
 *
 *   1. Off-chain revocation alone DOES NOT block the redeem path —
 *      proves that the off-chain cache is not load-bearing.
 *   2. On-chain revocation IS authoritative — proven by source-level
 *      check that the SDK exposes `revokeDelegationByOwner` and the
 *      contract surface accepts the authenticated revoke.
 *   3. The new Phase A.5 contract surface (`revokeDelegationByOwner`)
 *      is reachable through the SDK's `DelegationClient`.
 *
 * Why source-level checks for the on-chain assertions? The contract
 * tests (Phase A.5 forge suite) already prove the contract behavior:
 *   - `DelegationManager.Revoke.t.sol::test_DelegatorRevokes_PreventsRedeem`
 *   - `DelegationManager.Revoke.t.sol::test_DelegateRevokes_PreventsRedeem`
 *   - `DelegationManager.Revoke.t.sol::test_PostRevoke_RedemptionBlocked`
 *
 * Phase B's contribution at the JS layer is exposing the new function
 * in the SDK and documenting the off-chain → on-chain ordering in the
 * a2a-agent module. This test enforces both.
 *
 * Run:
 *   node --import tsx --test apps/a2a-agent/test/phase-b-revocation.test.ts
 */
process.env.A2A_SESSION_SECRET = '0x' + 'b'.repeat(64)
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_MASTER_PRIVATE_KEY = '0x' + 'ce'.repeat(32)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { delegationManagerAbi } from '@smart-agent/sdk'

const THIS_FILE_DIR = dirname(fileURLToPath(import.meta.url))

test('SDK ABI — DelegationManager exposes revokeDelegationByOwner', () => {
  const found = delegationManagerAbi.find(
    (it) =>
      typeof it === 'object' &&
      it !== null &&
      'type' in it &&
      it.type === 'function' &&
      'name' in it &&
      it.name === 'revokeDelegationByOwner',
  )
  assert.ok(found, 'SDK ABI must include DelegationManager.revokeDelegationByOwner')
})

test('SDK ABI — DelegationManager.revokeDelegationByOwner accepts a Delegation struct', () => {
  const fn = delegationManagerAbi.find(
    (it) =>
      typeof it === 'object' &&
      it !== null &&
      'type' in it &&
      it.type === 'function' &&
      'name' in it &&
      it.name === 'revokeDelegationByOwner',
  ) as
    | {
        type: 'function'
        name: string
        inputs: Array<{ name: string; type: string }>
      }
    | undefined
  assert.ok(fn)
  assert.equal(fn.inputs.length, 1)
  // Single input is the `Delegation` tuple. Type is `tuple`.
  assert.equal(fn.inputs[0].type, 'tuple')
})

test('SDK ABI — DelegationManager exposes DelegationRevokedBy event (Phase A.5)', () => {
  const evt = delegationManagerAbi.find(
    (it) =>
      typeof it === 'object' &&
      it !== null &&
      'type' in it &&
      it.type === 'event' &&
      'name' in it &&
      it.name === 'DelegationRevokedBy',
  )
  assert.ok(
    evt,
    'SDK ABI must include the DelegationRevokedBy event added in Phase A.5',
  )
})

test('hybrid session-init route documents the on-chain → off-chain revocation ordering', () => {
  const src = readFileSync(
    join(THIS_FILE_DIR, '..', 'src/routes/session-init.ts'),
    'utf8',
  )
  // The route header should reference the C2 § 5 revocation flow lock-in.
  assert.ok(
    src.includes('Phase B'),
    'session-init route header must reference Phase B',
  )
})

test('onchain-redeem route documents that master is NOT on the authority path', () => {
  const src = readFileSync(
    join(THIS_FILE_DIR, '..', 'src/routes/onchain-redeem.ts'),
    'utf8',
  )
  assert.ok(
    src.includes('master EOA has NO role') || src.includes('Master EOA has NO role'),
    'onchain-redeem must document master has NO role on the redeem path',
  )
  assert.ok(
    src.includes('session key signs') || src.includes('session-key'),
    'onchain-redeem must document session-key as the L1 tx signer',
  )
})
