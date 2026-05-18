#!/usr/bin/env tsx
/**
 * `pnpm generate:route-inventory` — Sprint 2 S2.7 inventory generator.
 *
 * Parses every `apps/web/src/app/api/**\/route.ts` for its `@sa-*` JSDoc
 * tags and writes a markdown summary to
 * `docs/architecture/api-route-inventory.md`. The committed file is the
 * canonical answer to "which API routes need which auth?" — drift-checked
 * by `--check` mode in CI.
 *
 * Modes:
 *
 *   pnpm generate:route-inventory          # rewrite the markdown file
 *   pnpm generate:route-inventory --check  # exit 1 if regenerating would
 *                                          # change the committed file
 *
 * Why a flat markdown table rather than JSON? Two reasons:
 *   1. The intended audience is a human reviewer asking "what's the
 *      attack surface of /api?" — markdown renders inline on GitHub.
 *   2. The drift check uses a deterministic generator (sorted, stable
 *      timestamp dropped from the diff) so accidental noise doesn't
 *      flag a PR.
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import {
  parseAllRoutes,
  type ParseResult,
  type RouteHandlerRecord,
  type RouteKind,
} from './lib/route-classification-parser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const WEB_API_DIR = resolve(REPO_ROOT, 'apps/web/src/app/api')
const OUTPUT_FILE = resolve(REPO_ROOT, 'docs/architecture/api-route-inventory.md')

interface SectionDef {
  kind: RouteKind
  title: string
  blurb: string
}

const SECTIONS: SectionDef[] = [
  {
    kind: 'public',
    title: 'Public routes',
    blurb: 'Unauthenticated by design (health probes, public discovery). Must rate-limit if they touch any DB / network.',
  },
  {
    kind: 'web-auth',
    title: 'Web-auth routes (require session cookie)',
    blurb: 'Standard authenticated browser surface. Handler checks `getSession()` / `getCurrentUser()` and 401s on miss.',
  },
  {
    kind: 'bootstrap',
    title: 'Bootstrap routes (special-purpose unauthenticated)',
    blurb: 'Mint sessions / register passkeys / verify SIWE — accept untrusted input by design. CSRF-guarded + middleware-rate-limited.',
  },
  {
    kind: 'service-only',
    title: 'Service-only routes (require HMAC envelope)',
    blurb: 'Internal service-to-service calls. Caller must sign with a shared HMAC key id; never reachable from a browser.',
  },
  {
    kind: 'admin-only',
    title: 'Admin-only routes (operator scope)',
    blurb: 'Reserved for operator-scoped JWT / KMS-signed entry points. Not used yet — listed for completeness.',
  },
  {
    kind: 'dev-only',
    title: 'Dev-only routes (404 in production)',
    blurb: 'Guarded by `requireDev()` (or equivalent prod-gate) — return 404 when `NODE_ENV=production` unless `SMART_AGENT_ENV=dev`.',
  },
]

function dash(s: string | undefined): string {
  return s && s.length > 0 ? s : '—'
}

/**
 * Map `@sa-validation` values to the column emoji/icon used in the
 * inventory. `zod` is the "validated" tick; the two `none-*` values
 * carry their justification inline so a reviewer doesn't have to open
 * the route file. State-changing methods without any tag get a "!"
 * (lint also fails — this is a doc-only fallback so the table stays
 * intelligible if someone regenerates with a malformed handler).
 */
function validationCell(record: RouteHandlerRecord): string {
  const v = record.tags.validation
  if (v === 'zod') return 'zod'
  if (v === 'none-no-body') return 'no-body'
  if (v === 'none-path-params') return 'path-params'
  return '—'
}

function formatRow(record: RouteHandlerRecord): string {
  const t = record.tags
  const auditCell = t.auditEvent ?? '—'
  const sourceCell = `[\`${record.filePath.replace(/^apps\/web\/src\//, '')}\`](../../${record.filePath})`
  return `| \`${record.apiPath}\` | ${record.method} | ${t.auth} | ${dash(t.rateLimit)} | ${auditCell} | ${dash(t.riskTier)} | ${validationCell(record)} | ${dash(t.prodGate)} | ${sourceCell} |`
}

function tableHeader(): string {
  return [
    '| Route | Method | Auth | Rate Limit | Audit Event | Risk | Validated? | Prod Gate | Source |',
    '|-------|--------|------|------------|-------------|------|------------|-----------|--------|',
  ].join('\n')
}

function renderSection(def: SectionDef, records: RouteHandlerRecord[]): string {
  const lines: string[] = []
  lines.push(`## ${def.title}`)
  lines.push('')
  lines.push(def.blurb)
  lines.push('')
  if (records.length === 0) {
    lines.push('_None._')
    lines.push('')
    return lines.join('\n')
  }
  lines.push(tableHeader())
  for (const r of records) lines.push(formatRow(r))
  lines.push('')
  return lines.join('\n')
}

