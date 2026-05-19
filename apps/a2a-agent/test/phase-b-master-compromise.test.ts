/**
 * Spec 007 Phase B § Step 4 — master compromise isolation.
 *
 * Phase A dropped master from the user owner set. Phase B adds a
 * `getRelayOnlySigner()` flavor that returns a master-signer
 * proxy whose `signMessage` / `signTypedData` / `signUserOp` throw
 * `MasterRelayOnlyViolation`. The only live signing surface is
 * `signTransaction` (which produces an L1 tx broadcast signature —
 * paying gas as a relay; never producing an authority-bearing signature).
 *
 * Tests:
 *   1. `getRelayOnlySigner()` returns a wrapper whose `signMessage`
 *      throws `MasterRelayOnlyViolation`.
 *   2. `signTypedData` throws.
 *   3. `signUserOp` throws.
 *   4. `signTransaction` is callable (relays still need to broadcast).
 *   5. The wrapper's address equals the underlying master's address
 *      (we don't substitute; we just block the wrong surfaces).
 *   6. `MasterRelayOnlyViolation` is a distinct error class with a
 *      descriptive message.
 *
 * The "user userOp recovery fails" half of the isolation invariant
 * lives in the on-chain forge tests (Phase A). At the JS layer, the
 * load-bearing assertion is: nothing on the redeem path even ATTEMPTS
 * master signing — the type system + relay-only stubs would reject it
 * before reaching the chain.
 *
 * Run:
 *   node --import tsx --test apps/a2a-agent/test/phase-b-master-compromise.test.ts
 */
process.env.A2A_SESSION_SECRET = '0x' + 'b'.repeat(64)
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_MASTER_PRIVATE_KEY = '0x' + 'ce'.repeat(32)
process.env.WEB_TO_A2A_HMAC_KEY = '0x' + '7'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_ORG = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_HUB = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_FAMILY = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_VERIFIER = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_SKILL = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_GEO = '0x' + 'a'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getMasterSigner,
  getRelayOnlySigner,
  MasterRelayOnlyViolation,
  __resetMasterSignerForTests,
} from '../src/auth/a2a-signer'

test('getRelayOnlySigner — signMessage throws MasterRelayOnlyViolation', async () => {
  __resetMasterSignerForTests()
  const relay = await getRelayOnlySigner()
  assert.throws(
    () => relay.signMessage(),
    (err: unknown) => err instanceof MasterRelayOnlyViolation && err.name === 'MasterRelayOnlyViolation',
  )
})

test('getRelayOnlySigner — signTypedData throws MasterRelayOnlyViolation', async () => {
  __resetMasterSignerForTests()
  const relay = await getRelayOnlySigner()
  assert.throws(() => relay.signTypedData(), MasterRelayOnlyViolation)
})

test('getRelayOnlySigner — signUserOp throws MasterRelayOnlyViolation', async () => {
  __resetMasterSignerForTests()
  const relay = await getRelayOnlySigner()
  assert.throws(() => relay.signUserOp(), MasterRelayOnlyViolation)
})

test('getRelayOnlySigner — signTransaction surface is live (relays must broadcast)', async () => {
  __resetMasterSignerForTests()
  const relay = await getRelayOnlySigner()
  // We don't actually broadcast — we just verify the function exists +
  // is callable. A real broadcast needs an RPC.
  assert.equal(typeof relay.signTransaction, 'function')
})

test('getRelayOnlySigner — address matches underlying master', async () => {
  __resetMasterSignerForTests()
  const master = await getMasterSigner()
  const relay = await getRelayOnlySigner()
  assert.equal(relay.address.toLowerCase(), master.address.toLowerCase())
})

test('MasterRelayOnlyViolation — descriptive error message', () => {
  const err = new MasterRelayOnlyViolation('signMessage')
  assert.equal(err.name, 'MasterRelayOnlyViolation')
  assert.ok(
    err.message.includes('Master cannot sign user authority'),
    'error message should reference user authority',
  )
  assert.ok(
    err.message.includes('signMessage'),
    'error message should include the method that was called',
  )
})

test('relay vs master are distinct signing surfaces', async () => {
  __resetMasterSignerForTests()
  // Master is still callable for legitimate non-relay use (audit
  // checkpoint signing, MAC, session-issuance envelopes).
  const master = await getMasterSigner()
  const sig = await master.signMessage({ message: { raw: '0xdeadbeef' as `0x${string}` } })
  assert.ok(sig.startsWith('0x'))
  assert.ok(sig.length >= 132, 'expect a 65-byte ECDSA signature')

  // The relay-only flavor produced from the SAME singleton throws.
  const relay = await getRelayOnlySigner()
  assert.throws(() => relay.signMessage(), MasterRelayOnlyViolation)
})
