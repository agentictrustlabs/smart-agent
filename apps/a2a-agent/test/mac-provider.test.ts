/**
 * Tests for `apps/a2a-agent/src/auth/mac-provider.ts` and the SDK-side
 * `buildMcpMacProvider` / `buildWebMacProvider` factories (KMS migration
 * K3-extension — selector + per-key cache).
 *
 * Covers:
 *   - Per-`A2A_KMS_BACKEND` selection (local-aes vs aws-kms vs
 *     vault-transit-sibling).
 *   - The `MacKeyId → env-var-name` mapping for both legacy and AWS KMS.
 *   - Fail-fast when required env is missing.
 *   - Cache hit on second `cache.get(macKeyId)` call (same instance).
 *   - Production guard refuses local-aes.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/mac-provider.test.ts`
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMacProvider,
  createMacProviderCache,
  MAC_KEY_IDS,
  type MacKeyId,
} from '../src/auth/mac-provider'
import {
  buildMcpMacProvider,
  buildWebMacProvider,
  envKeyForMacKeyId,
  MCP_TO_MAC_KEY_ID,
} from '@smart-agent/sdk/key-custody'

const HEX_SECRET = '0x' + 'd'.repeat(64)

function localEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    A2A_KMS_BACKEND: 'local-aes',
    WEB_TO_A2A_HMAC_KEY: HEX_SECRET,
    A2A_INTERSERVICE_HMAC_KEY_PERSON: HEX_SECRET,
    A2A_INTERSERVICE_HMAC_KEY_ORG: HEX_SECRET,
    A2A_INTERSERVICE_HMAC_KEY_FAMILY: HEX_SECRET,
    A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP: HEX_SECRET,
    A2A_INTERSERVICE_HMAC_KEY_VERIFIER: HEX_SECRET,
    A2A_INTERSERVICE_HMAC_KEY_SKILL: HEX_SECRET,
    A2A_INTERSERVICE_HMAC_KEY_GEO: HEX_SECRET,
    // S2.6 — `oauth-salt` MAC key. web-internal; not used for an
    // inter-service hop. The factory still has to be able to construct
    // a provider for it through the standard selector.
    OAUTH_SALT_HMAC_KEY: HEX_SECRET,
    ...extra,
  }
}

const VALID_AWS_ROLE_ARN = 'arn:aws:iam::111122223333:role/SmartAgentA2A'
const VALID_AWS_KEY_ARN =
  'arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567'

// ─── env-var name mapping ────────────────────────────────────────────

test('envKeyForMacKeyId maps web-to-a2a → both legacy and AWS env names', () => {
  const { legacy, awsKms } = envKeyForMacKeyId('web-to-a2a')
  assert.equal(legacy, 'WEB_TO_A2A_HMAC_KEY')
  assert.equal(awsKms, 'AWS_KMS_MAC_KEY_ID_WEB_TO_A2A')
})

test('envKeyForMacKeyId maps a2a-to-person → the legacy person key', () => {
  const { legacy, awsKms } = envKeyForMacKeyId('a2a-to-person')
  assert.equal(legacy, 'A2A_INTERSERVICE_HMAC_KEY_PERSON')
  assert.equal(awsKms, 'AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON')
})

test('envKeyForMacKeyId maps oauth-salt → OAUTH_SALT_HMAC_KEY / AWS_KMS_MAC_KEY_ID_OAUTH_SALT (S2.6)', () => {
  const { legacy, awsKms } = envKeyForMacKeyId('oauth-salt')
  assert.equal(legacy, 'OAUTH_SALT_HMAC_KEY')
  assert.equal(awsKms, 'AWS_KMS_MAC_KEY_ID_OAUTH_SALT')
})

test('envKeyForMacKeyId covers every MacKeyId without throwing', () => {
  // Exhaustiveness: every constant in MAC_KEY_IDS must round-trip the
  // mapping. A new MacKeyId added without updating the switch fails here.
  for (const id of MAC_KEY_IDS) {
    const { legacy, awsKms } = envKeyForMacKeyId(id)
    assert.ok(legacy && legacy.length > 0, `legacy env name for ${id} is empty`)
    assert.ok(awsKms.startsWith('AWS_KMS_MAC_KEY_ID_'), `aws env name for ${id} is wrong shape`)
  }
})

test('MCP_TO_MAC_KEY_ID has entries for all seven MCPs', () => {
  assert.equal(MCP_TO_MAC_KEY_ID.person, 'a2a-to-person')
  assert.equal(MCP_TO_MAC_KEY_ID.org, 'a2a-to-org')
  assert.equal(MCP_TO_MAC_KEY_ID.family, 'a2a-to-family')
  assert.equal(MCP_TO_MAC_KEY_ID['people-group'], 'a2a-to-people-group')
  assert.equal(MCP_TO_MAC_KEY_ID.verifier, 'a2a-to-verifier')
  assert.equal(MCP_TO_MAC_KEY_ID.skill, 'a2a-to-skill')
  assert.equal(MCP_TO_MAC_KEY_ID.geo, 'a2a-to-geo')
})

// ─── local-aes backend ──────────────────────────────────────────────

test("buildMacProvider('a2a-to-person', local-aes) reads A2A_INTERSERVICE_HMAC_KEY_PERSON", async () => {
  const provider = buildMacProvider('a2a-to-person', localEnv())
  const msg = new TextEncoder().encode('hello')
  const { mac } = await provider.generateMac({ canonicalMessage: msg })
  assert.equal(mac.length, 32)
  const { valid } = await provider.verifyMac({ canonicalMessage: msg, mac })
  assert.equal(valid, true)
})

test("buildMacProvider returns DIFFERENT MAC for same message under different keys", async () => {
  // Defense in depth: per-key secrets must produce per-key MACs even when
  // both happen to share a hex-secret value in dev (which they do in
  // localEnv() — that's only safe because each key is bound to its own
  // canonical-message contract; the verifier picks the key from the
  // service header).
  //
  // We assert the binding by using DIFFERENT secrets for two keys and
  // verifying that the MAC produced under one fails to verify under the
  // other.
  const envA = localEnv({ A2A_INTERSERVICE_HMAC_KEY_PERSON: '0x' + 'a'.repeat(64) })
  const envB = localEnv({ A2A_INTERSERVICE_HMAC_KEY_PERSON: '0x' + 'b'.repeat(64) })
  const a = buildMacProvider('a2a-to-person', envA)
  const b = buildMacProvider('a2a-to-person', envB)
  const msg = new TextEncoder().encode('hello')
  const { mac: macA } = await a.generateMac({ canonicalMessage: msg })
  const { valid } = await b.verifyMac({ canonicalMessage: msg, mac: macA })
  assert.equal(valid, false)
})

test('buildMacProvider local-aes throws when its env var is missing', () => {
  // Person env present, org missing → org factory throws.
  const env = localEnv()
  delete env.A2A_INTERSERVICE_HMAC_KEY_ORG
  assert.throws(
    () => buildMacProvider('a2a-to-org', env),
    /A2A_INTERSERVICE_HMAC_KEY_ORG is missing/,
  )
})

// ─── aws-kms backend ─────────────────────────────────────────────────

test('buildMacProvider aws-kms requires AWS_REGION', () => {
  assert.throws(
    () =>
      buildMacProvider('web-to-a2a', {
        A2A_KMS_BACKEND: 'aws-kms',
        AWS_ROLE_ARN: VALID_AWS_ROLE_ARN,
        AWS_KMS_MAC_KEY_ID_WEB_TO_A2A: VALID_AWS_KEY_ARN,
      }),
    /AWS_REGION is required/,
  )
})

test('buildMacProvider aws-kms requires AWS_KMS_MAC_KEY_ID_<MAC_KEY_ID>', () => {
  assert.throws(
    () =>
      buildMacProvider('web-to-a2a', {
        A2A_KMS_BACKEND: 'aws-kms',
        AWS_REGION: 'us-east-1',
        AWS_ROLE_ARN: VALID_AWS_ROLE_ARN,
        // missing AWS_KMS_MAC_KEY_ID_WEB_TO_A2A
      }),
    /AWS_KMS_MAC_KEY_ID_WEB_TO_A2A is required/,
  )
})

test('buildMacProvider aws-kms constructs a provider when env is well-formed', () => {
  // Constructor doesn't contact AWS — lazy. So this is just a shape check.
  const provider = buildMacProvider('web-to-a2a', {
    A2A_KMS_BACKEND: 'aws-kms',
    AWS_REGION: 'us-east-1',
    AWS_ROLE_ARN: VALID_AWS_ROLE_ARN,
    AWS_KMS_MAC_KEY_ID_WEB_TO_A2A: VALID_AWS_KEY_ARN,
  })
  assert.equal(typeof provider.generateMac, 'function')
  assert.equal(typeof provider.verifyMac, 'function')
})

// ─── vault-transit sibling ───────────────────────────────────────────

test("buildMacProvider 'vault-transit' throws not-implemented (sibling)", () => {
  assert.throws(
    () =>
      buildMacProvider('web-to-a2a', {
        A2A_KMS_BACKEND: 'vault-transit',
      }),
    /vault-transit.*not implemented/,
  )
})

test('buildMacProvider unknown backend throws', () => {
  assert.throws(
    () =>
      buildMacProvider('web-to-a2a', {
        A2A_KMS_BACKEND: 'foo-bar',
      }),
    /unknown A2A_KMS_BACKEND: foo-bar/,
  )
})

// ─── Production guard ────────────────────────────────────────────────

test("NODE_ENV='production' + local-aes throws", () => {
  assert.throws(
    () =>
      buildMacProvider('web-to-a2a', {
        ...localEnv(),
        NODE_ENV: 'production',
      }),
    /refusing to instantiate 'local-aes' in production/,
  )
})

// ─── createMacProviderCache caches by MacKeyId ───────────────────────

test('createMacProviderCache returns the same instance on second .get()', () => {
  const cache = createMacProviderCache(localEnv())
  const p1 = cache.get('a2a-to-person')
  const p2 = cache.get('a2a-to-person')
  assert.strictEqual(p1, p2)
})

test('createMacProviderCache returns DIFFERENT instances for different MacKeyIds', () => {
  const cache = createMacProviderCache(localEnv())
  const person = cache.get('a2a-to-person')
  const org = cache.get('a2a-to-org')
  assert.notStrictEqual(person, org)
})

// ─── buildMcpMacProvider and buildWebMacProvider ─────────────────────

test('buildMcpMacProvider returns the same shape as buildMacProvider', async () => {
  const provider = buildMcpMacProvider('person', localEnv())
  const msg = new TextEncoder().encode('hello')
  const { mac } = await provider.generateMac({ canonicalMessage: msg })
  assert.equal(mac.length, 32)
})

test('buildWebMacProvider(env, "oauth-salt") selects the oauth-salt key (S2.6)', async () => {
  // The S2.6 web-internal MAC key path: same factory, different key id.
  const env = localEnv({
    WEB_TO_A2A_HMAC_KEY: '0x' + '1'.repeat(64),
    OAUTH_SALT_HMAC_KEY: '0x' + '2'.repeat(64),
  })
  const webDefault = buildWebMacProvider(env)
  const oauthSalt = buildWebMacProvider(env, 'oauth-salt')
  const msg = new TextEncoder().encode('hello')
  const { mac: macDefault } = await webDefault.generateMac({ canonicalMessage: msg })
  const { mac: macOauth } = await oauthSalt.generateMac({ canonicalMessage: msg })
  // Same message under different keys → different MAC bytes.
  assert.notDeepEqual(Array.from(macDefault), Array.from(macOauth))
  // And the default-keyed mac must NOT verify under the oauth-salt provider.
  const { valid } = await oauthSalt.verifyMac({ canonicalMessage: msg, mac: macDefault })
  assert.equal(valid, false)
})

test('buildWebMacProvider uses the web-to-a2a key', async () => {
  // Make web-to-a2a deliberately different from a2a-to-person so the
  // factory's key selection is observable: the same canonical message
  // signed under web-to-a2a must NOT verify under a2a-to-person.
  const env = localEnv({
    WEB_TO_A2A_HMAC_KEY: '0x' + 'e'.repeat(64),
    A2A_INTERSERVICE_HMAC_KEY_PERSON: '0x' + 'f'.repeat(64),
  })
  const web = buildWebMacProvider(env)
  const person = buildMcpMacProvider('person', env)
  const msg = new TextEncoder().encode('hello')
  const { mac } = await web.generateMac({ canonicalMessage: msg })
  const { valid } = await person.verifyMac({ canonicalMessage: msg, mac })
  assert.equal(valid, false)
})

// ─── Exhaustive: every MacKeyId is reachable through the cache ─────

test('every MacKeyId in MAC_KEY_IDS can be resolved through the cache', () => {
  const cache = createMacProviderCache(localEnv())
  for (const id of MAC_KEY_IDS) {
    const p = cache.get(id as MacKeyId)
    assert.ok(p, `cache.get(${id}) returned a provider`)
  }
})
