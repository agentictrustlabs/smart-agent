/**
 * hub-mcp — aggregate knowledge-base service.
 *
 *   - All KB reads (DiscoveryService) flow through `discovery:*` tools
 *     so we can cache aggressively in one place.
 *   - All GraphDB writes / on-chain → KB syncs flow through `sync:*`
 *     tools so write→read consistency lives next to the cache that
 *     would otherwise serve stale.
 *
 * Web app + other MCPs reach hub-mcp via the A2A gateway:
 *   POST  http://<slug>.agent.localhost:3100/mcp/hub/<tool-name>
 *
 * Direct HTTP (port 3900) is dev-only / inter-MCP.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'

import { config } from './config.js'
import { discoveryTools } from './tools/discovery.js'
import { syncTools } from './tools/sync.js'
import { cacheSize, cacheClear } from './lib/cache.js'

// ---------------------------------------------------------------------------
// Collect tool definitions + handlers
// ---------------------------------------------------------------------------

const allTools = {
  ...discoveryTools,
  ...syncTools,
} as const

const toolDefinitions = Object.values(allTools).map(
  ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
)

const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {}
for (const [, tool] of Object.entries(allTools)) {
  toolHandlers[tool.name] = tool.handler as (args: Record<string, unknown>) => Promise<unknown>
}

// ---------------------------------------------------------------------------
// MCP stdio (for AI agent integration / dev tooling)
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'hub-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const handler = toolHandlers[name]
  if (!handler) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    }
  }
  try {
    return await handler(args as Record<string, unknown>) as { content: Array<{ type: 'text'; text: string }> }
  } catch (err) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
      isError: true,
    }
  }
})

// ---------------------------------------------------------------------------
// HTTP — A2A gateway hits this; direct HTTP is dev-only.
// ---------------------------------------------------------------------------

const app = new Hono()
app.use('*', logger())

app.post('/tools/:toolName', async (c) => {
  const toolName = c.req.param('toolName')
  const body = await c.req.json<{ tool?: string; args?: Record<string, unknown> }>()
  const actualTool = body.tool ?? toolName
  const handler = toolHandlers[actualTool]
  if (!handler) return c.json({ error: `Unknown tool: ${actualTool}` }, 404)
  try {
    const result = await handler(body.args ?? body) as { content: Array<{ type: string; text: string }> }
    const text = result.content?.[0]?.text
    if (text) {
      try { return c.json(JSON.parse(text)) } catch { return c.json({ result: text }) }
    }
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

app.get('/tools', (c) => c.json({ tools: toolDefinitions }))
app.get('/health', (c) => c.json({ status: 'ok', tools: Object.keys(toolHandlers).length, cache: cacheSize() }))

// Admin: flush cache. Useful in tests + after fresh-start.
app.post('/admin/cache/clear', (c) => { cacheClear(); return c.json({ ok: true, cleared: true }) })

// Debug: raw turtle output for the agents named graph. Used by the
// `/api/ontology-sync/turtle` proxy in the web app + manual GraphDB
// inspection. Read-only, unauthenticated — hub-mcp itself is not
// exposed to browsers (port 3900 is dev-local / inter-MCP only).
app.get('/debug/agents-turtle', async (c) => {
  const mod = await import('./lib/graphdb-sync.js')
  const turtle = await mod.emitAgentsTurtle()
  return new Response(turtle, { headers: { 'Content-Type': 'text/turtle' } })
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  serve({ fetch: app.fetch, port: config.PORT })
  console.log(`[hub-mcp] HTTP server on http://localhost:${config.PORT}`)
  console.log(`[hub-mcp] GraphDB: ${config.GRAPHDB_URL} (${config.GRAPHDB_REPO})`)
  console.log(`[hub-mcp] Tools: ${Object.keys(toolHandlers).join(', ')}`)

  if (!process.stdin.isTTY) {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error('[hub-mcp] MCP stdio transport connected')
  }
}

main().catch((err) => {
  console.error('[hub-mcp] Fatal error:', err)
  process.exit(1)
})
