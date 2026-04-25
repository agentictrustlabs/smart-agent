/**
 * Passkey E2E — virtual authenticator + mocked P-256 precompile.
 *
 *   Chromium's WebAuthn devtools API (`WebAuthn.addVirtualAuthenticator`) lets
 *   Playwright simulate a real Touch-ID-style authenticator. We use it to:
 *     1. navigate to /settings/passkeys, click Register → a virtual authenticator
 *        produces a real P-256 keypair, COSE-encoded. The attestation round-
 *        trips through our parser + server action + the on-chain UserOp flow.
 *     2. navigate to /settings/passkeys/sign, click Sign → the same virtual
 *        authenticator produces a WebAuthn assertion over the userOpHash.
 *        The signature is packed and submitted via entryPoint.handleOps.
 *
 *   For the second step to succeed on local anvil, we inject a bytecode stub
 *   at precompile address 0x100 via anvil_setCode. The stub always returns
 *   32 bytes of 0x01, which our P256Verifier library accepts as "signature
 *   valid". Production chains use the real RIP-7212 precompile and need no
 *   stubbing. This test verifies the RECEIPT path end-to-end; cryptographic
 *   correctness of the P-256 signature itself is covered by the Forge suite
 *   (where WebAuthnLib + P256Verifier are exercised against crafted inputs).
 */

import { test, expect, type Page, type CDPSession } from '@playwright/test'

const BASE = 'http://localhost:3000'
const RPC = 'http://127.0.0.1:8545'

/** Runtime bytecode that always returns 32 bytes of 0x01 (P256Verifier reads this as "valid"). */
const P256_STUB_BYTECODE = '0x600160005260206000F3'

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = await r.json() as { result?: T; error?: { message: string } }
  if (j.error) throw new Error(`${method}: ${j.error.message}`)
  return j.result as T
}

/** Install a stubbed P-256 verifier at 0x100 + at the canonical Daimo fallback address.
 *  Anvil accepts anvil_setCode for any address including precompiles. */
async function installP256Stub() {
  await rpc('anvil_setCode', ['0x0000000000000000000000000000000000000100', P256_STUB_BYTECODE])
  await rpc('anvil_setCode', ['0xc2b78104907F722DABAc4C69f826a522B2754De4', P256_STUB_BYTECODE])
}

async function demoLogin(page: Page, userId: string) {
  await page.goto(BASE)
  const r = await page.request.post(`${BASE}/api/demo-login`, {
    data: { userId },
    headers: { origin: BASE, 'content-type': 'application/json' },
  })
  expect(r.ok()).toBeTruthy()
}

async function waitUntilSystemReady(page: Page, timeoutMs = 300_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = await page.request.get(`${BASE}/api/system-readiness`)
    if (r.ok()) {
      const body = await r.json() as { allReady: boolean }
      if (body.allReady) return
    }
    await page.waitForTimeout(2000)
  }
  throw new Error(`system not ready within ${timeoutMs}ms`)
}

async function addVirtualAuthenticator(page: Page): Promise<{ session: CDPSession; authenticatorId: string }> {
  const session = await page.context().newCDPSession(page)
  await session.send('WebAuthn.enable')
  const { authenticatorId } = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { session, authenticatorId }
}

test.describe('Passkey — register + sign a UserOp', () => {
  test.beforeAll(async () => {
    await installP256Stub()
  })

  test('register a passkey, then sign a no-op UserOp', async ({ page }) => {
    test.setTimeout(180_000)

    await demoLogin(page, 'cat-user-001')    // Maria
    await waitUntilSystemReady(page)

    const virt = await addVirtualAuthenticator(page)

    // ─── Register ──────────────────────────────────────────────────
    await page.goto(`${BASE}/settings/passkeys`)
    await page.getByTestId('passkey-label').fill('Playwright Virtual Key')
    await page.getByTestId('passkey-register').click()
    // Either "✓ Registered" (success) appears, or we error.
    await expect(page.getByText(/✓ Registered/i)).toBeVisible({ timeout: 60_000 })

    // Sanity: refresh lists the new passkey row.
    await page.reload()
    // Either a passkey row is visible, or the client banner says "not deployed"
    // (which would've failed already). Look for at least one Remove button.
    const removeBtn = page.locator('[data-testid^="passkey-remove-"]').first()
    await expect(removeBtn).toBeVisible({ timeout: 10_000 })

    // ─── Sign a UserOp ─────────────────────────────────────────────
    await page.goto(`${BASE}/settings/passkeys/sign`)
    await page.getByTestId('passkey-sign').click()
    // Success: "UserOp landed — tx 0x…"
    await expect(page.getByTestId('passkey-sign-ok')).toBeVisible({ timeout: 60_000 })
    const msgText = await page.getByTestId('passkey-sign-ok').innerText()
    expect(msgText).toMatch(/UserOp landed/i)

    // Tidy up the virtual authenticator.
    await virt.session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: virt.authenticatorId })
  })
})
