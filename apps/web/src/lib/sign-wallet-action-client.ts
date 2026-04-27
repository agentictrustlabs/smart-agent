/**
 * Client-side WalletAction signer.
 *
 * Picks the signing path based on the user's auth method:
 *
 *   - 'siwe'   → MetaMask (or any injected wallet) signs the EIP-712 typed
 *                data via eth_signTypedData_v4. The user's EOA is an owner
 *                of the smart account, so the resulting 65-byte ECDSA
 *                passes ERC-1271 isValidSignature.
 *   - 'passkey'→ WebAuthn assertion against the EIP-712 hash; signature is
 *                packed with the 0x01 type byte so AgentAccount routes to
 *                the WebAuthn verification path. Real cryptographic
 *                verification via the Daimo P-256 verifier.
 *   - 'eoa'    → never reaches the client (server-signs with stored key).
 *
 * Both paths return a `0x…`-prefixed signature that ssi-wallet-mcp /
 * person-mcp consume identically — the SmartAgentP256VerifyAction
 * verifier on-chain doesn't care which path produced it.
 */

import { packWebAuthnSignature } from '@smart-agent/sdk'
// IMPORTANT: import from the `wallet-actions` subpath, NOT the barrel.
// `@smart-agent/privacy-creds` (root) re-exports IssuerAgent which pulls in
// better-sqlite3 — a Node-only native module that webpack can't bundle for
// the browser. The subpath export is pure types + EIP-712 helpers.
import type { WalletAction } from '@smart-agent/privacy-creds/wallet-actions'
import { walletActionDomain, WalletActionTypes } from '@smart-agent/privacy-creds/wallet-actions'

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

interface SignContext {
  kind: 'eoa' | 'passkey' | 'siwe'
  chainId: number
  verifyingContract: `0x${string}`
  signerAddress: `0x${string}`
  walletAddress: `0x${string}` | null
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Sign a WalletAction with the user's auth-method-appropriate key. Returns
 * a hex signature ready to submit to ssi-wallet-mcp / person-mcp.
 *
 * @param action  The WalletAction with serialized expiresAt (string).
 * @param hash    The pre-computed EIP-712 hash of `action` (server-side).
 * @param signer  Signing context returned by `prepareWalletProvisionIfNeeded`.
 */
export async function signWalletActionClient(
  action: WalletAction & { expiresAt: string },
  hash: `0x${string}`,
  signer: SignContext,
): Promise<`0x${string}`> {
  if (signer.kind === 'siwe') {
    const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum
    if (!eth) throw new Error('No injected wallet detected')
    const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[]
    if (!accounts[0]) throw new Error('Wallet returned no accounts')
    const typedData = {
      domain: walletActionDomain(signer.chainId, signer.verifyingContract),
      types: {
        // eth_signTypedData_v4 needs EIP712Domain explicitly listed.
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        ...WalletActionTypes,
      },
      primaryType: 'WalletAction' as const,
      message: action,
    }
    const sig = await eth.request({
      method: 'eth_signTypedData_v4',
      params: [accounts[0], JSON.stringify(typedData)],
    }) as string
    return sig as `0x${string}`
  }

  if (signer.kind === 'passkey') {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) {
      throw new Error('Passkey signing not available in this browser')
    }
    // Constrain the OS picker to passkeys registered on the CURRENT
    // user's account. Login is name-based — no server-side credential
    // mapping — so we filter localStorage hints by the .agent name set
    // at signup time. Without this filter, picking a passkey for a
    // different account here would produce a digest that isn't in this
    // account's on-chain _passkeys mapping → ERC-1271 rejects.
    let userName: string | null = null
    try {
      const r = await fetch('/api/auth/session', { cache: 'no-store' })
      const body = await r.json() as { user: { name?: string } | null }
      userName = body.user?.name ?? null
    } catch { /* */ }
    const localHint = JSON.parse(localStorage.getItem('smart-agent.passkeys.local') ?? '[]') as Array<{ id: string; name?: string }>
    const matched = userName ? localHint.filter(h => h.name === userName) : []
    const allowCredentials = matched.length > 0
      ? matched.map(({ id }) => {
          const idBytes = base64UrlDecode(id)
          const idAb = new ArrayBuffer(idBytes.length)
          new Uint8Array(idAb).set(idBytes)
          return { type: 'public-key' as const, id: idAb }
        })
      : undefined

    const challengeBytes = hexToBytes(hash)
    const challengeAb = new ArrayBuffer(challengeBytes.length)
    new Uint8Array(challengeAb).set(challengeBytes)

    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: challengeAb,
        rpId: window.location.hostname,
        userVerification: 'preferred',
        timeout: 60_000,
        allowCredentials,
      },
    }) as PublicKeyCredential | null
    if (!cred) throw new Error('Cancelled')

    const resp = cred.response as AuthenticatorAssertionResponse
    const passkeySig = packWebAuthnSignature({
      credentialIdBytes: new Uint8Array(cred.rawId),
      authenticatorData: new Uint8Array(resp.authenticatorData),
      clientDataJSON: new Uint8Array(resp.clientDataJSON),
      derSignature: new Uint8Array(resp.signature),
    })
    return ('0x01' + passkeySig.slice(2)) as `0x${string}`
  }

  throw new Error(`signer kind '${signer.kind}' is server-side only`)
}
