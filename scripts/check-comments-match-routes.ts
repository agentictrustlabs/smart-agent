#!/usr/bin/env tsx
/**
 * Spec 007 Phase G.2 — comments-match-routes lint.
 *
 * Walks every `.ts` / `.tsx` file under `apps/` and `packages/` and scans
 * comments for cross-references of the form:
 *
 *     // see routes/<name>(.ts)?[:<symbol>]
 *     // see middleware/<name>(.ts)?
 *     // see <name>.ts(:<symbol>)?
 *
 * For each match, asserts the referenced file actually exists. The intent
 * is to catch comments that promise "the X route is mounted at Y" or
 * "see X.ts for the bypass" when the implementation has drifted and X
 * no longer exists. Stale comments lie to reviewers; the lint forces
 * the author to either delete the stale comment or restore the
 * implementation.
 *
 * Exit codes:
 *   0 — every comment reference resolves
 *   1 — one or more stale references
 *   2 — internal failure (e.g. couldn't walk the tree)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')

const SEARCH_ROOTS = [
  join(REPO_ROOT, 'apps'),
  join(REPO_ROOT, 'packages'),
]

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  'lib', // packages/contracts/lib/ has external submodules
  'out',
  'build',
  '__tests__',
])

/**
 * Patterns that capture cross-file references in comments. Each pattern
 * yields a relative reference (file stem or path-like fragment) that we
 * try to resolve against the codebase.
 *
 * The patterns are deliberately conservative — they require leading
 * `see ` so the comment's intent is unambiguous.
 */
const PATTERNS: Array<{ re: RegExp; kind: string }> = [
  // // see routes/foo or // see routes/foo.ts
  { re: /(?:^|\s)see\s+routes\/([\w.-]+?)(?:\.tsx?)?(?:[:\s,.]|$)/gi, kind: 'routes' },
  // // see middleware/foo or // see middleware/foo.ts
  { re: /(?:^|\s)see\s+middleware\/([\w.-]+?)(?:\.tsx?)?(?:[:\s,.]|$)/gi, kind: 'middleware' },
  // // see auth/foo
  { re: /(?:^|\s)see\s+auth\/([\w.-]+?)(?:\.tsx?)?(?:[:\s,.]|$)/gi, kind: 'auth' },
]

interface Violation {
  filePath: string
  line: number
  kind: string
  reference: string
  comment: string
}

function* walk(root: string): Generator<string> {
  if (!existsSync(root)) return
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRS.has(entry)) continue
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

function fileExistsAnywhereUnder(roots: string[], kind: string, stem: string): boolean {
  // Search for any file whose path matches `<kind>/<stem>(.ts|.tsx)` anywhere
  // under the given roots. Cached BFS bounded by SKIP_DIRS.
  for (const root of roots) {
    if (findStemUnder(root, kind, stem)) return true
  }
  return false
}

const stemCache = new Map<string, boolean>()
function findStemUnder(root: string, kind: string, stem: string): boolean {
  const key = `${root}|${kind}|${stem}`
  if (stemCache.has(key)) return stemCache.get(key)!
  let found = false
  try {
    for (const entry of readdirSync(root)) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(root, entry)
      let stat
      try { stat = statSync(full) } catch { continue }
      if (stat.isDirectory()) {
        // Match `<root>/.../<kind>/<stem>.ts(x)`.
        if (basename(full) === kind) {
          for (const child of readdirSync(full)) {
            if (child === `${stem}.ts` || child === `${stem}.tsx` ||
                child === stem || child.replace(/\.tsx?$/, '') === stem) {
              found = true
              break
            }
          }
        }
        if (!found) found = findStemUnder(full, kind, stem)
      }
      if (found) break
    }
  } catch { /* ignore */ }
  stemCache.set(key, found)
  return found
}

function lintFile(file: string): Violation[] {
  const violations: Violation[] = []
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Only check comment lines — skip strings/code.
    if (!/^\s*(\*|\/\/)/.test(line) && !/\/\*/.test(line)) continue
    for (const { re, kind } of PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        const ref = m[1]
        if (!ref) continue
        // Ignore obvious false-positives like "see foo" within URL paths.
        if (ref.includes('/')) continue
        if (!fileExistsAnywhereUnder(SEARCH_ROOTS, kind, ref)) {
          violations.push({
            filePath: file,
            line: i + 1,
            kind,
            reference: ref,
            comment: line.trim(),
          })
        }
      }
    }
  }
  return violations
}

function main(): number {
  try {
    const all: Violation[] = []
    let filesScanned = 0
    for (const root of SEARCH_ROOTS) {
      for (const f of walk(root)) {
        filesScanned++
        all.push(...lintFile(f))
      }
    }
    if (all.length === 0) {
      console.log(`[check-comments-match-routes] ok — scanned ${filesScanned} files, every cross-file reference resolves`)
      return 0
    }
    console.error(`[check-comments-match-routes] FAIL — ${all.length} stale comment reference(s) (scanned ${filesScanned} files)\n`)
    for (const v of all) {
      const rel = v.filePath.replace(REPO_ROOT + '/', '')
      console.error(`  ${rel}:${v.line}`)
      console.error(`    references ${v.kind}/${v.reference} — not found`)
      console.error(`    > ${v.comment}`)
    }
    console.error('\nEither delete the stale comment or restore the referenced file.')
    return 1
  } catch (err) {
    console.error(`[check-comments-match-routes] internal error: ${(err as Error).message}`)
    return 2
  }
}

process.exit(main())
