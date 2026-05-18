import './config.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import { CATALYST_DID, ensureMembershipRegistered } from './issuers/membership.js'
import { ensureMarketplaceCredsRegistered } from './issuers/marketplaceCreds.js'
import { credentialRoutes } from './api/credential.js'
import { oid4vciRoutes } from './api/oid4vci.js'
// Sprint 4 A.1 — inbound service-auth on org-mcp's tool surface.
import {
  requireInboundServiceAuth,
  MAX_CLOCK_SKEW_SECONDS as INBOUND_MAX_CLOCK_SKEW_SECONDS,
} from './auth/require-inbound-service-auth.js'
import { cleanupOldNonces as cleanupInboundNonces } from './auth/replay-nonce.js'

// ───────────────────────────────────────────────────────────────────────
// Tool registry — mirrors person-mcp's pattern. All tools are gated by
// `requireOrgPrincipal(token, toolName)` which verifies the delegation
// token (audience='urn:mcp:server:org') and enforces MCP tool scope.
// ───────────────────────────────────────────────────────────────────────
import { orgProfileTools } from './tools/org-profile.js'
import { membersTools } from './tools/members.js'
import { revenueTools } from './tools/revenue.js'
import { activityTools } from './tools/activity.js'
import { orgIntentsTools } from './tools/intents.js'
import { orgNotificationsTools, orgBeliefsTools } from './tools/notifications-beliefs.js'
import { orgWorkItemsTools, engagementTools } from './tools/work-items-engagement.js'
import { grantProposalsTools } from './tools/grantProposals.js'
import { poolsTools } from './tools/pools.js'
import { roundsTools } from './tools/rounds.js'
import { matchInitiationsTools } from './tools/matchInitiations.js'
import { poolPledgesTools } from './tools/poolPledges.js'
import { proposalVotesTools } from './tools/proposalVotes.js'
import { fundingTools } from './tools/disbursements.js'
import { marketplaceCredIssuanceTools } from './tools/marketplaceCredIssuance.js'
// Phase 4 — A2A-first routing consolidation.
import { agentResolverTools } from './tools/agent_resolver.js'
import { proposalRegistryTools } from './tools/proposal_registry.js'
import { commitmentTools } from './tools/commitment.js'
import { fundRegistryReadTools } from './tools/fund_registry_read.js'
import { poolRegistryReadTools } from './tools/pool_registry_read.js'
import { agentDeployTools } from './tools/agent_deploy.js'

const allTools = {
  ...orgProfileTools,
  ...membersTools,
  ...revenueTools,
  ...activityTools,
  ...orgIntentsTools,
  ...orgNotificationsTools,
  ...orgBeliefsTools,
  ...orgWorkItemsTools,
  ...engagementTools,
  ...grantProposalsTools,
  ...poolsTools,
  ...roundsTools,
  ...matchInitiationsTools,
  ...poolPledgesTools,
  ...proposalVotesTools,
  ...fundingTools,
  ...marketplaceCredIssuanceTools,
  // Phase 4 additions.
  ...agentResolverTools,
  ...proposalRegistryTools,
  ...commitmentTools,
  ...fundRegistryReadTools,
  ...poolRegistryReadTools,
  ...agentDeployTools,
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
  service: 'org-mcp',
  issuerDid: CATALYST_DID,
  displayName: config.displayName,
  port: config.port,
  tools: Object.keys(toolHandlers).length,
}))

app.get('/.well-known/agent.json', (c) => c.json({
  name: config.displayName,
  role: 'issuer',
  did: CATALYST_DID,
  credentialTypes: ['OrgMembershipCredential'],
  endpoints: {
    offer: '/credential/offer',
    issue: '/credential/issue',
    oid4vciMetadata: '/.well-known/openid-credential-issuer',
    tools: '/tools',
  },
}))

// Sprint 4 A.1 — inbound service-auth on tool invocations. The MCP
// tool surface used to accept any caller that could reach the HTTP
// port; now every tool call must carry a valid `X-SA-Service: a2a-agent`
// HMAC envelope. The mcp-proxy in a2a-agent re-signs each forwarded
// request with the `a2a-to-org` MAC key before calling org-mcp.
//
// Applied per-route (not via `app.use('/tools/*')`) because Hono's
// wildcard pattern also catches the bare `GET /tools` listing route,
// which is an operator-debug surface that leaks no PII and stays open.
// `/health` is similarly open.
const toolsAuth = requireInboundServiceAuth()

// Tool dispatcher — same pattern as person-mcp
app.get('/tools', (c) => c.json({ tools: toolDefinitions }))

app.post('/tools/:toolName', toolsAuth, async (c) => {
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

// Existing routes (OID4VCI / credential issuance) preserved unchanged
app.route('/', credentialRoutes)
app.route('/', oid4vciRoutes)

async function main() {
  await ensureMembershipRegistered()
  await ensureMarketplaceCredsRegistered()
  serve({ fetch: app.fetch, port: config.port })
  console.log(`[org-mcp] ${config.displayName} @ ${CATALYST_DID}`)
  console.log(`[org-mcp] tools: ${Object.keys(toolHandlers).length}`)
  console.log(`[org-mcp] listening on http://localhost:${config.port}`)

  // Sprint 4 A.1 — replay-nonce cache GC. Nonces older than 2× the
  // timestamp-skew window are safe to evict (the timestamp check alone
  // would reject any envelope that old). 5-minute interval; .unref() so
  // the timer never holds the process open.
  const NONCE_GC_INTERVAL_MS = 5 * 60 * 1000
  const NONCE_MAX_AGE_SECONDS = 2 * INBOUND_MAX_CLOCK_SKEW_SECONDS
  setInterval(() => {
    try {
      const deleted = cleanupInboundNonces(NONCE_MAX_AGE_SECONDS)
      if (deleted > 0) console.log(`[org-mcp nonce-gc] evicted ${deleted} expired replay-nonce rows`)
    } catch (err) {
      console.error('[org-mcp nonce-gc] failed:', err)
    }
  }, NONCE_GC_INTERVAL_MS).unref()
}

main().catch((err) => {
  console.error('[org-mcp] fatal:', err)
  process.exit(1)
})
