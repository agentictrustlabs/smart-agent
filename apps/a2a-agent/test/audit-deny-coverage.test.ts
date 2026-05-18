/**
 * Sprint 5 Wave 2 P0-4 — coverage assertion: every 4xx/5xx exit in
 * the high-risk routes goes through `denyAndAudit(...)`. NOT through a
 * raw `c.json(..., 4xx)` or `c.json(..., 5xx)` call.
 *
 * Why a static scan?
 *   The parity test (`audit-deny-parity-redeem.test.ts`) drives one
 *   request per branch and asserts an audit row exists. It can only
 *   cover branches that are reachable without an active session, full
 *   delegation fixture, deployed contracts, etc. The deeper branches
 *   (`policy:target-not-allowed`, `tx:reverted`, `executor:resolution-
 *   failed`, …) live behind several layers of setup.
 *
 *   This test fills the gap: a regex sweep of each route source file
 *   asserts that NO bare `return c.json(..., 4xx_or_5xx)` survives.
 *   The bypass-guard script enforces the same invariant in CI; this
 *   test gives developers a fast in-test failure when they regress.
 *
 *   We also assert that EVERY `denyAndAudit(` call site uses a reason
 *   string drawn from `AUDIT_DENY_REASONS`. TypeScript already enforces
 *   this at compile time (the helper takes `reason: AuditDenyReason`),
 *   but a runtime literal-set scan catches any future `as` cast that
 *   slips a hand-rolled reason past the type checker.
 *
 * Run:
 *   node --import tsx --test apps/a2a-agent/test/audit-deny-coverage.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUDIT_DENY_REASONS } from '../src/lib/audit-deny-reasons'

// __dirname-equivalent that works under both CJS-transpile and ESM-tsx.
// `import.meta.url` is always defined; under CJS tsx it still produces
// a valid file:// URL, so `fileURLToPath` round-trips back to a path.
const THIS_FILE_DIR = dirname(fileURLToPath(import.meta.url))

// Files in scope: the redeem variants + deploy-agent all live in
// `onchain-redeem.ts`. The list is open-ended — future routes that
// mint on-chain action should be added here as they land.
const FILES_IN_SCOPE = [
  'src/routes/onchain-redeem.ts',
] as const

function readScopeFile(rel: string): string {
  return readFileSync(join(THIS_FILE_DIR, '..', rel), 'utf8')
}

/**
 * Walk a source string line-by-line, splitting block- and line-comments
 * so we don't count comment-line examples. Returns the array of
 * "content lines" suitable for regex testing.
 */
function stripComments(src: string): string[] {
  const out: string[] = []
  let inBlock = false
  for (const line of src.split('\n')) {
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end >= 0) {
        inBlock = false
        // Anything after the comment close still counts.
        out.push(line.slice(end + 2))
      }
      // Otherwise the whole line is comment — skip.
      continue
    }
    // Strip line comments (`// …`) at start of trimmed line.
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
    // Block comment opens here?
    const open = line.indexOf('/*')
    if (open >= 0) {
      const close = line.indexOf('*/', open + 2)
      if (close >= 0) {
        // Single-line block comment — keep surrounding text.
        out.push(line.slice(0, open) + line.slice(close + 2))
      } else {
        inBlock = true
        out.push(line.slice(0, open))
      }
      continue
    }
    out.push(line)
  }
  return out
}

// ─── 1. No bare 4xx/5xx exits ────────────────────────────────────────

test('P0-4 coverage — no raw `c.json(..., 4xx|5xx)` in routes in scope', () => {
  // Pattern matches: `c.json(<anything>, <digit><digit><digit>)`
  // where the status starts with 4 or 5. This catches every shape:
  //   return c.json({ error }, 400)
  //   return c.json(body, 403)
  //   return c.json({ … }, 502)
  const bare = /c\.json\([^)]*,\s*[45]\d{2}\s*\)/

  for (const rel of FILES_IN_SCOPE) {
    const src = readScopeFile(rel)
    const lines = stripComments(src)
    const violations: string[] = []
    for (let i = 0; i < lines.length; i++) {
      if (bare.test(lines[i]!)) {
        violations.push(`  ${rel}:~${i + 1}  ${lines[i]!.trim()}`)
      }
    }
    if (violations.length > 0) {
      assert.fail(
        'P0-4 violation — every 4xx/5xx exit in scope must use denyAndAudit(...):\n' +
          violations.join('\n'),
      )
    }
  }
})

