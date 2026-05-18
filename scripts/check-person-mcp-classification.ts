#!/usr/bin/env tsx
/**
 * `pnpm check:person-mcp-classification` — Sprint 5 Wave 3 lint (P1-2).
 *
 * Walks `apps/person-mcp/src/` for every Hono HTTP route handler and every
 * MCP tool descriptor, and fails (exit 1) if any handler/tool lacks the
 * required `@sa-route` / `@sa-tool` JSDoc classification.
 *
 * Run from repo root:
 *
 *   pnpm check:person-mcp-classification
 *
 * Exit codes:
 *   0 — every HTTP route + MCP tool carries a valid classification block
 *   1 — one or more handlers/tools are missing or malformed
 *   2 — internal failure (e.g. couldn't read the person-mcp source tree)
 *
 * Why this exists: person-mcp owns PII, the AnonCreds wallet, and session
 * storage. Reviewer (Sprint 5 W3) flagged that as the surface grows, every
 * callable endpoint must be classifiable for audit — same discipline the
 * web app gained in Sprint 2 S2.7. This lint is the chokepoint that keeps
 * the inventory honest.
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanPersonMcp } from './lib/person-mcp-classification-parser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')

function main(): number {
  try {
    const { httpRoutes, mcpTools } = scanPersonMcp(REPO_ROOT)
    const all = [...httpRoutes, ...mcpTools]
    if (all.length === 0) {
      console.error(
        `[check-person-mcp-classification] no HTTP routes or MCP tools found under apps/person-mcp/src/ — refusing to claim "ok" with zero coverage`,
      )
      return 2
    }
    const failures = all.filter((r) => !r.ok)
    const okCount = all.length - failures.length
    if (failures.length === 0) {
      console.log(
        `[check-person-mcp-classification] ok — ${httpRoutes.length} HTTP route(s) + ${mcpTools.length} MCP tool(s) classified`,
      )
      return 0
    }
    console.error(
      `[check-person-mcp-classification] FAIL — ${failures.length} handler/tool(s) missing or malformed (${okCount} ok)\n`,
    )
    for (const f of failures) {
      if (f.ok) continue
      const tag = f.kind === 'http-route' ? '[http-route]' : '[mcp-tool]'
      console.error(`  ${f.filePath} ${tag} ${f.symbol}`)
      for (const e of f.errors) console.error(`    - ${e}`)
    }
    console.error(
      [
        '',
        'Add a JSDoc block immediately above the handler / tool literal with at minimum:',
        '',
        '  HTTP route (Hono):',
        '    /**',
        '     * @sa-route   public | service-only | delegation-verified | bootstrap | dev-only',
        '     * @sa-auth    none-system-scoped | service-hmac | delegation-token | wallet-action-signature | session-bearer',
        '     * @sa-rate-limit  none | <N>/<window>',
        '     * @sa-prod-gate   always | dev-only | feature-flag:<NAME>',
        '     * @sa-validation  shape-check | json-schema | none-no-body | none-path-params | wallet-action-canonical',
        '     */',
        '',
        '  MCP tool:',
        '    /**',
        '     * @sa-tool    delegation-verified | service-only | bootstrap | dev-only',
        '     * @sa-auth    <as above>',
        '     * @sa-rate-limit  <as above>',
        '     * @sa-prod-gate   <as above>',
        '     * @sa-validation  <as above>  // required on writes',
        '     */',
        '',
        'See `scripts/lib/person-mcp-classification-parser.ts` for the canonical tag values.',
      ].join('\n'),
    )
    return 1
  } catch (err) {
    console.error(
      `[check-person-mcp-classification] internal error: ${(err as Error).message}`,
    )
    return 2
  }
}

process.exit(main())
