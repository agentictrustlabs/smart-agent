/**
 * Off-chain caveat evaluator — the twin of the on-chain enforcers under
 * `packages/contracts/src/enforcers/`.
 *
 * Why this exists
 * ---------------
 * The MCP token verifier (`apps/person-mcp/src/auth/verify-delegation.ts`
 * and `apps/org-mcp/src/auth/verify-delegation.ts`) loops over the
 * `delegation.caveats` and historically only checked Timestamp +
 * McpToolScope. Every other enforcer (AllowedTargets, AllowedMethods,
 * Value, TaskBinding, CallDataHash, …) fell through silently. For tools
 * whose `executionPath === 'mcp-only'` (i.e. no on-chain redeem ever
 * happens), the user's caveat-scoped delegation was effectively
 * unenforced — and worse, an attacker could craft a delegation with an
 * UNKNOWN enforcer and the MCP verifier would silently accept it.
 *
 * This module exposes a single fail-closed dispatcher:
 *
 *   - Known enforcers each have a per-enforcer evaluator. Timestamp +
 *     McpToolScope are fully evaluated off-chain. AllowedTargets,
 *     AllowedMethods, Value are evaluated IF the caller supplies the
 *     relevant context (target / selector / value); if context is
 *     missing the verdict is `allowed: true` because the on-chain
 *     redeem path re-evaluates these enforcers in their canonical
 *     environment. TaskBinding + CallDataHash are TODO-stubbed as
 *     "trusted on-chain" — they cannot be evaluated meaningfully
 *     without the runtime callData, which the MCP boundary doesn't
 *     have. Both are inert at the MCP boundary and CallDataHashEnforcer
 *     reverts on-chain on mismatch (see CallDataHashEnforcer.sol).
 *
 *   - Unknown enforcer (i.e. not in the dispatch table) ⇒ verdict
 *     `{ allowed: false, reason: 'unknown enforcer' }`. This is the
 *     fail-closed bit; without it, an attacker could insert any caveat
 *     into a signed delegation and the MCP path would pass it through.
 *
 * Enforcer addresses are read from env (these are the same env vars the
 * a2a-agent reads in `apps/a2a-agent/src/config.ts`):
 *
 *   TIMESTAMP_ENFORCER_ADDRESS
 *   ALLOWED_TARGETS_ENFORCER_ADDRESS
 *   ALLOWED_METHODS_ENFORCER_ADDRESS
 *   VALUE_ENFORCER_ADDRESS
 *   CALLDATA_HASH_ENFORCER_ADDRESS
 *   TASK_BINDING_ENFORCER_ADDRESS
 *   MCP_TOOL_SCOPE_ENFORCER_ADDRESS  (defaults to sentinel constant)
 *   DATA_SCOPE_ENFORCER_ADDRESS      (defaults to sentinel constant)
 *
 * Callers may pass an explicit `enforcerAddresses` map to override env
 * (useful for tests). When an env var is unset / zero, the dispatcher
 * treats the enforcer as unconfigured — matching the address still
 * yields a known evaluator, but matching the *zero* address never
 * happens because real caveats have non-zero enforcers.
 */
import {
  MCP_TOOL_SCOPE_ENFORCER,
  DATA_SCOPE_ENFORCER,
  DELEGATE_BINDING_ENFORCER,
  decodeTimestampTerms,
  decodeMcpToolScopeTerms,
  decodeAllowedTargetsTerms,
  decodeAllowedMethodsTerms,
  decodeValueTerms,
  decodeDataScopeTerms,
  decodeDelegateBindingTerms,
} from '../delegation'

export interface CaveatLike {
  enforcer: `0x${string}`
  terms: `0x${string}`
  args?: `0x${string}`
}

/**
 * Context for evaluating caveats off-chain.
 *
 *   mcpTool      — REQUIRED. The tool being invoked. Always known at the
 *                  MCP boundary.
 *   principal    — REQUIRED. The delegator address (lower-cased).
 *   sessionId    — Optional session identifier (audit-only; not yet wired
 *                  into any evaluator).
 *   timestamp    — REQUIRED. Unix seconds. Pass `Math.floor(Date.now() / 1000)`.
 *
 *   target       — Optional. The on-chain target contract address. If
 *                  provided, AllowedTargets enforcer is evaluated.
 *   selector     — Optional. The 4-byte function selector. If provided,
 *                  AllowedMethods enforcer is evaluated.
 *   value        — Optional. Call value in wei. If provided, Value
 *                  enforcer is evaluated.
 *   callData     — Optional. Full callData. Reserved for future
 *                  CallDataHashEnforcer off-chain twin.
 */
