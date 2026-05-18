# Smart Agent — 1claw-Inspired Security Primitives Plan

Status: **PROPOSED** (2026-05-17)
Goal: Adopt the six operational-security ideas from 1claw's architecture (KMS custody, sign-only proxies, MCP inspection, secret handles, expiry/max-use access, tamper-evident audit) as **Smart-Agent-native primitives**. Explicitly reject 1claw's static API key model, plaintext secret return, and wildcard-policy defaults.

This plan complements:
- `output/KMS-IMPLEMENTATION-PLAN.md` — AWS KMS substrate
- `output/GCP-KMS-IMPLEMENTATION-PLAN.md` — GCP KMS sibling
- `specs/003-intent-marketplace-proposal/plan.md` — the proposal lane these features harden

---

## What's already done — do not redo

| 1claw idea | Where Smart Agent already has it |
|---|---|
| HSM-backed envelope encryption | Sprint 5 K0-K7: `A2AKeyProvider` interface, `buildSessionAAD` with `key_version`, AWS KMS EncryptionContext, hashed `session_id_h`. AWS production-ready; GCP G-PR-2 just landed. |
| Sign-only key custody (master EOA, tool executors) | K4 + K5: master signer + per-tool signers via KMS asymmetric `ECC_SECG_P256K1`; private key never leaves KMS. Bypass-guard invariant: no `@aws-sdk/client-kms`/`@google-cloud/kms` imports in routes. |
| KMS-held inter-service MAC | K3-ext: `MacProvider` via AWS KMS HMAC (per-service-pair keys). |
| Vercel OIDC → cloud STS (no static creds) | Both AWS (`@vercel/oidc-aws-credentials-provider`) and GCP (`@vercel/oidc` + `ExternalAccountClient`) federated identity. |
| Tamper-evident audit chain | Sprint 5 P0-5: two-row model (`request_received` + `request_finalized` + `request_denied`) with `prev_entry_hash` + `entry_hash`. Append-only invariant enforced by `scripts/check-no-bypass.sh`. Signed checkpoints (`apps/a2a-agent/src/lib/audit-checkpoint.ts`) attest chain head via master signer. Person-mcp + org-mcp have parallel chains with their own checkpoints. |
| 90-day rotation, KMS key versioning | `key_version` bound into AAD (Sprint 5 P0-6); pinned `cryptoKeyVersions/<n>` paths (GCP) and key-id+version pairs (AWS); ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL break-glass for time-bounded operator overrides. |
| Hash-bound break-glass audit rows | Sprint 5 W3 Gap A: `system:break-glass-legacy-a2a-sessions`; sibling of `system:break-glass-deployer-key`. |

**Bypass guard at 7 invariants** (was 4 entering Sprint 5). Inter-service MAC canonical-v2 (`${ts}|${nonce}|${path}|${sha256(body)}`) is the only form accepted. Audit table is strictly append-only.

---

## What's NOT yet built — the new work

### Priority 1: **ActionIntent + sign-only action proxy** (1claw item #2)

Today: KMS signers are sign-only **at the key level** (private key never leaves the HSM), but there's no policy engine that gates **what gets signed**. Today, anything inside `apps/a2a-agent/src/routes/onchain-redeem.ts` that has a delegation envelope and a `redeemAndExecute(...)` payload can ask the master signer to sign it. That's narrower than 1claw's Intents API.

Add a formal **ActionIntent envelope** + policy engine that sits between the route and the signer:

```ts
// packages/sdk/src/action-policy/types.ts
export interface SmartAgentActionIntent {
  actionId: string                          // UUID / JTI — single-use
  actorAgent: string                        // ENS-style agent name
  sessionId: string
  audience: 'a2a-agent' | 'person-mcp' | 'org-mcp' | 'hub-mcp' | ... | 'onchain'
  tool: ActionTool                          // closed enum across all MCPs
  resource: {
    proposalId?: string
    roundId?: string
    fundAgentId?: string
    poolId?: string
    pledgeId?: string
    intentId?: string
    targetContract?: `0x${string}`
    methodSelector?: `0x${string}`
    chainId?: number
  }
  expiresAt: string                         // ISO-8601; max 5 min in future
  idempotencyKey: string                    // dedupes (actor, tool, resource) per (epoch)
  risk: 'low' | 'medium' | 'high'
  payloadHash: `0x${string}`                // keccak256 of the canonical action payload
  delegationJti?: string                    // when invoking under cross-delegation
}
```

