/**
 * Per-tool executor identities (Phase 2 — sub-delegated path).
 *
 * Each sensitive-tier MCP tool family gets its own EOA identity in
 * a2a-agent. When the org-mcp asks a2a-agent to mint a per-call D_sub
 * (via /session/:id/redeem-subdelegated), a2a-agent:
 *   1. picks the executor family for the requested tool,
 *   2. mints D_sub with delegate = executor.address,
 *   3. signs the redeem tx FROM the executor's private key,
 *   4. revokes hash(D_sub) immediately after submit.
 *
 * Per-family identities mean a compromised executor key can only sign
 * (and re-issue) calls inside ITS family's policy envelope — round-awards
 * keys can't claim disbursements, pool-lifecycle keys can't set awards
 * roots, etc. This is the blast-radius reason for not collapsing them
 * into one "treasury bot" key.
 *
 * Identity sourcing (v1 priority order):
 *   1. Explicit env var: TOOL_EXECUTOR_<FAMILY>_PRIVATE_KEY
 *   2. Deterministic fallback: keccak256(`tool-executor:${FAMILY}:${DEPLOYER_PRIVATE_KEY}`)
 *      — so dev fresh-start works without env wiring, but each install
 *      still has unique addresses (the deployer key differs per env).
 *
 * Production would source these from an HSM / rotated-key store; v1
 * does the simplest safe thing.
 *
 * Adding a new sensitive tool family: add an entry to FAMILIES below,
 * map the relevant toolIds in `TOOL_TO_FAMILY`, and (optionally) set
 * `TOOL_EXECUTOR_<FAMILY>_PRIVATE_KEY` in env. deploy-local.sh handles
 * the dev env injection.
 */
import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

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

interface ToolExecutor {
  family: ToolExecutorFamily
  privateKey: Hex
  address: Address
}

let _cache: Record<ToolExecutorFamily, ToolExecutor> | null = null

function envKeyFor(family: ToolExecutorFamily): string {
  return `TOOL_EXECUTOR_${family}_PRIVATE_KEY`
}

/**
 * Derive a deterministic 32-byte key for a family when no explicit env is
 * set. The deployer key acts as a per-environment salt so dev / test /
 * staging installs all get distinct executor addresses even when this
 * fallback path is taken.
 */
function deriveFallbackKey(family: ToolExecutorFamily): Hex {
  const deployer = process.env.DEPLOYER_PRIVATE_KEY ?? '0x0'
  return keccak256(toBytes(`tool-executor:${family}:${deployer}`))
}

function normalizePrivateKey(raw: string): Hex {
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`tool-executor private key must be 32-byte hex; got ${raw.length} chars`)
  }
  return hex as Hex
}

function loadExecutor(family: ToolExecutorFamily): ToolExecutor {
  const fromEnv = process.env[envKeyFor(family)]
  const privateKey = fromEnv
    ? normalizePrivateKey(fromEnv)
    : deriveFallbackKey(family)
  const account = privateKeyToAccount(privateKey)
  return { family, privateKey, address: account.address }
}

function ensureCache(): Record<ToolExecutorFamily, ToolExecutor> {
  if (_cache) return _cache
  const out = {} as Record<ToolExecutorFamily, ToolExecutor>
  for (const f of FAMILIES) out[f] = loadExecutor(f)
  _cache = out
  return out
}

/**
 * Look up the executor identity that should sign a given sensitive tool's
 * sub-delegated redeem. Throws if the tool isn't enrolled here.
 */
export function getExecutorForTool(toolId: string): ToolExecutor {
  const family = TOOL_TO_FAMILY[toolId]
  if (!family) {
    throw new Error(
      `getExecutorForTool: tool "${toolId}" has no executor family. Add it to TOOL_TO_FAMILY in tool-executors.ts.`,
    )
  }
  return ensureCache()[family]
}

/**
 * Look up the executor identity by family. Used internally + by setup
 * tooling that needs to display addresses (e.g. deploy-local.sh fund step).
 */
export function getExecutorForFamily(family: ToolExecutorFamily): ToolExecutor {
  return ensureCache()[family]
}

/** All executor families, in registry order. Used by audit/observability. */
export function listExecutors(): ToolExecutor[] {
  const cache = ensureCache()
  return FAMILIES.map((f) => cache[f])
}

/**
 * Reset the cached executors. Test-only helper; production code does not
 * call this. Re-reads env on next access.
 */
export function _resetToolExecutorCacheForTests(): void {
  _cache = null
}

// Suppress unused export for `toHex` — kept for future use when a route
// wants to render an executor key in logs.
void toHex