export interface CaveatContext {
  mcpTool: string
  principal: `0x${string}`
  sessionId?: string
  target?: `0x${string}`
  selector?: `0x${string}`
  value?: bigint
  callData?: `0x${string}`
  timestamp: number
}

export interface CaveatVerdict {
  allowed: boolean
  reason?: string
  enforcer: string
}

/**
 * Optional map of enforcer-address overrides. Useful for tests; in
 * production callers should pass `process.env` derived addresses.
 */
export interface EnforcerAddressMap {
  timestamp?: `0x${string}`
  allowedTargets?: `0x${string}`
  allowedMethods?: `0x${string}`
  value?: `0x${string}`
  callDataHash?: `0x${string}`
  taskBinding?: `0x${string}`
  mcpToolScope?: `0x${string}`
  dataScope?: `0x${string}`
  delegateBinding?: `0x${string}`
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

function fromEnv(envName: string): `0x${string}` | undefined {
  const v = (typeof process !== 'undefined' ? process.env?.[envName] : undefined)
  if (!v) return undefined
  const lower = v.toLowerCase()
  if (lower === ZERO_ADDR) return undefined
  return lower as `0x${string}`
}

/** Resolve the effective enforcer-address map by overlaying explicit
 *  overrides on top of env-derived values. Missing entries are left
 *  undefined — those enforcers won't be in the dispatch table. The MCP
 *  tool scope + data scope enforcers fall back to their SDK sentinel
 *  constants when no env override is set. */
function resolveAddresses(overrides?: EnforcerAddressMap): Required<
  Pick<EnforcerAddressMap, 'mcpToolScope' | 'dataScope' | 'delegateBinding'>
> &
  EnforcerAddressMap {
  return {
    timestamp:       overrides?.timestamp       ?? fromEnv('TIMESTAMP_ENFORCER_ADDRESS'),
    allowedTargets:  overrides?.allowedTargets  ?? fromEnv('ALLOWED_TARGETS_ENFORCER_ADDRESS'),
    allowedMethods:  overrides?.allowedMethods  ?? fromEnv('ALLOWED_METHODS_ENFORCER_ADDRESS'),
    value:           overrides?.value           ?? fromEnv('VALUE_ENFORCER_ADDRESS'),
    callDataHash:    overrides?.callDataHash    ?? fromEnv('CALLDATA_HASH_ENFORCER_ADDRESS'),
    taskBinding:     overrides?.taskBinding     ?? fromEnv('TASK_BINDING_ENFORCER_ADDRESS'),
    mcpToolScope:    (overrides?.mcpToolScope   ?? fromEnv('MCP_TOOL_SCOPE_ENFORCER_ADDRESS') ?? MCP_TOOL_SCOPE_ENFORCER).toLowerCase() as `0x${string}`,
    dataScope:       (overrides?.dataScope      ?? fromEnv('DATA_SCOPE_ENFORCER_ADDRESS')     ?? DATA_SCOPE_ENFORCER).toLowerCase() as `0x${string}`,
    delegateBinding: (overrides?.delegateBinding ?? fromEnv('DELEGATE_BINDING_ENFORCER_ADDRESS') ?? DELEGATE_BINDING_ENFORCER).toLowerCase() as `0x${string}`,
  }
}

// ─── Per-enforcer evaluators ────────────────────────────────────────

type Evaluator = (caveat: CaveatLike, ctx: CaveatContext) => CaveatVerdict

function evalTimestamp(caveat: CaveatLike, ctx: CaveatContext): CaveatVerdict {
  try {
    const { validAfter, validUntil } = decodeTimestampTerms(caveat.terms)
    if (ctx.timestamp < validAfter) {
      return { allowed: false, reason: `not yet valid (validAfter=${validAfter}, now=${ctx.timestamp})`, enforcer: caveat.enforcer }
    }
    if (ctx.timestamp >= validUntil) {
      return { allowed: false, reason: `expired (validUntil=${validUntil}, now=${ctx.timestamp})`, enforcer: caveat.enforcer }
    }
    return { allowed: true, enforcer: caveat.enforcer }
  } catch (e) {
    return { allowed: false, reason: `failed to decode timestamp terms: ${(e as Error).message}`, enforcer: caveat.enforcer }
  }
}

function evalMcpToolScope(caveat: CaveatLike, ctx: CaveatContext): CaveatVerdict {
  try {
    const { allowedTools } = decodeMcpToolScopeTerms(caveat.terms)
    if (!allowedTools.includes(ctx.mcpTool)) {
      return {
        allowed: false,
        reason: `tool '${ctx.mcpTool}' not in MCP tool scope (allowed: ${allowedTools.join(', ')})`,
        enforcer: caveat.enforcer,
      }
    }
    return { allowed: true, enforcer: caveat.enforcer }
  } catch (e) {
    return { allowed: false, reason: `failed to decode MCP tool scope terms: ${(e as Error).message}`, enforcer: caveat.enforcer }
  }
}

function evalAllowedTargets(caveat: CaveatLike, ctx: CaveatContext): CaveatVerdict {
  // If the caller hasn't supplied a target, this enforcer is on-chain-only
  // territory. The redeem handler in a2a-agent re-evaluates this against
  // the actual call. We can't second-guess off-chain.
  if (!ctx.target) return { allowed: true, enforcer: caveat.enforcer }
  try {
    const { targets } = decodeAllowedTargetsTerms(caveat.terms)
    const targetLower = ctx.target.toLowerCase()
    const ok = targets.some((t) => t.toLowerCase() === targetLower)
    if (!ok) {
      return {
        allowed: false,
        reason: `target ${ctx.target} not in AllowedTargets (${targets.join(', ')})`,
        enforcer: caveat.enforcer,
      }
    }
    return { allowed: true, enforcer: caveat.enforcer }
  } catch (e) {
    return { allowed: false, reason: `failed to decode AllowedTargets terms: ${(e as Error).message}`, enforcer: caveat.enforcer }
  }
}

function evalAllowedMethods(caveat: CaveatLike, ctx: CaveatContext): CaveatVerdict {
  if (!ctx.selector) return { allowed: true, enforcer: caveat.enforcer }
  try {
    const { selectors } = decodeAllowedMethodsTerms(caveat.terms)
    const selLower = ctx.selector.toLowerCase()
    const ok = selectors.some((s) => s.toLowerCase() === selLower)
    if (!ok) {
      return {
        allowed: false,
        reason: `selector ${ctx.selector} not in AllowedMethods (${selectors.join(', ')})`,
        enforcer: caveat.enforcer,
      }
    }
    return { allowed: true, enforcer: caveat.enforcer }
  } catch (e) {
    return { allowed: false, reason: `failed to decode AllowedMethods terms: ${(e as Error).message}`, enforcer: caveat.enforcer }
  }
}

function evalValue(caveat: CaveatLike, ctx: CaveatContext): CaveatVerdict {
  if (ctx.value === undefined) return { allowed: true, enforcer: caveat.enforcer }
  try {
    const { maxValue } = decodeValueTerms(caveat.terms)
    if (ctx.value > maxValue) {
      return {
        allowed: false,
        reason: `value ${ctx.value} exceeds Value enforcer maxValue ${maxValue}`,
        enforcer: caveat.enforcer,
      }
    }
    return { allowed: true, enforcer: caveat.enforcer }
  } catch (e) {
    return { allowed: false, reason: `failed to decode Value terms: ${(e as Error).message}`, enforcer: caveat.enforcer }
  }
}

/**
 * DataScope enforcer is per-cross-principal-delegation. At the standard
 * delegation-verify boundary the off-chain code only needs to recognize
 * it as a known enforcer; the cross-delegation verifier (which handles
 * those flows explicitly) decodes the grants separately.
 */
function evalDataScope(caveat: CaveatLike): CaveatVerdict {
  try {
    decodeDataScopeTerms(caveat.terms)
    return { allowed: true, enforcer: caveat.enforcer }
  } catch (e) {
    return { allowed: false, reason: `failed to decode DataScope terms: ${(e as Error).message}`, enforcer: caveat.enforcer }
  }
}

/**
 * DelegateBinding enforcer (Sprint 2 S2.3) carries the dual-address
 * binding for cross-principal delegations: `(delegateSmartAccount,
 * delegatePersonAgent)`. At the standard verifier we just sanity-check
 * the encoding — the cross-delegation verifier
 * (`apps/person-mcp/src/auth/verify-delegation.ts::verifyCrossDelegation`)
 * decodes the terms and asserts the binding against the session subject
 * + on-chain resolution.
 */
function evalDelegateBinding(caveat: CaveatLike): CaveatVerdict {
  try {
    decodeDelegateBindingTerms(caveat.terms)
    return { allowed: true, enforcer: caveat.enforcer }
  } catch (e) {
    return { allowed: false, reason: `failed to decode DelegateBinding terms: ${(e as Error).message}`, enforcer: caveat.enforcer }
  }
}

/**
 * TaskBindingEnforcer is informational on-chain (just records the taskId).
 * CallDataHashEnforcer locks a sub-delegation to one exact callData and
 * reverts on mismatch at on-chain redeem.
 *
 * Both are minted exclusively by `a2a-agent`'s sub-delegated path; they
 * never appear in user-signed root delegations under current flows. They
 * cannot be evaluated meaningfully without the runtime callData (which
 * the MCP boundary doesn't have), and they are enforced at on-chain
 * redeem. We mark them known and inert here. TODO: revisit if a code
 * path ever puts these caveats on a delegation that doesn't go through
 * `/redeem-subdelegated` — then evaluate against ctx.callData.
 */
function evalTrustedOnChain(caveat: CaveatLike): CaveatVerdict {
  return { allowed: true, enforcer: caveat.enforcer }
}

// ─── Dispatcher ─────────────────────────────────────────────────────

/**
 * Evaluate every caveat against `ctx`. Returns one verdict per caveat,
 * in input order. Unknown enforcer addresses always produce a `denied`
 * verdict (fail-closed). Callers should reject the request as soon as
 * any verdict has `allowed === false`.
 */
export function evaluateCaveats(
  caveats: CaveatLike[],
  ctx: CaveatContext,
  addressOverrides?: EnforcerAddressMap,
): CaveatVerdict[] {
  const addrs = resolveAddresses(addressOverrides)

  // Build a dispatch table keyed by lower-cased enforcer address.
  const table = new Map<string, Evaluator>()
  if (addrs.timestamp)      table.set(addrs.timestamp.toLowerCase(),     evalTimestamp)
  if (addrs.allowedTargets) table.set(addrs.allowedTargets.toLowerCase(), evalAllowedTargets)
  if (addrs.allowedMethods) table.set(addrs.allowedMethods.toLowerCase(), evalAllowedMethods)
  if (addrs.value)          table.set(addrs.value.toLowerCase(),          evalValue)
  if (addrs.callDataHash)   table.set(addrs.callDataHash.toLowerCase(),   evalTrustedOnChain)
  if (addrs.taskBinding)    table.set(addrs.taskBinding.toLowerCase(),    evalTrustedOnChain)
  // MCP tool scope + data scope + delegate-binding sentinels are always
  // defined (SDK constants).
  table.set(addrs.mcpToolScope.toLowerCase(),    evalMcpToolScope)
  table.set(addrs.dataScope.toLowerCase(),       evalDataScope)
  table.set(addrs.delegateBinding.toLowerCase(), evalDelegateBinding)

  return caveats.map((caveat) => {
    const key = caveat.enforcer.toLowerCase()
    const evaluator = table.get(key)
    if (!evaluator) {
      return {
        allowed: false,
        reason: 'unknown enforcer',
        enforcer: caveat.enforcer,
      }
    }
    return evaluator(caveat, ctx)
  })
}

/**
 * Convenience: returns the first denying verdict, or undefined if all
 * caveats pass.
 */
export function firstDenial(
  caveats: CaveatLike[],
  ctx: CaveatContext,
  addressOverrides?: EnforcerAddressMap,
): CaveatVerdict | undefined {
  for (const v of evaluateCaveats(caveats, ctx, addressOverrides)) {
    if (!v.allowed) return v
  }
  return undefined
}
