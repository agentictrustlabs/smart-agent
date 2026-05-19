#!/usr/bin/env tsx
/**
 * Spec 007 Phase G.2 — silent-catch-on-primitives lint.
 *
 * Disallows the dangerous shape:
 *
 *     try { … kmsCall / signMessage / signTypedData / signUserOp /
 *               writeContract / sendTransaction / executeUserOp /
 *               redeemDelegation / auditDeny / auditFinalize … }
 *     catch { /* empty *\/ }              ← always wrong
 *     catch { console.warn(…); return … } ← almost always wrong
 *
 * These are required architectural primitives — signing, on-chain writes,
 * audit-log writes. Silent failure on any of them is forbidden because
 * the only safe response is to surface the failure to the caller (or
 * audit-deny + re-throw). Swallowing it lets a user think their request
 * succeeded when it didn't — exactly the foot-gun memory
 * `feedback_seed_footguns.md` captures.
 *
 * The opt-out is a marker comment immediately above the catch block:
 *
 *     // eslint-disable-next-line silent-catch — observability only
 *     try { … } catch { console.warn(…) }
 *
 * The marker itself becomes a code-review flag; PR reviewers must
 * justify the observability-only rationale.
 *
 * Heuristic detection — we don't run a TS AST parser; instead we
 * regex-match the catch block opening line and look BACK up to N
 * previous lines for a `try {` opening and for one of the protected
 * primitive names. Imperfect but deterministic.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violation
 *   2 — internal failure
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')

// Roots to scan — apps/web/src, apps/a2a-agent/src, apps/*-mcp/src.
const APPS_DIR = join(REPO_ROOT, 'apps')

const SKIP_NAMES = new Set([
  'node_modules', 'dist', '.next', 'coverage', 'lib', 'out', 'build',
  '__tests__', 'test', 'tests',
])

// Architectural primitives — silent failure on any of these breaks the
// trust model. Names are matched as bare identifiers in a function-call
// position (so `signMessage(` matches but `signMessageRef.toString()`
// does not).
const PROTECTED_PRIMITIVES = [
  'kmsCall',
  'signMessage',
  'signTypedData',
  'signUserOp',
  'writeContract',
  'sendTransaction',
  'executeUserOp',
  'redeemDelegation',
  'auditDeny',
  'auditFinalize',
  'auditAppend',
]

const PRIMITIVE_RE = new RegExp(`\\b(${PROTECTED_PRIMITIVES.join('|')})\\s*\\(`)

// Marker comment that opts out of the lint (and itself triggers PR review).
const OPT_OUT_RE = /silent-catch\s*—|silent-catch:\s*observability|eslint-disable.*silent-catch/i

// Look back up to LOOKBACK lines to find the matching `try {` and any
// protected-primitive call.
const LOOKBACK = 20

interface Violation {
  filePath: string
  line: number
  primitive: string
  reason: string
}

function* walk(root: string): Generator<string> {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root)) {
    if (SKIP_NAMES.has(entry)) continue
    const full = join(root, entry)
    let stat
    try { stat = statSync(full) } catch { continue }
    if (stat.isDirectory()) {
      yield* walk(full)
    } else if (stat.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
      yield full
    }
  }
}

function lintFile(file: string): Violation[] {
  const violations: Violation[] = []
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match `} catch { ... }` or `} catch (e) { ... }` or `catch { ... }`
    // where the body is either empty OR contains only `console.warn(...)` /
    // `console.error(...)` and a single `return …`.
    //
    // We're conservative — we flag two patterns:
    //   1. Empty catch:    catch { }
    //   2. Console-only:   catch { console.warn(...) [return ...] }
    //
    // Multi-line catch blocks: we collect the catch body until the
    // matching `}` on the same indent level.

    const catchMatch = line.match(/^(\s*)\}?\s*catch\s*(?:\([^)]*\))?\s*\{(.*)$/)
    if (!catchMatch) continue

    const indent = catchMatch[1]
    const restOfLine = catchMatch[2]

    // Check opt-out marker on the previous 2 lines.
    let optedOut = false
    for (let p = Math.max(0, i - 2); p < i; p++) {
      if (OPT_OUT_RE.test(lines[p])) {
        optedOut = true
        break
      }
    }
    if (optedOut) continue

    // Collect the catch body. Single-line: `catch { ... }` on this line.
    let body = ''
    if (restOfLine.includes('}')) {
      body = restOfLine.slice(0, restOfLine.lastIndexOf('}'))
    } else {
      // Multi-line; collect until a closing `}` at the same indent.
      for (let j = i + 1; j < Math.min(lines.length, i + 30); j++) {
        const close = new RegExp(`^${indent}\\}`)
        if (close.test(lines[j])) break
        body += lines[j] + '\n'
      }
    }

    // Classify the body.
    const stripped = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()

    // Pattern 1 — empty catch body.
    const isEmpty = stripped === ''

    // Pattern 2 — only console.warn/error + optional return.
    const ONLY_CONSOLE_RE = /^(?:console\.(?:warn|error|log|debug|info)\s*\([^)]*\)\s*;?\s*)+(?:return[\s\S]*?;?\s*)?$/
    const isConsoleOnly = ONLY_CONSOLE_RE.test(stripped.replace(/\s+/g, ' '))

    if (!isEmpty && !isConsoleOnly) continue

    // Look back for one of the protected primitives within the try block.
    let primitive: string | null = null
    let tryDepth = 0
    for (let k = i; k >= Math.max(0, i - LOOKBACK); k--) {
      const ln = lines[k]
      if (/(^|\s)try\s*\{/.test(ln)) { tryDepth-- ; if (tryDepth < 0) break }
      const m = ln.match(PRIMITIVE_RE)
      if (m) { primitive = m[1]; break }
    }

    if (primitive) {
      violations.push({
        filePath: file,
        line: i + 1,
        primitive,
        reason: isEmpty ? 'empty catch swallows the error' : 'catch only logs; the error is not propagated',
      })
    }
  }

  return violations
}

function main(): number {
  try {
    const all: Violation[] = []
    let filesScanned = 0
    for (const f of walk(APPS_DIR)) {
      filesScanned++
      all.push(...lintFile(f))
    }
    if (all.length === 0) {
      console.log(`[check-no-silent-catch-on-primitives] ok — scanned ${filesScanned} files, no silent catch on protected primitives`)
      return 0
    }
    console.error(`[check-no-silent-catch-on-primitives] FAIL — ${all.length} silent catch(es) on protected primitives\n`)
    for (const v of all) {
      const rel = v.filePath.replace(REPO_ROOT + '/', '')
      console.error(`  ${rel}:${v.line}`)
      console.error(`    primitive: ${v.primitive}()`)
      console.error(`    reason:    ${v.reason}`)
    }
    console.error('\nProtected primitives (signing, chain writes, audit) must not be silently')
    console.error('swallowed. Either re-throw, route through auditDeny, or annotate with')
    console.error('`// eslint-disable-next-line silent-catch — observability only` and explain in PR.')
    return 1
  } catch (err) {
    console.error(`[check-no-silent-catch-on-primitives] internal error: ${(err as Error).message}`)
    return 2
  }
}

process.exit(main())
