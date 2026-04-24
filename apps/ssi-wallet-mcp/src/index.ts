import './config.js'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'

// Register the native AnonCreds binding exactly once for this process.
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import { AnonCreds } from '@smart-agent/privacy-creds'
AnonCreds.registerNativeBinding(anoncredsNodeJS)
import { walletRoutes } from './api/wallet.js'
import { credentialRoutes } from './api/credentials.js'
import { proofRoutes } from './api/proofs.js'
import { auditRoutes } from './api/audit.js'
import { oid4vpRoutes } from './api/oid4vp.js'

const app = new Hono()
app.use('*', logger())

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'ssi-wallet-mcp',
    port: config.port,
    askarStore: config.askarStorePath,
    chainId: config.chainId,
  }),
)

app.get('/.well-known/ssi-wallet.json', (c) =>
  c.json({
    name: 'Smart Agent SSI Wallet',
    version: '0.1.0',
    formats: ['anoncreds-v1'],
    capabilities: ['provision', 'request', 'store', 'present'],
    endpoints: {
      provision: '/wallet/provision',
      request: '/credentials/request',
      store: '/credentials/store',
      present: '/proofs/present',
    },
  }),
)

app.route('/', walletRoutes)
app.route('/', credentialRoutes)
app.route('/', proofRoutes)
app.route('/', auditRoutes)
app.route('/', oid4vpRoutes)

serve({ fetch: app.fetch, port: config.port })
console.log(`[ssi-wallet-mcp] listening on http://localhost:${config.port}`)
console.log(`[ssi-wallet-mcp] askar store: ${config.askarStorePath}`)
console.log(`[ssi-wallet-mcp] sqlite db:   ${config.dbPath}`)
console.log(`[ssi-wallet-mcp] registry db: ${config.registryPath}`)
