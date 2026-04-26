import { Hono } from 'hono'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { AnonCreds } from '@smart-agent/privacy-creds'
import {
  askarProfileFor,
  getHolderWalletByContext,
  insertHolderWallet,
  listHolderWalletsForPrincipal,
  newHolderWalletId,
  newLinkSecretId,
  normalizeWalletContext,
  updateHolderLinkSecret,
} from '../storage/wallets.js'
import { createProfile, putLinkSecret } from '../storage/askar.js'
import { markCredentialsStaleForLinkSecret } from '../storage/cred-metadata.js'
import { gateExistingWalletAction, gateProvisionAction } from '../auth/verify-wallet-action.js'

export const walletRoutes = new Hono()

/**
 * POST /wallet/provision
 *
 * Body: { action: WalletAction, signature, expectedSigner }
 *
 * Keyed on (personPrincipal, walletContext). Each (principal, context) pair
 * has its own Askar profile + its own link secret — independent link-secret
 * means cross-context correlation is impossible at the crypto layer.
 *
 * Idempotent: if a wallet for that (principal, context) already exists, return it.
 */
walletRoutes.post('/wallet/provision', async (c) => {
  const body = await c.req.json<{
    action: WalletAction
    signature: `0x${string}`
    expectedSigner: `0x${string}`
  }>()

  const context = normalizeWalletContext(body.action.walletContext)
  if (context === null) {
    return c.json({ error: 'walletContext must be ≤32 chars of [a-z0-9_-] starting with a letter/digit' }, 400)
  }
  if (body.action.walletContext !== context) {
    // The signature commits to the pre-signed string. If the caller signed a
    // non-normalized form ("Personal"), the gate would reject it anyway —
    // fail fast with a clear error instead.
    return c.json({ error: `walletContext must be normalized (got "${body.action.walletContext}", expected "${context}")` }, 400)
  }

  // Idempotency per (principal, context).
  const existing = getHolderWalletByContext(body.action.personPrincipal, context)
  if (existing) {
    return c.json({
      holderWalletId: existing.id,
      walletContext:  existing.walletContext,
      linkSecretId:   existing.linkSecretId,
      askarProfile:   existing.askarProfile,
      idempotent:     true,
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
  const askarProfile   = askarProfileFor(body.action.personPrincipal, context)

  await createProfile(askarProfile)
  const linkSecret = AnonCreds.createLinkSecretValue()
  await putLinkSecret(askarProfile, linkSecretId, linkSecret)

  insertHolderWallet({
    id: holderWalletId,
    personPrincipal: body.action.personPrincipal,
    walletContext: context,
    signerEoa: body.expectedSigner,
    askarProfile,
    linkSecretId,
    status: 'active',
  })

  return c.json({
    holderWalletId,
    walletContext: context,
    linkSecretId,
    askarProfile,
    idempotent: false,
  })
})

/**
 * GET /wallet/:principal
 *
 * Returns the list of wallets (contexts) this principal owns.
 * Kept plural — the UI wallet-switcher needs all of them.
 */
walletRoutes.get('/wallet/:principal', async (c) => {
  const principal = c.req.param('principal')
  const wallets = listHolderWalletsForPrincipal(principal)
  if (wallets.length === 0) return c.json({ wallets: [] })
  return c.json({
    wallets: wallets.map(w => ({
      holderWalletId: w.id,
      walletContext:  w.walletContext,
      linkSecretId:   w.linkSecretId,
      status:         w.status,
      createdAt:      w.createdAt,
    })),
  })
})

/**
 * POST /wallet/rotate-link-secret
 *
 * Body: { action: WalletAction (type='RotateLinkSecret'), signature }
 *
 * Creates a NEW link secret for this (principal, context) wallet and marks
 * every credential bound to the old secret as 'stale' (needs re-issuance).
 * The old link secret is kept in Askar for forensic purposes but is no longer
 * used for new credential requests or presentations.
 */
walletRoutes.post('/wallet/rotate-link-secret', async (c) => {
  const body = await c.req.json<{
    action: WalletAction & { expiresAt: string | number | bigint }
    signature: `0x${string}`
  }>()

  const action: WalletAction = { ...body.action, expiresAt: BigInt(body.action.expiresAt) }
  if (action.type !== 'RotateLinkSecret') {
    return c.json({ error: `unexpected action type: ${action.type}` }, 400)
  }

  const gate = await gateExistingWalletAction({ action, signature: body.signature })
  if (!gate.ok) return c.json({ error: gate.reason }, gate.status as 400 | 401 | 404 | 409)
  const hw = gate.holderWallet

  const oldLinkSecretId = hw.linkSecretId
  const newLinkSecretIdVal = newLinkSecretId()
  const newSecret = AnonCreds.createLinkSecretValue()
  await putLinkSecret(hw.askarProfile, newLinkSecretIdVal, newSecret)
  updateHolderLinkSecret(hw.id, newLinkSecretIdVal)
  const stale = markCredentialsStaleForLinkSecret(hw.id, oldLinkSecretId)

  return c.json({
    holderWalletId: hw.id,
    oldLinkSecretId,
    newLinkSecretId: newLinkSecretIdVal,
    credentialsMarkedStale: stale,
  })
})

/**
 * GET /wallet/:principal/:context
 *
 * Convenience lookup for a single (principal, context) pair.
 * 404 if the wallet doesn't exist.
 */
walletRoutes.get('/wallet/:principal/:context', async (c) => {
  const principal = c.req.param('principal')
  const context   = c.req.param('context')
  const hw = getHolderWalletByContext(principal, context)
  if (!hw) return c.json({ error: 'not found' }, 404)
  return c.json({
    holderWalletId: hw.id,
    walletContext:  hw.walletContext,
    linkSecretId:   hw.linkSecretId,
    status:         hw.status,
    createdAt:      hw.createdAt,
  })
})
