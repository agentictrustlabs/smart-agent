# Smart Agent — Wallet Execution Layer Plan (Namera-Inspired)

Status: **QUEUED** (2026-05-17) — start after 1claw priority features (`output/1CLAW-INSPIRED-FEATURES-PLAN.md`) land.
Goal: Adopt Namera's wallet-execution ergonomics — policy DSL, action batches with nonce lanes, agent-readable CLI schemas, wallet MCP with hardened auth, passkey-prompted approvals — as **Smart-Agent-native primitives**. Implement in our own contracts + SDK. Explicitly reject ZeroDev runtime dependency, sudo policy, private-key print UX, raw session-key CLI args, unauth HTTP MCP, origin-reflecting WebAuthn.

This plan complements:
- `output/KMS-IMPLEMENTATION-PLAN.md` — AWS KMS substrate
- `output/GCP-KMS-IMPLEMENTATION-PLAN.md` — GCP sibling
- `output/1CLAW-INSPIRED-FEATURES-PLAN.md` — ActionIntent + MCP inspection + AccessGrant + credentialRef
- `docs/architecture/principles.md` — substrate-independence rule (P1)

---

## Strategic positioning

Namera is an **agent-native programmable smart wallet** layer (built on ZeroDev). Smart Agent is a **broader agent identity + delegation + trust graph + MCP private data + marketplace** architecture.

We are ahead on:
- Agent identity (not just a wallet — first-class principal with name, namespace, role)
- Owner-routed MCP private data (each row has exactly one owning agent)
- Cross-agent delegation as a data-access primitive (not just an execution primitive)
- GraphDB / discovery / trust-graph mirroring of public on-chain assertions
- Marketplace / proposal / pledge / pool / round flows with confidential bodies
- AnonCreds / OID4VCI / credential gating
- Substrate independence (we build our own contracts; do NOT depend on ZeroDev/Safe/MetaMask DTK)

Namera is ahead on:
- Wallet-execution policy UX (call/gas/rate-limit/timestamp/signature/sudo categories)
- Batched + parallel + multichain transaction execution (nonce lanes, atomic per-batch, receipts)
- Agent-friendly CLI with `--params` JSON mode + schema discovery + JSON/NDJSON output
- Passkey session-key UX for user-prompted approvals
- Explicit revocation invariants (session key cannot extend or revoke itself)

This plan codifies what we adopt and what we reject.

---

## What's already in Smart Agent (do not redo)

| Namera capability | Smart Agent equivalent already shipped |
|---|---|
| Smart accounts (ERC-4337 + ERC-1271) | `AgentAccount`, `AgentAccountFactory` in `packages/contracts/`. |
| Session keys with scoped onchain policies | `DelegationManager` + ICaveatEnforcer interface; `TimestampEnforcer`, `ValueEnforcer`, `AllowedTargetsEnforcer`, `AllowedMethodsEnforcer`. SDK exports `createAgentSession`. |
| Passkey-rooted custody | Sessionless passkey + SIWE auth (see `project_sessionless_passkey_siwe.md`). |
| KMS-backed signers | Sprint 5 K0..K7 + GCP G-PR-1..6. Master EOA + tool-executor + MAC all KMS-resident. |
| Revocation lifecycle | `DelegationManager.revokeDelegation` + revocation epoch in session-store. |
| ERC-6492 (signing for not-yet-deployed accounts) | Listed as an open standard the substrate-independence rule says we implement ourselves. |
| Tamper-evident audit chain | Two-row execution_audit + signed checkpoints (Sprint 5 P0-5). |

---

## What's new — the Namera-inspired work

### Priority 1: **Smart-Agent Policy DSL** (Namera item #1)

Today: ICaveatEnforcer + 4 concrete enforcers (timestamp, value, allowed-targets, allowed-methods). Plus `CallDataHashEnforcer` mentioned in spec architecture but not enforced.