The policy engine (a new `packages/sdk/src/action-policy/`) validates:
- `actor` has a current session.
- `tool` is in the actor's session-grant `allowedTools`.
- `audience` matches the MCP being invoked.
- `delegationJti` (if present) is unrevoked, unexpired, and grants this tool on this resource.
- `targetContract` + `methodSelector` are in the actor's session-grant `allowedTargets` / `allowedMethods`.
- `chainId` is allowed.
- Value caps and risk caps are within the session's limits.
- `idempotencyKey` has not been used (anti-replay).
- Simulation result (where applicable) is success.

Only after every check passes does the route call the signer. The signer DOES NOT verify policy — it trusts that the policy engine wouldn't have called it if policy failed (defense in depth: the signer logs which `actionId` requested the signature so an audit can reconstruct which policy decisions led to which sign calls).

**The signer is the load-bearing boundary, but the policy engine is the gatekeeper.**

This is a **bigger conceptual upgrade than it sounds**. Today, route handlers compute the redeem payload, build the userOp, and sign. After this change, route handlers MINT an ActionIntent, call `policyEngine.evaluate(intent)`, and only if it returns `permit` does the signer execute. The audit chain binds the `actionId` to both the policy decision and the signature, so a senior security firm walking the chain can reconstruct every gate the action passed through.

#### PR-A1: ActionIntent envelope + policy engine

- `packages/sdk/src/action-policy/types.ts` — `SmartAgentActionIntent`, `ActionTool` (closed enum), `PolicyDecision`, `PolicyEngineDeps`.
- `packages/sdk/src/action-policy/engine.ts` — `evaluatePolicy(intent, context, deps): PolicyDecision`.
- `packages/sdk/src/action-policy/idempotency-store.ts` — backed by a small SQLite table (a2a-agent) or in-memory store (web) keyed by `(actionId)` with TTL = `expiresAt`. Anti-replay.
- `packages/sdk/src/action-policy/index.ts` — barrel.
- Tests: every policy path (permit / deny / require-simulation / require-review) + idempotency-replay rejection + expired-intent rejection.

#### PR-A2: a2a-agent routes mint and evaluate ActionIntents

- `apps/a2a-agent/src/routes/onchain-redeem.ts` — `/redeem-with-chain`, `/redeem-subdelegated`, `/redeem-via-account`, `/deploy-agent` each build an `ActionIntent` BEFORE calling the signer. The policy engine evaluates BEFORE the signer is touched. Failures call `denyAndAudit(c, { reason: 'policy:intent-rejected', ... })`.
- New audit-row binding: `actionId` is part of the `ENTRY_HASH_BINDING_FIELDS`.

#### PR-A3: MCP-side ActionIntent for inter-MCP system calls

Apply the same ActionIntent envelope to:
- `round:increment_proposals_received`
- `intent:bump_ack_count`
- `pool:contribute_to_total`

These are one-shot system delegations today (per Gap B identified in spec 003). Formalize them as ActionIntents whose policy engine enforces `maxUses: 1` via the idempotency store.

---

### Priority 2: **MCP inspection pipeline** (1claw item #3 — the user's most-aggressively-adopt item)

Today: MCPs validate input via Zod (P0-4 + S3.4) but do **not** scan for prompt-injection, command-injection, hidden Unicode, exfiltration markers, or PII bleed. Output redaction is per-tool, not a layer.

Build `packages/mcp-security/`:

```ts
export interface McpSecurityMiddleware {
  beforeToolCall(input: {
    principal: string
    tool: string
    args: unknown
    delegation: VerifiedDelegation
  }): Promise<SecurityVerdict>     // permit | block | flag-for-review

  afterToolCall(input: {
    principal: string
    tool: string
    result: unknown
    fetchedSensitiveRefs: SensitiveRef[]
  }): Promise<SanitizedResult>
}

export type SecurityVerdict =
  | { verdict: 'permit' }
  | { verdict: 'block'; reason: string; markers: SecurityMarker[] }
  | { verdict: 'flag'; reason: string; markers: SecurityMarker[]; auditOnly: true }
```

