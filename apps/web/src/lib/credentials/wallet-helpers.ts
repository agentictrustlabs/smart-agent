/**
 * Sync helpers for the AnonCreds wallet flow.
 *
 * Lives outside the `'use server'` module boundary because Next.js
 * server-action files only allow async exports. Both action files
 * (`wallet-provision.action.ts`, `request-credential.action.ts`)
 * import from here for the sync EIP-712 hashing step.
 */

import type { WalletAction } from '@smart-agent/privacy-creds'
import { walletActionDomain, WalletActionTypes } from '@smart-agent/privacy-creds'
import { hashTypedData } from 'viem'

export type SignerKind = 'eoa' | 'passkey' | 'siwe'

export interface SignerContext {
  kind: SignerKind
  chainId: number
  verifyingContract: `0x${string}`
  signerAddress: `0x${string}`
  smartAccountAddress: `0x${string}` | null
  walletAddress: `0x${string}` | null
}

export function hashWalletAction(action: WalletAction, ctx: SignerContext): `0x${string}` {
  return hashTypedData({
    domain: walletActionDomain(ctx.chainId, ctx.verifyingContract),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })
}