Add:
- `RateLimitEnforcer` — N calls per window, configurable.
- `GasBudgetEnforcer` — cumulative gas cap across a delegation's lifetime.
- `SignatureDomainEnforcer` — restricts which EIP-712 domains a delegation can sign over.
- `PaymasterEnforcer` — restricts which paymaster sponsors a userOp.
- `CallDataHashEnforcer` (formalize) — exact-call sub-delegation binding via keccak256 of calldata.

Plus a SDK policy-builder DSL that emits the enforcer terms:
```ts
// packages/sdk/src/policy-dsl/index.ts
export function toCallPolicy(opts: {
  target: Address
  method: `0x${string}`        // 4-byte selector OR full selector list
  valueCap?: bigint
  callDataHash?: `0x${string}` // exact-call binding
}): { enforcer: Address; terms: `0x${string}` }

export function toGasPolicy(opts: { cumulativeWei: bigint }): Caveat
export function toRateLimitPolicy(opts: { perWindowMs: number; max: number }): Caveat
export function toTimestampPolicy(opts: { validAfter: number; validUntil: number }): Caveat
export function toSignatureDomainPolicy(opts: { domainSeparator: `0x${string}` }): Caveat
export function toPaymasterPolicy(opts: { paymaster: Address }): Caveat
```

These builders compose into a `buildCaveat[]` array consumed by `DelegationClient.issue`.

**Explicitly REJECT** sudo policy. There is no "unrestricted-by-design" capability in Smart Agent. The break-glass for emergency operator action is `ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL=<ISO>` + audit row — a time-bounded, externally-attested escape with no autonomous-agent equivalent.

#### PR-W1: New caveat enforcer contracts + tests
- `packages/contracts/src/RateLimitEnforcer.sol`
- `packages/contracts/src/GasBudgetEnforcer.sol`
- `packages/contracts/src/SignatureDomainEnforcer.sol`
- `packages/contracts/src/PaymasterEnforcer.sol`
- `packages/contracts/src/CallDataHashEnforcer.sol` (if not already there)
- Foundry tests covering: enforcement + tamper resistance + cumulative state correctness + boundary conditions.

#### PR-W2: SDK policy-builder DSL
- `packages/sdk/src/policy-dsl/{call,gas,rate-limit,timestamp,signature-domain,paymaster,call-data-hash}.ts`
- Unit tests covering serialization round-trip + composability.
- Update `createAgentSession` and `DelegationClient.issue` to accept policy-builder output.

---

### Priority 2: **ActionBatch + nonce lanes + multichain receipts** (Namera item #2)

Today: routes mint a single userOp at a time. No batch primitive, no nonce-lane separation, no multichain coordination.

Add a Smart-Agent-native ActionBatch primitive:
```ts
// packages/sdk/src/action-batch/types.ts
export interface ActionBatch {
  batchId: string                 // UUID per batch
  chainId: number                 // multichain support
  nonceLane?: string              // e.g. 'proposal-submit', 'notify-stewards'
  atomic: boolean                 // all-or-nothing within a chain
  calls: ExactCall[]              // each ExactCall has target + selector + calldata + value
  requiredDelegationJti?: string  // bound to a specific delegation
}

export interface ActionBundle {
  bundleId: string                // UUID; the outer audit-chain reference
  batches: ActionBatch[]          // parallel across distinct nonceLanes
}

export interface BatchReceipt {
  batchId: string
  chainId: number
  txHash?: `0x${string}`
  userOpHash?: `0x${string}`
  status: 'submitted' | 'confirmed' | 'reverted' | 'cancelled'
  gasUsed?: bigint
  error?: string
}
```

Execution semantics:
- One `ActionBundle` = one logical user/agent operation (e.g., "honor pledge + record honor + notify stewards").
- Batches within a bundle that share a `nonceLane` are serialized; batches with distinct nonce lanes run in parallel.
- A batch's `atomic: true` means all calls succeed or the batch reverts (executeBatch on the smart account).
- The bundle's audit row is hash-bound to all batches + all receipts.