#### Inspection checks (`beforeToolCall`)
- **Prompt-injection markers**: "ignore previous instructions", "system override", "developer mode on", role-leak heuristics, JSON-mode escape.
- **Command-injection markers**: shell metacharacters in expected-text fields, base64-encoded executables, eval payloads.
- **URL exfiltration**: any URL in a field that's not declared as `url|markdown`.
- **Unicode tricks**: homoglyphs, zero-width chars, RTL overrides, surrogate-pair tampering.
- **Encoded obfuscation**: base64/hex over a threshold of total field length when the field is expected text.
- **PII where unexpected**: SSN/EIN/credit-card/IBAN regex match in non-PII fields.
- **Credential/private-key patterns**: `sk_live_*`, `0x[64-hex]`, `-----BEGIN PRIVATE KEY-----`, AWS access key prefix, JWT shape.
- **Tool-confusion**: tool name in args that doesn't match the called tool, mismatched delegation-jti and tool.
- **Attempts to alter delegation/audit/status fields**: hard-block if any tool args include `delegationJti`, `entryHash`, `prevEntryHash`, `status`, `tx_hash`.

#### Output checks (`afterToolCall`)
- **Secret redaction**: known credential patterns redacted to `[REDACTED]` with audit row.
- **Private proposal-body fields** redacted unless caller has `proposal:read_for_review` for that resource.
- **Block private MCP row leakage to GraphDB**: outputs intended for GraphDB sync are filtered to public-tier fields only.
- **Cross-principal data leakage**: assert every row returned is owned by `principal` or under valid delegation.
- **Response schema verification**: result matches the tool's declared output schema.

#### Defaults — different from 1claw

| Marker class | Smart Agent default | 1claw default |
|---|---|---|
| Prompt injection (high confidence) | **block** | warn |
| Credential exfil | **block** | warn |
| Proposal body exfil w/o `proposal:read_for_review` | **block** | n/a |
| PII bleed in non-PII field | **block** | warn |
| Unicode tricks | **block** | warn |
| Tool-confusion | **block** | warn |
| Encoded obfuscation (over threshold) | flag | warn |
| URL in non-url field | flag | warn |

The block defaults are deliberately stricter than 1claw because Smart Agent's MCPs own PII and confidential proposals.

#### PR-M1: `packages/mcp-security/`

- Detection module per marker class.
- `McpSecurityMiddleware` interface + `runSecurity(middlewares, ...)` helper.
- `SecurityMarker[]` envelope with stable taxonomy.
- Tests with known-attack vectors per marker class.

#### PR-M2: Person-mcp + org-mcp adopt the middleware

- Wrap every tool handler in `runSecurity(middlewares, { before, tool, after })`.
- Block decisions write `request_denied` audit rows with `reason: 'security:<marker>'`.
- Flag decisions write `request_received` rows with `flags: [...]` field.

#### PR-M3: Hub/family/geo/skill/verifier/people-group MCPs adopt (Sprint 4 W2 fold-in synergy)

These MCPs are in the Sprint 4 W2 fold-in queue anyway. Add security middleware as part of that work.

---

### Priority 3: **Secret handle / credentialRef scheme** (1claw item #4)

