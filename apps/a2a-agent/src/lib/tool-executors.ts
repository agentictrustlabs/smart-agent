/**
 * Per-tool executor identities (Phase 2 — sub-delegated path; K5 KMS).
 *
 * Each sensitive-tier MCP tool family gets its own EOA identity in
 * a2a-agent. When the org-mcp asks a2a-agent to mint a per-call D_sub
 * (via /session/:id/redeem-subdelegated), a2a-agent:
 *   1. picks the executor family for the requested tool,
 *   2. mints D_sub with delegate = executor.address,
 *   3. signs the redeem tx FROM the executor's signer,
 *   4. revokes hash(D_sub) immediately after submit.
 *
 * Per-family identities mean a compromised executor key can only sign
 * (and re-issue) calls inside ITS family's policy envelope — round-awards
 * keys can't claim disbursements, pool-lifecycle keys can't set awards
 * roots, etc. This is the blast-radius reason for not collapsing them
 * into one "treasury bot" key.
 *
 * ─── K5 migration ───────────────────────────────────────────────────
 *
 * Before K5: each family's private key was an env var
 * (`TOOL_EXECUTOR_<FAMILY>_PRIVATE_KEY`) read directly here and fed
 * into `privateKeyToAccount(...)`. After K5: each family routes
 * through `getToolExecutorSigner(toolId)` (apps/a2a-agent/src/auth/
 * a2a-signer.ts), which returns a viem `LocalAccount` backed by:
 *
 *   - local-secp256k1 in dev (reads
 *     `TOOL_EXECUTOR_<TOOL_ID>_PRIVATE_KEY` — same env var as before,
 *     same anvil addresses, same deploy-local.sh seed), OR
 *   - AWS KMS asymmetric `ECC_SECG_P256K1` in prod (reads
 *     `AWS_KMS_TOOL_EXECUTOR_<TOOL_ID>_KEY_ID` — a SEPARATE KMS key
 *     per tool family for defense in depth; IAM scope pins each
 *     `kms:Sign` permission to that single ARN).
 *
 * The legacy "family" registry below is preserved for the public API
 * surface (`getExecutorForTool`, `listExecutors`); the family ↔ tool
 * id mapping converts the SCREAMING_SNAKE_CASE family to the
 * lowercase-with-dashes tool id consumed by the K5 signer:
 *
 *   ROUND_AWARDS    ↔ round-awards
 *   DISBURSEMENT    ↔ disbursement
 *   POOL_LIFECYCLE  ↔ pool-lifecycle
 *   GRANT_AWARDS    ↔ grant-awards
 *
 * Adding a new sensitive tool family: add to the FAMILIES list,
 * `TOOL_TO_FAMILY` mapping, `TOOL_EXECUTOR_IDS` in
 * `packages/sdk/src/key-custody/tool-executor-signer.ts`, and (for
 * dev) `scripts/deploy-local.sh`.
 *
 * Inventory of tool executor families (K5):
 *
 *   family          tool id           local env var                                 prod env var
 *   ROUND_AWARDS    round-awards      TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY        AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID
 *   DISBURSEMENT    disbursement      TOOL_EXECUTOR_DISBURSEMENT_PRIVATE_KEY        AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID
 *   POOL_LIFECYCLE  pool-lifecycle    TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY      AWS_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ID
 *   GRANT_AWARDS    grant-awards      TOOL_EXECUTOR_GRANT_AWARDS_PRIVATE_KEY        AWS_KMS_TOOL_EXECUTOR_GRANT_AWARDS_KEY_ID
 */
import type { Address, LocalAccount } from 'viem'
import type { ToolExecutorId } from '@smart-agent/sdk/key-custody'
import { getToolExecutorSigner } from '../auth/a2a-signer'

export type ToolExecutorFamily =
  | 'ROUND_AWARDS'
  | 'DISBURSEMENT'
  | 'POOL_LIFECYCLE'
  | 'GRANT_AWARDS'

/**
 * Maps a sensitive-tier toolId to the executor family that signs its
 * sub-delegated redeems. Tools listed here must have
 * ToolPolicy.executionPath === 'sub-delegated' in @smart-agent/sdk.
 *
 * Tools NOT in this map but declared sub-delegated in the SDK will be
 * rejected at /session/:id/redeem-subdelegated with an explicit error;
 * adding a new sensitive tool requires adding it here AND choosing a
 * family.
 */
export const TOOL_TO_FAMILY: Record<string, ToolExecutorFamily> = {
  'pool:close': 'POOL_LIFECYCLE',
  'round:close': 'ROUND_AWARDS',
  'round:cancel': 'ROUND_AWARDS',
  'round:set_awards_root': 'ROUND_AWARDS',
  'disbursement:claim': 'DISBURSEMENT',
  'grant_proposal:award': 'GRANT_AWARDS',
  'grant_proposal:revoke_award': 'GRANT_AWARDS',
}

const FAMILIES: ToolExecutorFamily[] = [
  'ROUND_AWARDS',
  'DISBURSEMENT',
  'POOL_LIFECYCLE',
  'GRANT_AWARDS',
]

/**
 * Convert the legacy SCREAMING_SNAKE_CASE family name to the lowercase
 * tool id consumed by the K5 signer factory. The conversion is a
 * pure-syntactic transform (`_` → `-`, lowercase).
 */
export function familyToToolId(family: ToolExecutorFamily): ToolExecutorId {
  return family.replace(/_/g, '-').toLowerCase() as ToolExecutorId
}

/**
 * Public executor handle. `account` is the viem `LocalAccount` returned
 * by the K5 signer — usable as `createWalletClient({ account })` or as
 * any `signMessage`/`signTransaction` caller. The K5 signer back-ends
 * the LocalAccount with either the dev hex key or the prod KMS key;
 * the call site sees a uniform interface.
 *
 * Note: `account.address` is the on-chain EOA derived from the
 * (possibly KMS-resident) public key.
 */
export interface ToolExecutor {
  family: ToolExecutorFamily
  toolId: ToolExecutorId
  address: Address
  account: LocalAccount
}

/**
 * Look up the executor identity that should sign a given sensitive tool's
 * sub-delegated redeem. Returns a fresh `LocalAccount` for the family
 * (the K5 signer caches the backend + LocalAccount internally so
 * subsequent calls for the same tool id are cheap).
 *
 * @throws if `toolId` isn't enrolled in `TOOL_TO_FAMILY`, or if the
 *         active backend's env vars for the resolved family are
 *         missing/malformed.
 */
export async function getExecutorForTool(toolId: string): Promise<ToolExecutor> {
  const family = TOOL_TO_FAMILY[toolId]
  if (!family) {
    throw new Error(
      `getExecutorForTool: tool "${toolId}" has no executor family. Add it to TOOL_TO_FAMILY in tool-executors.ts.`,
    )
  }
  return getExecutorForFamily(family)
}

/**
 * Look up the executor identity by family. Used internally + by setup
 * tooling that needs to display addresses (e.g. deploy-local.sh fund step).
 */
export async function getExecutorForFamily(
  family: ToolExecutorFamily,
): Promise<ToolExecutor> {
  const toolId = familyToToolId(family)
  const account = await getToolExecutorSigner(toolId)
  return { family, toolId, address: account.address, account }
}

/** All executor families, in registry order. Used by audit/observability. */
export async function listExecutors(): Promise<ToolExecutor[]> {
  const out: ToolExecutor[] = []
  for (const f of FAMILIES) {
    out.push(await getExecutorForFamily(f))
  }
  return out
}
