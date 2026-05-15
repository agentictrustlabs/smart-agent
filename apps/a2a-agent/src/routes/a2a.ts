import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { handles } from '../db/schema'
import { config } from '../config'

const a2a = new Hono()

// ─── GET /.well-known/agent.json ────────────────────────────────────
//
// Host-aware. When the request arrives at a subdomain that resolved
// to a concrete agent principal, return that agent's metadata. Otherwise
// (bare port — for service discovery / health checks) return the generic
// process-level card.

a2a.get('/.well-known/agent.json', (c) => {
  const host = c.req.header('Host') ?? c.req.header('host') ?? `localhost:${config.PORT}`
  const proto = c.req.header('X-Forwarded-Proto') ?? 'http'
  const origin = `${proto}://${host}`
  const ctx = c.get('agentHostContext')

  if (ctx) {
    return c.json({
      name: ctx.displayName,
      slug: ctx.slug,
      agentAddress: ctx.agentAddress,
      agentType: ctx.agentType,
      description: `Smart Agent A2A endpoint for ${ctx.displayName}`,
      version: '0.0.1',
      protocol: 'a2a',
      capabilities: {
        auth: { challenge: true, erc1271Verify: true },
        sessions: { create: true, revoke: true, delegationTokenMint: true },
        messaging: { handleRouting: true },
      },
      endpoints: {
        challenge: `${origin}/auth/challenge`,
        verify: `${origin}/auth/verify`,
        sessionInit: `${origin}/session/init`,
        delegationMint: `${origin}/delegation/mint`,
        agentMessage: `${origin}/a2a/:handle`,
        mcpProxy: `${origin}/mcp/:server/:tool`,
      },
      chainId: config.CHAIN_ID,
    })
  }

  // Generic (no host context). Discoverable for tooling that hits the
  // bare port, but not bound to any specific principal.
  return c.json({
    name: 'Smart Agent A2A',
    description:
      'Agent-to-Agent protocol server for Smart Agent accounts. Per-agent endpoints are served on subdomains of the configured host base.',
    version: '0.0.1',
    protocol: 'a2a',
    hostBase: config.A2A_HOST_BASE,
    capabilities: {
      auth: { challenge: true, erc1271Verify: true },
      sessions: { create: true, revoke: true, delegationTokenMint: true },
      messaging: { handleRouting: true },
    },
    endpoints: {
      challenge: '/auth/challenge',
      verify: '/auth/verify',
      sessionInit: '/session/init',
      delegationMint: '/delegation/mint',
      agentMessage: '/a2a/:handle',
    },
    chainId: config.CHAIN_ID,
  })
})

// ─── POST /a2a/:handle ─────────────────────────────────────────────

a2a.post('/:handle', async (c) => {
  const handle = c.req.param('handle')

  const [row] = await db
    .select()
    .from(handles)
    .where(eq(handles.handle, handle))
    .limit(1)

  if (!row) {
    return c.json({ error: 'Handle not found' }, 404)
  }

  // Reserved for forward A2A messaging; today we just acknowledge.
  await c.req.json().catch(() => ({}))

  return c.json({
    status: 'received',
    handle,
  })
})

export { a2a }
