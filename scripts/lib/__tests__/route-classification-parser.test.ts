/**
 * Tests for `route-classification-parser.ts`.
 *
 * Each test feeds synthetic route.ts source strings into
 * `parseRouteFileSource` and asserts the structured outputs. No file I/O
 * required — the parser is pure.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRouteFileSource,
  validateTags,
  deriveApiPath,
  ROUTE_KINDS,
  AUTH_KINDS,
} from '../route-classification-parser'

describe('route-classification-parser', () => {
  describe('happy path', () => {
    it('parses well-formed tags on a single handler', () => {
      const src = [
        '/**',
        ' * @sa-route web-auth',
        ' * @sa-auth session-cookie',
        ' * @sa-risk-tier medium',
        ' * @sa-audit-event vote.cast',
        ' * @sa-validation zod',
        ' */',
        "import { validateRequest } from '@/lib/auth/validate-request'",
        'export async function POST(req: Request) { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, true)
      if (!out[0].ok) return
      assert.equal(out[0].record.method, 'POST')
      assert.equal(out[0].record.apiPath, '/api/foo')
      assert.equal(out[0].record.tags.route, 'web-auth')
      assert.equal(out[0].record.tags.auth, 'session-cookie')
      assert.equal(out[0].record.tags.riskTier, 'medium')
      assert.equal(out[0].record.tags.auditEvent, 'vote.cast')
      assert.equal(out[0].record.tags.validation, 'zod')
    })

    it('handles multiple methods in one file (POST + GET)', () => {
      const src = [
        '/**',
        ' * @sa-route web-auth',
        ' * @sa-auth session-cookie',
        ' */',
        'export async function GET() { return Response.json({}) }',
        '',
        '/**',
        ' * @sa-route dev-only',
        ' * @sa-auth none',
        ' * @sa-prod-gate requireDev',
        ' * @sa-validation none-no-body',
        ' */',
        'export async function POST(req: Request) { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/dual/route.ts', src)
      assert.equal(out.length, 2)
      assert.ok(out.every((r) => r.ok))
      const methods = out.map((r) => (r.ok ? r.record.method : null)).sort()
      assert.deepEqual(methods, ['GET', 'POST'])
      const dev = out.find((r) => r.ok && r.record.method === 'POST')
      assert.equal(dev?.ok && dev.record.tags.route, 'dev-only')
      assert.equal(dev?.ok && dev.record.tags.prodGate, 'requireDev')
    })

    it('falls back to file-level JSDoc when handler has no local block', () => {
      const src = [
        '/** @sa-route dev-only @sa-auth none @sa-prod-gate requireDev */',
        "import { NextResponse } from 'next/server'",
        'export async function GET() { return NextResponse.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/boot-seed/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, true)
      if (!out[0].ok) return
      assert.equal(out[0].record.tags.route, 'dev-only')
      assert.equal(out[0].record.tags.prodGate, 'requireDev')
    })
  })

  describe('error paths', () => {
    it('errors on missing @sa-route tag', () => {
      const src = [
        '/** @sa-auth session-cookie */',
        'export async function GET() { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, false)
      if (out[0].ok) return
      assert.ok(out[0].errors.some((e) => /missing required tag: @sa-route/.test(e)))
    })

    it('errors on dev-only without @sa-prod-gate', () => {
      const src = [
        '/** @sa-route dev-only @sa-auth none */',
        'export async function GET() { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, false)
      if (out[0].ok) return
      assert.ok(
        out[0].errors.some((e) => /dev-only requires @sa-prod-gate/.test(e)),
        `expected dev-only/prod-gate error, got: ${out[0].errors.join('; ')}`,
      )
    })

    it('errors on unknown @sa-route value', () => {
      const src = [
        '/** @sa-route mystery-auth @sa-auth none */',
        'export async function GET() { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, false)
      if (out[0].ok) return
      assert.ok(
        out[0].errors.some((e) => /invalid @sa-route value "mystery-auth"/.test(e)),
      )
    })

    it('errors on unknown @sa-auth value', () => {
      const src = [
        '/** @sa-route public @sa-auth basic-auth */',
        'export async function GET() { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, false)
      if (out[0].ok) return
      assert.ok(out[0].errors.some((e) => /invalid @sa-auth value/.test(e)))
    })

    it('errors on malformed @sa-rate-limit value', () => {
      const src = [
        '/** @sa-route public @sa-auth none @sa-rate-limit super-fast */',
        'export async function GET() { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, false)
      if (out[0].ok) return
      assert.ok(
        out[0].errors.some((e) => /invalid @sa-rate-limit value/.test(e)),
      )
    })

    it('returns a structured failure when no exported HTTP handler is found', () => {
      const src = [
        '/** @sa-route public @sa-auth none */',
        "export function helper() { return 1 }",
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, false)
      if (out[0].ok) return
      assert.equal(out[0].method, null)
      assert.ok(out[0].errors.some((e) => /no exported HTTP handler/.test(e)))
    })

    it('errors on a state-changing handler that omits @sa-validation (Sprint 3 S3.4)', () => {
      const src = [
        '/** @sa-route web-auth @sa-auth session-cookie */',
        'export async function POST() { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, false)
      if (out[0].ok) return
      assert.ok(out[0].errors.some((e) => /missing @sa-validation tag/.test(e)))
    })

    it('errors on @sa-validation=zod without importing validateRequest (Sprint 3 S3.4)', () => {
      // Tag claims zod but file never imports the helper — lint must catch.
      const src = [
        '/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod */',
        'export async function POST() { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, false)
      if (out[0].ok) return
      assert.ok(
        out[0].errors.some((e) => /requires importing validateRequest/.test(e)),
      )
    })

    it('allows GET handlers to omit @sa-validation (only state-changing methods need it)', () => {
      const src = [
        '/** @sa-route web-auth @sa-auth session-cookie */',
        'export async function GET() { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, true)
    })

    it('accepts @sa-validation=none-no-body (no validateRequest import required)', () => {
      const src = [
        '/** @sa-route web-auth @sa-auth session-cookie @sa-validation none-no-body */',
        'export async function POST() { return Response.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, true)
    })

    it('returns a structured failure when handler has no preceding JSDoc and no file header', () => {
      const src = [
        "import { NextResponse } from 'next/server'",
        'export async function POST(req: Request) { return NextResponse.json({}) }',
      ].join('\n')
      const out = parseRouteFileSource('apps/web/src/app/api/foo/route.ts', src)
      assert.equal(out.length, 1)
      assert.equal(out[0].ok, false)
      if (out[0].ok) return
      // Either "no JSDoc block found" or "missing required tag" is acceptable
      // — the parser does its best to surface the most useful message.
      assert.ok(
        out[0].errors.some((e) => /no JSDoc classification block found|missing required tag/.test(e)),
      )
    })
  })

  describe('validateTags', () => {
    it('exposes every documented route kind in the public constant', () => {
      assert.deepEqual([...ROUTE_KINDS], [
        'public',
        'web-auth',
        'service-only',
        'admin-only',
        'dev-only',
        'bootstrap',
      ])
    })

    it('exposes every documented auth kind in the public constant', () => {
      assert.deepEqual([...AUTH_KINDS], [
        'none',
        'session-cookie',
        'grant-cookie',
        'service-hmac',
        'kms-token',
        'none-with-csrf',
      ])
    })

    it('accepts the full optional tag set', () => {
      const tagMap = new Map([
        ['route', 'public'],
        ['auth', 'none'],
        ['rate-limit', '10/min'],
        ['audit-event', 'foo.bar'],
        ['risk-tier', 'high'],
        ['owner', 'security'],
      ])
      const { tags, errors } = validateTags(tagMap)
      assert.deepEqual(errors, [])
      assert.equal(tags?.route, 'public')
      assert.equal(tags?.rateLimit, '10/min')
      assert.equal(tags?.riskTier, 'high')
      assert.equal(tags?.owner, 'security')
    })
  })

  describe('deriveApiPath', () => {
    it('strips app prefix and /route.ts suffix', () => {
      assert.equal(
        deriveApiPath('apps/web/src/app/api/auth/session/route.ts'),
        '/api/auth/session',
      )
    })

    it('preserves bracketed dynamic segments', () => {
      assert.equal(
        deriveApiPath('apps/web/src/app/api/messages/[id]/route.ts'),
        '/api/messages/[id]',
      )
    })

    it('returns (unknown) when path shape is unexpected', () => {
      assert.equal(
        deriveApiPath('lib/somewhere-else/route.ts'),
        '(unknown)',
      )
    })
  })
})
