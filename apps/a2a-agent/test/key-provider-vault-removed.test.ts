/**
 * Regression tests for the removal of the vault-transit deferred-sibling
 * case (GCP-KMS G-PR-1, orchestrator decision per
 * `output/GCP-KMS-IMPLEMENTATION-PLAN.md § G6`).
 *
 * Before G-PR-1: `A2A_KMS_BACKEND='vault-transit'` matched a stub branch
 * in each factory and threw "vault-transit signer not implemented
 * (deferred sibling)".
 *
 * After G-PR-1: the vault-transit case is deleted from every factory.
 * Setting `A2A_KMS_BACKEND='vault-transit'` MUST now fall through to the
 * default branch and throw "unknown A2A_KMS_BACKEND" — failing closed.
 *
 * This pins the regression so a future reintroduction is caught.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/key-provider-vault-removed.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildKeyProvider,
  buildSignerBackend,
  buildToolExecutorBackend,
} from '../src/auth/key-provider'
import { buildMacProvider } from '../src/auth/mac-provider'

test("buildKeyProvider('vault-transit') → unknown backend (no deferred-sibling branch)", () => {
  assert.throws(
    () => buildKeyProvider({ A2A_KMS_BACKEND: 'vault-transit' }),
    /unknown A2A_KMS_BACKEND: vault-transit/,
  )
})

test("buildKeyProvider('vault-transit') does NOT throw deferred-sibling marker anymore", () => {
  // Negative assertion: the removed branch's marker phrase must not
  // appear in the error message.
  try {
    buildKeyProvider({ A2A_KMS_BACKEND: 'vault-transit' })
    assert.fail('buildKeyProvider should have thrown')
  } catch (err) {
    const message = (err as Error).message
    assert.ok(
      !/not yet implemented \(K2-alt sibling\)/.test(message),
      `expected deferred-sibling marker to be absent, got: ${message}`,
    )
  }
})

test("buildSignerBackend('vault-transit') → unknown backend", () => {
  assert.throws(
    () =>
      buildSignerBackend({
        A2A_KMS_BACKEND: 'vault-transit',
      }),
    /unknown A2A_KMS_BACKEND: vault-transit/,
  )
})

test("buildToolExecutorBackend('vault-transit') → unknown backend", () => {
  assert.throws(
    () =>
      buildToolExecutorBackend('round-awards', {
        A2A_KMS_BACKEND: 'vault-transit',
      }),
    /unknown A2A_KMS_BACKEND: vault-transit/,
  )
})

test("buildMacProvider('vault-transit') → unknown backend", () => {
  assert.throws(
    () =>
      buildMacProvider('web-to-a2a', {
        A2A_KMS_BACKEND: 'vault-transit',
      }),
    /unknown A2A_KMS_BACKEND: vault-transit/,
  )
})
