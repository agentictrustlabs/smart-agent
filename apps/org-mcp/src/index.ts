import './config.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import { CATALYST_DID, ensureMembershipRegistered } from './issuers/membership.js'
import { credentialRoutes } from './api/credential.js'
import { oid4vciRoutes } from './api/oid4vci.js'

const app = new Hono()
app.use('*', logger())

app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'org-mcp',
  issuerDid: CATALYST_DID,
  displayName: config.displayName,
  port: config.port,
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
  },
}))

app.route('/', credentialRoutes)
app.route('/', oid4vciRoutes)

async function main() {
  await ensureMembershipRegistered()
  serve({ fetch: app.fetch, port: config.port })
  console.log(`[org-mcp] ${config.displayName} @ ${CATALYST_DID}`)
  console.log(`[org-mcp] listening on http://localhost:${config.port}`)
}

main().catch((err) => {
  console.error('[org-mcp] fatal:', err)
  process.exit(1)
})
