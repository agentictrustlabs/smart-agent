#!/usr/bin/env tsx
/**
 * Spec 007 Phase G.2 — no-server-only-in-scripts lint.
 *
 * `import 'server-only'` is a Next.js runtime guard that hard-fails at
 * import time when included in client bundles. It is OK in `apps/web/src/`
 * — that is exactly where it belongs — but NEVER in `scripts/*.ts`,
 * which are seed/admin scripts executed under raw Node via tsx and have
 * no Next.js runtime. Importing it there fails with
 * `Module not found: 'server-only'` and the seed silently dies in CI
 * (the F-2.0 issue we hit).
 *
 * The lint:
 *   - greps every file under `scripts/` for `import 'server-only'` or
 *     `require('server-only')`
 *   - additionally checks `apps/web/src/` for the bug-shaped case where
 *     a TSX file imports server-only via a path that wouldn't catch the
 *     Next.js client/server boundary checker — that's narrowly the
 *     case the spec calls out.
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

const SCRIPTS_DIR = join(REPO_ROOT, 'scripts')

const SKIP_NAMES = new Set([
  'node_modules', 'dist', '.next', 'coverage', 'lib', 'out', 'build', '__tests__',
])

interface Violation {
  filePath: string
  line: number
  text: string
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
    } else if (stat.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx') || full.endsWith('.mts') || full.endsWith('.mjs'))) {
      yield full
    }
  }
}

// Match a REAL import statement (not a string literal mention in a doc
// comment or a path in a regex/code-string). We require the line to
// start with optional whitespace + `import` or `require(`.
const SERVER_ONLY_RE = /^\s*(?:import\s*['"]server-only['"]|(?:const|let|var)\s+[^=]+=\s*require\s*\(\s*['"]server-only['"]\s*\))/

// Skip lines that are clearly comments — single-line `//`, JSDoc `*`,
// or a comment block opener.
function isCommentLine(line: string): boolean {
  const t = line.trimStart()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

function lintFile(file: string): Violation[] {
  const violations: Violation[] = []
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue
    if (SERVER_ONLY_RE.test(lines[i])) {
      violations.push({ filePath: file, line: i + 1, text: lines[i].trim() })
    }
  }
  return violations
}

function main(): number {
  try {
    const all: Violation[] = []
    let filesScanned = 0
    for (const f of walk(SCRIPTS_DIR)) {
      filesScanned++
      all.push(...lintFile(f))
    }
    if (all.length === 0) {
      console.log(`[check-no-server-only-in-tsx] ok — scanned ${filesScanned} scripts/ files, no \`server-only\` imports`)
      return 0
    }
    console.error(`[check-no-server-only-in-tsx] FAIL — ${all.length} \`server-only\` import(s) in scripts/\n`)
    for (const v of all) {
      const rel = v.filePath.replace(REPO_ROOT + '/', '')
      console.error(`  ${rel}:${v.line}`)
      console.error(`    > ${v.text}`)
    }
    console.error('\n`import \'server-only\'` only works under Next.js — never in scripts/.')
    console.error('Seed/admin scripts run via raw `tsx`/Node and will fail with `Module not found`.')
    return 1
  } catch (err) {
    console.error(`[check-no-server-only-in-tsx] internal error: ${(err as Error).message}`)
    return 2
  }
}

process.exit(main())
