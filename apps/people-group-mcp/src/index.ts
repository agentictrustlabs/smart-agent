import './config.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config, hasCuratorAllowlist } from './config.js'
import './db/index.js' // Side effect: bootstrap schema on import.
import { seedScopeTypes } from './boot/scope-types-seed.js'
import { seedWolofCatalog } from './boot/wolof-catalog-seed.js'

// Tools (added incrementally — C3 public + admin, C4 sponsor-private)
import { conceptReadTools } from './tools/concepts.js'
import { conceptAdminTools } from './tools/concepts-admin.js'
import { segmentTools } from './tools/segments.js'
import { communityTools } from './tools/communities.js'
import { estimateTools } from './tools/estimates.js'
import { reachednessTools } from './tools/reachedness.js'
import { geometryTools } from './tools/geometries.js'
import { classificationTools } from './tools/classifications.js'
import { revokeTools } from './tools/revoke.js'
import { auditTools } from './tools/audit.js'

// ───────────────────────────────────────────────────────────────────────
// Tool registry. All tools are gated by one of:
//   - requirePrincipal      (T2 owner-only writes)
//   - requirePrincipalAny   (T2 reads: owner OR cross-delegation; per-resource gate)
//   - requireCurator        (T0 curator writes; allowlist gated)
//   - none                  (T0 reads)
// All paths audit on success AND denial (SEC G9).
// ───────────────────────────────────────────────────────────────────────

const allTools = {
  ...conceptReadTools,
  ...conceptAdminTools,
  ...segmentTools,
  ...communityTools,
  ...estimateTools,
  ...reachednessTools,
  ...geometryTools,
  ...classificationTools,
  ...revokeTools,
  ...auditTools,
} as const

const toolDefinitions = Object.values(allTools).map(
  ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
)

const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {}
for (const [, tool] of Object.entries(allTools)) {
  toolHandlers[tool.name] = tool.handler as (args: Record<string, unknown>) => Promise<unknown>
}

const app = new Hono()
app.use('*', logger())

app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'people-group-mcp',
  port: config.port,
  tools: Object.keys(toolHandlers).length,
  curatorAllowlist: hasCuratorAllowlist() ? 'configured' : 'EMPTY (T0 writes disabled)',
}))

app.get('/.well-known/agent.json', (c) => c.json({
  name: 'Smart Agent People-Group MCP',
  role: 'people-group-registry',
  audience: 'urn:mcp:server:people-groups',
  endpoints: {
    tools: '/tools',
  },
}))

app.get('/tools', (c) => c.json({ tools: toolDefinitions }))

app.post('/tools/:toolName', async (c) => {
  const toolName = c.req.param('toolName')
  const body = await c.req.json<{ tool?: string; args?: Record<string, unknown> }>()
  const actualTool = body.tool ?? toolName
  const handler = toolHandlers[actualTool]
  if (!handler) return c.json({ error: `Unknown tool: ${actualTool}` }, 404)
  try {
    const result = await handler(body.args ?? body) as { content: Array<{ type: string; text: string }> }
    // Mirror person-mcp HTTP shim — unwrap MCP content envelope to plain JSON.
    const text = result.content?.[0]?.text
    if (text) {
      try { return c.json(JSON.parse(text)) } catch { return c.json({ result: text }) }
    }
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

async function main() {
  // Pre-seed the scope_types controlled vocabulary.
  const seed = seedScopeTypes()
  console.log(`[people-group-mcp] scope-types: ${seed.inserted} inserted (${seed.total} total)`)
  // Pre-seed demo catalog (schemes, external records, Wolof concept,
  // worldwide collective). Boot-seeded for v1 — see boot/wolof-catalog-seed.ts.
  const w = seedWolofCatalog()
  console.log(`[people-group-mcp] wolof catalog: schemes=${w.schemes} records=${w.records} concepts=${w.concepts} collectives=${w.collectives}`)

  serve({ fetch: app.fetch, port: config.port })
  console.log(`[people-group-mcp] tools: ${Object.keys(toolHandlers).length}`)
  console.log(`[people-group-mcp] curator allowlist: ${hasCuratorAllowlist() ? `${config.curatorAllowlist.size} principal(s)` : 'EMPTY'}`)
  console.log(`[people-group-mcp] listening on http://localhost:${config.port}`)
}

main().catch((err) => {
  console.error('[people-group-mcp] fatal:', err)
  process.exit(1)
})
