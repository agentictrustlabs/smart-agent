/**
 * Startup-time invariant check for the ToolPolicyRegistry.
 *
 * The on-chain redeem handlers (`apps/a2a-agent/src/routes/onchain-redeem.ts`)
 * gate every redeem on `policyAllowedSelectors(toolId, policy).has(selector)`.
 * If `policyAllowedSelectors` returns an empty set for an on-chain tool —
 * because nobody added a row to the per-target selector tables in
 * `packages/sdk/src/policy/tool-policies.ts` — the historic guard
 * `if (size > 0 && !has(selector))` short-circuited and accepted ANY
 * calldata. The fix in onchain-redeem.ts is the strict
 * `if (!has(selector))` form; this module is the second half of the
 * fix — fail the boot if a policy registration is incomplete.
 *
 * Run this from `apps/a2a-agent/src/index.ts` BEFORE the Hono server
 * starts listening. Throws on any non-`mcp-only` tool that has no
 * selectors registered for any of its allowed targets.
 *
 * Runs in BOTH dev and prod — catching policy mistakes in dev is the
 * point.
 *
 * ─── Sprint 5 Wave 2 additions ──────────────────────────────────────
 *
 *   P0-8 — Marketplace tools are gated behind `MARKETPLACE_ENABLED`.
 *     The Spec-004 marketplace registries (PledgeRegistry,
 *     MatchInitiationRegistry, GrantProposalRegistry, VoteRegistry) do
 *     not ship a *_SELECTORS_BY_TOOL table yet. Pre-Sprint-5 these
 *     targets were unconditionally exempted from
 *     `assertPolicyCompleteness` via `SPECIAL_CASE_TARGETS`, meaning
 *     the redeem route's strict `!allowedSelectors.has(selector)` gate
 *     was the ONLY thing keeping marketplace traffic off the chain.
 *     The redeem gate still rejects every call, but a production
 *     deploy that ships marketplace UI without an updated policy
 *     registration would surface as a runtime 403 — too late for a
 *     security-critical surface. The flag formalises the posture:
 *
 *       - MARKETPLACE_ENABLED=false (production default): marketplace
 *         tool ids are exempted from completeness, AND the redeem route
 *         is required to return 503 for them. The route check lives in
 *         `apps/a2a-agent/src/routes/onchain-redeem.ts`; this module
 *         exports `MARKETPLACE_TOOL_IDS` so the route can read the
 *         same canonical list.
 *
 *       - MARKETPLACE_ENABLED=true: the exemption is REMOVED — every
 *         marketplace tool MUST have a `*_SELECTORS_BY_TOOL` entry, or
 *         `assertMarketplacePolicy` refuses to boot.
 *
 *   P0-9 — DEPLOYER_PRIVATE_KEY hard-fail in production.
 *     The deployer key is a CI/CD-only secret. In production the
 *     mere presence of the env var refuses startup, except when the
 *     operator sets `ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL=<ISO-8601>` as a
 *     time-boxed break-glass.
 *
 *   P1-5 — Audit sink required in production.
 *     `AUDIT_CHECKPOINT_SINK_URL` must be set in production, and the
 *     URL must be reachable at boot (HEAD with 5s timeout). A missing
 *     or unreachable sink is a deploy-time failure, not a runtime gate.
 */
import {
  TOOL_POLICIES,
  POOL_REGISTRY_SELECTORS_BY_TOOL,
  FUND_REGISTRY_SELECTORS_BY_TOOL,
  AGENT_ACCOUNT_RESOLVER_SELECTORS_BY_TOOL,
  AGENT_RELATIONSHIP_SELECTORS_BY_TOOL,
  COMMITMENT_REGISTRY_SELECTORS_BY_TOOL,
  PROPOSAL_REGISTRY_SELECTORS_BY_TOOL,
  type ToolPolicy,
} from '@smart-agent/sdk'
import { auditAppend } from './audit'

