/**
 * Tests for the Spec 007 Phase F.2 storage abstraction
 * (`packages/sdk/src/storage/index.ts`).
 *
 * Three concerns covered:
 *   1. `resolveStorageBackend` — env precedence (per-service > generic > sqlite fallback).
 *   2. `assertProductionStorageBackend` — production refuses SQLite; refuses sqlite:// URLs.
 *   3. `consumeNonceSqlite` / `consumeNoncePostgres` — replay rejection semantics.
 *
 * The Postgres helper is exercised via a hand-mocked `PgSqlLike`; we
 * don't need a live Postgres to assert the query shape + return semantics.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveStorageBackend,
  assertProductionStorageBackend,
  consumeNonceSqlite,
  consumeNoncePostgres,
  type PgSqlLike,
  type SqliteHandleLike,
} from '../storage'

describe('storage / resolveStorageBackend', () => {
  it('returns pg when service-specific PG_URL is set', () => {
    const backend = resolveStorageBackend(
      { A2A_AGENT_PG_URL: 'postgres://u:p@host:5432/a2a_agent' },
      'A2A_AGENT',
      'local.db',
    )
    assert.equal(backend.kind, 'pg')
    if (backend.kind === 'pg') {
      assert.equal(backend.url, 'postgres://u:p@host:5432/a2a_agent')
    }
  })

  it('falls back to DATABASE_URL when it is a postgres:// URL', () => {
    const backend = resolveStorageBackend(
      { DATABASE_URL: 'postgresql://u:p@host:5432/foo' },
      'A2A_AGENT',
      'local.db',
    )
    assert.equal(backend.kind, 'pg')
    if (backend.kind === 'pg') {
      assert.equal(backend.url, 'postgresql://u:p@host:5432/foo')
    }
  })

  it('falls back to sqlite when no env vars are set', () => {
    const backend = resolveStorageBackend({}, 'A2A_AGENT', 'local.db')
    assert.equal(backend.kind, 'sqlite')
    if (backend.kind === 'sqlite') {
      assert.equal(backend.path, 'local.db')
    }
  })

  it('falls back to sqlite when DATABASE_URL is a sqlite: URL', () => {
    const backend = resolveStorageBackend(
      { DATABASE_URL: 'sqlite:./data.db' },
      'PERSON_MCP',
      'person-mcp.db',
    )
    assert.equal(backend.kind, 'sqlite')
    if (backend.kind === 'sqlite') {
      assert.equal(backend.path, 'person-mcp.db')
    }
  })

  it('per-service PG_URL wins over DATABASE_URL', () => {
    const backend = resolveStorageBackend(
      {
        DATABASE_URL: 'postgres://generic',
        PERSON_MCP_PG_URL: 'postgres://specific',
      },
      'PERSON_MCP',
      'person-mcp.db',
    )
    assert.equal(backend.kind, 'pg')
    if (backend.kind === 'pg') {
      assert.equal(backend.url, 'postgres://specific')
    }
  })
})

describe('storage / assertProductionStorageBackend', () => {
  it('passes through pg backend in production', () => {
    const backend = assertProductionStorageBackend(
      {
        NODE_ENV: 'production',
        A2A_AGENT_PG_URL: 'postgres://u:p@host:5432/a2a_agent',
      },
      'A2A_AGENT',
      'local.db',
    )
    assert.equal(backend.kind, 'pg')
  })

  it('throws in production when no PG URL is set', () => {
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

  it('throws in production when PG_URL has sqlite scheme', () => {
    assert.throws(
      () =>
        assertProductionStorageBackend(
          {
            NODE_ENV: 'production',
            A2A_AGENT_PG_URL: 'sqlite:./bad.db',
          },
          'A2A_AGENT',
          'local.db',
        ),
      /non-Postgres scheme/,
    )
  })

  it('throws in production when ALLOW_SQLITE_FOR_TESTS is set', () => {
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

  it('permits sqlite backend in dev', () => {
    const backend = assertProductionStorageBackend({}, 'A2A_AGENT', 'local.db')
    assert.equal(backend.kind, 'sqlite')
  })
})

describe('storage / consumeNonceSqlite', () => {
  /**
   * Mock the better-sqlite3 surface — `prepare(sql)` returns a stmt, and
   * `run(...args)` returns a `{ changes }` object. We track which nonces
   * have been seen to simulate UNIQUE constraint behavior.
   */
  function mockHandle(seen: Set<string>): SqliteHandleLike {
    return {
      prepare(_sql: string) {
        return {
          run: (...args: unknown[]) => {
            // Layout depends on scopeColumn:
            //   3 args: (scope, nonce, used_at)
            //   2 args: (nonce, used_at)
            const nonce = args.length === 3 ? (args[1] as string) : (args[0] as string)
            const scope =
              args.length === 3 ? (args[0] as string) : '__no_scope__'
            const key = `${scope}::${nonce}`
            if (seen.has(key)) return { changes: 0 }
            seen.add(key)
            return { changes: 1 }
          },
          get: () => undefined,
        }
      },
    }
  }

  it('first insert returns true (nonce accepted)', () => {
    const seen = new Set<string>()
    const ok = consumeNonceSqlite({
      sqliteHandle: mockHandle(seen),
      table: 'inter_service_nonce',
      scopeColumn: 'service',
      scope: 'a2a',
      nonce: 'n1',
    })
    assert.equal(ok, true)
  })

  it('second insert with same scope+nonce returns false (replay rejected)', () => {
    const seen = new Set<string>()
    const handle = mockHandle(seen)
    consumeNonceSqlite({
      sqliteHandle: handle,
      table: 'inter_service_nonce',
      scopeColumn: 'service',
      scope: 'a2a',
      nonce: 'n1',
    })
    const second = consumeNonceSqlite({
      sqliteHandle: handle,
      table: 'inter_service_nonce',
      scopeColumn: 'service',
      scope: 'a2a',
      nonce: 'n1',
    })
    assert.equal(second, false)
  })

  it('same nonce different scope returns true (different rows)', () => {
    const seen = new Set<string>()
    const handle = mockHandle(seen)
    consumeNonceSqlite({
      sqliteHandle: handle,
      table: 'inter_service_nonce',
      scopeColumn: 'service',
      scope: 'a2a',
      nonce: 'n1',
    })
    const cross = consumeNonceSqlite({
      sqliteHandle: handle,
      table: 'inter_service_nonce',
      scopeColumn: 'service',
      scope: 'web',
      nonce: 'n1',
    })
    assert.equal(cross, true)
  })

  it('nonce-only mode (scopeColumn null) works for legacy verifier table', () => {
    const seen = new Set<string>()
    const handle = mockHandle(seen)
    const first = consumeNonceSqlite({
      sqliteHandle: handle,
      table: 'consumed_nonces',
      scopeColumn: null,
      scope: 'unused',
      nonce: 'n1',
    })
    assert.equal(first, true)
    const second = consumeNonceSqlite({
      sqliteHandle: handle,
      table: 'consumed_nonces',
      scopeColumn: null,
      scope: 'unused',
      nonce: 'n1',
    })
    assert.equal(second, false)
  })

  it('throws on empty nonce', () => {
    assert.throws(
      () =>
        consumeNonceSqlite({
          sqliteHandle: mockHandle(new Set()),
          table: 'inter_service_nonce',
          scopeColumn: 'service',
          scope: 'a2a',
          nonce: '',
        }),
      /nonce must be non-empty/,
    )
  })
})

