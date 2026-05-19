/**
 * Spec 007 Phase F.2 — production storage guard test.
 *
 * Asserts the `assertProductionStorageBackend` helper from the SDK refuses
 * to boot a2a-agent in `NODE_ENV='production'` without a Postgres URL —
 * the canonical anti-SQLite-in-production invariant.
 *
 * The guard is wired in `apps/a2a-agent/src/index.ts` before the HTTP
 * listener binds. We exercise the underlying helper directly with
 * synthesized env maps so the test doesn't have to spawn the full
 * service.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertProductionStorageBackend } from '@smart-agent/sdk'

describe('Phase F.2 — production storage backend guard', () => {
  it('production without A2A_AGENT_PG_URL → refuses to boot', () => {
    assert.throws(
      () =>
        assertProductionStorageBackend(
          { NODE_ENV: 'production' },
          'A2A_AGENT',
          'local.db',
        ),
      /Production refuses to start without Postgres/,
    )
  })

  it('production with sqlite-scheme URL → refuses to boot', () => {
    assert.throws(
      () =>
        assertProductionStorageBackend(
          { NODE_ENV: 'production', A2A_AGENT_PG_URL: 'sqlite:./local.db' },
          'A2A_AGENT',
          'local.db',
        ),
      /non-Postgres scheme/,
    )
  })

  it('production with file: URL → refuses to boot', () => {
    assert.throws(
      () =>
        assertProductionStorageBackend(
          { NODE_ENV: 'production', A2A_AGENT_PG_URL: 'file:./local.db' },
          'A2A_AGENT',
          'local.db',
        ),
      /non-Postgres scheme/,
    )
  })

  it('production with Postgres URL → passes', () => {
    const result = assertProductionStorageBackend(
      {
        NODE_ENV: 'production',
        A2A_AGENT_PG_URL: 'postgres://u:p@host:5432/a2a_agent',
      },
      'A2A_AGENT',
      'local.db',
    )
    assert.equal(result.kind, 'pg')
  })

  it('production with ALLOW_SQLITE_FOR_TESTS=true → refuses to boot', () => {
    // Even if a Postgres URL is set, ALLOW_SQLITE_FOR_TESTS in production
    // is a hard refuse — the env var is meant for test-only contexts.
    assert.throws(
      () =>
        assertProductionStorageBackend(
          {
            NODE_ENV: 'production',
            ALLOW_SQLITE_FOR_TESTS: 'true',
            A2A_AGENT_PG_URL: 'postgres://u:p@host:5432/a2a_agent',
          },
          'A2A_AGENT',
          'local.db',
        ),
      /ALLOW_SQLITE_FOR_TESTS=true is set in NODE_ENV='production'/,
    )
  })

  it('dev (NODE_ENV undefined) → SQLite fallback permitted', () => {
    const result = assertProductionStorageBackend(
      {},
      'A2A_AGENT',
      'local.db',
    )
    assert.equal(result.kind, 'sqlite')
  })

  it('dev with A2A_AGENT_PG_URL → uses Postgres', () => {
    // Developer who wants Postgres locally just sets the env var.
    const result = assertProductionStorageBackend(
      { A2A_AGENT_PG_URL: 'postgres://dev:dev@localhost:5432/a2a_agent' },
      'A2A_AGENT',
      'local.db',
    )
    assert.equal(result.kind, 'pg')
  })
})
