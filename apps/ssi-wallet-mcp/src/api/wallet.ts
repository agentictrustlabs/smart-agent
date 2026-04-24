import { Hono } from 'hono'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { AnonCreds } from '@smart-agent/privacy-creds'
import {
  askarProfileFor,
  getHolderWalletByPrincipal,
  insertHolderWallet,
  newHolderWalletId,
  newLinkSecretId,
} from '../storage/wallets.js'
import { createProfile, putLinkSecret } from '../storage/askar.js'
import { gateProvisionAction } from '../auth/verify-privy-action.js'

export const walletRoutes = new Hono()

/**
 * POST /wallet/provision
 *
 * Body: { action: WalletAction, signature, expectedSigner }
 *
 * Flow (from plan §6.1):
 *   1. verify Privy signature (ProvisionHolderWallet)
 *   2. create Askar profile
 *   3. create AnonCreds link secret
 *   4. store link secret in Askar profile
 *   5. insert holder_wallets row
 *   6. return { holderWalletId, linkSecretId, askarProfile }
 *
 * Idempotent: if a wallet already exists for the principal, return it.
 */
walletRoutes.post('/wallet/provision', async (c) => {
  const body = await c.req.json<{
    action: WalletAction
    signature: `0x${string}`
    expectedSigner: `0x${string}`
  }>()

  // Idempotency: person already has a wallet → return it.
  const existing = getHolderWalletByPrincipal(body.action.personPrincipal)
  if (existing) {
    return c.json({
      holderWalletId: existing.id,
      linkSecretId: existing.linkSecretId,
      askarProfile: existing.askarProfile,
      idempotent: true,
    })
  }

  const gated = await gateProvisionAction(
    { ...body.action, expiresAt: BigInt(body.action.expiresAt) },
    body.signature,
    body.expectedSigner,
  )
  if (!gated.ok) return c.json({ error: gated.reason }, gated.status as 400 | 401 | 409)

  const holderWalletId = newHolderWalletId()
  const linkSecretId   = newLinkSecretId()
  const askarProfile   = askarProfileFor(body.action.personPrincipal)

  await createProfile(askarProfile)
  const linkSecret = AnonCreds.createLinkSecretValue()
  await putLinkSecret(askarProfile, linkSecretId, linkSecret)

  insertHolderWallet({
    id: holderWalletId,
    personPrincipal: body.action.personPrincipal,
    privyEoa: body.expectedSigner,
    askarProfile,
    linkSecretId,
    status: 'active',
  })

  return c.json({ holderWalletId, linkSecretId, askarProfile, idempotent: false })
})

walletRoutes.get('/wallet/:principal', async (c) => {
  const principal = c.req.param('principal')
  const hw = getHolderWalletByPrincipal(principal)
  if (!hw) return c.json({ error: 'not found' }, 404)
  return c.json({
    holderWalletId: hw.id,
    status: hw.status,
    createdAt: hw.createdAt,
  })
})
