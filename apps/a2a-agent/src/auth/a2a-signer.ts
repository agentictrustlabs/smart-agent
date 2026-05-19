/**
 * Master-EOA signer wrapper (KMS migration K4 PR-1 / §7 of K4 plan).
 *
 * Lazy singletons for the master-EOA signer backend + the viem
 * `LocalAccount` adapter. Every call site that previously called
 * `privateKeyToAccount(config.A2A_MASTER_EOA_PRIVATE_KEY)` now goes
 * through `getMasterSigner()` instead.
 *
 * ── Spec 007 Phase B — `getRelayOnlySigner()` flavor ──────────────
 *
 * Phase A dropped master from every user account's owner set. After
 * Phase B, master MUST NOT sign anything that recovers to a user's
 * authority — its only on-chain role is `EntryPoint.handleOps` (the
 * 4337 bundler relay). `getRelayOnlySigner()` returns a viem account
 * whose `signMessage` / `signTypedData` / `signTransaction` THROW so
 * that a future regression that tries to use master to forge a userOp
 * signature fails loud at compile-runtime instead of silently producing
 * an invalid signature.
 *
 * `getMasterSigner()` keeps its broader role for:
 *   - inter-service MAC envelope authentication
 *   - audit checkpoint signing
 *   - session-issuance co-signing (Variant B envelope)
 *
 * Outside `onchain-redeem.ts` and the relay path, prefer the relay-only
 * flavor for any call that lands at EntryPoint.
 *
 * Why a singleton:
 *   - `buildSignerBackend` validates env synchronously; instantiating on
 *     every call site would multiply the cost of env parsing.
 *   - The signer's `getSignerAddress()` is cached internally (immutable
 *     for the lifetime of the process — secp256k1 key material doesn't
 *     change), so producing one `LocalAccount` per use is wasteful.
 *
 * Why lazy:
 *   - Tests set `process.env.A2A_KMS_BACKEND` / `A2A_MASTER_PRIVATE_KEY`
 *     after module load. Eager instantiation would read the env before
 *     the test fixture runs. `__resetMasterSignerForTests()` is the test
 *     hook to drop the cached pair.
 *
 * The wrapper deliberately does NOT consume `config` — it reads
 * `process.env` directly so it composes with the lazy `config` loader and
 * matches the pattern used by `encryption.ts`. Tests that exercise the
 * branches of `buildSignerBackend` can mutate `process.env` and call
 * `__resetMasterSignerForTests()` between cases.
 */
import type { LocalAccount } from 'viem'
import {
  createKmsAccount,
  toolEnvKeyName,
  type KmsAccountBackend,
  type ToolExecutorId,
  type ToolExecutorSignerBackend,
} from '@smart-agent/sdk/key-custody'
import {
  buildSignerBackend,
  buildToolExecutorBackend,
  type KeyProviderEnv,
  type SignerAuditEvent,
} from './key-provider'
import { auditAppend } from '../lib/audit'

/**
 * Sprint 3 S3.2 — write a `kms-sign` audit row for every successful
 * `signA2AAction` call. Best-effort: failures are logged but never
 * cancel the signature (the call already committed at the KMS side).
 *
 * `toolId` is the per-tool family identifier when the audit comes from
 * a tool-executor signer; `master` (the literal string) when it comes
 * from the master EOA signer. Both end up in the `mcpTool` column.
 */
function makeSignerAudit(toolId: ToolExecutorId | 'master'): (event: SignerAuditEvent) => Promise<void> {
  return async (event) => {
    // Sprint 3 S3.1 — the audit-checkpoint signing path is internal
    // observability, not an authority-bearing action. The checkpoint
    // module marks its signs with a `checkpoint:` actionId prefix so
    // the hook can skip them. Without this guard every checkpoint
    // emit would write a kms-sign row, which would in turn shift the
    // chain head and force the next checkpoint to attest a different
    // head than the one we intended to anchor.
    if (event.actionId.startsWith('checkpoint:')) return
    try {
      await auditAppend({
        rootGrantHash: '',
        sessionId: event.sessionId,
        sessionPrincipal: event.accountAddress,
        mcpServer: 'a2a-agent',
        mcpTool: toolId === 'master' ? 'kms:sign:master' : `kms:sign:${toolId}`,
        eventType: 'kms-sign',
        executionPath: 'mcp-only',
        target: event.keyId,
        toolExecutor: event.signerAddress,
        status: 'completed',
        // The audit chain needs a deterministic unique mcpCallId per row.
        // Construct one from the actionId so it's chase-able from a chain
        // receipt without colliding with the parent execution row's
        // mcpCallId. Note: the parent execution row uses the raw actionId;
        // we suffix this row so the UNIQUE constraint on mcp_call_id
        // doesn't fight us.
        mcpCallId: `kms-sign:${event.actionId}:${event.signerAddress.toLowerCase()}:${Date.now()}`,
      })
    } catch (err) {
      console.error('[a2a-signer audit] kms-sign row insert failed:', err)
    }
  }
}