/**
 * Selector tables keyed by the same target-symbol enum that
 * `ToolPolicy.allowedTargets[number]` ranges over. Adding a new target
 * symbol to the SDK requires adding a row here so the completeness
 * check can find it. Targets not represented here (e.g.
 * AgentAccountFactory whose only call is `createAccount` minted in the
 * /deploy-agent handler directly) are tolerated — see the special-case
 * list below.
 */
const SELECTOR_TABLE_BY_TARGET: Partial<Record<
  ToolPolicy['allowedTargets'][number],
  Record<string, string[]>
>> = {
  PoolRegistry:           POOL_REGISTRY_SELECTORS_BY_TOOL,
  FundRegistry:           FUND_REGISTRY_SELECTORS_BY_TOOL,
  AgentAccountResolver:   AGENT_ACCOUNT_RESOLVER_SELECTORS_BY_TOOL,
  AgentRelationship:      AGENT_RELATIONSHIP_SELECTORS_BY_TOOL,
  CommitmentRegistry:     COMMITMENT_REGISTRY_SELECTORS_BY_TOOL,
  ProposalRegistry:       PROPOSAL_REGISTRY_SELECTORS_BY_TOOL,
  // NOTE: DelegationManager + AgentAssertion target symbols are valid
  // policy allowedTargets but their tool→selector tables aren't
  // exported from @smart-agent/sdk in the current HEAD. Tools whose
  // allowedTargets contain only these are exempted below.
}

/**
 * Spec-004 marketplace registries. Selector tables for these aren't
 * exported yet; see `MARKETPLACE_TOOL_IDS` for the corresponding tool
 * ids and `assertMarketplacePolicy` for the boot gate.
 */
const MARKETPLACE_TARGETS: ReadonlySet<ToolPolicy['allowedTargets'][number]> = new Set<
  ToolPolicy['allowedTargets'][number]
>([
  'PledgeRegistry',
  'MatchInitiationRegistry',
  'GrantProposalRegistry',
  'VoteRegistry',
])

/**
 * Targets that legitimately route through dedicated endpoints rather
 * than the generic redeem path. Their selector resolution lives in the
 * endpoint code (e.g. /deploy-agent computes `createAccount`'s selector
 * directly). Tools whose ONLY targets are in this list don't need a
 * selector table entry.
 *
 * NOTE: the marketplace registries (PledgeRegistry, MatchInitiationRegistry,
 * GrantProposalRegistry, VoteRegistry) were historically in this list
 * but are now gated by `MARKETPLACE_ENABLED` — see
 * `assertMarketplacePolicy` and `MARKETPLACE_TARGETS`.
 */
const SPECIAL_CASE_TARGETS: ReadonlySet<ToolPolicy['allowedTargets'][number]> = new Set<
  ToolPolicy['allowedTargets'][number]
>([
  'AgentAccountFactory',
  // Sentinel targets the marketplace registries that aren't generic
  // ABI dispatches — add to this list if a new dedicated endpoint
  // surfaces.
  'ClassAssertionContract',
  'GrantRegistry',
])

/**
 * Specific (toolId) entries that are policy-registered but have no
 * corresponding on-chain function yet. These tools reference future
 * FundRegistry / PoolRegistry capabilities (e.g. on-chain claim,
 * award, revoke_award) and remain in the policy registry as forward
 * declarations. Until the contract methods exist, no selector mapping
 * is possible.
 *
 * The strict redeem-time guard (`!allowedSelectors.has(selector)`)
 * still rejects every call against these tools, so they are
 * effectively disabled at runtime. Listing them here is a "we know,
 * don't refuse to boot" signal — remove an entry only when the
 * matching contract function ships AND the selector table is updated.
 *
 * IMPORTANT (P0-8): this set is for non-marketplace forward declarations
 * ONLY. Marketplace tools (PledgeRegistry, MatchInitiationRegistry,
 * GrantProposalRegistry, VoteRegistry) are gated by `MARKETPLACE_ENABLED`
 * via `MARKETPLACE_TOOL_IDS` — do NOT add marketplace tools here.
 */