describe('storage / consumeNoncePostgres', () => {
  /**
   * Mock the postgres surface. We track which `(scope, nonce)` pairs
   * have been "inserted" and return `[{used_at}]` when fresh, `[]` when
   * the ON CONFLICT clause would fire.
   */
  function mockSql(seen: Set<string>): PgSqlLike {
    const fn: PgSqlLike = (() => {
      throw new Error('not used in test (we only call .unsafe)')
    }) as unknown as PgSqlLike
    fn.unsafe = async <T = unknown>(query: string, values?: unknown[]) => {
      // Heuristic: detect scopeColumn-null shape by counting placeholders
      // We sent VALUES ($1, $2, $3) for compound; VALUES ($1, $2) for nonce-only.
      const hasScope = /VALUES \(\$1, \$2, \$3\)/.test(query)
      const v = values ?? []
      const nonce = hasScope ? (v[1] as string) : (v[0] as string)
      const scope = hasScope ? (v[0] as string) : '__no_scope__'
      const key = `${scope}::${nonce}`
      if (seen.has(key)) return [] as T[]
      seen.add(key)
      return [{ used_at: new Date() } as unknown as T]
    }
    return fn
  }

  it('first insert returns true (nonce accepted)', async () => {
    const seen = new Set<string>()
    const ok = await consumeNoncePostgres({
      sql: mockSql(seen),
      table: 'inter_service_nonces',
      scopeColumn: 'scope',
      scope: 'a2a',
      nonce: 'n1',
    })
    assert.equal(ok, true)
  })

  it('replay returns false', async () => {
    const seen = new Set<string>()
    const sql = mockSql(seen)
    await consumeNoncePostgres({
      sql,
      table: 'inter_service_nonces',
      scopeColumn: 'scope',
      scope: 'a2a',
      nonce: 'n1',
    })
    const second = await consumeNoncePostgres({
      sql,
      table: 'inter_service_nonces',
      scopeColumn: 'scope',
      scope: 'a2a',
      nonce: 'n1',
    })
    assert.equal(second, false)
  })

  it('rejects invalid table name (defensive against injection)', async () => {
    await assert.rejects(
      () =>
        consumeNoncePostgres({
          sql: mockSql(new Set()),
          table: 'inter_service_nonces; DROP TABLE users;',
          scopeColumn: 'scope',
          scope: 'a2a',
          nonce: 'n1',
        }),
      /invalid table name/,
    )
  })

  it('rejects invalid scope column name', async () => {
    await assert.rejects(
      () =>
        consumeNoncePostgres({
          sql: mockSql(new Set()),
          table: 'inter_service_nonces',
          scopeColumn: 'scope; DROP' as 'scope',
          scope: 'a2a',
          nonce: 'n1',
        }),
      /invalid scope column/,
    )
  })

  it('throws on empty nonce', async () => {
    await assert.rejects(
      () =>
        consumeNoncePostgres({
          sql: mockSql(new Set()),
          table: 'inter_service_nonces',
          scopeColumn: 'scope',
          scope: 'a2a',
          nonce: '',
        }),
      /nonce must be non-empty/,
    )
  })

  it('nonce-only mode works for legacy verifier table', async () => {
    const seen = new Set<string>()
    const sql = mockSql(seen)
    const first = await consumeNoncePostgres({
      sql,
      table: 'consumed_nonces',
      scopeColumn: null,
      scope: 'unused',
      nonce: 'n1',
    })
    assert.equal(first, true)
    const second = await consumeNoncePostgres({
      sql,
      table: 'consumed_nonces',
      scopeColumn: null,
      scope: 'unused',
      nonce: 'n1',
    })
    assert.equal(second, false)
  })
})
