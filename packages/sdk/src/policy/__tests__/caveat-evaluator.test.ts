/**
 * Tests for the off-chain caveat evaluator.
 *
 * Run with:
 *   pnpm --filter @smart-agent/sdk exec node --import tsx --test \
 *     src/policy/__tests__/caveat-evaluator.test.ts
 *
 * The fixtures below pick deliberately memorable hex addresses so the
 * dispatch logic is easy to follow when reading test output:
 *
 *   0x...timestamp     0x0000000000000000000000000000000000007a51 (timestamp)
 *   0x...allowed       0x000000000000000000000000000000000000a110 (allowed targets)
 *   0x...methods       0x000000000000000000000000000000000000fede (methods)
 *   0x...value         0x000000000000000000000000000000000000ee11 (value)
 *
 * Unknown enforcers use a sentinel that's NOT registered in the
 * override map — they MUST be rejected.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateCaveats,
  firstDenial,
  type CaveatContext,
  type EnforcerAddressMap,
  type CaveatLike,
} from '../caveat-evaluator'
import {
  encodeTimestampTerms,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  encodeValueTerms,
  encodeMcpToolScopeTerms,
  MCP_TOOL_SCOPE_ENFORCER,
} from '../../delegation'

// ─── Fixtures ────────────────────────────────────────────────────────

const TIMESTAMP_ENFORCER = '0x0000000000000000000000000000000000007a51' as const
const ALLOWED_TARGETS_ENFORCER = '0x000000000000000000000000000000000000a110' as const
const ALLOWED_METHODS_ENFORCER = '0x000000000000000000000000000000000000fede' as const
const VALUE_ENFORCER = '0x000000000000000000000000000000000000ee11' as const

const OVERRIDES: EnforcerAddressMap = {
  timestamp: TIMESTAMP_ENFORCER,
  allowedTargets: ALLOWED_TARGETS_ENFORCER,
  allowedMethods: ALLOWED_METHODS_ENFORCER,
  value: VALUE_ENFORCER,
  // mcpToolScope + dataScope default to the SDK sentinel constants.
}

function baseCtx(overrides: Partial<CaveatContext> = {}): CaveatContext {
  return {
    mcpTool: 'pool:create',
    principal: '0x1111111111111111111111111111111111111111',
    timestamp: 1_800_000_000, // far enough in the future to not collide with any default
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('evaluateCaveats — fail-closed dispatcher', () => {
  it('rejects an unknown enforcer (no entry in the dispatch table)', () => {
    const unknown: CaveatLike = {
      enforcer: '0x000000000000000000000000000000000000dead',
      terms: '0x',
    }
    const verdicts = evaluateCaveats([unknown], baseCtx(), OVERRIDES)
    assert.equal(verdicts.length, 1)
    assert.equal(verdicts[0].allowed, false)
    assert.equal(verdicts[0].reason, 'unknown enforcer')
    assert.equal(verdicts[0].enforcer.toLowerCase(), unknown.enforcer.toLowerCase())
  })

  it('rejects a timestamp caveat whose window has expired', () => {
    const ts = baseCtx().timestamp
    const expired: CaveatLike = {
      enforcer: TIMESTAMP_ENFORCER,
      terms: encodeTimestampTerms(ts - 1_000, ts - 10), // window already closed
    }
    const verdicts = evaluateCaveats([expired], baseCtx(), OVERRIDES)
    assert.equal(verdicts.length, 1)
    assert.equal(verdicts[0].allowed, false)
    assert.match(verdicts[0].reason ?? '', /expired/)
  })

  it('rejects a timestamp caveat that is not yet valid', () => {
    const ts = baseCtx().timestamp
    const future: CaveatLike = {
      enforcer: TIMESTAMP_ENFORCER,
      terms: encodeTimestampTerms(ts + 1_000, ts + 10_000),
    }
    const verdicts = evaluateCaveats([future], baseCtx(), OVERRIDES)
    assert.equal(verdicts[0].allowed, false)
    assert.match(verdicts[0].reason ?? '', /not yet valid/)
  })

  it('accepts a timestamp caveat whose window covers now', () => {
    const ts = baseCtx().timestamp
    const valid: CaveatLike = {
      enforcer: TIMESTAMP_ENFORCER,
      terms: encodeTimestampTerms(ts - 100, ts + 100),
    }
    const verdicts = evaluateCaveats([valid], baseCtx(), OVERRIDES)
    assert.equal(verdicts[0].allowed, true)
  })

  it('rejects when target is not in AllowedTargets', () => {
    const wrongTarget = '0x9999999999999999999999999999999999999999' as const
    const allowed = '0x2222222222222222222222222222222222222222' as const
    const caveat: CaveatLike = {
      enforcer: ALLOWED_TARGETS_ENFORCER,
      terms: encodeAllowedTargetsTerms([allowed]),
    }
    const verdicts = evaluateCaveats([caveat], baseCtx({ target: wrongTarget }), OVERRIDES)
    assert.equal(verdicts.length, 1)
    assert.equal(verdicts[0].allowed, false)
    assert.match(verdicts[0].reason ?? '', /not in AllowedTargets/)
  })

  it('passes AllowedTargets when target matches', () => {
    const ok = '0x2222222222222222222222222222222222222222' as const
    const caveat: CaveatLike = {
      enforcer: ALLOWED_TARGETS_ENFORCER,
      terms: encodeAllowedTargetsTerms([ok]),
    }
    const verdicts = evaluateCaveats([caveat], baseCtx({ target: ok }), OVERRIDES)
    assert.equal(verdicts[0].allowed, true)
  })

  it('AllowedTargets is a no-op when target context is absent', () => {
    // The MCP boundary doesn't always have a target; deferring to the
    // on-chain redeem path is correct because the redeem handler in
    // a2a-agent re-evaluates against the actual call.
    const caveat: CaveatLike = {
      enforcer: ALLOWED_TARGETS_ENFORCER,
      terms: encodeAllowedTargetsTerms(['0x2222222222222222222222222222222222222222']),
    }
    const verdicts = evaluateCaveats([caveat], baseCtx(), OVERRIDES)
    assert.equal(verdicts[0].allowed, true)
  })

  it('rejects when selector is not in AllowedMethods', () => {
    const wantedSelector = '0xaabbccdd' as const
    const otherSelector = '0xdeadbeef' as const
    const caveat: CaveatLike = {
      enforcer: ALLOWED_METHODS_ENFORCER,
      terms: encodeAllowedMethodsTerms([wantedSelector]),
    }
    const verdicts = evaluateCaveats([caveat], baseCtx({ selector: otherSelector }), OVERRIDES)
    assert.equal(verdicts[0].allowed, false)
    assert.match(verdicts[0].reason ?? '', /not in AllowedMethods/)
  })

  it('rejects when value exceeds Value enforcer cap', () => {
    const cap = 1_000_000n
    const caveat: CaveatLike = {
      enforcer: VALUE_ENFORCER,
      terms: encodeValueTerms(cap),
    }
    const verdicts = evaluateCaveats([caveat], baseCtx({ value: cap + 1n }), OVERRIDES)
    assert.equal(verdicts[0].allowed, false)
    assert.match(verdicts[0].reason ?? '', /exceeds Value enforcer/)
  })

  it('rejects when McpToolScope does not list the current tool', () => {
    const caveat: CaveatLike = {
      enforcer: MCP_TOOL_SCOPE_ENFORCER,
      terms: encodeMcpToolScopeTerms(['some_other_tool']),
    }
    const verdicts = evaluateCaveats([caveat], baseCtx({ mcpTool: 'pool:create' }), OVERRIDES)
    assert.equal(verdicts[0].allowed, false)
    assert.match(verdicts[0].reason ?? '', /not in MCP tool scope/)
  })

  it('passes McpToolScope when current tool is listed', () => {
    const caveat: CaveatLike = {
      enforcer: MCP_TOOL_SCOPE_ENFORCER,
      terms: encodeMcpToolScopeTerms(['pool:create', 'pool:close']),
    }
    const verdicts = evaluateCaveats([caveat], baseCtx({ mcpTool: 'pool:create' }), OVERRIDES)
    assert.equal(verdicts[0].allowed, true)
  })

  it('rejects on the FIRST failing caveat via firstDenial', () => {
    const ts = baseCtx().timestamp
    const goodTimestamp: CaveatLike = {
      enforcer: TIMESTAMP_ENFORCER,
      terms: encodeTimestampTerms(ts - 100, ts + 100),
    }
    const badScope: CaveatLike = {
      enforcer: MCP_TOOL_SCOPE_ENFORCER,
      terms: encodeMcpToolScopeTerms(['some_other_tool']),
    }
    const verdict = firstDenial([goodTimestamp, badScope], baseCtx(), OVERRIDES)
    assert.ok(verdict)
    assert.equal(verdict!.allowed, false)
    assert.equal(verdict!.enforcer.toLowerCase(), MCP_TOOL_SCOPE_ENFORCER.toLowerCase())
  })

  it('firstDenial returns undefined when every caveat passes', () => {
    const ts = baseCtx().timestamp
    const caveats: CaveatLike[] = [
      { enforcer: TIMESTAMP_ENFORCER, terms: encodeTimestampTerms(ts - 100, ts + 100) },
      { enforcer: MCP_TOOL_SCOPE_ENFORCER, terms: encodeMcpToolScopeTerms(['pool:create']) },
    ]
    const verdict = firstDenial(caveats, baseCtx(), OVERRIDES)
    assert.equal(verdict, undefined)
  })
})
