import './config.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import { SKILL_ISSUER_DID, ensureSkillsRegistered } from './issuers/skill.js'
import { credentialRoutes } from './api/credential.js'

const app = new Hono()
app.use('*', logger())

app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'skill-mcp',
  issuerDid: SKILL_ISSUER_DID,
  displayName: config.displayName,
  port: config.port,
}))

app.get('/.well-known/agent.json', (c) => c.json({
  name: config.displayName,
  role: 'issuer',
  did: SKILL_ISSUER_DID,
  credentialTypes: ['SkillsCredential'],
  endpoints: {
    offer: '/credential/offer',
    issue: '/credential/issue',
  },
}))

app.route('/', credentialRoutes)

async function main() {
  await ensureSkillsRegistered()
  serve({ fetch: app.fetch, port: config.port })
  console.log(`[skill-mcp] ${config.displayName} @ ${SKILL_ISSUER_DID}`)
  console.log(`[skill-mcp] listening on http://localhost:${config.port}`)
}

main().catch((err) => {
  console.error('[skill-mcp] fatal:', err)
  process.exit(1)
})