const PLACEHOLDER_TOOL_IDS: ReadonlySet<string> = new Set<string>([
  // No on-chain claim() on FundRegistry yet — Phase 5 disbursement.
  'disbursement:claim',
  // No on-chain award() / revokeAward() yet — Phase 5 award lifecycle.
  'grant_proposal:award',
  'grant_proposal:revoke_award',
])

/**
 * P0-8 — Canonical list of marketplace tool ids. Derived from the
 * `TOOL_POLICIES` table: any on-chain tool whose `allowedTargets`
 * is a non-empty subset of `MARKETPLACE_TARGETS`. Exported so the
 * redeem route handler can refuse marketplace traffic with a 503 when
 * `MARKETPLACE_ENABLED=false`.
 *
 * Lazy because `TOOL_POLICIES` is itself an imported const — building
 * the set at module-eval time is fine, but we expose a getter so a test
 * can stub `TOOL_POLICIES` without re-importing this module.
 */
export const MARKETPLACE_TOOL_IDS: ReadonlySet<string> = (() => {
  const s = new Set<string>()
  for (const [toolId, policy] of Object.entries(TOOL_POLICIES)) {
    if (policy.executionPath === 'mcp-only') continue
    if (policy.allowedTargets.length === 0) continue
    if (policy.allowedTargets.every((t) => MARKETPLACE_TARGETS.has(t))) {
      s.add(toolId)
    }
  }
  return s
})()

/**
 * P0-8 — Resolve `MARKETPLACE_ENABLED` from the env map. Pure helper
 * so tests can exercise every branch without mutating `process.env`.
 *
 * Defaults: `false` in production, `false` in dev. The dev default of
 * `false` is intentional — marketplace tools 503 at the route layer in
 * both environments until the selector tables ship; the only way to
 * enable them is an explicit operator opt-in via the env var, and that
 * opt-in REQUIRES the selector tables to exist (assertMarketplacePolicy
 * refuses to boot otherwise).
 */
export function resolveMarketplaceEnabled(envIn: { MARKETPLACE_ENABLED?: string }): boolean {
  const raw = envIn.MARKETPLACE_ENABLED
  if (raw === undefined) return false
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0' || v === '') return false
  throw new Error(
    `config: MARKETPLACE_ENABLED must be 'true' or 'false' (got '${raw}')`,
  )
}

/**
 * Treat these tools as exempt from the completeness check. The Phase
 * 1A hardening trail is meant to PREVENT new tools from being added
 * without selectors; legacy tools whose only on-chain target is a
 * special-case target (e.g. agent:deploy → AgentAccountFactory only)
 * fall here.
 *
 * P0-8: marketplace tools are exempted from the *base* completeness
 * check ONLY when `MARKETPLACE_ENABLED=false`. When the flag is true,
 * marketplace tools are required to have selectors — see
 * `assertMarketplacePolicy`.
 */
function policyIsExemptFromSelectorCheck(
  toolId: string,
  policy: ToolPolicy,
  marketplaceEnabled: boolean,
): boolean {
  if (policy.allowedTargets.length === 0) return true
  if (PLACEHOLDER_TOOL_IDS.has(toolId)) return true
  // Marketplace tools: exempt from the *base* check; their own assert
  // (`assertMarketplacePolicy`) handles them when the flag is on.
  if (MARKETPLACE_TOOL_IDS.has(toolId) && !marketplaceEnabled) return true
  // Tools whose every allowed target is either a special-case target
  // OR a marketplace target (when marketplace is disabled).
  return policy.allowedTargets.every((t) => {
    if (SPECIAL_CASE_TARGETS.has(t)) return true
    if (!marketplaceEnabled && MARKETPLACE_TARGETS.has(t)) return true
    return false
  })
}

/**
 * Walk every on-chain ToolPolicy and verify that at least one of its
 * allowedTargets has a non-empty selector mapping for the tool. Throws
 * on any failure with a list of problem tools.
 *
 * P0-8: when `MARKETPLACE_ENABLED=true`, marketplace tools participate
 * in the check; when false, marketplace tools are exempted here and
 * the redeem route 503s them instead.
 */
