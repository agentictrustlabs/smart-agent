/**
 * Tests for the request validator (Sprint 3 S3.4).
 *
 * Verifies the three invariants:
 *   - body > maxBytes ⇒ 413 (no parsing attempted)
 *   - malformed JSON ⇒ 400 (no schema attempted)
 *   - schema rejection ⇒ 400 generic (no Zod issue leak — the S1.8 invariant)
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  DEFAULT_BODY_LIMIT_BYTES,
  DELEGATION_BODY_LIMIT_BYTES,
  validateRequest,
} from '../validate-request'

/** Build a POST Request with the given body, optionally declaring a Content-Length. */
function buildRequest(
  body: string,
  opts: { declareContentLength?: boolean | number } = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (opts.declareContentLength === false) {
    // Omit content-length (Headers.set with undefined keeps it absent).
  } else if (typeof opts.declareContentLength === 'number') {
    headers.set('content-length', String(opts.declareContentLength))
  } else {
    headers.set('content-length', String(Buffer.byteLength(body, 'utf-8')))
  }
  return new Request('https://example.test/api/route', {
    method: 'POST',
    headers,
    body,
  })
}

const SimpleSchema = z.object({
  name: z.string().min(1).max(64),
  count: z.number().int().nonnegative().optional(),
})

describe('validateRequest — Sprint 3 S3.4', () => {
  it('returns 413 when Content-Length advertises a size larger than maxBytes', async () => {
    // Advertise 100 KiB while cap is 1 KiB — short-circuit before reading.
    const req = buildRequest('x', { declareContentLength: 100 * 1024 })
    const r = await validateRequest(req, {
      schema: SimpleSchema,
      maxBytes: 1024,
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.response.status, 413)
      const body = await r.response.json() as { error: string }
      assert.equal(body.error, 'Request body too large')
    }
  })

  it('returns 413 when the actual streamed bytes exceed maxBytes (even if Content-Length lied)', async () => {
    // Advertise small length but ship a huge body — the stream-capped
    // reader must catch the lie.
    const big = 'a'.repeat(10 * 1024)
    const req = buildRequest(JSON.stringify({ name: big }), {
      declareContentLength: 50,  // lie
    })
    const r = await validateRequest(req, {
      schema: SimpleSchema,
      maxBytes: 1024,
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.response.status, 413)
  })

  it('returns 400 generic for malformed JSON', async () => {
    const req = buildRequest('{not valid json')
    const r = await validateRequest(req, { schema: SimpleSchema })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.response.status, 400)
      const body = await r.response.json() as { error: string }
      assert.equal(body.error, 'Invalid request body')
    }
  })

  it('returns 400 generic when Zod rejects the shape (no issue leak — S1.8 invariant)', async () => {
    // Missing required `name` field — schema will reject.
    const req = buildRequest(JSON.stringify({ count: 1 }))
    const r = await validateRequest(req, { schema: SimpleSchema })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.response.status, 400)
      const body = await r.response.json() as Record<string, unknown>
      assert.equal(body.error, 'Invalid request body')
      // The S1.8 invariant: response body must NOT carry Zod issues,
      // schema paths, or any field hint.
      assert.equal(typeof body.error, 'string')
      assert.ok(!('issues' in body), 'response leaked zod issues')
      assert.ok(!('_debug' in body), 'response leaked debug fields')
      assert.ok(!('path' in body), 'response leaked schema path')
      // Make sure none of the field names from the schema appear in the
      // response payload.
      const json = JSON.stringify(body)
      assert.ok(!json.includes('name'), 'response leaked schema field "name"')
      assert.ok(!json.includes('count'), 'response leaked schema field "count"')
    }
  })

  it('accepts a request with no Content-Length header up to maxBytes', async () => {
    const req = buildRequest(JSON.stringify({ name: 'alice' }), {
      declareContentLength: false,
    })
    const r = await validateRequest(req, { schema: SimpleSchema })
    // Whether the body shows up depends on whether Node populated content-length
    // automatically. The point is: missing CL must not be an error.
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.data.name, 'alice')
    }
  })

  it('passes valid input through with parsed + typed data', async () => {
    const req = buildRequest(JSON.stringify({ name: 'alice', count: 7 }))
    const r = await validateRequest(req, { schema: SimpleSchema })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.data.name, 'alice')
      assert.equal(r.data.count, 7)
    }
  })

  it('uses DEFAULT_BODY_LIMIT_BYTES (64 KiB) when no maxBytes is given', async () => {
    // 65 KiB > default 64 KiB cap.
    const big = 'a'.repeat(65 * 1024)
    const req = buildRequest(JSON.stringify({ name: big }))
    const r = await validateRequest(req, { schema: SimpleSchema })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.response.status, 413)
    // Sanity check: the constants are what the helper docs advertise.
    assert.equal(DEFAULT_BODY_LIMIT_BYTES, 64 * 1024)
    assert.equal(DELEGATION_BODY_LIMIT_BYTES, 1024 * 1024)
  })

  it('different routes can use different schemas without bleed', async () => {
    const SchemaA = z.object({ a: z.string() })
    const SchemaB = z.object({ b: z.number() })
    const reqA = buildRequest(JSON.stringify({ a: 'hi' }))
    const reqB = buildRequest(JSON.stringify({ b: 42 }))
    const rA = await validateRequest(reqA, { schema: SchemaA })
    const rB = await validateRequest(reqB, { schema: SchemaB })
    assert.equal(rA.ok, true)
    assert.equal(rB.ok, true)
    // Reject cross-schema bodies.
    const reqMismatch = buildRequest(JSON.stringify({ a: 'hi' }))
    const rMismatch = await validateRequest(reqMismatch, { schema: SchemaB })
    assert.equal(rMismatch.ok, false)
    if (!rMismatch.ok) assert.equal(rMismatch.response.status, 400)
  })

  it('treats an empty body as {} (schemas of all-optional fields succeed)', async () => {
    const AllOptional = z.object({ note: z.string().optional() })
    const req = buildRequest('')
    const r = await validateRequest(req, { schema: AllOptional })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.data.note, undefined)
  })
})