let backendSingleton: KmsAccountBackend | null = null
let accountSingleton: LocalAccount | null = null

// K5 — per-tool-executor backend + LocalAccount caches. Separate Maps
// from the master singleton so a master-signer reset doesn't drop tool
// caches and vice-versa.
const toolExecutorBackendCache = new Map<ToolExecutorId, ToolExecutorSignerBackend>()
const toolExecutorAccountCache = new Map<ToolExecutorId, LocalAccount>()

/**
 * Returns the lazily-built master-EOA signer backend. Throws cleanly if
 * the current `A2A_KMS_BACKEND` is unsupported in PR-1 (aws-kms / vault-
 * transit) or if env validation fails.
 */
export function getMasterSignerBackend(): KmsAccountBackend {
  if (!backendSingleton) {
    backendSingleton = buildSignerBackend(process.env as KeyProviderEnv, {
      audit: makeSignerAudit('master'),
    })
  }
  return backendSingleton
}

/**
 * Returns the lazily-built viem `LocalAccount` over the master-EOA signer.
 * Drop-in replacement for `privateKeyToAccount(...)` — usable as the
 * `account` field of `createWalletClient` or as the first argument to any
 * viem signing surface.
 *
 * Emits a one-shot boot-time log line on first construction:
 *
 *   [kms-signer] address=0x... keyId=arn:aws:kms:...
 *
 * This is the single source of truth at runtime for operator verification —
 * the address must match what `scripts/kms-signer-address.ts` printed during
 * setup (`docs/operations/kms-signer-setup.md` Steps 4 + 6). Logged exactly
 * once per process: subsequent calls return the cached `accountSingleton`
 * without re-logging. `__resetMasterSignerForTests()` clears the latch so
 * tests can assert on multiple boots.
 */
export async function getMasterSigner(): Promise<LocalAccount> {
  if (!accountSingleton) {
    const backend = getMasterSignerBackend()
    accountSingleton = await createKmsAccount(backend)
    // `keyId` for the boot banner: AWS path uses the configured ARN;
    // local-secp256k1 reports a stable sentinel so logs differentiate.
    // We don't read the runtime backend's internal keyId because that
    // would couple the wrapper to the backend's response shape — the
    // env-derived value is canonical and matches the runbook record.
    const keyId =
      (process.env.A2A_KMS_BACKEND ?? 'local-aes') === 'aws-kms'
        ? (process.env.AWS_KMS_SIGNER_KEY_ID ?? '(unset)')
        : 'local-secp256k1'
    // Use %s placeholders per K4 plan §8.2 / runbook Step 6 — operators
    // grep for `[kms-signer]` to verify the cutover.
    console.log('[kms-signer] address=%s keyId=%s', accountSingleton.address, keyId)
  }
  return accountSingleton
}

/**
 * Test hook — drop the cached backend + account so a test can mutate
 * `process.env.A2A_KMS_BACKEND` / `A2A_MASTER_PRIVATE_KEY` and rebuild.
 * NOT for production use.
 */
export function __resetMasterSignerForTests(): void {
  backendSingleton = null
  accountSingleton = null
}

// ─── Spec 007 Phase B — relay-only signer flavor ────────────────────

/**
 * Sentinel error class for relay-only mis-use. A throw of this type
 * proves the calling site tried to use master to sign user-authority
 * material — surface it in tests + audit + alerting.
 */
export class MasterRelayOnlyViolation extends Error {
  constructor(method: string) {
    super(
      `Master cannot sign user authority — use a session key. ` +
        `(method=${method}; call getMasterSigner() instead of getRelayOnlySigner() ` +
        `if you legitimately need a non-relay signing surface — and audit why)`,
    )
    this.name = 'MasterRelayOnlyViolation'
  }
}

/**
 * Read-mostly account view exposing ONLY `account` + `address` from the
 * underlying master `LocalAccount`. Every signing method throws
 * `MasterRelayOnlyViolation`. Pass this to `createWalletClient` when
 * the only call that follows is `writeContract({ functionName:
 * 'handleOps', ... })` — viem composes the wallet client to forward
 * the underlying `signTransaction` via the chain's `eth_sendTransaction`
 * RPC, which goes through `account.signTransaction(...)`. We override
 * that ONE method to allow tx-broadcast (the relay's actual job) while
 * blocking message-signing surfaces that could be used to forge a
 * userOp signature.
 *
 * `signTransaction` is the only signing surface kept live: it produces
 * an L1 transaction signature, which authorises the master EOA to PAY
 * GAS — it does NOT recover to any AgentAccount owner. (Cross-check:
 * `_validateSig` in `AgentAccount.sol` reads `userOp.signature`, not
 * `tx.signature`; the latter is unaccessible from the smart account
 * context.)
 */