This becomes the execution substrate for the integration points the 1claw plan already identified:
- Pledge honor (transfer + recordHonor)
- Proposal award + treasury settlement + notifier
- Round open/close + on-chain assertion + GraphDB sync trigger
- Credential issuance + audit anchor

#### PR-W3: SDK ActionBundle/ActionBatch types + executor
- `packages/sdk/src/action-batch/` — types + `executeBundle()` + receipt collation.
- Tests covering: parallel-lane execution, atomic-batch revert, multichain bundling, receipt-hash audit binding.

#### PR-W4: a2a-agent route migration to ActionBundle
- `/redeem-with-chain`, `/redeem-subdelegated`, `/redeem-via-account`, `/deploy-agent` accept ActionBundle envelopes.
- Audit-chain bindings extended to include `bundleId` + `batchId[]`.
- Per-batch receipts written as `request_finalized` rows linked by `bundleId`.

---

### Priority 3: **Agent-readable CLI schemas** (Namera item #3)

Today: scripts/ has many individual TS scripts. No `--params` JSON mode, no schema discovery, no NDJSON output.

Add a `smart-agent` CLI binary with:
- `smart-agent schema <command>` — dump the JSON schema for any command's params + output.
- `smart-agent <command> --params '<json>'` — invoke with JSON params.
- `--output [pretty|json|ndjson]` — flexible output for agent consumption.
- Per-command JSON schemas live alongside the implementation, single source of truth.

Initial command coverage:
```
smart-agent delegation.issue
smart-agent delegation.revoke
smart-agent session.create
smart-agent session.list
smart-agent session.revoke
smart-agent mcp.tool.call
smart-agent action.bundle.execute
smart-agent proposal.submit
smart-agent proposal.list_for_member
smart-agent proposal.read_for_review
smart-agent pledge.honor
smart-agent round.open
smart-agent round.finalize
smart-agent credential.issue
smart-agent credential.verify
smart-agent audit.export
smart-agent audit.verify
```

#### PR-W5: `smart-agent` CLI scaffold
- `packages/cli/` — new package.
- Schema-first command registration. Every command has a Zod schema for params and a result type.
- `--params` JSON mode + NDJSON output.
- One sample command implemented end-to-end (`delegation.issue`).

