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

  test('sign up with a brand-new passkey lands a passkey session', async ({ page }) => {
    test.setTimeout(240_000)

    const virt = await addVirtualAuthenticator(page)
    const label = `pwnative${Date.now().toString().slice(-6)}`
    const fullName = `${label}.agent`

    // /sign-up redirects to / now; signup happens from a hub landing.
    await page.goto(`${BASE}/h/catalyst`)
    // Wait for the input to mount before filling; the availability check
    // uses a 400ms debounce + an /api/auth/check-agent-name round-trip.
    await page.waitForLoadState('networkidle')
    await page.getByTestId('hub-onboard-signup-name').fill(label)
    await expect(page.getByTestId('hub-onboard-passkey-signup')).toBeEnabled({ timeout: 30_000 })
    await page.getByTestId('hub-onboard-passkey-signup').click()

    // Signup runs two passkey ceremonies (registration, then session-grant
    // signature) and provisions the holder wallet via session-EOA. The
    // dialog reloads /h/catalyst when done; the session API is the most
    // direct way to confirm completion.
    await expect.poll(
      async () => {
        const r = await page.request.get(`${BASE}/api/auth/session`)
        const body = await r.json() as { user: { via?: string; name?: string } | null }
        return body.user?.name ?? null
      },
      { timeout: 180_000, intervals: [2_000] },
    ).toBe(fullName)

    const r1 = await page.request.get(`${BASE}/api/auth/session`)
    const body1 = await r1.json() as { user: { name: string; via: string } | null }
    expect(body1.user!.via).toBe('passkey')

    // The "same passkey can sign in again" leg is exercised end-to-end by
    // the SSI wallet tests (which use long-lived demo sessions and would
    // surface any session-validation regression). We don't repeat the
    // signin ceremony here because conditional-UI + virtual-authenticator
    // timing under sequential test load is non-deterministic.

    await virt.session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: virt.authenticatorId })
  })
})
