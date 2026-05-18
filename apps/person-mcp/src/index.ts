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
import { preferencesTools } from './tools/preferences.js'
import { oikosTools } from './tools/oikos.js'
import { prayersTools } from './tools/prayers.js'
import { trainingTools } from './tools/training.js'
import { pinnedTools } from './tools/pinned.js'
import { notificationsTools } from './tools/notifications.js'
import { beliefsTools } from './tools/beliefs.js'
import { coachingTools } from './tools/coaching.js'
import { intentsTools } from './tools/intents.js'
import { activitiesTools } from './tools/activities.js'
import { workItemsTools } from './tools/work-items.js'
import { crossDelegationsTools } from './tools/cross-delegations.js'
import { receivedDelegationsTools } from './tools/received-delegations.js'
import { grantProposalsTools } from './tools/grantProposals.js'
// Phase 4 — AgentRelationship MCP tools for person-side trust-graph writes.
import { relationshipTools } from './tools/relationship.js'
// Spec 004 v2 — person-mcp's `pool_pledge:*` and `match_initiation:*`
// stub tools were removed. Pledges and match initiations are
// authoritative on chain (PledgeRegistry / MatchInitiationRegistry);
// callers route through org-mcp.

// ---------------------------------------------------------------------------
// Collect all tool definitions and handlers
// ---------------------------------------------------------------------------

const allTools = {
  ...profileTools,
  ...identityTools,
  ...chatTools,
  ...ssiWalletTools,
  ...preferencesTools,
  ...oikosTools,
  ...prayersTools,
  ...trainingTools,
  ...pinnedTools,
  ...notificationsTools,
  ...beliefsTools,
  ...coachingTools,
  ...intentsTools,
  ...activitiesTools,
  ...workItemsTools,
  ...crossDelegationsTools,
  ...receivedDelegationsTools,
  ...grantProposalsTools,
  // Phase 4 additions.
  ...relationshipTools,
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

// Sprint 1 W2.1 — inbound service-auth on tool invocations. The MCP
// tool surface used to accept any caller that could reach the HTTP
// port; now every tool call must carry a valid `X-SA-Service: a2a-agent`
// HMAC envelope. The mcp-proxy in a2a-agent re-signs each forwarded
// request with the `a2a-to-person` MAC key before calling person-mcp.
//
// Applied per-route (not via `app.use('/tools/*')`) because Hono's
// wildcard pattern also catches the bare `GET /tools` listing route,
// which is an operator-debug surface that leaks no PII and stays open.
// `/health` is similarly open.
const toolsAuth = requireInboundServiceAuth()

/**
 * POST /tools/:toolName — HTTP entry point for MCP tool invocation.
 *
 * Gated on `requireInboundServiceAuth()` — the caller (a2a-agent mcp-proxy)
 * signs each forwarded request with the `a2a-to-person` MAC key. Each
 * underlying tool then runs its own delegation-token check via
 * `requirePrincipal()`, so this route doesn't peek at the body's `token`.
 *
 * Validation: `shape-check` — the request body is parsed into a thin
 * `{ tool?, args? }` envelope; the tool's own JSON Schema (`inputSchema`)
 * is enforced by each tool handler downstream.
 *
 * @sa-route service-only
 * @sa-auth service-hmac
 * @sa-rate-limit none
 * @sa-prod-gate always
 * @sa-validation shape-check
 * @sa-risk-tier high
 * @sa-owner developer
 */
app.post('/tools/:toolName', toolsAuth, async (c) => {
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

/**
 * GET /tools — operator-debug surface listing tool descriptors only.
 * No PII is exposed (just the same `inputSchema` metadata an MCP client
 * would see over stdio). Left open intentionally so an operator can curl
 * the port to verify the tool registry without holding the HMAC key.
 *
 * @sa-route public
 * @sa-auth none-system-scoped
 * @sa-rate-limit none
 * @sa-prod-gate always
 * @sa-owner developer
 */
app.get('/tools', (c) => {
  return c.json({ tools: toolDefinitions })
})

/**
 * GET /health — liveness probe. Returns OK status + tool count; no PII.
 *
 * @sa-route public
 * @sa-auth none-system-scoped
 * @sa-rate-limit none
 * @sa-prod-gate always
 * @sa-owner infra
 */
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
import {
  requireInboundServiceAuth,
  MAX_CLOCK_SKEW_SECONDS as INBOUND_MAX_CLOCK_SKEW_SECONDS,
} from './auth/require-inbound-service-auth.js'
import { cleanupOldNonces as cleanupInboundNonces } from './auth/replay-nonce.js'
// Sprint 4 A.3 — audit hash-chain external anchor for person-mcp (mirrors
// the a2a-agent scheduler that Sprint 3 S3.1 installed). Person-mcp signs
// its checkpoints by calling a2a-agent's `/auth/sign-checkpoint`; person-
// mcp itself holds no signing key.
import { schedulePersonMcpCheckpoints } from './lib/audit-checkpoint.js'

app.route('/', walletRoutes)
app.route('/', credentialRoutes)
app.route('/', proofRoutes)
app.route('/', auditRoutes)
app.route('/', oid4vpRoutes)
app.route('/', matchPublicSetRoutes)
app.route('/', walletActionRoutes)
app.route('/', dispatchRoutes)

/**
 * GET /.well-known/ssi-wallet.json — discovery manifest for OID4VCI /
 * OID4VP clients. Public per the well-known convention; reveals only the
 * endpoint paths + supported credential formats (no PII).
 *
 * @sa-route public
 * @sa-auth none-system-scoped
 * @sa-rate-limit none
 * @sa-prod-gate always
 * @sa-owner security
 */
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

  // Sprint 1 W2.1 — replay-nonce cache GC. Nonces older than 2× the
  // timestamp-skew window are safe to evict (the timestamp check alone
  // would reject any envelope that old). 5-minute interval; .unref() so
  // the timer never holds the process open.
  const NONCE_GC_INTERVAL_MS = 5 * 60 * 1000
  const NONCE_MAX_AGE_SECONDS = 2 * INBOUND_MAX_CLOCK_SKEW_SECONDS
  setInterval(() => {
    try {
      const deleted = cleanupInboundNonces(NONCE_MAX_AGE_SECONDS)
      if (deleted > 0) console.log(`[person-mcp nonce-gc] evicted ${deleted} expired replay-nonce rows`)
    } catch (err) {
      console.error('[person-mcp nonce-gc] failed:', err)
    }
  }, NONCE_GC_INTERVAL_MS).unref()

  // ─── Sprint 4 A.3 — Audit checkpoint scheduler ───────────────────
  // Sign and persist a chain-head snapshot of person-mcp's audit_log on
  // a periodic interval (15 min prod / 1 min dev). When
  // `AUDIT_CHECKPOINT_SINK_URL` is set the checkpoint is also POSTed to
  // the external sink so an attacker who tampers with person-mcp's local
  // SQLite cannot also rewrite the external history. Signing routes
  // through a2a-agent's master signer (see
  // `apps/person-mcp/src/lib/audit-checkpoint.ts`).
  schedulePersonMcpCheckpoints()
  if (process.env.AUDIT_CHECKPOINT_SINK_URL) {
    console.log(
      `[person-mcp audit-checkpoint] sink configured: ${process.env.AUDIT_CHECKPOINT_SINK_URL}`,
    )
  } else {
    console.log(
      '[person-mcp audit-checkpoint] no external sink (AUDIT_CHECKPOINT_SINK_URL unset) — local-only archive',
    )
  }

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
