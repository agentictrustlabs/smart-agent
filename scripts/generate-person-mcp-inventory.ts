#!/usr/bin/env tsx
/**
 * `pnpm generate:person-mcp-inventory` — Sprint 5 Wave 3 (P1-2) generator.
 *
 * Parses every Hono HTTP route handler and every MCP tool descriptor in
 * `apps/person-mcp/src/` for its `@sa-*` JSDoc tags and writes a markdown
 * summary to `docs/architecture/person-mcp-route-inventory.md`.
 *
 * Modes:
 *
 *   pnpm generate:person-mcp-inventory          # rewrite the markdown file
 *   pnpm generate:person-mcp-inventory --check  # exit 1 if regenerating
 *                                               # would change the file
 *
 * Why this exists: person-mcp is the agent's PII-bearing surface. Its
 * routes + tools must be classifiable for audit ("which of these need a
 * delegation token? which are dev-only? which mutate state?"). This
 * generator is the human-readable answer; `check-person-mcp-classification`
 * is the machine-enforced lint that keeps every handler annotated.
 *
 * Sibling to (not extension of) `generate-route-inventory.ts`. The web
 * generator is hardcoded to Next.js `route.ts` shape and a different tag
 * value set; person-mcp has two callable surfaces (HTTP + MCP tools) and
 * its own auth value vocabulary, so a separate entry point is cleaner
 * than a megafile that branches on app.
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import {
  scanPersonMcp,
  type PersonMcpParseResult,
  type HttpRouteRecord,
  type McpToolRecord,
  type HttpRouteKind,
  type McpToolKind,
} from './lib/person-mcp-classification-parser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const OUTPUT_FILE = resolve(REPO_ROOT, 'docs/architecture/person-mcp-route-inventory.md')

interface HttpSectionDef {
  kind: HttpRouteKind
  title: string
  blurb: string
}
interface McpSectionDef {
  kind: McpToolKind
  title: string
  blurb: string
}

const HTTP_SECTIONS: HttpSectionDef[] = [
  {
    kind: 'public',
    title: 'Public HTTP routes',
    blurb: 'Unauthenticated by design (health, operator debug). MUST disclose no PII and rate-limit any DB/network touch.',
  },
  {
    kind: 'service-only',
    title: 'Service-only HTTP routes (require inbound HMAC)',
    blurb: 'Gated on `requireInboundServiceAuth()` — caller signs with the shared `a2a-to-person` MAC key. Never reachable from a browser.',
  },
  {
    kind: 'delegation-verified',
    title: 'Delegation-verified HTTP routes',
    blurb: 'Each call carries a signed WalletAction the route verifies via `gateExistingWalletAction` / `gateProvisionAction` / `verifyDelegatedWalletAction`.',
  },
  {
    kind: 'bootstrap',
    title: 'Bootstrap HTTP routes',
    blurb: 'Special-purpose unauthenticated entry points (e.g. provisioning idempotency probes). Must still rate-limit and audit.',
  },
  {
    kind: 'dev-only',
    title: 'Dev-only HTTP routes',
    blurb: 'Guarded by `@sa-prod-gate` — return 404 in production.',
  },
]

const MCP_SECTIONS: McpSectionDef[] = [
  {
    kind: 'delegation-verified',
    title: 'Delegation-verified MCP tools',
    blurb: 'Each invocation calls `requirePrincipal(token, scope)` against the cross-MCP delegation registry. The principal is derived from the verified delegation chain, not from input.',
  },
  {
    kind: 'service-only',
    title: 'Service-only MCP tools',
    blurb: 'Reachable only via the a2a-agent mcp-proxy after HMAC service-auth; tools require `_a2aSessionId` injected by the proxy.',
  },
  {
    kind: 'bootstrap',
    title: 'Bootstrap MCP tools',
    blurb: 'Special-purpose tools that build a wallet action envelope clients then sign client-side. Tool output is the unsigned action, not a state change.',
  },
  {
    kind: 'dev-only',
    title: 'Dev-only MCP tools',
    blurb: 'Guarded by `@sa-prod-gate` — refuse in production.',
  },
]

function dash(s: string | undefined): string {
  return s && s.length > 0 ? s : '—'
}

function httpRow(r: HttpRouteRecord): string {
  const t = r.tags
  const source = `[\`${r.filePath.replace(/^apps\/person-mcp\/src\//, '')}\`](../../${r.filePath})`
  return `| \`${r.path}\` | ${r.method} | ${t.auth} | ${dash(t.rateLimit)} | ${dash(t.validation)} | ${dash(t.prodGate)} | ${dash(t.riskTier)} | ${source} |`
}

function mcpRow(r: McpToolRecord): string {
  const t = r.tags
  const source = `[\`${r.filePath.replace(/^apps\/person-mcp\/src\//, '')}\`](../../${r.filePath})`
  return `| \`${r.toolName}\` | ${t.isWrite ? 'write' : 'read'} | ${t.auth} | ${dash(t.rateLimit)} | ${dash(t.validation)} | ${dash(t.prodGate)} | ${dash(t.riskTier)} | ${source} |`
}

function httpHeader(): string {
  return [
    '| Route | Method | Auth | Rate Limit | Validation | Prod Gate | Risk | Source |',
    '|-------|--------|------|------------|------------|-----------|------|--------|',
  ].join('\n')
}

function mcpHeader(): string {
  return [
    '| Tool | Side | Auth | Rate Limit | Validation | Prod Gate | Risk | Source |',
    '|------|------|------|------------|------------|-----------|------|--------|',
  ].join('\n')
}

function renderHttpSection(def: HttpSectionDef, records: HttpRouteRecord[]): string {
  const lines: string[] = []
  lines.push(`### ${def.title}`)
  lines.push('')
  lines.push(def.blurb)
  lines.push('')
  if (records.length === 0) {
    lines.push('_None._')
    lines.push('')
    return lines.join('\n')
  }
  lines.push(httpHeader())
  for (const r of records) lines.push(httpRow(r))
  lines.push('')
  return lines.join('\n')
}

function renderMcpSection(def: McpSectionDef, records: McpToolRecord[]): string {
  const lines: string[] = []
  lines.push(`### ${def.title}`)
  lines.push('')
  lines.push(def.blurb)
  lines.push('')
  if (records.length === 0) {
    lines.push('_None._')
    lines.push('')
    return lines.join('\n')
  }
  lines.push(mcpHeader())
  for (const r of records) lines.push(mcpRow(r))
  lines.push('')
  return lines.join('\n')
}

interface RenderOptions {
  withTimestamp: boolean
}

function renderInventory(
  httpRecords: HttpRouteRecord[],
  mcpRecords: McpToolRecord[],
  opts: RenderOptions,
): string {
  // Bucket + stable-sort.
  const httpBuckets = new Map<HttpRouteKind, HttpRouteRecord[]>()
  for (const def of HTTP_SECTIONS) httpBuckets.set(def.kind, [])
  for (const r of httpRecords) httpBuckets.get(r.tags.route)?.push(r)
  for (const arr of httpBuckets.values()) {
    arr.sort((a, b) => {
      if (a.path !== b.path) return a.path.localeCompare(b.path)
      return a.method.localeCompare(b.method)
    })
  }

  const mcpBuckets = new Map<McpToolKind, McpToolRecord[]>()
  for (const def of MCP_SECTIONS) mcpBuckets.set(def.kind, [])
  for (const r of mcpRecords) mcpBuckets.get(r.tags.tool)?.push(r)
  for (const arr of mcpBuckets.values()) {
    arr.sort((a, b) => a.toolName.localeCompare(b.toolName))
  }

  const out: string[] = []
  out.push('# Person-MCP Route + Tool Inventory')
  out.push('')
  if (opts.withTimestamp) {
    out.push(`_Generated: ${new Date().toISOString()}_  `)
  }
  out.push('_Source: `apps/person-mcp/src/{index.ts, ssi/api/**, auth/**, tools/**}`_  ')
  out.push('_Regenerate: `pnpm generate:person-mcp-inventory`_  ')
  out.push('_Drift-check: `pnpm generate:person-mcp-inventory --check` (CI gate)_')
  out.push('')
  out.push(
    'This file is auto-generated from the `@sa-route` / `@sa-tool` JSDoc ' +
      'tags on every Hono route handler and MCP tool descriptor in person-mcp. ' +
      'Editing it by hand will be undone the next time the generator runs — ' +
      "change the handler/tool's JSDoc and regenerate.",
  )
  out.push('')
  out.push(
    'Why this exists: person-mcp owns PII, the AnonCreds wallet, and ' +
      'session storage. Without this inventory, the attack surface is ' +
      'unauditable. The sibling `check-person-mcp-classification` lint ' +
      "fails CI when any handler/tool drops its classification.",
  )
  out.push('')

  // Summary table.
  out.push('## Summary')
  out.push('')
  out.push('| Section | Count |')
  out.push('|---------|-------|')
  let httpTotal = 0
  for (const def of HTTP_SECTIONS) {
    const n = httpBuckets.get(def.kind)!.length
    httpTotal += n
    out.push(`| ${def.title} | ${n} |`)
  }
  out.push(`| **HTTP routes total** | **${httpTotal}** |`)
  let mcpTotal = 0
  for (const def of MCP_SECTIONS) {
    const n = mcpBuckets.get(def.kind)!.length
    mcpTotal += n
    out.push(`| ${def.title} | ${n} |`)
  }
  out.push(`| **MCP tools total** | **${mcpTotal}** |`)
  out.push(`| **Grand total** | **${httpTotal + mcpTotal}** |`)
  out.push('')

  out.push('## HTTP routes')
  out.push('')
  for (const def of HTTP_SECTIONS) {
    out.push(renderHttpSection(def, httpBuckets.get(def.kind)!))
  }

  out.push('## MCP tools')
  out.push('')
  for (const def of MCP_SECTIONS) {
    out.push(renderMcpSection(def, mcpBuckets.get(def.kind)!))
  }

  return out.join('\n').replace(/\n+$/, '\n')
}

function main(): number {
  const checkMode = process.argv.includes('--check')

  const { httpRoutes, mcpTools } = scanPersonMcp(REPO_ROOT)
  const failures = [...httpRoutes, ...mcpTools].filter(
    (r): r is Extract<PersonMcpParseResult, { ok: false }> => !r.ok,
  )
  if (failures.length > 0) {
    console.error(
      `[generate-person-mcp-inventory] cannot generate — ${failures.length} handler/tool(s) lack a valid classification block. Run \`pnpm check:person-mcp-classification\` for details.`,
    )
    return 1
  }

  const httpRecords = httpRoutes
    .filter((r): r is Extract<PersonMcpParseResult, { ok: true }> => r.ok)
    .map((r) => (r.record as Extract<typeof r.record, { kind: 'http-route' }>).record)
  const mcpRecords = mcpTools
    .filter((r): r is Extract<PersonMcpParseResult, { ok: true }> => r.ok)
    .map((r) => (r.record as Extract<typeof r.record, { kind: 'mcp-tool' }>).record)

  if (checkMode) {
    const generated = renderInventory(httpRecords, mcpRecords, { withTimestamp: false })
    if (!existsSync(OUTPUT_FILE)) {
      console.error(
        `[generate-person-mcp-inventory] ${OUTPUT_FILE} does not exist. Run \`pnpm generate:person-mcp-inventory\`.`,
      )
      return 1
    }
    const existing = readFileSync(OUTPUT_FILE, 'utf-8')
    const existingStripped = stripTimestamp(existing)
    if (existingStripped.trim() === generated.trim()) {
      console.log(
        `[generate-person-mcp-inventory] ok — ${httpRecords.length} HTTP route(s) + ${mcpRecords.length} MCP tool(s); doc is in sync`,
      )
      return 0
    }
    console.error(
      '[generate-person-mcp-inventory] DRIFT — committed inventory does not match what the generator would produce.',
    )
    console.error('Run `pnpm generate:person-mcp-inventory` and commit the result.')
    return 1
  }

  const generated = renderInventory(httpRecords, mcpRecords, { withTimestamp: true })
  writeFileSync(OUTPUT_FILE, generated, 'utf-8')
  console.log(
    `[generate-person-mcp-inventory] wrote ${OUTPUT_FILE} — ${httpRecords.length} HTTP route(s) + ${mcpRecords.length} MCP tool(s)`,
  )
  return 0
}

function stripTimestamp(s: string): string {
  return s.replace(/^_Generated:.*$/m, '').replace(/\n\n+/g, '\n\n')
}

process.exit(main())
