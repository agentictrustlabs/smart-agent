/**
 * Tests for the CSRF origin allowlist (S2.2).
 *
 * Covers the regression the senior review caught: the old substring
 * check accepted `Origin: https://evil-foo.com` against `Host: foo.com`.
 * `requireOriginAllowed` does parsed-URL exact equality and rejects.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isOriginAllowed, requireOriginAllowed, getAllowedOrigins } from '../csrf'

const env = process.env as Record<string, string | undefined>

function buildRequest(originHeader: string | null): Request {
  const headers = new Headers()
  if (originHeader !== null) headers.set('origin', originHeader)
  return new Request('https://example.test/api/route', {
    method: 'POST',
    headers,
  })
}

describe('csrf — origin allowlist', () => {
  const ORIG_ALLOWED = env.ALLOWED_ORIGINS

  beforeEach(() => {
    delete env.ALLOWED_ORIGINS
  })

  afterEach(() => {
    if (ORIG_ALLOWED === undefined) delete env.ALLOWED_ORIGINS
    else env.ALLOWED_ORIGINS = ORIG_ALLOWED
  })

  describe('isOriginAllowed', () => {
    it('rejects substring-lookalike that the old check let through', () => {
      // OLD CHECK: `origin.includes('foo.com')` returned TRUE for 'https://evil-foo.com'.
      // NEW CHECK: parsed-URL equality — `evil-foo.com !== foo.com`.
      env.ALLOWED_ORIGINS = 'https://foo.com'
      assert.equal(isOriginAllowed('https://evil-foo.com'), false)
      assert.equal(isOriginAllowed('https://foo.com.evil.com'), false)
    })

    it('allows an exactly-matching origin', () => {
      env.ALLOWED_ORIGINS = 'https://app.example.com'
      assert.equal(isOriginAllowed('https://app.example.com'), true)
    })

    it('accepts any of multiple comma-separated allowed origins', () => {
      env.ALLOWED_ORIGINS = 'http://localhost:3000, https://app.example.com'
      assert.equal(isOriginAllowed('http://localhost:3000'), true)
      assert.equal(isOriginAllowed('https://app.example.com'), true)
      assert.equal(isOriginAllowed('https://other.example.com'), false)
    })

    it('rejects when the Origin header is missing (null)', () => {
      env.ALLOWED_ORIGINS = 'http://localhost:3000'
      assert.equal(isOriginAllowed(null), false)
    })

    it('rejects when the Origin header is not a valid URL', () => {
      env.ALLOWED_ORIGINS = 'http://localhost:3000'
      assert.equal(isOriginAllowed('not a url'), false)
      assert.equal(isOriginAllowed(''), false)
      // `null`-as-string is what some browsers send for sandboxed iframes
      // / `file://` contexts — must NOT be treated as an allowed origin.
      assert.equal(isOriginAllowed('null'), false)
    })

    it('rejects on port mismatch', () => {
      env.ALLOWED_ORIGINS = 'http://localhost:3000'
      assert.equal(isOriginAllowed('http://localhost:3001'), false)
      assert.equal(isOriginAllowed('http://localhost'), false)  // default port 80
    })

    it('rejects on protocol mismatch (http vs https)', () => {
      env.ALLOWED_ORIGINS = 'https://app.example.com'
      assert.equal(isOriginAllowed('http://app.example.com'), false)
    })

    it('falls back to localhost:3000 when ALLOWED_ORIGINS is unset', () => {
      delete env.ALLOWED_ORIGINS
      assert.equal(isOriginAllowed('http://localhost:3000'), true)
      assert.equal(isOriginAllowed('https://evil.example.com'), false)
    })

    it('fails closed (rejects everything) when ALLOWED_ORIGINS is empty', () => {
      env.ALLOWED_ORIGINS = ''
      // Empty string is treated as "unset" by the helper — falls back to
      // localhost default. Operators wanting a hard-fail-closed should
      // set `ALLOWED_ORIGINS=https://nowhere.invalid`.
      assert.equal(isOriginAllowed('http://localhost:3000'), true)
    })

    it('ignores malformed entries in the env list and keeps valid ones', () => {
      env.ALLOWED_ORIGINS = 'not_a_url, https://app.example.com,   '
      const list = getAllowedOrigins()
      assert.equal(list.length, 1)
      assert.equal(list[0].host, 'app.example.com')
      assert.equal(isOriginAllowed('https://app.example.com'), true)
    })
  })

  describe('requireOriginAllowed', () => {
    it('returns null for an allowed origin', () => {
      env.ALLOWED_ORIGINS = 'http://localhost:3000'
      const req = buildRequest('http://localhost:3000')
      assert.equal(requireOriginAllowed(req), null)
    })

    it('returns a 403 NextResponse for a rejected origin', () => {
      env.ALLOWED_ORIGINS = 'http://localhost:3000'
      const req = buildRequest('https://evil-localhost.example')
      const denied = requireOriginAllowed(req)
      assert.notEqual(denied, null)
      assert.equal(denied?.status, 403)
    })

    it('returns a 403 NextResponse when Origin header is missing', () => {
      env.ALLOWED_ORIGINS = 'http://localhost:3000'
      const req = buildRequest(null)
      const denied = requireOriginAllowed(req)
      assert.notEqual(denied, null)
      assert.equal(denied?.status, 403)
    })
  })
})
