/**
 * Tests for /api/agents/governance auth + body validation (Sprint 3
 * S3.4 / S2.7 closure).
 *
 * The route's chain side-effects are intentionally NOT exercised here
 * — testing through viem against a fork would mean booting anvil for
 * a unit test. Instead we drive the pieces that the senior review
 * cared about:
 *
 *   - the body schema (the discriminated union of governance actions)
 *   - the authorisation policy (self / owner / bootstrap rule)
 *   - body-size capping (413 path) — verified via the helper directly
 *
 * The route file imports `getSession`, `requireOriginAllowed`,
 * `getPublicClient` etc. — exercising the full handler would require
 * `--experimental-test-module-mocks` or a runtime DI seam neither of
 * which is in repo style. The auth model + schema are the load-bearing
 * pieces; they get unit coverage here and an e2e harness will pick up
 * the chain side later (out of scope for this PR).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  GovernanceBodySchema,
  GOVERNANCE_BODY_LIMIT_BYTES,
  checkAuthorization,
} from '../route'
import { validateRequest } from '@/lib/auth/validate-request'

const AGENT = '0x1111111111111111111111111111111111111111' as const
const OWNER_A = '0x2222222222222222222222222222222222222222' as const
const OWNER_B = '0x3333333333333333333333333333333333333333' as const
const STRANGER = '0x4444444444444444444444444444444444444444' as const

function buildRequest(body: unknown): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('https://example.test/api/agents/governance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: text,
  })
}

describe('GovernanceBodySchema — Sprint 3 S3.4', () => {
  it('accepts a well-formed initialize body', () => {
    const r = GovernanceBodySchema.safeParse({
      action: 'initialize', agentAddress: AGENT, minOwners: 1, quorum: 1,
    })
    assert.equal(r.success, true)
  })

  it('rejects when action discriminator is unknown', () => {
    const r = GovernanceBodySchema.safeParse({
      action: 'overthrow', agentAddress: AGENT,
    })
    assert.equal(r.success, false)
  })

  it('rejects addOwner without newOwner', () => {
    const r = GovernanceBodySchema.safeParse({
      action: 'addOwner', agentAddress: AGENT,
    })
    assert.equal(r.success, false)
  })

  it('rejects setQuorum with non-positive quorum', () => {
    const r = GovernanceBodySchema.safeParse({
      action: 'setQuorum', agentAddress: AGENT, newQuorum: 0,
    })
    assert.equal(r.success, false)
  })

  it('rejects malformed addresses', () => {
    const r = GovernanceBodySchema.safeParse({
      action: 'addOwner', agentAddress: 'not-an-address', newOwner: OWNER_A,
    })
    assert.equal(r.success, false)
  })
})

describe('checkAuthorization — governance auth policy', () => {
  it('rejects when the session has no smart account', () => {
    const r = checkAuthorization({
      caller: null, agent: AGENT, action: 'addOwner',
      initialized: true, owners: [OWNER_A],
    })
    assert.notEqual(r, null)
    assert.equal(r?.status, 403)
  })

  it('allows the agent to govern itself (self-rule)', () => {
    const r = checkAuthorization({
      caller: AGENT, agent: AGENT, action: 'setQuorum',
      initialized: true, owners: [OWNER_A],
    })
    assert.equal(r, null)
  })

  it('allows a registered owner (case-insensitive)', () => {
    // Upper-case caller, lower-case owner — must still match.
    const r = checkAuthorization({
      caller: OWNER_A.toUpperCase() as `0x${string}`,
      agent: AGENT, action: 'setQuorum',
      initialized: true, owners: [OWNER_A.toLowerCase() as `0x${string}`, OWNER_B],
    })
    assert.equal(r, null)
  })

  it('rejects a non-owner stranger on addOwner', () => {
    const r = checkAuthorization({
      caller: STRANGER, agent: AGENT, action: 'addOwner',
      initialized: true, owners: [OWNER_A],
    })
    assert.notEqual(r, null)
    assert.equal(r?.status, 403)
  })

  it('allows the bootstrap initialize on an uninitialised agent', () => {
    // Chicken-and-egg: a fresh account needs to install its first
    // governance config and there are no owners yet to check against.
    const r = checkAuthorization({
      caller: STRANGER, agent: AGENT, action: 'initialize',
      initialized: false, owners: [],
    })
    assert.equal(r, null)
  })

  it('rejects initialize once governance is already set up', () => {
    // If `initialize` is called on an already-initialised contract the
    // on-chain function will revert — but we reject earlier so a
    // probing attacker doesn't even get to find that out.
    const r = checkAuthorization({
      caller: STRANGER, agent: AGENT, action: 'initialize',
      initialized: true, owners: [OWNER_A],
    })
    assert.notEqual(r, null)
    assert.equal(r?.status, 403)
  })

  it('does NOT extend the bootstrap exception to addOwner / setQuorum', () => {
    for (const action of ['addOwner', 'setQuorum'] as const) {
      const r = checkAuthorization({
        caller: STRANGER, agent: AGENT, action,
        initialized: false, owners: [],
      })
      assert.notEqual(r, null, `bootstrap should not allow ${action}`)
      assert.equal(r?.status, 403)
    }
  })
})

describe('governance body size cap', () => {
  it('rejects oversized bodies with 413 before any auth or schema runs', async () => {
    const huge = JSON.stringify({
      action: 'addOwner',
      agentAddress: AGENT,
      newOwner: OWNER_A,
      // 16 KiB of padding — bigger than GOVERNANCE_BODY_LIMIT_BYTES (4 KiB).
      _padding: 'x'.repeat(16 * 1024),
    })
    const req = buildRequest(huge)
    const r = await validateRequest(req, {
      schema: GovernanceBodySchema,
      maxBytes: GOVERNANCE_BODY_LIMIT_BYTES,
    })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.response.status, 413)
      const body = await r.response.json() as { error: string }
      assert.equal(body.error, 'Request body too large')
    }
    // Sanity: the cap is the constant the route advertises.
    assert.equal(GOVERNANCE_BODY_LIMIT_BYTES, 4 * 1024)
  })

  it('accepts a well-formed body under the cap', async () => {
    const req = buildRequest({
      action: 'initialize', agentAddress: AGENT, minOwners: 1, quorum: 1,
    })
    const r = await validateRequest(req, {
      schema: GovernanceBodySchema,
      maxBytes: GOVERNANCE_BODY_LIMIT_BYTES,
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.data.action, 'initialize')
    }
  })

  it('returns 400 (not 413) for a non-JSON body within the cap', async () => {
    const req = buildRequest('not-json-at-all')
    const r = await validateRequest(req, {
      schema: GovernanceBodySchema,
      maxBytes: GOVERNANCE_BODY_LIMIT_BYTES,
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.response.status, 400)
  })
})
