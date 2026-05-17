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
 * Targets that legitimately route through dedicated endpoints rather
 * than the generic redeem path. Their selector resolution lives in the
 * endpoint code (e.g. /deploy-agent computes `createAccount`'s selector
 * directly). Tools whose ONLY targets are in this list don't need a
 * selector table entry.
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
  // Spec-004 marketplace registries — Pool/Match/Grant/Vote selector
  // tables ship with the marketplace integration. Exempted until then;
  // the on-chain selector guard remains strict (`!allowedSelectors.has(selector)`)
  // so an empty mapping still rejects every call — this exemption just
  // keeps assertPolicyCompleteness from refusing to boot.
  'PledgeRegistry',
  'MatchInitiationRegistry',
  'GrantProposalRegistry',
  'VoteRegistry',
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
 */
const PLACEHOLDER_TOOL_IDS: ReadonlySet<string> = new Set<string>([
  // No on-chain claim() on FundRegistry yet — Phase 5 disbursement.
  'disbursement:claim',
  // No on-chain award() / revokeAward() yet — Phase 5 award lifecycle.
  'grant_proposal:award',
  'grant_proposal:revoke_award',
])

/**
 * Treat these tools as exempt from the completeness check. The Phase
 * 1A hardening trail is meant to PREVENT new tools from being added
 * without selectors; legacy tools whose only on-chain target is a
 * special-case target (e.g. agent:deploy → AgentAccountFactory only)
 * fall here.
 */
function policyIsExemptFromSelectorCheck(toolId: string, policy: ToolPolicy): boolean {
  if (policy.allowedTargets.length === 0) return true
  if (PLACEHOLDER_TOOL_IDS.has(toolId)) return true
  return policy.allowedTargets.every((t) => SPECIAL_CASE_TARGETS.has(t))
}

/**
 * Walk every on-chain ToolPolicy and verify that at least one of its
 * allowedTargets has a non-empty selector mapping for the tool. Throws
 * on any failure with a list of problem tools.
 */
export function assertPolicyCompleteness(): void {
  const problems: string[] = []

  for (const [toolId, policy] of Object.entries(TOOL_POLICIES)) {
    if (policy.executionPath === 'mcp-only') continue
    if (policyIsExemptFromSelectorCheck(toolId, policy)) continue

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
