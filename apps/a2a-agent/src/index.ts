import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { bodyLimit } from 'hono/body-limit'
import { config } from './config'
import { auth } from './routes/auth'
import { session } from './routes/session'
import { delegation } from './routes/delegation'
import { profile } from './routes/profile'
import { mcpProxy } from './routes/mcp-proxy'
import { onchainRedeem } from './routes/onchain-redeem'
import { sessionMeta } from './routes/session-meta'
import { sessionStore } from './routes/session-store'
import { walletAction } from './routes/wallet-action'
import { a2a } from './routes/a2a'
import { hostContext } from './middleware/host-context'
import { rateLimit } from './middleware/rate-limit'
import { correlationId } from './middleware/correlation-id'
import { assertPolicyCompleteness } from './lib/policy-startup'
import { cleanupOldNonces } from './auth/replay-nonce'
import { MAX_CLOCK_SKEW_SECONDS } from './auth/inter-service'

const app = new Hono()

// ─── Middleware ──────────────────────────────────────────────────────
app.use('*', logger())

// Hardening Phase 1D — cross-service correlation id. MUST sit before
// any middleware that may write an audit-deny row so the id is on the
// context when the deny is recorded.
app.use('*', correlationId)

// Body-size cap (HARDENING-PLAN §1.5 #9). 256 KB default; routes that
// legitimately need larger bodies override per-route.
app.use(
  '*',
  bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ error: 'body too large' }, 413),
  }),
)
// /session/package carries WebAuthn assertions + caveat blobs.
app.use(
  '/session/package',
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: 'body too large' }, 413),
  }),
)

// Per-IP sliding-window rate limit (HARDENING-PLAN §1.5 #9). 60 req/min
// global; tightened on auth + session-init bootstrap surfaces. In-memory
// store; multi-instance deployments MUST migrate to Redis.
app.use('*', rateLimit({ windowMs: 60_000, max: 60 }))
app.use('/session/init', rateLimit({ windowMs: 60_000, max: 10 }))
app.use('/auth/*', rateLimit({ windowMs: 60_000, max: 10 }))

// Host-context MUST sit before every route. It binds the request to a
// specific agent principal based on the subdomain in the Host header and
// rejects non-public routes that arrive without a resolvable subdomain.
app.use('*', hostContext)

// ─── Health ─────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ status: 'ok' }))

// ─── Route Groups ───────────────────────────────────────────────────
app.route('/auth', auth)
app.route('/session', session)
app.route('/delegation', delegation)
app.route('/profile', profile)
app.route('/mcp', mcpProxy)

// Phase 1 — Inter-service on-chain redeem (HMAC auth, NOT session bearer).
// Mounted under /session so the path params (:id) match the canonical
// HMAC canonical-message format used by callers (signed as bodyJson:ts:sessionId).
app.route('/session', onchainRedeem)

// Phase 4 — Permission UI metadata endpoints (status, audit).
// Mounted under /session; matches the suffixed paths /session/:id/status and
// /session/:id/audit which don't collide with the bare /session/:id handler.
app.route('/session', sessionMeta)

// Hardening §1.3 (Stream B Task B1) — web → a2a-agent passthroughs for
// the SessionRecord lifecycle and WalletAction dispatch. Write routes
// (insert/revoke/bump-epoch/dispatch) gate on `requireServiceAuth('web')`
// using `WEB_TO_A2A_HMAC_KEY`. Read routes (epoch/by-cookie/active) stay
// unauthenticated at the a2a edge for now — read-only and idempotent.
app.route('/session-store', sessionStore)
app.route('/wallet-action', walletAction)

// Mount a2a at root so /.well-known/agent.json works
app.route('/', a2a)

// ─── Startup invariants ─────────────────────────────────────────────
// Fail-fast if a TOOL_POLICY is missing its selector mapping. Pairs
// with the strict `if (!allowedSelectors.has(selector))` guard in
// onchain-redeem.ts — empty selector sets used to fail OPEN; now
// they (a) cannot exist at boot, and (b) reject every call if they
// somehow do.
assertPolicyCompleteness()

// Hardening K6 — DEPLOYER_PRIVATE_KEY runtime warning. The deployer
// key is a CI/CD-only secret used by `forge script Deploy.s.sol`. Its
// presence in a production runtime env is a misconfiguration. We log
// loudly but do not throw (would break boot during sensitive migration
// windows). The companion CI invariant in `scripts/check-no-bypass.sh`
// prevents the key from being re-introduced into route handler code.
// See `docs/operations/kms-signer-setup.md` § "Deployer key (K6 —
// CI/CD only)" for the operator runbook.
if (process.env.NODE_ENV === 'production' && process.env.DEPLOYER_PRIVATE_KEY) {
  console.warn(
    '[K6 WARNING] DEPLOYER_PRIVATE_KEY is set in a production environment. ' +
      'The deployer key is a CI/CD-only secret; it must NOT be available at ' +
      'runtime. Remove it from your production env. See ' +
      'docs/operations/kms-signer-setup.md § "Deployer key (K6 — CI/CD only)".',
  )
}

// ─── Replay-nonce cache cleanup ─────────────────────────────────────
// Hardening §1.10. Nonces older than 2× the timestamp-skew window are
// safe to evict — the timestamp check alone would reject any envelope
// that old. Runs every 5 minutes (light SQLite DELETE on indexed col).
const NONCE_GC_INTERVAL_MS = 5 * 60 * 1000
const NONCE_MAX_AGE_SECONDS = 2 * MAX_CLOCK_SKEW_SECONDS
setInterval(() => {
  try {
    const deleted = cleanupOldNonces(NONCE_MAX_AGE_SECONDS)
    if (deleted > 0) console.log(`[nonce-gc] evicted ${deleted} expired replay-nonce rows`)
  } catch (err) {
    console.error('[nonce-gc] failed:', err)
  }
}, NONCE_GC_INTERVAL_MS).unref()

// ─── Start Server ───────────────────────────────────────────────────
console.log(`Smart Agent A2A server starting on port ${config.PORT}`)
console.log(`  Chain ID:    ${config.CHAIN_ID}`)
console.log(`  RPC URL:     ${config.RPC_URL}`)
console.log(`  host routing: *.${config.A2A_HOST_BASE}:${config.PORT}`)
console.log(`  Agent card:  http://<slug>.${config.A2A_HOST_BASE}:${config.PORT}/.well-known/agent.json`)

serve({
  fetch: app.fetch,
  port: config.PORT,
}, (info) => {
  console.log(`Smart Agent A2A server listening on http://localhost:${info.port}`)
})
