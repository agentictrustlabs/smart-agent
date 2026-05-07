import './config.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import { CATALYST_DID, ensureMembershipRegistered } from './issuers/membership.js'
import { credentialRoutes } from './api/credential.js'
import { oid4vciRoutes } from './api/oid4vci.js'

// ───────────────────────────────────────────────────────────────────────
// Tool registry — mirrors person-mcp's pattern. All tools are gated by
// `requireOrgPrincipal(token, toolName)` which verifies the delegation
// token (audience='urn:mcp:server:org') and enforces MCP tool scope.
// ───────────────────────────────────────────────────────────────────────
import { orgProfileTools } from './tools/org-profile.js'
import { membersTools } from './tools/members.js'
import { revenueTools } from './tools/revenue.js'
import { proposalsTools } from './tools/proposals.js'
import { activityTools } from './tools/activity.js'
import { orgIntentsTools } from './tools/intents.js'
import { orgNotificationsTools, orgBeliefsTools } from './tools/notifications-beliefs.js'
import { orgWorkItemsTools, engagementTools } from './tools/work-items-engagement.js'
import { grantProposalsTools } from './tools/grantProposals.js'
import { roundsTools } from './tools/rounds.js'
import { matchInitiationsTools } from './tools/matchInitiations.js'
import { poolPledgesTools } from './tools/poolPledges.js'
import { poolsTools } from './tools/pools.js'
import { proposalVotesTools } from './tools/proposalVotes.js'
import { fundingTools } from './tools/disbursements.js'

const allTools = {
  ...orgProfileTools,
  ...membersTools,
  ...revenueTools,
  ...proposalsTools,
  ...activityTools,
  ...orgIntentsTools,
  ...orgNotificationsTools,
  ...orgBeliefsTools,
  ...orgWorkItemsTools,
  ...engagementTools,
  ...grantProposalsTools,
  ...roundsTools,
  ...matchInitiationsTools,
  ...poolPledgesTools,
  ...poolsTools,
  ...proposalVotesTools,
  ...fundingTools,
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

// Tool dispatcher — same pattern as person-mcp
app.get('/tools', (c) => c.json({ tools: toolDefinitions }))

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

// Existing routes (OID4VCI / credential issuance) preserved unchanged
app.route('/', credentialRoutes)
app.route('/', oid4vciRoutes)

async function main() {
  await ensureMembershipRegistered()
  serve({ fetch: app.fetch, port: config.port })
  console.log(`[org-mcp] ${config.displayName} @ ${CATALYST_DID}`)
  console.log(`[org-mcp] tools: ${Object.keys(toolHandlers).length}`)
  console.log(`[org-mcp] listening on http://localhost:${config.port}`)
}

main().catch((err) => {
  console.error('[org-mcp] fatal:', err)
  process.exit(1)
})