interface RenderOptions {
  /** Include the generation timestamp in the doc header. Off in `--check`. */
  withTimestamp: boolean
}

function renderInventory(records: RouteHandlerRecord[], opts: RenderOptions): string {
  // Stable sort: by section order → by apiPath → by method.
  const grouped = new Map<RouteKind, RouteHandlerRecord[]>()
  for (const def of SECTIONS) grouped.set(def.kind, [])
  for (const r of records) {
    const bucket = grouped.get(r.tags.route)
    if (bucket) bucket.push(r)
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => {
      if (a.apiPath !== b.apiPath) return a.apiPath.localeCompare(b.apiPath)
      return a.method.localeCompare(b.method)
    })
  }

  const out: string[] = []
  out.push('# API Route Inventory')
  out.push('')
  if (opts.withTimestamp) {
    out.push(`_Generated: ${new Date().toISOString()}_  `)
  }
  out.push('_Source: `apps/web/src/app/api/**/route.ts`_  ')
  out.push('_Regenerate: `pnpm generate:route-inventory`_  ')
  out.push('_Drift-check: `pnpm generate:route-inventory --check` (CI gate)_')
  out.push('')
  out.push(
    'This file is auto-generated from the `@sa-*` JSDoc tags on every API ' +
      'route handler. Editing it by hand will be undone the next time the ' +
      "generator runs — change the route's JSDoc and regenerate.",
  )
  out.push('')
  out.push(
    'Why this exists: the Next.js middleware (`apps/web/src/middleware.ts`) ' +
      'lets every `/api/*` path through unauthenticated; each handler ' +
      'mints / checks its own auth. Without this inventory, route auth ' +
      'coverage is unauditable.',
  )
  out.push('')

  // Summary row.
  const summary: string[] = []
  summary.push('| Section | Handlers |')
  summary.push('|---------|----------|')
  let total = 0
  for (const def of SECTIONS) {
    const n = grouped.get(def.kind)!.length
    total += n
    summary.push(`| ${def.title} | ${n} |`)
  }
  summary.push(`| **Total** | **${total}** |`)
  out.push('## Summary')
  out.push('')
  out.push(summary.join('\n'))
  out.push('')

  for (const def of SECTIONS) {
    out.push(renderSection(def, grouped.get(def.kind)!))
  }

  // Trailing newline so editors don't fight the generator.
  return out.join('\n').replace(/\n+$/, '\n')
}

function main(): number {
  const checkMode = process.argv.includes('--check')

  const parseResults = parseAllRoutes(WEB_API_DIR, REPO_ROOT)
  const failures = parseResults.filter((r): r is Extract<ParseResult, { ok: false }> => !r.ok)
  if (failures.length > 0) {
    console.error(
      `[generate-route-inventory] cannot generate — ${failures.length} route handler(s) lack a valid classification block. Run \`pnpm check:route-classification\` for details.`,
    )
    return 1
  }
  const records = parseResults
    .filter((r): r is Extract<ParseResult, { ok: true }> => r.ok)
    .map((r) => r.record)

  if (checkMode) {
    // Drift mode — generate without a fresh timestamp, compare to existing.
    const generated = renderInventory(records, { withTimestamp: false })
    if (!existsSync(OUTPUT_FILE)) {
      console.error(`[generate-route-inventory] ${OUTPUT_FILE} does not exist. Run \`pnpm generate:route-inventory\`.`)
      return 1
    }
    const existing = readFileSync(OUTPUT_FILE, 'utf-8')
    const existingStripped = stripTimestamp(existing)
    if (existingStripped.trim() === generated.trim()) {
      console.log(`[generate-route-inventory] ok — ${records.length} route(s) inventoried; doc is in sync`)
      return 0
    }
    console.error(
      '[generate-route-inventory] DRIFT — committed inventory does not match what the generator would produce.',
    )
    console.error('Run `pnpm generate:route-inventory` and commit the result.')
    return 1
  }

  const generated = renderInventory(records, { withTimestamp: true })
  writeFileSync(OUTPUT_FILE, generated, 'utf-8')
  console.log(
    `[generate-route-inventory] wrote ${OUTPUT_FILE} — ${records.length} route(s)`,
  )
  return 0
}

/**
 * Strip the `_Generated: ...iso..._` line so drift-check diffs ignore
 * timestamps (the only intentionally-volatile bit).
 */
function stripTimestamp(s: string): string {
  return s.replace(/^_Generated:.*$/m, '').replace(/\n\n+/g, '\n\n')
}

process.exit(main())
