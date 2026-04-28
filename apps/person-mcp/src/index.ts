import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// AnonCreds binding registration must happen exactly once per process,
// before any code path that touches the AnonCreds APIs. Person-mcp now owns
// the ssi-wallet operations end-to-end, so we register here instead of in a
// separate ssi-wallet-mcp process.
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import { AnonCreds } from '@smart-agent/privacy-creds'
AnonCreds.registerNativeBinding(anoncredsNodeJS)

import { profileTools } from './tools/profile.js'
import { identityTools } from './tools/identities.js'
import { chatTools } from './tools/chat.js'
import { ssiWalletTools } from './tools/ssi-wallet.js'

// ---------------------------------------------------------------------------
// Collect all tool definitions and handlers
// ---------------------------------------------------------------------------

const allTools = {
  ...profileTools,
  ...identityTools,
  ...chatTools,
  ...ssiWalletTools,
} as const

const toolDefinitions = Object.values(allTools).map(
  ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
)

const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {}
for (const [, tool] of Object.entries(allTools)) {
  toolHandlers[tool.name] = tool.handler as (args: Record<string, unknown>) => Promise<unknown>
}

// ---------------------------------------------------------------------------
// MCP Server (stdio transport for AI agent integration)
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'person-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}))

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
// HTTP Server (for web app delegation-verified tool calls)
// ---------------------------------------------------------------------------

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'

// Load .env
import { readFileSync } from 'fs'
try {
  const envFile = readFileSync('.env', 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx)
      const val = trimmed.slice(eqIdx + 1)
      if (!process.env[key]) process.env[key] = val
    }
  }
} catch { /* .env not found */ }

const PORT = parseInt(process.env.PERSON_MCP_PORT ?? '3200', 10)

const app = new Hono()
app.use('*', logger())

// POST /tools/:toolName — HTTP endpoint for tool calls
app.post('/tools/:toolName', async (c) => {
  const toolName = c.req.param('toolName')
  const body = await c.req.json<{ tool?: string; args?: Record<string, unknown> }>()

  // Support both /tools/profile (toolName from URL) and /tools/profile {tool: "update_profile"}
  const actualTool = body.tool ?? toolName
  const handler = toolHandlers[actualTool]

  if (!handler) {
    return c.json({ error: `Unknown tool: ${actualTool}` }, 404)
  }

  try {
    const result = await handler(body.args ?? body) as { content: Array<{ type: string; text: string }> }
    // Extract the JSON from the MCP content format
    const text = result.content?.[0]?.text
    if (text) {
      try {
        return c.json(JSON.parse(text))
      } catch {
        return c.json({ result: text })
      }
    }
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// GET /tools — list available tools
app.get('/tools', (c) => {
  return c.json({ tools: toolDefinitions })
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok', tools: Object.keys(toolHandlers).length }))

// ---------------------------------------------------------------------------
// SSI-wallet HTTP routes (absorbed from the deleted ssi-wallet-mcp service)
// ---------------------------------------------------------------------------
// Same paths as before — /wallet/*, /credentials/*, /proofs/*, /audit/*,
// /oid4vp/*, /wallet/match-against-public-set — only the port changes (3200
// instead of 3300). Tools that used to HTTP-forward to ssi-wallet-mcp now
// loopback to this same Hono server, which keeps the route bodies untouched.
import { walletRoutes } from './ssi/api/wallet.js'
import { credentialRoutes } from './ssi/api/credentials.js'
import { proofRoutes } from './ssi/api/proofs.js'
import { auditRoutes } from './ssi/api/audit.js'
import { oid4vpRoutes } from './ssi/api/oid4vp.js'
import { matchPublicSetRoutes } from './ssi/api/match-public-set.js'
import { walletActionRoutes } from './auth/wallet-action-routes.js'
import { dispatchRoutes } from './auth/dispatch-routes.js'

app.route('/', walletRoutes)
app.route('/', credentialRoutes)
app.route('/', proofRoutes)
app.route('/', auditRoutes)
app.route('/', oid4vpRoutes)
app.route('/', matchPublicSetRoutes)
app.route('/', walletActionRoutes)
app.route('/', dispatchRoutes)

app.get('/.well-known/ssi-wallet.json', (c) =>
  c.json({
    name: 'Smart Agent SSI Wallet (in-process within person-mcp)',
    version: '0.1.0',
    formats: ['anoncreds-v1'],
    capabilities: ['provision', 'request', 'store', 'present', 'match-against-public-set'],
    endpoints: {
      provision: '/wallet/provision',
      request: '/credentials/request',
      store: '/credentials/store',
      present: '/proofs/present',
      match: '/wallet/match-against-public-set',
    },
  }),
)

// ---------------------------------------------------------------------------
// Start both servers
// ---------------------------------------------------------------------------

async function main() {
  // Start HTTP server
  serve({ fetch: app.fetch, port: PORT })
  console.log(`[person-mcp] HTTP server on http://localhost:${PORT}`)
  console.log(`[person-mcp] Tools: ${Object.keys(toolHandlers).join(', ')}`)

  // Start MCP stdio server if stdin is a pipe (not a terminal)
  if (!process.stdin.isTTY) {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error('[person-mcp] MCP stdio transport connected')
  }
}

main().catch((err) => {
  console.error('[person-mcp] Fatal error:', err)
  process.exit(1)
})
