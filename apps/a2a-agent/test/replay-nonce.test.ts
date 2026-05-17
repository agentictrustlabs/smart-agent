/**
 * Tests for `apps/a2a-agent/src/auth/replay-nonce.ts`
 * (Hardening §1.10 Stream B Task B2).
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/replay-nonce.test.ts`
 *
 * Covers:
 *   - first INSERT of a fresh nonce → accepted (returns true)
 *   - second INSERT of the SAME nonce → rejected (returns false)
 *   - distinct nonces across different services → both accepted
 *   - too-short nonce → rejected (defends against accidentally empty
 *     defaults that would silently degrade replay protection)
 *   - cleanup removes only rows older than maxAgeSeconds
 *
 * The replay-nonce table is auto-created by `apps/a2a-agent/src/db/index.ts`
 * at module load; tests reuse the dev SQLite file. Each test uses a
 * fresh randomUUID() so re-runs don't collide.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { recordNonce, cleanupOldNonces } from '../src/auth/replay-nonce'
import { db } from '../src/db'
import { interServiceNonce } from '../src/db/schema'
import { sql } from 'drizzle-orm'

test('first INSERT of a fresh nonce is accepted', () => {
  const nonce = randomUUID()
  const ok = recordNonce(nonce, 'web')
  assert.equal(ok, true)
})

test('same nonce twice → second is rejected', () => {
  const nonce = randomUUID()
  const first = recordNonce(nonce, 'web')
  const second = recordNonce(nonce, 'web')
  assert.equal(first, true)
  assert.equal(second, false)
})

test('same nonce across different services → still rejected (table is global)', () => {
  // The nonce table is keyed on `nonce`, not `(service, nonce)`. A
  // malicious caller can't claim the nonce was "for a different
  // service" and replay it. This is the intended design.
  const nonce = randomUUID()
  const first = recordNonce(nonce, 'web')
  const second = recordNonce(nonce, 'org-mcp')
  assert.equal(first, true)
  assert.equal(second, false)
})

test('distinct nonces are accepted independently', () => {
  const n1 = randomUUID()
  const n2 = randomUUID()
  assert.equal(recordNonce(n1, 'web'), true)
  assert.equal(recordNonce(n2, 'web'), true)
})

test('too-short nonce is rejected', () => {
  assert.equal(recordNonce('', 'web'), false)
  assert.equal(recordNonce('short', 'web'), false)
})

test('cleanup removes only rows older than maxAgeSeconds', () => {
  const oldNonce = randomUUID()
  const freshNonce = randomUUID()
  // Insert oldNonce manually with a timestamp far in the past.
  const oldTs = new Date(Date.now() - 60 * 60 * 1000).toISOString()  // 1 hour ago
  db.insert(interServiceNonce)
    .values({ nonce: oldNonce, service: 'web', usedAt: oldTs })
    .run()
  // Insert freshNonce via the normal path (current time).
  assert.equal(recordNonce(freshNonce, 'web'), true)

  // Cleanup with a 10-minute cutoff → oldNonce should be evicted,
  // freshNonce should remain.
  const deleted = cleanupOldNonces(10 * 60)
  assert.ok(deleted >= 1, `expected at least 1 row deleted, got ${deleted}`)

  const oldStillPresent = db
    .select()
    .from(interServiceNonce)
    .where(sql`${interServiceNonce.nonce} = ${oldNonce}`)
    .all()
  assert.equal(oldStillPresent.length, 0, 'old nonce should have been evicted')

  const freshStillPresent = db
    .select()
    .from(interServiceNonce)
    .where(sql`${interServiceNonce.nonce} = ${freshNonce}`)
    .all()
  assert.equal(freshStillPresent.length, 1, 'fresh nonce should still be present')
})