Today: there is no formal way to pass "use this credential" without passing the credential itself. Few places in Smart Agent currently leak credentials (we've already removed most static keys), but the proposal lane will need this for LLM-assisted drafting (provider keys), verifier credentials, and external evidence URLs.

Define a URI scheme:
```
credentialRef://<owning-agent>/<resource-path>#<version>
secretRef://<owning-agent>/<resource-path>#<version>
walletSignerRef://<owning-agent>/<purpose>#<version>
```

Examples:
- `credentialRef://org/abc/providers/openai/api-key#v3`
- `secretRef://family/xyz/treasury-passphrase#v1`
- `walletSignerRef://person/richard/master-eoa#v1`

A handle resolver is itself a brokered MCP tool — `secrets:resolve_handle` — that returns a one-shot **brokered handle** (e.g., a token redeemable against a `llm-proxy` or a single signing operation), NEVER the raw value. The LLM/agent/tool never sees the raw secret.

For Smart Agent's marketplace flow specifically:
- LLM provider keys (when proposal composer uses LLM assistance) → `credentialRef://`.
- AnonCreds verifier keys → `credentialRef://`.
- GraphDB credentials → `credentialRef://`.
- RPC credentials → `credentialRef://`.
- KMS aliases → `walletSignerRef://`.
- Session package wrapping keys → already handled by `A2AKeyProvider`; no new URI needed.

#### PR-C1: `credentialRef://` scheme + resolver

- `packages/sdk/src/credential-ref/types.ts` — `CredentialRef`, `BrokeredHandle`, `HandleResolver`.
- Resolver only callable via authenticated MCP tool `secrets:resolve_handle`. Returns a brokered handle valid for ONE use, with TTL ≤ 5 minutes, bound to the (actor, target tool) pair.
- LLM proxy + verifier proxy + GraphDB sync each accept brokered handles instead of raw credentials.

#### PR-C2: Proposal-lane integration

- Replace any raw credential passed into LLM-assisted proposal drafting with `credentialRef://org/.../openai/api-key`.
- Replace any raw key passed into verifier calls with `credentialRef://`.

---

### Priority 4: **Expiry + max-use access objects** (1claw item #5)

Today: delegations have `validAfter` + `validUntil`. They do NOT have:
- `maxUses` (per-JTI)
- `readCount` (running tally)
- `revokeOnStatus` (terminal-state revocation list)
- Formal `jti` field (some flows use it; others don't)

Standardize the cross-delegation shape per 1claw's expiry + max-access pattern:

```ts
// packages/sdk/src/delegation/access-grant.ts
export interface AccessGrant {
  grantId: string
  jti: string                       // single-use across the lifecycle
  issuerAgent: string
  granteeAgent: string
  allowedTools: ActionTool[]
  resourceScope: ResourceScope
  validFrom: string                 // ISO-8601
  validUntil: string                // ISO-8601
  maxUses: number                   // 0 = unbounded (rare; default 1 for system delegations)
  useCount: number                  // running tally
  revokeOnStatus?: string[]         // e.g. ['withdrawn', 'awarded', 'declined']
  revokedAt?: string
  payloadHashAtGrant?: string       // for read-grants on snapshotted bodies
}
```

Apply to:
- `proposal:read_for_review` (steward reads of confidential proposal bodies)
- `round:increment_proposals_received` (one-shot system delegation)
- `intent:bump_ack_count` (one-shot)
- `pool:contribute_to_total` (one-shot)
- Future: every cross-delegation in the proposal lane

When a grant is exercised, the `useCount` increments atomically. If `useCount >= maxUses`, the grant is exhausted (treated as revoked). If the linked resource transitions to one of `revokeOnStatus`, the grant is revoked (one row update marking `revokedAt`; the read pipeline checks before serving).

#### PR-G1: `AccessGrant` schema + DB tables

- New table per owning MCP: `access_grants`. Columns: as above.
- Person-mcp owns `proposal:read_for_review` grants over its own proposals.
- Org-mcp / hub-mcp / fund-mcp etc. own their own grant scopes.

#### PR-G2: Grant lifecycle middleware

- `requireAccessGrant({ tool, jti, resourceId })` middleware that atomically:
  1. Loads the grant by `(granteeAgent, jti)`.
  2. Verifies `validFrom <= now <= validUntil`.
  3. Verifies `useCount < maxUses`.
  4. Verifies `revokedAt IS NULL`.
  5. Verifies the resource is NOT in `revokeOnStatus`.
  6. Increments `useCount`.
  7. Returns `permit` or `deny + reason`.
- Wraps every read of a confidential body or system-delegated mutation.

#### PR-G3: Status-cascading revocation

- When a proposal transitions to `awarded`/`declined`/`withdrawn`, mark all `proposal:read_for_review` grants for that proposal as `revokedAt = now` in one transaction.
- A nightly sweep job catches any drift.

---

### Priority 5: **Proposal-lane schema + audit upgrades** (synergy with the 003 branch)

These are the changes the user specifically called out in section "A. Update the proposal_submissions schema" and section "E. Add a 'proposal review read receipt' event":

```sql
-- proposal_submissions (person-mcp, OR proposer's owning MCP)
ALTER TABLE proposal_submissions
  ADD COLUMN encrypted_body BLOB NOT NULL,
  ADD COLUMN body_content_hash TEXT NOT NULL,           -- sha256 of canonical body for review-grant binding
  ADD COLUMN body_encryption_context TEXT NOT NULL,     -- JSON: aadContext used for envelope encryption
  ADD COLUMN body_key_version TEXT NOT NULL,            -- 'local-v1' | 'aws-kms:<id>' | 'gcp-kms:<v>'

  ADD COLUMN review_grant_id TEXT,                      -- FK to access_grants.grantId
  ADD COLUMN review_grant_jti TEXT,
  ADD COLUMN review_grant_valid_until TEXT,
  ADD COLUMN review_grant_max_reads INTEGER,
  ADD COLUMN review_grant_read_count INTEGER DEFAULT 0,
  ADD COLUMN review_grant_revoked_at TEXT,

  ADD COLUMN submitted_payload_hash TEXT,               -- snapshot at submit time (canon of body for dispute)
  ADD COLUMN last_edited_payload_hash TEXT,             -- snapshot at most-recent edit
  ADD COLUMN withdrawal_reason_hash TEXT,
  ADD COLUMN last_audit_event_hash TEXT;                -- link to local audit chain

-- proposal_review_reads (person-mcp)
CREATE TABLE proposal_review_reads (
  id INTEGER PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  round_id TEXT,
  steward_agent TEXT NOT NULL,
  reviewer_session_id TEXT NOT NULL,
  delegation_jti TEXT NOT NULL,
  content_hash_read TEXT NOT NULL,                       -- exactly what the steward saw
  read_at TEXT NOT NULL,
  audit_event_id INTEGER NOT NULL,
  FOREIGN KEY (audit_event_id) REFERENCES execution_audit(id)
);

CREATE INDEX idx_review_reads_proposal ON proposal_review_reads(proposal_id, read_at);
```

#### PR-P1: proposal_submissions encrypted-body migration

- Migration to add encrypted_body + AAD context columns.
- `apps/person-mcp/src/tools/proposals.ts` (or wherever proposal CRUD lives) encrypts via `A2AKeyProvider.generateSessionDataKey` (purpose: `'proposal-body'`).
- `bodyEncryptionContext` includes `(principal, proposalId, version, submittedAt)` for AAD binding.
- Decryption only via authenticated tool call with valid `proposal:read_for_review` grant (PR-G2 middleware enforces).
- `body_content_hash` is sha256 of the canonical (sorted-keys) plaintext body. Reviewers compare to ensure they saw the same bytes the proposer published.

#### PR-P2: proposal_review_reads receipts

- Every successful `proposal:read_for_review` call writes a row.
- Row is hash-linked to the audit chain (`audit_event_id` FK).
- Dispute resolution: proposer queries `proposal_review_reads.where(proposal_id == X)` to prove who saw what version.

---

### Priority 6: **Per-agent policy profiles** (1claw item #8, deferred)

For later — once the proposal composer starts using LLM assistance. The shape:

```ts
export interface AgentPolicyProfile {
  allowedMcpServers: string[]
  allowedTools: ActionTool[]
  deniedTools: ActionTool[]
  maxToolCallsPerMinute: number
  maxRisk: 'low' | 'medium' | 'high'
  allowedModels?: string[]
  deniedModels?: string[]
  maxTokensPerRequest?: number
  dailyBudgetUsd?: string
  piiPolicy: 'block' | 'redact' | 'warn' | 'allow'
  exfilPolicy: 'block' | 'warn'
}
```

Bound into:
- Session grant (web → A2A)
- A2A session package (encrypted, AAD-bound)
- MCP delegation token

When the actor is an LLM-driven agent, the profile is mandatory and at least one of `block`/`redact` must apply to `piiPolicy`. When the actor is a human via passkey, the profile is optional.

#### PR-PP1 (deferred): `AgentPolicyProfile` schema + binding into session grant + MCP enforcement

Not in the immediate scope; tracked here for completeness.

---

## What this plan explicitly REJECTS from 1claw

(Direct from the user's analysis; codifying so future contributors don't accidentally drift.)

| Pattern | Why rejected |
|---|---|
| Static `ocv_...` agent API key | Static bearer material is the wrong root for agent authority. Smart Agent uses passkey-rooted session grants + Vercel/cloud OIDC. |
| Plaintext `get_secret` as normal flow | Once a secret reaches agent/LLM/tool context, KMS protection is over. Use credentialRef + brokered handles. |
| MCP that "just relays" auth to a central vault | Each Smart Agent MCP is a sovereign data boundary. Authorization is local. |
| Wildcard/no-policy defaults | No policy = no access. No explicit delegation = no access. |
| Default-open `grant_access` / `share_secret` tools | Too dangerous for autonomous agents without explicit human approval. |

These rejections will be encoded as **bypass-guard invariants** in `scripts/check-no-bypass.sh`:
- No static API-key env vars in route handlers (already partially enforced for `DEPLOYER_PRIVATE_KEY`; extend to a configurable forbidden-list).
- No `get_secret`-shaped tool returning raw secret value (lint).
- No MCP tool whose default scope is `'*'` or empty (lint).

---

## Sequencing

| PR | Owns | Depends on | Estimated size |
|---|---|---|---|
| **PR-A1** | `packages/sdk/src/action-policy/` + idempotency store + tests | None | M |
| **PR-A2** | a2a-agent routes mint+evaluate ActionIntents | PR-A1 | M |
| **PR-A3** | MCP-side ActionIntents for system delegations | PR-A1 | S |
| **PR-G1** | `AccessGrant` schema + DB tables | None | S |
| **PR-G2** | `requireAccessGrant` middleware + use-count atomics | PR-G1 | M |
| **PR-G3** | Status-cascading revocation + sweep job | PR-G1, PR-G2 | S |
| **PR-M1** | `packages/mcp-security/` middleware + markers + tests | None | L |
| **PR-M2** | person-mcp + org-mcp adopt security middleware | PR-M1 | M |
| **PR-M3** | Remaining 6 MCPs adopt (folds into Sprint 4 W2) | PR-M1, PR-M2 | M |
| **PR-C1** | `credentialRef://` scheme + brokered-handle resolver | None | M |
| **PR-C2** | LLM proxy + verifier + GraphDB accept handles | PR-C1 | M |
| **PR-P1** | proposal_submissions encrypted-body migration | PR-G1 (for grant_id FK) | M |
| **PR-P2** | proposal_review_reads receipts + audit linkage | PR-P1 | S |

**Hard sequencing**: PR-A1 → PR-A2/A3 (everything else parallel after PR-A1 + PR-G1 land).

**Soft sequencing recommendation**:
1. **PR-A1** first (foundation for everything else).
2. **PR-M1** in parallel with PR-A1 (independent file scope; SDK only).
3. **PR-G1** in parallel with the above.
4. **PR-A2 + PR-G2** after their predecessors.
5. **PR-P1 + PR-P2** after PR-G1/G2 land (proposal-lane is the integration test for both).
6. **PR-M2 + PR-M3** after PR-M1.
7. **PR-C1 + PR-C2** can run any time after PR-A1.

Most of these can run in parallel across the 4 weeks since they're well-separated by file scope.

---

## Open decisions for the orchestrator

1. **Closed enum for `ActionTool`**: PR-A1 needs the full list. Today's tool taxonomy is spread across MCPs; pulling the canonical list into the SDK is its own sub-task. Either include in PR-A1 (cleaner; bigger PR) or extract first into a separate prep PR.
2. **`packages/mcp-security/` vs `packages/sdk/src/mcp-security/`**: separate package gives clean dependency tracking; SDK subpath is faster to ship. Recommend separate package given the size of the surface.
3. **`AccessGrant` ownership**: today's delegations live in DelegationManager (on-chain) and in per-MCP session/grant tables. The new `AccessGrant` shape is OFF-chain. Confirm: this is intentional (per spec 003 the proposal review reads are off-chain only); should we ever anchor any of them on-chain?
4. **Backward compat**: per "no deprecated paths" rule, the existing ad-hoc one-shot system-delegation tables get folded into `access_grants` rather than kept alive. This is a small DB migration; `fresh-start.sh` re-seeds.
5. **Demo video**: this work delays the post-hardening demo video further. User should decide whether to record after Sprint 5 W3 finishes (current ~1 week out) or after this full 1claw-inspired plan lands (~3-4 weeks out).

---

## What this plan is NOT

- NOT a re-architecture. The existing IA principles (owner-routed private data, public on-chain → GraphDB mirror, MCPs as sovereign boundaries) stay. These features SLOT INTO that architecture as new layers.
- NOT a 1claw dependency. We learn from their public docs; we implement everything ourselves. Substrate independence (P1) holds.
- NOT a centralized vault. There is no "smart-agent-vault MCP" — each MCP owns its own private data, custody, and audit chain.
- NOT a replacement for KMS work. KMS is the substrate; these features build on top of it.
