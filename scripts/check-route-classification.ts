#!/usr/bin/env tsx
/**
 * `pnpm check:route-classification` — Sprint 2 S2.7 lint.
 *
 * Walks `apps/web/src/app/api/**\/route.ts` and fails (exit 1) if any
 * route handler lacks the `@sa-route` + `@sa-auth` JSDoc tags
 * (per `output/tester-guardrails-framework.md` § Route Classification
 * Comment Specification).
 *
 * Run from repo root:
 *
 *   pnpm check:route-classification
 *
 * Exit codes:
 *   0 — every route handler has a valid classification block
 *   1 — one or more handlers are missing / malformed
 *   2 — internal failure (e.g. couldn't find the api dir)
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAllRoutes } from './lib/route-classification-parser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const WEB_API_DIR = resolve(REPO_ROOT, 'apps/web/src/app/api')

function main(): number {
  try {
    const results = parseAllRoutes(WEB_API_DIR, REPO_ROOT)
    if (results.length === 0) {
      console.error(`[check-route-classification] no route.ts files found under ${WEB_API_DIR}`)
      return 2
    }

    const failures = results.filter((r) => !r.ok)
    const okCount = results.length - failures.length

    if (failures.length === 0) {
      console.log(
        `[check-route-classification] ok — ${okCount} route handler(s) classified`,
      )
      return 0
    }

    console.error(
      `[check-route-classification] FAIL — ${failures.length} handler(s) missing / malformed (${okCount} ok)\n`,
    )
    for (const f of failures) {
      if (f.ok) continue
      const method = f.method ?? '(no handler)'
      console.error(`  ${f.filePath} [${method}]`)
      for (const e of f.errors) console.error(`    - ${e}`)
    }
    console.error(
      '\nAdd a JSDoc block above the handler (or at file head) with at minimum:',
    )
    console.error('  /**')
    console.error('   * @sa-route <public|web-auth|service-only|admin-only|dev-only|bootstrap>')
    console.error('   * @sa-auth  <none|session-cookie|grant-cookie|service-hmac|kms-token|none-with-csrf>')
    console.error('   */')
    console.error('\nSee output/tester-guardrails-framework.md for the full tag set.')
    return 1
  } catch (err) {
    console.error(`[check-route-classification] internal error: ${(err as Error).message}`)
    return 2
  }
}

process.exit(main())
