import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { handles } from '../db/schema'
import { config } from '../config'

const a2a = new Hono()

// ─── GET /.well-known/agent.json ────────────────────────────────────

a2a.get('/.well-known/agent.json', (c) => {
  return c.json({
    name: 'Smart Agent A2A',
    description:
      'Agent-to-Agent protocol server for Smart Agent accounts. Supports challenge-based authentication, session management, and delegation token minting.',
    version: '0.0.1',
    protocol: 'a2a',
    capabilities: {
      auth: {
        challenge: true,
        erc1271Verify: true,
      },
      sessions: {
        create: true,
        revoke: true,
        delegationTokenMint: true,
      },
      messaging: {
        handleRouting: true,
      },
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

  const message = await c.req.json()

  return c.json({
    status: 'received',
    handle,
  })
})

export { a2a }