export function assertPolicyCompleteness(
  envIn: { MARKETPLACE_ENABLED?: string } = process.env,
): void {
  const marketplaceEnabled = resolveMarketplaceEnabled(envIn)
  const problems: string[] = []

  for (const [toolId, policy] of Object.entries(TOOL_POLICIES)) {
    if (policy.executionPath === 'mcp-only') continue
    if (policyIsExemptFromSelectorCheck(toolId, policy, marketplaceEnabled)) continue

    // For every allowedTarget, find the selector table entry for this
    // tool. If none of the targets contributes a selector, the redeem
    // guard `allowedSelectors.has(selector)` will always be false and
    // the tool is unreachable — which is safer than the old fail-open
    // bug but still indicates a policy-registration mistake. Treat as
    // a startup error.
    let totalSelectors = 0
    for (const target of policy.allowedTargets) {
      const table = SELECTOR_TABLE_BY_TARGET[target]
      if (!table) continue
      const fns = table[toolId]
      if (fns && fns.length > 0) totalSelectors += fns.length
    }
    if (totalSelectors === 0) {
      problems.push(
        `[${toolId}] executionPath=${policy.executionPath} targets=[${policy.allowedTargets.join(',')}] — no selector mapping registered. Add an entry to the matching *_SELECTORS_BY_TOOL table in packages/sdk/src/policy/tool-policies.ts.`,
      )
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `assertPolicyCompleteness: ${problems.length} tool(s) have no selector mapping:\n  ${problems.join('\n  ')}`,
    )
  }
}

/**
 * P0-8 — When `MARKETPLACE_ENABLED=true`, every tool in
 * `MARKETPLACE_TOOL_IDS` MUST have a non-empty selector mapping for at
 * least one of its allowed targets. If the flag is off this is a
 * no-op; the route gate at `onchain-redeem.ts` 503s marketplace traffic
 * regardless.
 *
 * This is a separate helper from `assertPolicyCompleteness` so the
 * error message can point operators specifically at the marketplace
 * selector tables (which don't exist yet in the SDK).
 */
export function assertMarketplacePolicy(
  envIn: { MARKETPLACE_ENABLED?: string } = process.env,
): void {
  if (!resolveMarketplaceEnabled(envIn)) return
  const problems: string[] = []
  for (const toolId of MARKETPLACE_TOOL_IDS) {
    const policy = TOOL_POLICIES[toolId]
    if (!policy) continue
    let totalSelectors = 0
    for (const target of policy.allowedTargets) {
      const table = SELECTOR_TABLE_BY_TARGET[target]
      if (!table) continue
      const fns = table[toolId]
      if (fns && fns.length > 0) totalSelectors += fns.length
    }
    if (totalSelectors === 0) {
      problems.push(
        `[${toolId}] targets=[${policy.allowedTargets.join(',')}] — no selector mapping for marketplace tool. MARKETPLACE_ENABLED=true requires every marketplace tool to have selectors. Either ship the matching *_SELECTORS_BY_TOOL export in @smart-agent/sdk and add it to SELECTOR_TABLE_BY_TARGET in policy-startup.ts, or unset MARKETPLACE_ENABLED.`,
      )
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `assertMarketplacePolicy: ${problems.length} marketplace tool(s) have no selector mapping but MARKETPLACE_ENABLED=true:\n  ${problems.join('\n  ')}`,
    )
  }
}

// ─── P0-9 — Deployer key policy ─────────────────────────────────────

/**
 * P0-9 — Pure validator. Refuses startup when DEPLOYER_PRIVATE_KEY is
 * present in a production environment, unless a future-dated
 * `ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL` break-glass is in effect.
 *
 * Returns one of:
 *   - `'no-key'`            DEPLOYER_PRIVATE_KEY is absent → safe
 *   - `'dev-key'`           dev or non-prod NODE_ENV → safe, warn only
 *   - `'break-glass-active'` prod + valid future expiry → permit, but
 *                            caller MUST log a structured WARN and
 *                            write the `system:break-glass-deployer-key`
 *                            audit row before continuing
 *
 * Throws on:
 *   - prod + DEPLOYER_PRIVATE_KEY + no break-glass
 *   - prod + DEPLOYER_PRIVATE_KEY + malformed ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL
 *   - prod + DEPLOYER_PRIVATE_KEY + expired ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL
 *
 * Tests pin every branch via `validateDeployerKey` directly so
 * `process.env` doesn't have to be globally mutated.
 */
