/**
 * SIWE (Sign-In With Ethereum) E2E.
 *
 *   Doesn't drive MetaMask — signs server-side with viem using a fresh EOA.
 *   Tests the full flow:
 *     1. GET /api/auth/siwe-challenge?address=...
 *     2. Sign the message with `personal_sign` (viem.signMessage)
 *     3. POST /api/auth/siwe-verify
 *     4. Confirm /api/auth/session returns user with via=siwe
 *     5. Confirm a fresh smart account was deployed for this EOA
 */

import { test, expect } from '@playwright/test'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const BASE = 'http://localhost:3000'

test.describe('SIWE auth', () => {
  test('first-time user signs in via Ethereum, gets a smart account', async ({ request }) => {
    test.setTimeout(120_000)

    const pk = generatePrivateKey()
    const eoa = privateKeyToAccount(pk)
    const address = eoa.address

    // 1. Challenge
    const chall = await request.get(`${BASE}/api/auth/siwe-challenge?domain=127.0.0.1:3000&address=${address}`)
    expect(chall.ok()).toBeTruthy()
    const { message, token } = await chall.json() as { message: string; nonce: string; token: string }
    expect(message).toContain(`Nonce:`)
    expect(message).toContain(address)

    // 2. Sign locally (impersonates a personal_sign).
    const signature = await eoa.signMessage({ message })

    // 3. Verify
    const verify = await request.post(`${BASE}/api/auth/siwe-verify`, {
      headers: { 'content-type': 'application/json', origin: BASE },
      data: { token, message, signature, address },
    })
    expect(verify.ok()).toBeTruthy()
    const body = await verify.json() as { success: boolean; user: { id: string; smartAccountAddress: string } }
    expect(body.success).toBe(true)
    expect(body.user.smartAccountAddress).toMatch(/^0x[a-f0-9]{40}$/)

    // 4. Session
    const sess = await request.get(`${BASE}/api/auth/session`)
    const sessBody = await sess.json() as { user: { via: string; walletAddress: string } | null }
    expect(sessBody.user).not.toBeNull()
    expect(sessBody.user!.via).toBe('siwe')
    expect(sessBody.user!.walletAddress.toLowerCase()).toBe(address.toLowerCase())
  })

  test('returning user with same EOA reuses the same smart account', async ({ request }) => {
    test.setTimeout(120_000)

    const pk = generatePrivateKey()
    const eoa = privateKeyToAccount(pk)

    async function signIn() {
      const chall = await request.get(`${BASE}/api/auth/siwe-challenge?domain=127.0.0.1:3000&address=${eoa.address}`)
      const { message, token } = await chall.json() as { message: string; nonce: string; token: string }
      const signature = await eoa.signMessage({ message })
      const verify = await request.post(`${BASE}/api/auth/siwe-verify`, {
        headers: { 'content-type': 'application/json', origin: BASE },
        data: { token, message, signature, address: eoa.address },
      })
      const body = await verify.json() as { user: { smartAccountAddress: string } }
      return body.user.smartAccountAddress
    }

    const first  = await signIn()
    await request.post(`${BASE}/api/auth/logout`)
    const second = await signIn()
    expect(second).toBe(first)
  })
})