// ─── 2. No bare `throw errorResponse(…)` outside denyAndAudit ──────

test('P0-4 coverage — no raw `errorResponse(...)` in routes in scope', () => {
  // The `errorResponse(...)` helper is for non-redeem routes; in the
  // routes in scope, every failure MUST go through `denyAndAudit`.
  const bare = /\berrorResponse\s*\(/
  for (const rel of FILES_IN_SCOPE) {
    const src = readScopeFile(rel)
    const lines = stripComments(src)
    const violations: string[] = []
    for (let i = 0; i < lines.length; i++) {
      if (bare.test(lines[i]!)) {
        violations.push(`  ${rel}:~${i + 1}  ${lines[i]!.trim()}`)
      }
    }
    if (violations.length > 0) {
      assert.fail(
        'P0-4 violation — errorResponse() must not appear in routes in scope:\n' +
          violations.join('\n'),
      )
    }
  }
})

// ─── 3. Every denyAndAudit(...) call uses a reason from AUDIT_DENY_REASONS ─

test('P0-4 coverage — every denyAndAudit(...) reason is registered', () => {
  // Match every `reason: '<literal>'` directly under a denyAndAudit
  // call. Multi-line: capture the literal inside single quotes that
  // follows `reason:` within the immediate object literal after each
  // `denyAndAudit(`. Reasons that are computed via a helper function
  // (e.g. `reason: sessionErrorToReason(sess.error)`) are returned as
  // `AuditDenyReason` from a typed helper — TypeScript enforces the
  // union at the call site, so we accept the function-call form here
  // and validate the helper's return values at the unit-test layer.
  const denyRe = /denyAndAudit\s*\(\s*c\s*,\s*\{([\s\S]*?)\}\s*\)/g
  const literalReasonRe = /reason:\s*'([^']+)'/
  const fnReasonRe = /reason:\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\(/

  for (const rel of FILES_IN_SCOPE) {
    const src = readScopeFile(rel)
    const stripped = stripComments(src).join('\n')
    let m: RegExpExecArray | null
    const seenLiterals: string[] = []
    let totalCalls = 0
    while ((m = denyRe.exec(stripped)) !== null) {
      totalCalls += 1
      const inner = m[1]!
      const rm = literalReasonRe.exec(inner)
      if (rm) {
        seenLiterals.push(rm[1]!)
        continue
      }
      const fm = fnReasonRe.exec(inner)
      if (fm) continue // typed-helper form, accepted
      assert.fail(
        `denyAndAudit(...) call in ${rel} has neither a string-literal nor a ` +
          `helper-call reason:\n${m[0]}`,
      )
    }
    assert.ok(totalCalls > 0, `expected ≥1 denyAndAudit(...) call in ${rel}`)
    assert.ok(seenLiterals.length > 0, `expected ≥1 literal reason in ${rel}`)
    for (const reason of seenLiterals) {
      assert.ok(
        (AUDIT_DENY_REASONS as readonly string[]).includes(reason),
        `denyAndAudit reason "${reason}" in ${rel} is not in AUDIT_DENY_REASONS — ` +
          `add it to apps/a2a-agent/src/lib/audit-deny-reasons.ts`,
      )
    }
  }
})

// ─── 4. Every route handler has an outer try/catch wrapping denyAndAudit ─

test('P0-4 coverage — every onchainRedeem.post handler ends with `error:unhandled` catch', () => {
  // Each `onchainRedeem.post('/<path>'…)` route must have at least one
  // `reason: 'error:unhandled'` denyAndAudit call (the outer catch).
  // We count route definitions and unhandled-catch sites and assert
  // they match.
  const src = readScopeFile('src/routes/onchain-redeem.ts')
  const stripped = stripComments(src).join('\n')

  const routeRe = /onchainRedeem\.post\(/g
  const routeCount = (stripped.match(routeRe) || []).length
  assert.ok(routeCount >= 5, `expected ≥5 onchainRedeem.post(...) routes, got ${routeCount}`)

  const unhandledRe = /reason:\s*'error:unhandled'/g
  const unhandledCount = (stripped.match(unhandledRe) || []).length
  assert.equal(
    unhandledCount,
    routeCount,
    `each route must wrap its handler in a try/catch whose catch calls denyAndAudit(reason:'error:unhandled'); ` +
      `expected ${routeCount}, found ${unhandledCount}`,
  )
})