#### PR-W6: Command coverage rollout
- Migrate the existing scripts/* one-off tools to commands.
- Add a `pnpm check:cli-schema-drift` invariant: every implementation has a schema; the schema is sync'd with the param Zod.

---

### Priority 4: **Wallet MCP** (Namera item #4)

Today: per-agent MCPs are domain-specific (person, org, hub, family, geo, skill, verifier, people-group). No MCP exposes "wallet" as a first-class surface.

Add `apps/wallet-mcp/` — a new MCP server with tools:
```
get_wallet_address(principal)             — read-only
get_balance(principal, token?)            — read-only
read_contract(principal, target, selector, args)  — read-only
simulate_transaction(principal, call)     — read-only
prepare_exact_call_delegation(...)        — write, delegation-verified
execute_action_bundle(bundle)             — write, delegation-verified
revoke_session_key(sessionId)             — write, owner-only
list_session_keys(principal)              — read
```

**EVERY mutating tool MUST**:
- Require service-auth at the wire (canonical-v2 envelope).
- Resolve to a specific session ID.
- Verify the calling delegation chain has the right scope (target + selector + value + chain).
- Have a one-use JTI.
- Pass MCP security middleware inspection (PR-M1 from the 1claw plan).
- Emit an audit row hash-bound to the bundle/batch IDs.

This is NOT a generic remote wallet executor. It's a domain MCP whose domain happens to be wallet primitives. It enforces authorization locally, like every other Smart Agent MCP.

#### PR-W7: `apps/wallet-mcp/` scaffold + read tools
- Hono server + MCP tools registry.
- Read tools (get_address, get_balance, read_contract, simulate_transaction).
- requireInboundServiceAuth on every route.
- Classified per Sprint 5 W3 P1-2 inventory standard.

#### PR-W8: Mutating tools + ActionBundle integration
- prepare_exact_call_delegation, execute_action_bundle, revoke_session_key.
- MCP security middleware (depends on 1claw PR-M1).
- Audit row per call hash-bound to bundle+batch IDs.

---

### Priority 5: **Passkey-prompted session keys for medium/high-risk actions** (Namera item #5)

Today: session-key creation happens server-side (WebAuthn ceremony rooted to passkey, but the session-key creation flow doesn't gate on a per-action passkey prompt).

Add a `risk` field to ActionIntent (the 1claw PR-A1 envelope):
- `risk: 'low'` — automated; existing session-key suffices.
- `risk: 'medium'` — passkey-prompted approval required per action.
- `risk: 'high'` — passkey-prompted approval + exact-call sub-delegation + on-chain simulation result.

Risk levels:

| Tool | Risk |
|---|---|
| `pledge.express` | low |
| `intent.express` | low |
| `proposal.draft` | low |
| `proposal.submit` | medium |
| `pledge.honor` | medium |
| `round.finalize` | medium |
| `treasury.transfer` | high |
| `agent.deploy` | medium |
| `delegation.issue` (broad scope) | high |
| `delegation.issue` (narrow scope) | medium |

#### PR-W9: passkey approval flow for medium-risk
- Per-action passkey ceremony: the web UI prompts WebAuthn before each medium-risk ActionBundle.
- Server validates the assertion against the user's registered passkey AND the ActionBundle payload hash.
- Audit row binds the WebAuthn challenge + signature.

#### PR-W10: high-risk = passkey + exact-call sub-delegation + simulation
- Before any high-risk action, the executor MUST receive a simulation result (eth_call against a fork or AA-bundler simulate).
- Simulation result hash is bound into the ActionIntent.
- The signer refuses if simulation result is not present.

---

## What this plan explicitly REJECTS from Namera

| Pattern | Why rejected |
|---|---|
| ZeroDev runtime substrate | Violates substrate-independence (P1). Study only. We implement the policy DSL + execution layer in our own `packages/contracts` + `packages/sdk`. |
| Sudo session policy | No "unrestricted-by-design" capability in Smart Agent. Operator break-glass is time-bounded + audit-row-emitting. |
| Private-key decrypt/print CLI command | KMS-backed signing only. No code path returns raw private key material in production. |
| Session-key password as CLI arg | Leaks via shell history / `ps` / process inspection. Use OS keychain, prompt, or KMS-resident handle. |
| Local HTTP MCP as unauthenticated wallet executor | Wallet-mcp will require `requireInboundServiceAuth` on every route + delegation verification per call. |
| Origin-reflecting WebAuthn verifier | Strict allowlist: `expectedRPID = 'yourdomain'`, `expectedOrigin = ['https://yourdomain.com', ...]`. Never reflect the request's Origin header. |
| MCP that "just relays" auth to a central wallet API | Each MCP is a sovereign authorization boundary. Authorization decisions are local. |

These rejections will be encoded as bypass-guard invariants:
- No `printPrivateKey` / `decryptAndPrint` exports in `packages/sdk` or any tool.
- No CLI command with a `--private-key` positional or option.
- No `expectedOrigin = request.headers.origin` pattern in WebAuthn code (lint).
- No wallet-mcp route without `requireInboundServiceAuth`.

---

## Sequencing

Run AFTER the 1claw plan lands (PR-A1, PR-M1, PR-G1 minimum). The wallet-mcp work (PR-W7/PR-W8) explicitly depends on MCP security middleware from PR-M1.

| PR | Scope | Depends on | Size |
|---|---|---|---|
| **PR-W1** | New caveat enforcer contracts + Foundry tests | None | M |
| **PR-W2** | SDK policy-builder DSL + tests | PR-W1 | M |
| **PR-W3** | SDK ActionBundle/ActionBatch types + executor | 1claw PR-A1 (ActionIntent) | L |
| **PR-W4** | a2a-agent routes migrate to ActionBundle | PR-W3, 1claw PR-A2 | M |
| **PR-W5** | `smart-agent` CLI scaffold | None | M |
| **PR-W6** | Command coverage rollout | PR-W5 | L |
| **PR-W7** | wallet-mcp scaffold + read tools | None | M |
| **PR-W8** | wallet-mcp mutating tools + ActionBundle integration | PR-W7, PR-W3, 1claw PR-M1 | M |
| **PR-W9** | Passkey approval for medium-risk actions | PR-W3 | M |
| **PR-W10** | High-risk = passkey + exact-call sub-delegation + simulation | PR-W9 | M |

**Soft ordering**:
1. PR-W1 + PR-W5 in parallel (independent foundation).
2. PR-W2 + PR-W7 in parallel after their predecessors.
3. PR-W3 once 1claw PR-A1 ships.
4. PR-W4 + PR-W6 + PR-W8 once their dependencies ship.
5. PR-W9 + PR-W10 last (touch UI + simulation infra; biggest blast radius).

Total: 10 PRs across ~3-4 weeks if run with 2-3 sub-agents in parallel.

---

## Open decisions for the orchestrator

1. **ActionBundle vs ActionIntent overlap**: the 1claw plan introduces ActionIntent (a single named operation). The Namera plan introduces ActionBundle (composite of batches). Confirm the relationship: ActionBundle wraps a list of ActionIntents? Or ActionIntent is the outer envelope and ActionBundle is the execution-plan it carries? Recommended: **ActionIntent is the policy envelope; ActionBundle is the execution plan carried inside**. The policy engine evaluates ActionIntent; if permit, the executor runs the ActionBundle. Single audit binding spans both.

2. **CLI binary naming**: `smart-agent` is taken by the project name. Pick `sa`, `sak` (Smart Agent Kit), or `agent-cli`. Recommend `sa` for terseness.

3. **wallet-mcp owner**: Does each agent get its own wallet-mcp instance (per-person, per-org)? Or is there one wallet-mcp that takes principal as a tool argument? Recommend ONE wallet-mcp with principal-bound tools, since the authority comes from the delegation chain, not from per-instance state.

4. **Simulation infrastructure**: PR-W10 needs eth_call / bundler simulate. Today we use anvil for dev. Production needs a remote bundler with simulate API. Pick: Alchemy Bundler / Pimlico / Stackup / self-hosted. Doesn't block PR-W1..PR-W9.

5. **Foundry vs Hardhat for the new enforcer tests**: stay on Foundry (matches existing contracts).

6. **Multichain timing**: PR-W3 specs multichain. Realistically, Smart Agent today is single-chain (anvil dev, target one production EVM chain). Multichain wiring can be a feature flag deferred until needed.

---

## What this plan is NOT

- NOT a Namera dependency. We study their public docs and CLI ergonomics; we implement everything in-house.
- NOT a wallet-only feature set. The wallet-mcp is one of many MCPs; the policy DSL is for delegations across the system, not just wallet ops.
- NOT a re-architecture. Owner-routed private data, public-on-chain → GraphDB mirror, MCPs as sovereign boundaries all stay.
- NOT a substitute for the 1claw plan. The two are complementary: 1claw covers MCP inspection + secret handles + access grants; this plan covers wallet execution ergonomics + CLI + passkey approvals.

---

## Why this matters

Once 1claw features land (ActionIntent + MCP inspection + AccessGrant + credentialRef), the substrate is defensible. This plan makes the substrate **operationally pleasant for agents and developers**: a clear policy DSL, lane-based batched execution, schema-first CLI, and risk-tiered approval flows. The combined hardening (Sprint 5) + safety primitives (1claw) + execution ergonomics (Namera) is what makes "langchain orchestration inside a2a-agent" feasible without sacrificing the trust model.
