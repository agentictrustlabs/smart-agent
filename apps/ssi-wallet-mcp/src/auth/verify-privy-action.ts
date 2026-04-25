import { verifyPrivyAction, type WalletAction } from '@smart-agent/privacy-creds'
import { createPublicClient, http } from 'viem'
import { consumeNonce } from '../storage/nonces.js'
import { getHolderWalletById, normalizeWalletContext } from '../storage/wallets.js'
import { config } from '../config.js'

// Lazy public client used for ERC-1271 signature verification (smart-account
// signers — passkey-signed WalletActions for OAuth users). Plain EOA paths
// continue to verify without any RPC.
let _publicClient: ReturnType<typeof createPublicClient> | null = null
function getPublicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: { id: config.chainId, name: 'sa', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } },
      transport: http(config.rpcUrl),
    })
  }
  return _publicClient
}

export interface GateInput {
  action: WalletAction
  signature: `0x${string}`
}

export interface GateSuccess {
  ok: true
  holderWallet: NonNullable<ReturnType<typeof getHolderWalletById>>
}
export interface GateFailure {
  ok: false
  status: number
  reason: string
}
export type GateResult = GateSuccess | GateFailure

/**
 * Single gate every privileged route passes through:
 *
 *   1. The holder wallet must exist (for Provision, the caller deals with that
 *      case separately — this gate is only for actions that reference an
 *      existing wallet).
 *   2. The Privy signature must verify against the stored EOA.
 *   3. The nonce must be unused. Consume it atomically.
 *
 * NB: For `ProvisionHolderWallet` the wallet does not yet exist; callers of
 * that route use `verifyProvisionAction` below.
 */
export async function gateExistingWalletAction(input: GateInput): Promise<GateResult> {
  const { action, signature } = input

  const hw = getHolderWalletById(action.holderWalletId)
  if (!hw) return { ok: false, status: 404, reason: 'holder wallet not found' }

  if (hw.personPrincipal !== action.personPrincipal) {
    return { ok: false, status: 400, reason: 'personPrincipal mismatch' }
  }
  // walletContext must already be normalized AND match the wallet's stored
  // context. Enforcing normalization here blocks the "Personal vs personal
  // parallel wallet" drift attack described in the security audit.
  const normalized = normalizeWalletContext(action.walletContext)
  if (normalized === null || normalized !== action.walletContext) {
    return { ok: false, status: 400, reason: 'walletContext not canonically normalized' }
  }
  if (hw.walletContext !== action.walletContext) {
    return { ok: false, status: 400, reason: 'walletContext mismatch' }
  }

  const verify = await verifyPrivyAction({
    action,
    signature,
    expectedSigner: hw.privyEoa as `0x${string}`,
    chainId: config.chainId,
    verifyingContract: config.verifyingContract,
    client: getPublicClient(),
  })
  if (!verify.ok) return { ok: false, status: 401, reason: verify.reason ?? 'invalid signature' }

  try {
    consumeNonce(action.nonce, action.type, hw.id, action.expiresAt)
  } catch (err) {
    return { ok: false, status: 409, reason: (err as Error).message }
  }

  return { ok: true, holderWallet: hw }
}

/**
 * Gate for ProvisionHolderWallet actions. The holder wallet doesn't yet exist
 * so `expectedSigner` must be supplied by the caller (= the Privy EOA they
 * claim to own). Caller is responsible for persisting the resulting wallet.
 */
export async function gateProvisionAction(
  action: WalletAction,
  signature: `0x${string}`,
  expectedSigner: `0x${string}`,
): Promise<{ ok: true } | GateFailure> {
  if (action.type !== 'ProvisionHolderWallet') {
    return { ok: false, status: 400, reason: `unexpected action type: ${action.type}` }
  }
  const verify = await verifyPrivyAction({
    action,
    signature,
    expectedSigner,
    chainId: config.chainId,
    verifyingContract: config.verifyingContract,
    client: getPublicClient(),
  })
  if (!verify.ok) return { ok: false, status: 401, reason: verify.reason ?? 'invalid signature' }

  // We don't have a holder wallet id yet, so nonce is bound to the personPrincipal.
  try {
    consumeNonce(action.nonce, action.type, `pending:${action.personPrincipal}`, action.expiresAt)
  } catch (err) {
    return { ok: false, status: 409, reason: (err as Error).message }
  }
  return { ok: true }
}
