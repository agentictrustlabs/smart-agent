import { privateKeyToAccount } from 'viem/accounts'
import { hashTypedData, getAddress } from 'viem'
import { walletActionDomain, WalletActionTypes, type WalletAction } from '@smart-agent/privacy-creds'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { ssiConfig } from './config'

/**
 * Load the currently-authenticated user's signing context.
 *
 * For demo / EOA users, this returns the stored `privateKey` and walletAddress
 * (the existing path). For OAuth (`via=google`) users there is no EOA — only
 * a smart account — so the signer is the contract address and signing must
 * be done via passkey on the client. Callers branch on the `kind` field.
 */
export async function loadSignerForCurrentUser(): Promise<
  | {
      kind: 'eoa'
      userRow: { id: string; walletAddress: string; privateKey: string; name: string }
      principal: string
    }
  | {
      kind: 'smart-account'
      userRow: { id: string; smartAccountAddress: string; name: string }
      principal: string
    }
> {
  const session = await requireSession()
  const rows = await db.select().from(schema.users)
    .where(eq(schema.users.did, session.userId))
    .limit(1)
  const user = rows[0]
  if (!user) throw new Error('User not found')

  if (user.privateKey) {
    if (!user.walletAddress) throw new Error('User has privateKey but no walletAddress')
    return {
      kind: 'eoa',
      userRow: {
        id: user.id,
        walletAddress: user.walletAddress,
        privateKey: user.privateKey,
        name: user.name,
      },
      principal: `person_${user.id}`,
    }
  }

  if (!user.smartAccountAddress) {
    throw new Error('User has neither EOA private key nor smart account address')
  }
  return {
    kind: 'smart-account',
    userRow: {
      id: user.id,
      smartAccountAddress: user.smartAccountAddress,
      name: user.name,
    },
    principal: `person_${user.id}`,
  }
}

/**
 * Sign a WalletAction with the current user's stored EOA key.
 *
 * THROWS for OAuth users — they have no server-side key. Callers that want
 * to support OAuth users should:
 *   1. Use `prepareWalletActionForPasskey(action)` server-side to get the
 *      EIP-712 hash + the smart-account address that will appear as `signer`.
 *   2. Have the browser run navigator.credentials.get(challenge=hash) and
 *      pack the assertion as 0x01 || abi.encode(Assertion).
 *   3. Pass the resulting `{ signature, signer }` to whichever consumer
 *      checks via `verifyWalletAction(..., { client })`. The smart account's
 *      ERC-1271 path verifies the passkey signature on-chain.
 */
export async function signWalletAction(action: WalletAction): Promise<{ signature: `0x${string}`; signer: `0x${string}` }> {
  const ctx = await loadSignerForCurrentUser()
  if (ctx.kind !== 'eoa') {
    throw new Error('signWalletAction: current user has no EOA key — use prepareWalletActionForPasskey for the OAuth/passkey path')
  }
  const account = privateKeyToAccount(ctx.userRow.privateKey as `0x${string}`)
  const signature = await account.signTypedData({
    domain: walletActionDomain(ssiConfig.chainId, ssiConfig.verifierContract),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })
  return { signature, signer: account.address }
}

/**
 * Compute the EIP-712 hash that a passkey must sign for a given WalletAction.
 *
 * The smart account's _verifyWebAuthn path expects the WebAuthn challenge
 * (carried in clientDataJSON) to equal this hash. The eventual signature is
 * 0x01 || abi.encode(WebAuthnLib.Assertion) with that challenge baked in.
 *
 * `signer` is the smart-account address — that's what `verifyWalletAction`
 * resolves to on the ERC-1271 path.
 */
export async function prepareWalletActionForPasskey(
  action: WalletAction,
): Promise<{ hash: `0x${string}`; signer: `0x${string}` }> {
  const ctx = await loadSignerForCurrentUser()
  if (ctx.kind !== 'smart-account') {
    throw new Error('prepareWalletActionForPasskey: current user has an EOA key — use signWalletAction')
  }
  const hash = hashTypedData({
    domain: walletActionDomain(ssiConfig.chainId, ssiConfig.verifierContract),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })
  return { hash, signer: getAddress(ctx.userRow.smartAccountAddress) }
}
