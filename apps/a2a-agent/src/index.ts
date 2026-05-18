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
import {
  assertPolicyCompleteness,
  assertMarketplacePolicy,
  assertDeployerKeyPolicy,
  assertLegacySessionPolicy,
  assertProductionKeyHygiene,
  assertAuditSinkConfigured,
  assertGcpEnvComplete,
} from './lib/policy-startup'
import { cleanupOldNonces } from './auth/replay-nonce'
import { MAX_CLOCK_SKEW_SECONDS } from './auth/inter-service'
import { scheduleCheckpoints } from './lib/audit-checkpoint'

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

// Hardening §1.3 (Stream B Task B1) + Sprint 5 P1-1 — web → a2a-agent
// passthroughs for the SessionRecord lifecycle and WalletAction
// dispatch. EVERY session-store route (insert/revoke/bump-epoch reads
// and writes) gates on `requireServiceAuth('web')` using
// `WEB_TO_A2A_HMAC_KEY`. The reads were closed in P1-1 — they leak
// session metadata (cookie ↔ account binding, active-session list,
// revocation epoch). WalletAction dispatch writes follow the same
// pattern.
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

// Sprint 5 P0-8 — when MARKETPLACE_ENABLED=true every marketplace tool
// MUST have selectors. When false, the redeem route 503s marketplace
// traffic and this assert is a no-op. Same module, separate helper so
// the error message can point at the marketplace-specific tables.
assertMarketplacePolicy()

// Sprint 5 W3 P0-7 — production key-hygiene guard. When A2A_KMS_BACKEND
// is a managed-KMS backend ('aws-kms' or 'gcp-kms') in production, refuse
// to boot if any per-process static signing/HMAC key or backend-specific
// static credential is present in the env. Mirrors what the GCP arm has
// always enforced and brings AWS to parity with the broader forensics-
// liability set the docs claim. Defense in depth: `buildKeyProvider`
// also calls the shared helper from the AWS arm so lazy code paths
// can't miss the check.
assertProductionKeyHygiene()

// GCP-KMS G-PR-6 — top-level "is the GCP env fully provisioned" check.
// Companion to assertProductionKeyHygiene: that helper enforces what must
// NOT be set (forensics-liability env vars); this one enforces what MUST
// be set when A2A_KMS_BACKEND='gcp-kms' — every identifier across the
// session envelope, master signer, tool-executor signers, and
// inter-service MAC keys. The error message lists EVERY missing var in
// one punch list so the operator can fix them all in a single edit.
// No-op when the backend is not gcp-kms.
assertGcpEnvComplete()

// Sprint 5 P0-9 — DEPLOYER_PRIVATE_KEY hard-fails in production. The
// `assertDeployerKeyPolicy` helper replaces the prior WARN-only path:
// production startup refuses if the key is present, unless the operator
// time-boxes a break-glass via ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL. When
// the break-glass is active a structured WARN is emitted AND a
// `system:break-glass-deployer-key` audit row is written. The companion
// CI invariant in `scripts/check-no-bypass.sh` prevents the key from
// being re-introduced into route handler code (K6).
//
// Sprint 5 P1-5 — production MUST have AUDIT_CHECKPOINT_SINK_URL set
// AND reachable at boot. Without an external attestation the audit
// chain is not tamper-evident; we refuse to start rather than serve
// requests whose audit trail is not externally witnessed.
//
// Both calls are async so we wrap them in an IIFE that gates `serve()`
// at the bottom of the file. The synchronous asserts above can stay
// top-level; only the audit-row write + sink probe need awaiting.
async function runAsyncStartupInvariants(): Promise<void> {
  await assertDeployerKeyPolicy()
  // Sprint 5 W3 P0-7 — when an operator explicitly opts into the legacy
  // a2a-sessions fallback in production via ALLOW_LEGACY_A2A_SESSIONS=true,
  // emit a structured WARN and write a `system:break-glass-legacy-a2a-sessions`
  // audit row so the chain head reflects the operator-known posture at boot.
  // Mirrors `assertDeployerKeyPolicy`. The middleware behavior is unchanged
  // (the audit row is purely observability; Path B still works when enabled).
  await assertLegacySessionPolicy()
  await assertAuditSinkConfigured()
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

// ─── Sprint 3 S3.1 — Audit checkpoint scheduler ─────────────────────
// Sign and persist a chain-head snapshot on a periodic interval (15 min
// in prod / 1 min in dev). When `AUDIT_CHECKPOINT_SINK_URL` is set the
// checkpoint is also POSTed to the external sink so an attacker who
// tampers with local SQLite cannot also rewrite the external history.
// See `apps/a2a-agent/src/lib/audit-checkpoint.ts` + the operator
// runbook (`docs/operations/kms-signer-setup.md` § AUDIT_CHECKPOINT_SINK_URL).
scheduleCheckpoints()
if (process.env.AUDIT_CHECKPOINT_SINK_URL) {
  console.log(`[audit-checkpoint] sink configured: ${process.env.AUDIT_CHECKPOINT_SINK_URL}`)
} else {
  console.log('[audit-checkpoint] no external sink (AUDIT_CHECKPOINT_SINK_URL unset) — local-only archive')
}

// ─── Start Server ───────────────────────────────────────────────────
console.log(`Smart Agent A2A server starting on port ${config.PORT}`)
console.log(`  Chain ID:    ${config.CHAIN_ID}`)
console.log(`  RPC URL:     ${config.RPC_URL}`)
console.log(`  host routing: *.${config.A2A_HOST_BASE}:${config.PORT}`)
console.log(`  Agent card:  http://<slug>.${config.A2A_HOST_BASE}:${config.PORT}/.well-known/agent.json`)
// Sprint 1 W2.2 — startup invariants summary line. Surfaces both the
// envelope-encryption backend and the legacy-session kill-switch state
// in the boot log so an operator inspecting a deploy can confirm the
// posture at a glance.
console.log(
  `  startup posture: NODE_ENV=${config.NODE_ENV} A2A_KMS_BACKEND=${config.A2A_KMS_BACKEND} ` +
    `ALLOW_LEGACY_A2A_SESSIONS=${config.ALLOW_LEGACY_A2A_SESSIONS}`,
)

// Sprint 5 P0-9 + P1-5 — gate `serve()` on the async invariants. A
// failure here exits the process with the thrown error before the
// listener binds, matching the dev-time behaviour of the synchronous
// asserts above.
runAsyncStartupInvariants()
  .then(() => {
    serve(
      {
        fetch: app.fetch,
        port: config.PORT,
      },
      (info) => {
        console.log(`Smart Agent A2A server listening on http://localhost:${info.port}`)
      },
    )
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[startup] async invariant failed: ${msg}`)
    process.exit(1)
  })
