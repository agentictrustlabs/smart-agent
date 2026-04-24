import './config.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import { FAMILY_DID, ensureGuardianRegistered } from './issuers/guardian.js'
import { credentialRoutes } from './api/credential.js'
import { verifyRoutes } from './api/verify.js'

const app = new Hono()
app.use('*', logger())

app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'family-mcp',
  did: FAMILY_DID,
  displayName: config.displayName,
  port: config.port,
}))

app.get('/.well-known/agent.json', (c) => c.json({
  name: config.displayName,
  roles: ['issuer', 'verifier'],
  did: FAMILY_DID,
  credentialTypes: ['GuardianOfMinorCredential'],
  endpoints: {
    offer: '/credential/offer',
    issue: '/credential/issue',
    verifyRequest: '/verify/guardian/request',
    verifyCheck: '/verify/guardian/check',
  },
}))

app.route('/', credentialRoutes)
app.route('/', verifyRoutes)

async function main() {
  await ensureGuardianRegistered()
  serve({ fetch: app.fetch, port: config.port })
  console.log(`[family-mcp] ${config.displayName} @ ${FAMILY_DID}`)
  console.log(`[family-mcp] listening on http://localhost:${config.port}`)
}

main().catch((err) => {
  console.error('[family-mcp] fatal:', err)
  process.exit(1)
})
