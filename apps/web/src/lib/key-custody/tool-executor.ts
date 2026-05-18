/**
 * Web-side tool-executor signer factory (KMS migration K6 S1.5).
 *
 * Mirror of `apps/a2a-agent/src/auth/a2a-signer.ts` `getToolExecutorSigner()`
 * for the web tier. Today only the `auth-bootstrap` tool family is needed
 * here — it's the system identity that signs the bootstrap operations the
 * user can't (they have no wallet yet): smart-account deployment, initial
 * owner addition during passkey signup, and deterministic account
 * derivation from a Google subject.
 *
 * Backend selection mirrors the a2a-agent's K4/K5 wrappers (same
 * `A2A_KMS_BACKEND` selector — one switch per deployment):
 *
 *   - 'local-aes' → reads `TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY`
 *                   (dev only; refused at startup when `NODE_ENV=production`).
 *   - 'aws-kms'   → reads `AWS_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ID`
 *                   (separate KMS CMK per tool family for defense in
 *                   depth — IAM `kms:Sign` is scoped to that single ARN).
 *
 * Returns a viem `LocalAccount` — drop-in replacement for
 * `privateKeyToAccount(DEPLOYER_PRIVATE_KEY)` at the 3 K6-D1 bootstrap-auth
 * routes (`siwe-verify`, `passkey-signup`, `google-callback`).
 *
 * Emits a one-shot boot-time log line on first construction:
 *
 *   [auth-bootstrap-signer] address=0x... backend=<aws-kms|local-aes>
 *
 * Operators grep for `[auth-bootstrap-signer]` to verify the cutover
 * (`docs/operations/kms-signer-setup.md` § "Tool-executor signer keys
 * (K5)" extended with the `auth-bootstrap` row).
 */
import type { LocalAccount } from 'viem'
import {
  createKmsAccount,
  createToolExecutorSigner,
  type KmsAccountBackend,
  type ToolExecutorSignerEnv,
} from '@smart-agent/sdk/key-custody'

let _authBootstrapSigner: LocalAccount | null = null

/**
 * Returns the lazily-built viem `LocalAccount` for the `auth-bootstrap`
 * tool family. Cached in module scope — subsequent calls return the same
 * instance (and don't re-log the boot banner).
 *
 * Throws operator-actionable errors if the active backend's required env
 * vars are missing or malformed (exact env name in the message so the
 * operator can `grep` their deployment for the missing variable).
 */
export async function getAuthBootstrapSigner(): Promise<LocalAccount> {
  if (_authBootstrapSigner) return _authBootstrapSigner

  const env = process.env as ToolExecutorSignerEnv
  const backend: KmsAccountBackend = createToolExecutorSigner('auth-bootstrap', env)
  _authBootstrapSigner = await createKmsAccount(backend, {
    sessionId: 'tool-executor:auth-bootstrap',
  })

  const activeBackend = process.env.A2A_KMS_BACKEND ?? 'local-aes'
  console.log(
    '[auth-bootstrap-signer] address=%s backend=%s',
    _authBootstrapSigner.address,
    activeBackend,
  )
  return _authBootstrapSigner
}

/**
 * Test hook — drop the cached account so a test can mutate
 * `process.env.A2A_KMS_BACKEND` / `TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY`
 * and rebuild. NOT for production use.
 */
export function __resetAuthBootstrapSignerForTests(): void {
  _authBootstrapSigner = null
}
