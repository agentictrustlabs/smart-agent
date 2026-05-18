/**
 * Google-OAuth deterministic salt derivation (Sprint S2.6).
 *
 * Replaces the legacy `SERVER_PEPPER` symmetric env secret. The salt that
 * pins a google identity to a counterfactual smart-account address is now
 * computed via a KMS-HMAC MAC over a canonical message — same K3-ext
 * `kms:GenerateMac` primitive used by the inter-service MAC keys.
 *
 *   canonical = `oauth-salt:v1:${lower(email)}:${rotation}`
 *   salt      = HMAC_SHA_256(macKey, canonical) → 32 bytes
 *
 * Properties:
 *   - Deterministic: same (email, rotation) → same 32-byte salt → same
 *     smart-account address forever (assuming the same factory +
 *     serverSigner triplet and the same KMS HMAC key).
 *   - Key rotation = address rotation. Provisioning a new
 *     `AWS_KMS_MAC_KEY_ID_OAUTH_SALT` produces different salts for every
 *     google user; the operator runbook treats the key as immutable in
 *     production (same posture as `SERVER_PEPPER` before this).
 *   - The MAC value never leaves the server — it's consumed locally to
 *     compute a CREATE2 salt. No wire-level binding is needed.
 *
 * Backends are selected by `A2A_KMS_BACKEND` (same selector as the rest
 * of the K3-ext family). The `local-hmac` provider refuses
 * `NODE_ENV=production`; the production path must point at
 * `AWS_KMS_MAC_KEY_ID_OAUTH_SALT`.
 */
import { buildWebMacProvider, type KmsMacProvider } from '@smart-agent/sdk/key-custody'

const PREFIX = 'oauth-salt:v1'

const cached: { provider?: KmsMacProvider } = {}

/**
 * Lazily resolve the `oauth-salt` MAC provider. Cached for the process
 * lifetime — each Next.js Function instance constructs the provider once
 * on first /api/auth/google-callback hit and reuses it for subsequent
 * requests. Tests can reset via {@link _resetOauthSaltProviderForTests}.
 */
function getProvider(): KmsMacProvider {
  if (!cached.provider) {
    cached.provider = buildWebMacProvider(process.env, 'oauth-salt')
  }
  return cached.provider
}

/** Test-only hook so per-test env mutations rebuild the provider. */
export function _resetOauthSaltProviderForTests(): void {
  cached.provider = undefined
}

/**
 * Build the canonical message string fed into the MAC. Exported so tests
 * can pin the exact bytes; production callers go through {@link deriveOauthSalt}.
 *
 * NOTE: the prefix + version live in the message itself (not the key
 * binding) so a future v2 with different inputs / hash extension can
 * coexist with v1-signed addresses for the same key. We don't expect to
 * need this — the address is the contract — but the version tag is
 * cheap insurance.
 */
export function canonicalOauthSaltMessage(
  email: string,
  rotation: number | string,
): string {
  return `${PREFIX}:${email.toLowerCase().trim()}:${String(rotation)}`
}

/**
 * Derive the 32-byte deterministic salt for a google identity.
 *
 * @param email    Verified `email` claim from the Google id_token.
 * @param rotation The per-user salt rotation counter (`accountSaltRotation`
 *                 in the `localUserAccounts` row). `0` for new users; the
 *                 "Start fresh" escape hatch bumps it.
 * @returns        32 raw bytes (the HMAC-SHA-256 output).
 */
export async function deriveOauthSalt(
  email: string,
  rotation: number | string,
): Promise<Uint8Array> {
  const canonical = canonicalOauthSaltMessage(email, rotation)
  const { mac } = await getProvider().generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return mac
}

/**
 * Convenience wrapper that returns the salt as the `bigint` the factory
 * expects (CREATE2 salt is a `uint256`). Equivalent to the legacy
 * `deriveSaltFromEmail` return type so the callers in
 * `google-callback/route.ts` and `setup-agent.action.ts` keep the same
 * shape on the boundary.
 */
export async function deriveOauthSaltBigInt(
  email: string,
  rotation: number | string,
): Promise<bigint> {
  const bytes = await deriveOauthSalt(email, rotation)
  let out = 0n
  for (const b of bytes) {
    out = (out << 8n) | BigInt(b)
  }
  return out
}