export type DeployerKeyDecision = 'no-key' | 'dev-key' | 'break-glass-active'

export interface DeployerKeyEnv {
  NODE_ENV?: string
  DEPLOYER_PRIVATE_KEY?: string
  ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL?: string
}

export function validateDeployerKey(
  envIn: DeployerKeyEnv,
  now: Date = new Date(),
): { decision: DeployerKeyDecision; breakGlassUntil?: Date } {
  const isProd = envIn.NODE_ENV === 'production'
  const keyPresent = !!envIn.DEPLOYER_PRIVATE_KEY && envIn.DEPLOYER_PRIVATE_KEY.length > 0

  if (!keyPresent) return { decision: 'no-key' }
  if (!isProd) return { decision: 'dev-key' }

  const rawUntil = envIn.ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL
  if (!rawUntil || rawUntil.length === 0) {
    throw new Error(
      "policy-startup: DEPLOYER_PRIVATE_KEY is set in NODE_ENV='production'. " +
        'The deployer key is a CI/CD-only secret and MUST NOT be present at runtime. ' +
        'Remove DEPLOYER_PRIVATE_KEY from the production environment. ' +
        'If you must keep it temporarily (e.g. staged migration), set ' +
        "ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL=<ISO-8601 timestamp> as a documented " +
        'break-glass. See docs/operations/kms-signer-setup.md § "Deployer key (K6 — CI/CD only)".',
    )
  }

  const until = new Date(rawUntil)
  if (Number.isNaN(until.getTime())) {
    throw new Error(
      `policy-startup: ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL has malformed value '${rawUntil}'. ` +
        'Must be an ISO-8601 timestamp (e.g. "2026-06-01T00:00:00Z"). ' +
        'Refusing to start.',
    )
  }
  if (until.getTime() <= now.getTime()) {
    throw new Error(
      `policy-startup: ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL='${rawUntil}' is in the past ` +
        `(now=${now.toISOString()}). The break-glass has expired; remove ` +
        'DEPLOYER_PRIVATE_KEY from the production environment to start the agent. ' +
        'See docs/operations/kms-signer-setup.md § "Deployer key (K6 — CI/CD only)".',
    )
  }

  return { decision: 'break-glass-active', breakGlassUntil: until }
}

/**
 * P0-9 — Top-level helper. Wraps `validateDeployerKey` and, on the
 * `break-glass-active` branch, emits a structured WARN AND writes the
 * `system:break-glass-deployer-key` audit row so the chain head reflects
 * the operator-known posture at boot.
 *
 * The audit write is best-effort: an audit failure logs but does NOT
 * abort startup (the break-glass is already operator-authorised; making
 * a transient SQLite hiccup block boot would be worse).
 */
export async function assertDeployerKeyPolicy(
  envIn: DeployerKeyEnv = process.env,
): Promise<DeployerKeyDecision> {
  const result = validateDeployerKey(envIn)
  if (result.decision === 'break-glass-active') {
    const untilIso = result.breakGlassUntil!.toISOString()
    console.warn(
      JSON.stringify({
        event: 'break-glass-deployer-key',
        level: 'warn',
        msg:
          'DEPLOYER_PRIVATE_KEY is permitted in production via ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL. ' +
          'This is a time-boxed break-glass — remove the env var before the deadline.',
        breakGlassUntil: untilIso,
        nodeEnv: 'production',
      }),
    )
    try {
      await auditAppend({
        rootGrantHash: '',
        sessionId: '',
        sessionPrincipal: '',
        mcpServer: 'system',
        mcpTool: 'system:break-glass-deployer-key',
        executionPath: 'mcp-only',
        status: 'completed',
        errorReason: `break-glass active until ${untilIso}`,
      })
    } catch (err) {
      console.error('[assertDeployerKeyPolicy] failed to write break-glass audit row:', err)
    }
  }
  return result.decision
}

