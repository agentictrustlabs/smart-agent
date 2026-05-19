#!/usr/bin/env tsx
/**
 * Spec 007 Phase G.2 — no-sqlite-in-prod-without-guard lint.
 *
 * `better-sqlite3` is fine in dev (and during the per-table cutover
 * to Postgres documented in Phase F.2). What is NOT fine is a service
 * that imports `better-sqlite3` somewhere under `src/` but DOES NOT
 * call `assertProductionStorageBackend(...)` at startup. Without the
 * guard the service silently boots in production against a `.db`
 * file on the container's ephemeral disk — exactly the regression
 * Phase F.2's startup guard exists to prevent.
 *
 * The lint:
 *   - finds every `apps/<svc>/src/**\/*.ts` (or `.tsx`) file that
 *     imports `better-sqlite3` (statically or dynamically)
 *   - skips test files (`*.test.ts`, paths containing `/test/` or `/__tests__/`)
 *   - for each affected service, checks that the service's
 *     `src/index.ts` or `instrumentation.ts` calls
 *     `assertProductionStorageBackend(`
 *   - reports services that have the dep but miss the guard.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violation
 *   2 — internal failure
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')

const APPS_DIR = join(REPO_ROOT, 'apps')

const SKIP_NAMES = new Set([
  'node_modules', 'dist', '.next', 'coverage', 'lib', 'out', 'build',
  '__tests__', 'test', 'tests',
])

const SQLITE_IMPORT_RE = /(?:from\s+['"]better-sqlite3['"]|require\s*\(\s*['"]better-sqlite3['"]\s*\)|import\s*\(\s*['"]better-sqlite3['"]\s*\))/

interface ServiceFinding {
  service: string
  files: string[]
  hasGuard: boolean
  guardSource?: string
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

function isTestFile(p: string): boolean {
  if (p.includes('/test/') || p.includes('/tests/') || p.includes('/__tests__/')) return true
  if (p.endsWith('.test.ts') || p.endsWith('.test.mts') || p.endsWith('.spec.ts')) return true
  return false
}

function findServiceGuard(serviceRoot: string): { has: boolean; source?: string } {
  // Check `src/index.ts`, `src/index.tsx`, `instrumentation.ts`,
  // `instrumentation.tsx` for `assertProductionStorageBackend(`.
  const candidates = [
    join(serviceRoot, 'src', 'index.ts'),
    join(serviceRoot, 'src', 'index.tsx'),
    join(serviceRoot, 'instrumentation.ts'),
    join(serviceRoot, 'instrumentation.tsx'),
  ]
  for (const c of candidates) {
    if (!existsSync(c)) continue
    const src = readFileSync(c, 'utf8')
    if (src.includes('assertProductionStorageBackend(')) {
      return { has: true, source: c }
    }
  }
  return { has: false }
}

function main(): number {
  try {
    if (!existsSync(APPS_DIR)) {
      console.error(`[check-no-sqlite-in-prod] apps/ directory not found at ${APPS_DIR}`)
      return 2
    }

    // Per-service detection.
    const services = readdirSync(APPS_DIR).filter((e) => {
      try { return statSync(join(APPS_DIR, e)).isDirectory() } catch { return false }
    })

    const findings: ServiceFinding[] = []
    let filesScanned = 0

    for (const svc of services) {
      const serviceRoot = join(APPS_DIR, svc)
      const srcDir = join(serviceRoot, 'src')
      if (!existsSync(srcDir)) continue
      const affected: string[] = []
      for (const f of walk(srcDir)) {
        if (isTestFile(f)) continue
        filesScanned++
        const src = readFileSync(f, 'utf8')
        if (SQLITE_IMPORT_RE.test(src)) affected.push(f)
      }
      if (affected.length === 0) continue
      const guard = findServiceGuard(serviceRoot)
      findings.push({ service: svc, files: affected, hasGuard: guard.has, guardSource: guard.source })
    }

    const violations = findings.filter((f) => !f.hasGuard)
    if (violations.length === 0) {
      const ok = findings.filter((f) => f.hasGuard)
      console.log(`[check-no-sqlite-in-prod] ok — scanned ${filesScanned} files; ${ok.length} services use better-sqlite3 and all have assertProductionStorageBackend guard`)
      for (const f of ok) {
        const rel = (f.guardSource ?? '').replace(REPO_ROOT + '/', '')
        console.log(`  ${f.service}: guard in ${rel}`)
      }
      return 0
    }

    console.error(`[check-no-sqlite-in-prod] FAIL — ${violations.length} service(s) import better-sqlite3 but have no assertProductionStorageBackend guard\n`)
    for (const v of violations) {
      console.error(`  service: ${v.service}`)
      console.error(`    ${v.files.length} src file(s) import better-sqlite3`)
      for (const f of v.files.slice(0, 3)) {
        console.error(`      - ${f.replace(REPO_ROOT + '/', '')}`)
      }
      if (v.files.length > 3) console.error(`      … and ${v.files.length - 3} more`)
      console.error(`    expected: src/index.ts or instrumentation.ts calls assertProductionStorageBackend(process.env, '<svc>', '<sqlite-fallback>.db')`)
    }
    console.error('\nA production deploy of a SQLite-backed service will silently write to the')
    console.error('container\'s ephemeral disk — data lost on restart. See packages/sdk/src/storage.')
    return 1
  } catch (err) {
    console.error(`[check-no-sqlite-in-prod] internal error: ${(err as Error).message}`)
    return 2
  }
}

process.exit(main())
