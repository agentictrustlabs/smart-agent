/**
 * Sprint 4 A.4.1 — `ssi_get_holder_wallet` tool tests.
 *
 * The web app's `lib/spec004/self-issue.ts` used to GET
 * `${PERSON_MCP_URL}/wallet/<principal>/<context>` directly to look up
 * the holder wallet for a (principal, walletContext) pair. The Phase-2
 * consolidation closed that direct fetch by routing through this MCP
 * tool. These tests exercise the tool handler in isolation:
 *
 *   1. Missing row → { found: false }.
 *   2. Existing row → { found: true, holderWalletId, walletContext,
 *                       linkSecretId, status, createdAt }.
 *   3. Default walletContext = 'default' when omitted.
 *   4. Distinct rows for the same principal under different contexts.
 *
 * Run: `node --import tsx --test apps/person-mcp/test/ssi-get-holder-wallet.test.ts`
 *
 * Note: env vars must be set BEFORE the `import` block because ESM
 * hoists imports above the file's top-level statements. Modules pulled
 * in by `../src/tools/ssi-wallet` (transitively `ssi/storage/askar` →
 * `ssi/config`) read these at module-init time, so we set them via the
 * top-level env mutations below — dynamic `await import()` patterns
 * inside individual tests are used so the env mutations execute first.
 */

// Pre-import env wiring. ESM hoists `import` statements, so we rely on
// dynamic `await import()` inside the tests for the modules whose
// init reads these. Static imports are limited to env-independent stdlib
// + node:test machinery.
process.env.A2A_KMS_BACKEND = process.env.A2A_KMS_BACKEND ?? 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON =
  process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON ?? '0x' + 'b'.repeat(64)
process.env.PERSON_MCP_DB_PATH =
  process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.ssi-get-holder-wallet.test.db'
// `ssi/config.ts` requires this at module init.
process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS =
  process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS ?? '0x' + '1'.repeat(40)
process.env.CHAIN_ID = process.env.CHAIN_ID ?? '31337'
process.env.RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

interface ToolResult {
  found: boolean
  holderWalletId?: string
  walletContext?: string
  linkSecretId?: string
  status?: string
  createdAt?: string
  error?: string
}

async function unwrap(
  promise: Promise<{ content: Array<{ text: string }> }>,
): Promise<ToolResult> {
  const result = await promise
  const text = result.content[0]?.text
  assert.ok(text, 'tool result has no text content')
  return JSON.parse(text) as ToolResult
}

// Cached dynamic imports — fetched once per test file run, AFTER the
// top-level env mutations above have executed.
async function loadDeps() {
  const tools = await import('../src/tools/ssi-wallet')
  const walletsMod = await import('../src/ssi/storage/wallets')
  return {
    tool: tools.ssiWalletTools.ssi_get_holder_wallet,
    insertHolderWallet: walletsMod.insertHolderWallet,
    newHolderWalletId: walletsMod.newHolderWalletId,
    newLinkSecretId: walletsMod.newLinkSecretId,
    askarProfileFor: walletsMod.askarProfileFor,
  }
}

test('returns { found: false } when no holder_wallets row exists', async () => {
  const { tool } = await loadDeps()
  const principal = `person_test_${randomUUID()}`
  const out = await unwrap(
    tool.handler({ principal, walletContext: 'default' }) as Promise<{
      content: Array<{ text: string }>
    }>,
  )
  assert.equal(out.found, false)
  assert.equal(out.holderWalletId, undefined)
})

test('returns full wallet row when (principal, context) matches', async () => {
  const { tool, insertHolderWallet, newHolderWalletId, newLinkSecretId, askarProfileFor } =
    await loadDeps()
  const principal = `person_test_${randomUUID()}`
  const id = newHolderWalletId()
  insertHolderWallet({
    id,
    personPrincipal: principal,
    walletContext: 'default',
    signerEoa: '0x' + 'a'.repeat(40),
    askarProfile: askarProfileFor(principal, 'default'),
    linkSecretId: newLinkSecretId(),
    status: 'active',
  })

  const out = await unwrap(
    tool.handler({ principal, walletContext: 'default' }) as Promise<{
      content: Array<{ text: string }>
    }>,
  )
  assert.equal(out.found, true)
  assert.equal(out.holderWalletId, id)
  assert.equal(out.walletContext, 'default')
  assert.equal(out.status, 'active')
  assert.ok(out.linkSecretId, 'linkSecretId should be set')
  assert.ok(out.createdAt, 'createdAt should be set')
})

test('walletContext defaults to "default" when omitted', async () => {
  const { tool, insertHolderWallet, newHolderWalletId, newLinkSecretId, askarProfileFor } =
    await loadDeps()
  const principal = `person_test_${randomUUID()}`
  const id = newHolderWalletId()
  insertHolderWallet({
    id,
    personPrincipal: principal,
    walletContext: 'default',
    signerEoa: '0x' + 'b'.repeat(40),
    askarProfile: askarProfileFor(principal, 'default'),
    linkSecretId: newLinkSecretId(),
    status: 'active',
  })

  // No walletContext arg — should still resolve the 'default' wallet.
  const out = await unwrap(
    tool.handler({ principal }) as Promise<{ content: Array<{ text: string }> }>,
  )
  assert.equal(out.found, true)
  assert.equal(out.holderWalletId, id)
  assert.equal(out.walletContext, 'default')
})

test('distinct rows surface for separate (principal, context) pairs', async () => {
  const { tool, insertHolderWallet, newHolderWalletId, newLinkSecretId, askarProfileFor } =
    await loadDeps()
  const principal = `person_test_${randomUUID()}`
  const defaultId = newHolderWalletId()
  const spec004Id = newHolderWalletId()
  insertHolderWallet({
    id: defaultId,
    personPrincipal: principal,
    walletContext: 'default',
    signerEoa: '0x' + 'c'.repeat(40),
    askarProfile: askarProfileFor(principal, 'default'),
    linkSecretId: newLinkSecretId(),
    status: 'active',
  })
  insertHolderWallet({
    id: spec004Id,
    personPrincipal: principal,
    walletContext: 'spec004',
    signerEoa: '0x' + 'd'.repeat(40),
    askarProfile: askarProfileFor(principal, 'spec004'),
    linkSecretId: newLinkSecretId(),
    status: 'active',
  })

  const outDefault = await unwrap(
    tool.handler({ principal, walletContext: 'default' }) as Promise<{
      content: Array<{ text: string }>
    }>,
  )
  const outSpec004 = await unwrap(
    tool.handler({ principal, walletContext: 'spec004' }) as Promise<{
      content: Array<{ text: string }>
    }>,
  )
  assert.equal(outDefault.holderWalletId, defaultId)
  assert.equal(outSpec004.holderWalletId, spec004Id)
  assert.notEqual(outDefault.holderWalletId, outSpec004.holderWalletId)
})