// ─── P1-5 — Audit sink policy ───────────────────────────────────────

/**
 * P1-5 — Pure validator. Returns the configured audit sink URL when
 * production has one set; throws otherwise.
 *
 * Returns:
 *   - `string` (URL)  — production + sink configured
 *   - `null`          — non-prod with no sink (development can no-op)
 *   - `string` (URL)  — non-prod with sink (operator opted in)
 *
 * Throws when NODE_ENV='production' and AUDIT_CHECKPOINT_SINK_URL is
 * missing.
 */
export interface AuditSinkEnv {
  NODE_ENV?: string
  AUDIT_CHECKPOINT_SINK_URL?: string
}

export function validateAuditSinkConfig(envIn: AuditSinkEnv): string | null {
  const isProd = envIn.NODE_ENV === 'production'
  const url = envIn.AUDIT_CHECKPOINT_SINK_URL
  if (isProd) {
    if (!url || url.length === 0) {
      throw new Error(
        "policy-startup: AUDIT_CHECKPOINT_SINK_URL is required in NODE_ENV='production'. " +
          'The audit chain is only tamper-evident when an EXTERNAL signed checkpoint ' +
          'witnesses the head; a missing sink defeats the entire mechanism. Configure ' +
          'AUDIT_CHECKPOINT_SINK_URL to an immutable sink (Azure Log Analytics DCR, S3 ' +
          'object-lock bucket, generic HTTPS webhook). See ' +
          'docs/operations/kms-signer-setup.md § AUDIT_CHECKPOINT_SINK_URL.',
      )
    }
    return url
  }
  return url && url.length > 0 ? url : null
}

/**
 * P1-5 — Reachability probe injection point. The default implementation
 * uses `fetch` with a 5s timeout; tests inject a mock so they don't
 * have to bind to a real port.
 */
export type SinkProbeFn = (url: string) => Promise<{ ok: boolean; status?: number; error?: string }>

export const defaultSinkProbe: SinkProbeFn = async (url) => {
  const SINK_PROBE_TIMEOUT_MS = 5_000
  try {
    const signal = AbortSignal.timeout(SINK_PROBE_TIMEOUT_MS)
    // HEAD first — minimal payload, most sinks honour it. If the sink
    // rejects HEAD with 405 (Azure Monitor DCR is POST-only) treat that
    // as a reachability success: the host is up, it just doesn't allow
    // the verb. Anything in the 2xx/3xx/405 band is "reachable"; 4xx
    // outside of 405 indicates auth misconfig (e.g. 401/403) which we
    // surface so the operator notices at boot, not after the first
    // export.
    const res = await fetch(url, { method: 'HEAD', signal })
    const reachable =
      (res.status >= 200 && res.status < 400) || res.status === 405
    if (reachable) return { ok: true, status: res.status }
    return { ok: false, status: res.status, error: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? 'fetch threw' }
  }
}

/**
 * P1-5 — Top-level helper. In production, requires the sink URL AND
 * probes it for reachability. In dev, silently no-ops when the sink is
 * unset (preserving the current developer experience).
 *
 * Probe is async and uses `fetch` with a 5s timeout. Failure is loud:
 * we want a deploy to fail BEFORE serving its first request rather
 * than silently lose audit attestations.
 */
export async function assertAuditSinkConfigured(
  envIn: AuditSinkEnv = process.env,
  probe: SinkProbeFn = defaultSinkProbe,
): Promise<void> {
  const url = validateAuditSinkConfig(envIn)
  if (!url) return // dev with no sink
  const result = await probe(url)
  if (!result.ok) {
    throw new Error(
      `policy-startup: AUDIT_CHECKPOINT_SINK_URL='${url}' is not reachable at boot ` +
        `(${result.error ?? 'unknown'}). This is a deploy-time check — fix the sink ` +
        'configuration before redeploying. See docs/operations/kms-signer-setup.md ' +
        '§ AUDIT_CHECKPOINT_SINK_URL.',
    )
  }
}
