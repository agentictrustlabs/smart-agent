/**
 * Native passkey auth E2E.
 *
 *   1. /sign-up + virtual authenticator → server deploys a fresh smart account
 *      whose only signer (besides the deployer relayer) is the new passkey.
 *      Session cookie is minted; user lands authenticated.
 *   2. /sign-in with the same virtual authenticator → server verifies via
 *      account.isValidSignature, mints a fresh session.
 *
 *   Mocks the RIP-7212 precompile + Daimo fallback at test setup so the
 *   on-chain ECDSA-P-256 verify accepts the virtual authenticator's sig.
 *   Production chains have the real precompile and need no stub.
 */

import { test, expect, type Page, type CDPSession } from '@playwright/test'

const BASE = 'http://localhost:3000'
const RPC = 'http://127.0.0.1:8545'
const P256_STUB_BYTECODE = '0x600160005260206000F3'

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await r.json() as { result: T }).result
}

async function installP256Stub() {
  await rpc('anvil_setCode', ['0x0000000000000000000000000000000000000100', P256_STUB_BYTECODE])
  await rpc('anvil_setCode', ['0xc2b78104907F722DABAc4C69f826a522B2754De4', P256_STUB_BYTECODE])
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

test.describe('Native passkey auth', () => {
  test.beforeAll(async () => { await installP256Stub() })

  test('sign up + sign in with a brand-new passkey', async ({ page }) => {
    test.setTimeout(180_000)

    const virt = await addVirtualAuthenticator(page)

    // ─── Sign up ──────────────────────────────────────────────────────
    await page.goto(`${BASE}/sign-up`)
    await page.getByTestId('signup-name').fill('Playwright Native')
    await page.getByTestId('signup-submit').click()

    // After successful signup the AuthGate routes us off /sign-up. Brand-new
    // passkey users have no email yet, so they land at /onboarding; existing
    // users land at /catalyst. Either is fine — what matters is the session.
    await page.waitForURL((u) => !u.pathname.startsWith('/sign-up'), { timeout: 60_000 })

    // Confirm we have a session.
    const r1 = await page.request.get(`${BASE}/api/auth/session`)
    const body1 = await r1.json() as { user: { name: string; via: string } | null }
    expect(body1.user).not.toBeNull()
    expect(body1.user!.via).toBe('passkey')
    expect(body1.user!.name).toBe('Playwright Native')

    // ─── Logout, then sign in with the SAME passkey ──────────────────
    await page.request.post(`${BASE}/api/auth/logout`)
    // Verify session is gone.
    const cleared = await page.request.get(`${BASE}/api/auth/session`)
    expect((await cleared.json() as { user: unknown }).user).toBeNull()

    await page.goto(`${BASE}/sign-in`)
    await page.getByTestId('signin-passkey').click()
    await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60_000 })

    const r2 = await page.request.get(`${BASE}/api/auth/session`)
    const body2 = await r2.json() as { user: { name: string; via: string } | null }
    expect(body2.user).not.toBeNull()
    expect(body2.user!.via).toBe('passkey')

    await virt.session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: virt.authenticatorId })
  })
})
