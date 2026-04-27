import './config.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import { verifyRoutes, getVerifierIdentity } from './api/verify.js'
import { listSpecs } from './verifiers/specs.js'

const app = new Hono()
app.use('*', logger())

app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'verifier-mcp',
  ...getVerifierIdentity(),
  port: config.port,
}))

app.get('/.well-known/agent.json', (c) => {
  const id = getVerifierIdentity()
  return c.json({
    name: id.displayName,
    role: 'verifier',
    did: id.did,
    address: id.address,
    credentialTypes: listSpecs().map(s => s.credentialType),
    endpoints: {
      // Templated routes — caller picks the credential type.
      requestTemplate: '/verify/:credentialType/request',
      checkTemplate:   '/verify/:credentialType/check',
      list:            '/verify/specs',
    },
  })
})

app.route('/', verifyRoutes)

serve({ fetch: app.fetch, port: config.port })
console.log(`[verifier-mcp] ${config.displayName} @ ${getVerifierIdentity().did}`)
console.log(`[verifier-mcp] listening on http://localhost:${config.port}`)
