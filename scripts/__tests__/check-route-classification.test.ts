/**
 * End-to-end tests for the route-classification lint check.
 *
 * The CLI script (`check-route-classification.ts`) hard-wires the
 * `apps/web/src/app/api` directory, so we test the library it consumes
 * — `parseAllRoutes` — against synthetic fixture trees under
 * `route-classification-fixtures/{good,bad}/`. This is the same code
 * path the CLI invokes, just pointed at a different root.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAllRoutes } from '../lib/route-classification-parser'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURES = resolve(__dirname, 'route-classification-fixtures')

describe('check-route-classification (fixture sweep)', () => {
  it('passes against the known-good fixture tree', () => {
    const results = parseAllRoutes(resolve(FIXTURES, 'good'), FIXTURES)
    const failures = results.filter((r) => !r.ok)
    assert.equal(
      failures.length,
      0,
      `expected zero failures, got: ${failures.map((f) => (!f.ok ? f.errors.join(';') : '')).join(' | ')}`,
    )
    // Sanity: the good fixture has 4 handlers (3 routes, one with GET+POST).
    assert.equal(results.length, 4)
  })

  it('fails against the bad fixture tree', () => {
    const results = parseAllRoutes(resolve(FIXTURES, 'bad'), FIXTURES)
    const failures = results.filter((r) => !r.ok)
    // bad/ has two route.ts files; each has exactly one classification
    // failure.
    assert.equal(failures.length, 2)
    const messages = failures.flatMap((f) => (!f.ok ? f.errors : []))
    assert.ok(messages.some((m) => /missing required tag: @sa-route/.test(m)
      || /no JSDoc classification block found/.test(m)))
    assert.ok(messages.some((m) => /dev-only requires @sa-prod-gate/.test(m)))
  })

  it('produces records whose apiPath matches the fixture file layout', () => {
    const results = parseAllRoutes(resolve(FIXTURES, 'good'), FIXTURES)
    const paths = new Set(
      results.filter((r) => r.ok).map((r) => (r.ok ? r.record.apiPath : '')),
    )
    assert.ok(paths.has('/api/system-readiness'))
    assert.ok(paths.has('/api/auth/session'))
    assert.ok(paths.has('/api/boot-seed'))
  })
})
