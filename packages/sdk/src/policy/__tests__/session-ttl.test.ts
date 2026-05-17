/**
 * Tests for session-ttl.ts (HARDENING-PLAN §1.5 #7 / C2).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clampSessionTtl, MAX_SESSION_TTL_SEC } from '../session-ttl'

describe('clampSessionTtl', () => {
  it('returns the request when it is below the cap', () => {
    assert.equal(clampSessionTtl(60, 'medium'), 60)
  })

  it('clamps a 1-year request to the medium cap (7 days)', () => {
    const oneYear = 365 * 24 * 60 * 60
    assert.equal(clampSessionTtl(oneYear, 'medium'), MAX_SESSION_TTL_SEC.medium)
  })

  it('clamps a 1-year request to the low cap (30 days)', () => {
    const oneYear = 365 * 24 * 60 * 60
    assert.equal(clampSessionTtl(oneYear, 'low'), MAX_SESSION_TTL_SEC.low)
  })

  it('clamps a 1-year request to the high cap (1 day)', () => {
    const oneYear = 365 * 24 * 60 * 60
    assert.equal(clampSessionTtl(oneYear, 'high'), MAX_SESSION_TTL_SEC.high)
  })

  it('clamps a 1-year request to the sensitive cap (4 hours)', () => {
    const oneYear = 365 * 24 * 60 * 60
    assert.equal(clampSessionTtl(oneYear, 'sensitive'), MAX_SESSION_TTL_SEC.sensitive)
  })

  it('defaults to medium when tier is omitted', () => {
    const oneYear = 365 * 24 * 60 * 60
    assert.equal(clampSessionTtl(oneYear), MAX_SESSION_TTL_SEC.medium)
  })

  it('returns the cap when the requested duration is zero/negative/NaN', () => {
    assert.equal(clampSessionTtl(0, 'medium'), MAX_SESSION_TTL_SEC.medium)
    assert.equal(clampSessionTtl(-1, 'medium'), MAX_SESSION_TTL_SEC.medium)
    assert.equal(clampSessionTtl(Number.NaN, 'medium'), MAX_SESSION_TTL_SEC.medium)
  })

  it('floors fractional durations', () => {
    assert.equal(clampSessionTtl(60.7, 'medium'), 60)
  })

  it('cap ordering: sensitive < high < medium < low', () => {
    assert.ok(MAX_SESSION_TTL_SEC.sensitive < MAX_SESSION_TTL_SEC.high)
    assert.ok(MAX_SESSION_TTL_SEC.high < MAX_SESSION_TTL_SEC.medium)
    assert.ok(MAX_SESSION_TTL_SEC.medium < MAX_SESSION_TTL_SEC.low)
  })
})
