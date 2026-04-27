import './config.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import { GEO_ISSUER_DID, ensureLocationRegistered } from './issuers/location.js'
import { credentialRoutes } from './api/credential.js'

const app = new Hono()
app.use('*', logger())

app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'geo-mcp',
  issuerDid: GEO_ISSUER_DID,
  displayName: config.displayName,
  port: config.port,
}))

app.get('/.well-known/agent.json', (c) => c.json({
  name: config.displayName,
  role: 'issuer',
  did: GEO_ISSUER_DID,
  credentialTypes: ['GeoLocationCredential'],
  endpoints: {
    offer: '/credential/offer',
    issue: '/credential/issue',
  },
}))

app.route('/', credentialRoutes)

async function main() {
  await ensureLocationRegistered()
  serve({ fetch: app.fetch, port: config.port })
  console.log(`[geo-mcp] ${config.displayName} @ ${GEO_ISSUER_DID}`)
  console.log(`[geo-mcp] listening on http://localhost:${config.port}`)
}

main().catch((err) => {
  console.error('[geo-mcp] fatal:', err)
  process.exit(1)
})
