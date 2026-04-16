import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config'
import { auth } from './routes/auth'
import { session } from './routes/session'
import { delegation } from './routes/delegation'
import { profile } from './routes/profile'
import { a2a } from './routes/a2a'

const app = new Hono()

// ─── Middleware ──────────────────────────────────────────────────────
app.use('*', logger())

// ─── Health ─────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok' }))

// ─── Route Groups ───────────────────────────────────────────────────
app.route('/auth', auth)
app.route('/session', session)
app.route('/delegation', delegation)
app.route('/profile', profile)

// Mount a2a at root so /.well-known/agent.json works
app.route('/', a2a)

// ─── Start Server ───────────────────────────────────────────────────
console.log(`Smart Agent A2A server starting on port ${config.PORT}`)
console.log(`  Chain ID: ${config.CHAIN_ID}`)
console.log(`  RPC URL:  ${config.RPC_URL}`)
console.log(`  Agent card: http://localhost:${config.PORT}/.well-known/agent.json`)

serve({
  fetch: app.fetch,
  port: config.PORT,
}, (info) => {
  console.log(`Smart Agent A2A server listening on http://localhost:${info.port}`)
})