export interface RelayOnlySigner {
  readonly address: `0x${string}`
  /** Underlying signer, narrowed to its broadcast surface only.
   *  Marked private-ish by convention — call sites should never pull
   *  it out and call the raw `signMessage` directly. */
  readonly account: LocalAccount
  /** Tx signing remains live — that's the relay's whole job. */
  signTransaction: LocalAccount['signTransaction']
  /** Throws `MasterRelayOnlyViolation`. */
  signMessage(): never
  /** Throws `MasterRelayOnlyViolation`. */
  signTypedData(): never
  /** Throws `MasterRelayOnlyViolation`. */
  signUserOp(): never
}

/**
 * Build a relay-only flavor of the master signer. Returns the viem
 * `LocalAccount` wrapped so authority-signing surfaces throw. The
 * underlying `LocalAccount` is REQUIRED for `createWalletClient`
 * (viem's wallet client needs `signTransaction` to broadcast txs); we
 * intercept the message-signing surfaces with throwing stubs.
 *
 * NOTE: We do not mutate the singleton — we return a fresh proxy each
 * call so the underlying account stays usable through `getMasterSigner()`
 * for the legitimate non-relay use cases (audit checkpoint, MAC).
 */
export async function getRelayOnlySigner(): Promise<RelayOnlySigner> {
  const master = await getMasterSigner()
  const blocked = (method: string): never => {
    throw new MasterRelayOnlyViolation(method)
  }
  return {
    address: master.address,
    account: master,
    signTransaction: master.signTransaction.bind(master),
    signMessage: () => blocked('signMessage') as never,
    signTypedData: () => blocked('signTypedData') as never,
    signUserOp: () => blocked('signUserOp') as never,
  }
}

// ─── K5 — per-tool executor signers ─────────────────────────────────

/**
 * Returns the lazily-built signer backend for a specific tool family.
 * Each tool id (`round-awards`, `disbursement`, `pool-lifecycle`,
 * `grant-awards`) has its OWN cached backend — a compromised key for
 * one family cannot sign for another (IAM-scoped to that single ARN
 * in prod; deterministic-different addresses in dev).
 *
 * Construction is via `buildToolExecutorBackend(toolId, env)`; the same
 * backend selector (`A2A_KMS_BACKEND`) applies. Validation is strict:
 * a missing env var throws with the exact env name so operators can
 * search their deployment for the missing variable.
 */
export function getToolExecutorSignerBackend(
  toolId: ToolExecutorId,
): ToolExecutorSignerBackend {
  const cached = toolExecutorBackendCache.get(toolId)
  if (cached) return cached
  const backend = buildToolExecutorBackend(
    toolId,
    process.env as KeyProviderEnv,
    { audit: makeSignerAudit(toolId) },
  )
  toolExecutorBackendCache.set(toolId, backend)
  return backend
}

/**
 * Returns the lazily-built viem `LocalAccount` over the executor signer
 * for `toolId`. Drop-in replacement for the legacy
 * `privateKeyToAccount(executor.privateKey)` call sites in
 * `apps/a2a-agent/src/routes/onchain-redeem.ts`. Usable as the
 * `account` field of `createWalletClient` or as the first argument to
 * any viem signing surface.
 *
 * Emits a one-shot boot-time log line on first construction per tool
 * id, matching the K4 master-signer banner shape:
 *
 *   [tool-executor-signer] toolId=round-awards address=0x... keyId=...
 *
 * Operators grep for `[tool-executor-signer]` to verify each tool's
 * derived address against the runbook record (per-tool entries in the
 * cutover log).
 */
export async function getToolExecutorSigner(
  toolId: ToolExecutorId,
): Promise<LocalAccount> {
  const cached = toolExecutorAccountCache.get(toolId)
  if (cached) return cached
  const backend = getToolExecutorSignerBackend(toolId)
  const account = await createKmsAccount(backend, { sessionId: `tool-executor:${toolId}` })
  toolExecutorAccountCache.set(toolId, account)
  // Resolve the logged keyId from the active backend. AWS path reports
  // the per-tool ARN env var; GCP path reports the per-tool
  // cryptoKeyVersion resource path; local-aes path reports the stable
  // sentinel so logs differentiate cleanly.
  const activeBackend = process.env.A2A_KMS_BACKEND ?? 'local-aes'
  const keyId =
    activeBackend === 'aws-kms'
      ? (process.env[toolEnvKeyName(toolId, 'aws-kms')] ?? '(unset)')
      : activeBackend === 'gcp-kms'
        ? (process.env[toolEnvKeyName(toolId, 'gcp-kms')] ?? '(unset)')
        : 'local-secp256k1'
  console.log(
    '[tool-executor-signer] toolId=%s address=%s keyId=%s',
    toolId,
    account.address,
    keyId,
  )
  return account
}

/**
 * Test hook — drop ALL cached per-tool backends + accounts. NOT for
 * production use. Tests that mutate per-tool env vars between cases
 * must call this between cases so the next call to
 * `getToolExecutorSigner` re-reads env.
 */
export function __resetToolExecutorSignersForTests(): void {
  toolExecutorBackendCache.clear()
  toolExecutorAccountCache.clear()
}
