# Architecture & Security Review — Passkey-Rooted Delegated Session Signing

> **Scope of review**: this document and its sister PM plan, as of
> 2026-04-27. Specifically:
> - [`docs/architecture/passkey-session-signing.md`](./passkey-session-signing.md)
> - [`docs/specs/passkey-session-signing-plan.md`](../specs/passkey-session-signing-plan.md)
>
> **Reviewer's mandate**: adversarial. Find correctness bugs,
> performance foot-guns, contradictions between sections, and
> hand-waves that would survive a casual read but fail an actual
> implementation.
>
> **Constraints already agreed in conversation** (don't litigate):
> - No backward compatibility. Pre-production codebase, fresh-start
>   on every milestone.
> - Unified session replaces A2A's session-EOA machinery in M4.
> - Verifier (`person-mcp`) is the policy boundary; web's role is
>   dispatch + signing.
> - High-risk actions stay on direct-passkey path; not in scope.

## Verdict

**Architecture is fundamentally sound; ship-blocked on six fixes.**

The shape is correct: passkey-rooted, capability-bearing session
signer, off-chain verification, deterministic policy. The pattern
matches Turnkey / Privy / Biconomy / ZeroDev / ERC-7710. None of the
findings below indicate a wrong direction — they're all "the design
draft has internal contradictions or implementation foot-guns we
need to resolve before code lands."

Six findings are blocking. Seven are architectural decisions that
should be locked before M2. Eight are polish.

---

## Critical findings (blocking — fix in design doc before M1 starts)

### C1 — Per-action ERC-1271 on `eth_call` is a foot-gun

**Where**: `passkey-session-signing.md` §3.1 diagram (line 84:
`VER -- ERC-1271 verify grant proof --> AA`), §3.3 sequence (line 178:
`V->>V: verify webauthn assertion in grantProof`), §5 step 2
(`await verifyERC1271(input.grant.subject.smartAccountAddress, ...)`).

**Problem**:
1. `eth_call` round-trip on every delegated action: ~30–100ms latency
   added to every Discover Agents run, every Test verification.
2. Hard availability dependency on chain RPC: RPC outage → every
   session action fails. Today's per-action passkey path has no
   chain dependency.
3. P-256 verification is CPU-expensive even on the EVM precompile path
   (~15k gas equivalent off-chain).
4. **Internally inconsistent**: §14 defenses claim "ERC-1271 verifies
   the passkey assertion over the SessionGrant (one signature
   verification rooted at the smart account's on-chain passkey)" —
   the "(one signature verification)" phrasing implies once-per-grant,
   but the pseudo-code does it per-action. The defense and the
   verifier disagree.

**Fix**: ERC-1271 verify exactly once at grant minting. Persist
`{ verifiedPasskeyPubkey, grantHash, smartAccountAddress }` in
`SessionRecord`. Per-action verification re-checks: action signature
matches `delegate.address` + DB lookup of session liveness +
scope/caveat enforcement. **Zero on-chain calls per action.** Update:

- §5 pseudo-code: remove step 2's `verifyERC1271`. Replace with
  "look up `SessionRecord.verifiedPasskeyPubkey` and assert it matches
  what the cached grant authorized."
- §3.1 diagram: drop the `VER → AA` arrow. Add `AUTH → AA` once at
  grant minting.
- §3.3 sequence: drop `V->>V: verify webauthn assertion`. Replace with
  `V->>SR: load grant + verifiedPasskeyPubkey from cache`.
- §14 defenses: clarify "one ERC-1271 verification per grant, cached
  for the session lifetime."

### C2 — Client-supplied `action.action.risk` is trusted by verifier

**Where**: `passkey-session-signing.md` §4.2 (`WalletActionV1.action.risk`
field), §5 step 7 (`riskRank(action.action.risk) <= riskRank(grant.scope.maxRisk)`).

**Problem**: `risk` is a field on the wire payload. The verifier reads
it and gates on it. A buggy client (or a malicious one, post any
future privilege escalation) can label a high-risk action `'low'` and
slip past the `maxRisk` ceiling. The action's actual risk is a
property of `action.action.type`, not a property the client should
self-report.

**Fix**: server-side risk classification keyed by `action.action.type`,
looked up in a hard-coded table in the policy classifier. The wire
payload either omits the `risk` field or treats it as advisory and
ignores it during verification.

- §4.2: remove `risk` from `WalletActionV1.action`, OR re-document it
  as "client-asserted; verifier ignores."
- §5 step 7: replace with `const serverRisk = classifyRisk(action.type);
  assert(serverRisk in grant.scope.allowedRisks)`.
- §6 risk classification table: confirm this is the authoritative
  source the classifier reads.

### C3 — Sign-in is two passkey ceremonies, not one

**Where**: `passkey-session-signing.md` §3.2 sequence diagram lines
110 (`B->>W: passkey-verify (identity assertion)`) and 120
(`B->>U: WebAuthn ceremony (challenge)`).

**Problem**: design claims "Single passkey ceremony at sign-in" (§2
goal) but the sequence shows two separate WebAuthn calls — one for
identity verification, one for grant signing. That's the same friction
as today's signin (passkey + A2A delegation). The whole point of M1
was to reduce this to one ceremony.

**Fix**: build the grant first, derive the WebAuthn challenge from
`grantHash`, the user signs once. Identity verification falls out of
the same assertion (possession of the passkey bound to the AgentAccount
proves the user). Today's `passkey-verify` route gets folded into
`session-grant/finalize`.

- §3.2: rewrite sequence so `passkey-verify` is removed. The grant
  finalize endpoint runs the same ERC-1271 check the old route did.
- PM plan M1 acceptance criterion stays: "Sign-in is exactly one
  WebAuthn ceremony" — currently true on paper, false in the actual
  flow shown.

### C4 — Risk classifier duplicated between web and person-mcp

**Where**: `passkey-session-signing-plan.md` M2 deliverable
(`apps/web/src/lib/wallet-action/risk.ts`); `passkey-session-signing.md`
§5 step 7 (verifier classifies risk).

**Problem**: two implementations of the same classifier. Web admits
an action; person-mcp denies it (or vice versa). Drift is inevitable.

**Fix**: ship the classifier in
`packages/privacy-creds/src/session-grant/risk-classifier.ts`. Both
web (dispatch) and person-mcp (verifier) import. Adding an action
type touches one file, one table.

- PM plan M1 deliverable: add `risk-classifier.ts` to
  `packages/privacy-creds/src/session-grant/`.
- Reference from web's dispatch and person-mcp's verifier.

### C5 — Single `audience: 'person-mcp'` contradicts the unified-session goal

**Where**: `passkey-session-signing.md` §4.1
(`audience: 'person-mcp'  // single audience per grant`), §12
("Replaces today's A2A session entirely"), PM plan M4 (A2A consumes
unified grant).

**Problem**: we have multiple MCPs (`person-mcp`, `org-mcp`,
`family-mcp`, `geo-mcp`, `verifier-mcp`, `a2a-agent`). Pinning a grant
to a single audience field contradicts the design intent that "one
grant covers all" (§12, §M4). Specifically:
- A2A's tool calls aren't to `person-mcp`.
- Test verification is a presentation to `verifier-mcp`.
- Future: presentations to other registered verifiers.

**Fix**: `audience` becomes `string[]`. Each entry is a service
identifier the grant authorizes. Verifier checks
`grant.audience.includes(this.serviceName)`. Unified grant typically
lists `['person-mcp', 'a2a-agent', 'verifier-mcp']`.

- §4.1: change `audience: 'person-mcp'` to `audience: string[]`.
- §5 step 6: update the audience match.
- §12: confirm the unified grant grants to multiple services.

### C6 — Audit log writer ambiguity (who's the system of record?)

**Where**: §3.1 diagram shows audit writes from web (line 76, 86) and
person-mcp (line 86, 183, 492). §4.4 doesn't specify ownership.
§7.1 says "Write-only audit log (separate database / append-only
store)."

**Problem**: it's not specified whether web or person-mcp owns the
log. If both write, you get duplicate entries. If only one,
the other has no record of decisions made there. "Append-only" is
asserted but not enforced — an app that owns its own DB table can
DELETE just fine.

**Fix**: person-mcp is the system of record (it's the deterministic
verifier; it's the policy boundary). Web writes "I dispatched X to
person-mcp" via an event endpoint that person-mcp records.
"Append-only" enforced via either:
- Separate DB ownership boundary (different DB, different IAM), or
- Cryptographic chaining (Merkle log where each entry's hash
  references the previous).

For our codebase: a separate sqlite DB owned by person-mcp, with
write-only IAM and an integrity-check job. Document this in §4.4.

### C7 — `__Host-` cookie prefix breaks dev (HTTP localhost)

**Where**: §3.2 step 7 (`__Host-session cookie`), §7.2 mitigations.

**Problem**: per RFC 6265bis, `__Host-` requires the cookie to be
sent only over secure connections. Dev runs on `http://localhost:3000`.
Setting `__Host-` will silently fail (browser refuses to set it) or
break the session entirely.

**Fix**: name is conditional on environment. Production:
`__Host-session`. Dev: `session`. Document in §3.2 and ensure the
implementation reads `process.env.NODE_ENV`.

---

## High findings (architectural decisions to lock before M2)

### H1 — Per-session KMS key creation cost / control-plane load

**Where**: §8.4 ("Production: KMS/HSM-backed key with non-exportable
signing primitive"), implied by §3.2 step "K-->>W: signerAddress +
keyref."

**Problem**: design says "rotate session signer on every
reauthentication; never reuse keys across sessions." If literally
new KMS asymmetric key per session, AWS KMS pricing ~$1/key/month
becomes punishing at scale. Plus every key creation is a control-plane
call, which is slower and rate-limited.

**Fix**: one master KMS key per environment. Session signers are
derived in process via HKDF:
```
sessionSignerKey = HKDF(
  ikm = signature_from_KMS_over("session-signer-derive" || sessionId),
  salt = sessionId,
  info = "smart-agent.session-signer.v1"
)
```
The derived secp256k1 key lives in process memory for the session's
lifetime, then forgotten. KMS holds one master key only; rotation is
on the master. This is the standard pattern (Cloudflare Workers, AWS
Nitro, SPIFFE).

- §8.4: replace "KMS-backed key per session" with "HKDF-derived
  session signer rooted in a single environment-wide KMS master key."
- Add a diagram for the derivation in §8.

### H2 — Too many IDs (`accountId`, `smartAccountAddress`, `sessionId`, `grantId`)

**Where**: §4.1 (four ID fields); also referenced in §4.3 SessionRecord.

**Problem**: four identifiers when two would do. `accountId` is "opaque,
not the .agent name" but no spec on what it actually is. `sessionId`
and `grantId` always have a 1:1 relationship in the design.

**Fix**: collapse:
- Remove `grantId`. Use `sessionId` (every grant *is* a session).
- Remove `accountId` or define it as `smartAccountAddress.toLowerCase()`.
  Drop the "opaque, not the .agent name" framing — `smartAccountAddress`
  is already opaque from the user's perspective and the right key for
  DB joins.

Net: `subject.smartAccountAddress` + `session.sessionId`. Done.

### H3 — WebAuthn `userVerification` policy not enforced

**Where**: §3.2 sequence diagram doesn't specify, §5 step 2 says
`requireUserVerification: true` only on verification side. Today's
signup uses `'preferred'`.

**Problem**: a session-grant ceremony authorizes 8 hours of
delegated action. That's much higher consequence than a single
action. `'preferred'` lets the OS skip biometric/PIN — silent reuse
of the platform credential is then possible. We should require user
verification for the grant ceremony.

**Fix**: grant minting passes `userVerification: 'required'` to
`navigator.credentials.get`. Verification asserts the UV bit was set
in `authenticatorData` (which §5 step 2 already implies).

- §3.2: explicitly note `userVerification: 'required'` in step 5.
- §8 cryptographic specifics: document the requirement.

### H4 — `idleTimeoutSeconds` in the signed grant is meaningless

**Where**: §4.1 `session.idleTimeoutSeconds`, §4.3 `SessionRecord.idleExpiresAt`.

**Problem**: `idleTimeoutSeconds` is signed into the grant. But the
sliding-window deadline (`idleExpiresAt = lastUseTime + idleTimeout`)
depends on `lastUseTime`, which is mutable server state. The signed
field can't enforce a sliding window — only the SessionRecord can.

**Fix**: drop `idleTimeoutSeconds` from `SessionGrantV1`. Keep
`idleExpiresAt` only on `SessionRecord` as server-managed state. The
signed grant carries `expiresAt` (hard TTL) only.

### H5 — Session extension semantics undefined

**Where**: §13 / PM plan don't address.

**Problem**: at 7h59m a busy user's `expiresAt` deadline is approaching.
Does the deadline extend? Design implies "8h hard TTL, period." Confirm
and document.

**Fix**: design doc adds a "Session lifetime semantics" subsection in
§3 explicitly stating:
- `expiresAt` is hard. 8 hours from signin, regardless of activity.
- `idleExpiresAt` slides on activity (last use + 30min).
- At hard expiry, user re-signs in (back to one passkey ceremony).

### H6 — Multi-MCP confused-deputy mitigation is hand-waved

**Where**: §7.3 says "Every downstream call carries
`{ sub, act, aud, scope, grantId }` matching RFC 8693 token-exchange
shape." But this propagation isn't specified in any data structure
in §4.

**Problem**: assertion without an artifact. The field shape exists
nowhere. If A2A makes a call to org-mcp on behalf of person-mcp on
behalf of the user, where do `sub` / `act` / `aud` actually live in
the request?

**Fix**: spec the inter-service token in §4. Either:
- Add `actor` block to `WalletActionV1` that gets propagated through
  service calls; or
- Define a separate `DelegatedRequest.v1` envelope that wraps each
  service-to-service call, including `{ sub, act, aud, originalGrantId }`.

Implementation: a JWT signed by the calling service with claims
matching RFC 8693 (`subject_token`, `actor_token`, `audience`,
`scope`).

### H7 — Recovery flow doesn't bump revocation epoch

**Where**: not addressed in the design doc.

**Problem**: when a user goes through device recovery (passkey
rotation), they have a new passkey. Existing `SessionRecord`s were
authorized by the old passkey and should be invalidated.

**Fix**: passkey-recovery flow in `apps/web/src/lib/actions/recovery/`
bumps `revocationEpoch` for the account in the same transaction that
registers the new passkey. Document explicitly in design doc §3.5
(revocation flow) and PM plan M5 acceptance.

---

## Medium findings (clean up before pen-test)

### M1 — Duplicate paragraph in §3.1

**Where**: lines 89-95 of design doc — "smart account is **not**
modified" appears twice consecutively.

**Fix**: delete the duplicate.

### M2 — Sloppy curve language in §3.2

**Where**: line 113: "Mint session signer (ECC P-256 / secp256k1)".

**Problem**: P-256 (NIST) and secp256k1 (Ethereum) are different
curves. §8.3 commits to secp256k1; §3.2 contradicts.

**Fix**: §3.2 sequence reads "Mint session signer (secp256k1)".

### M3 — `agentNameHash?: string` is a placeholder

**Where**: §4.1 `subject.agentNameHash?: string  // hash, not plaintext`.

**Problem**: optional with no consumer. Violates the "unknown fields
don't expand authority" rule by existing without a documented use.

**Fix**: remove the field, or document the consumer (likely UI display
in audit logs?). Probably just remove — `smartAccountAddress` is the
primary key throughout.

### M4 — `maxActions` / `maxActionsPerMinute` not enforced

**Where**: §4.1 `scope.maxActions?` and `scope.maxActionsPerMinute?`.

**Problem**: listed in scope, never read by the §5 verifier. Either
implement (with a counter store) or remove.

**Fix**: implement in M2 — adds a `actionCounter` table (per-session
atomic counter with a per-minute window). Rate-limit checks happen
between scope and nonce in §5 step 7.

### M5 — `idempotencyKey?: string` not specified

**Where**: §4.2 `replayProtection.idempotencyKey?: string`.

**Problem**: optional, no consumer. Same as M3.

**Fix**: define use case (deduplication of duplicate POSTs from buggy
clients?) or remove. Likely defer to a future milestone.

### M6 — Nonce-burned-on-failure semantics undocumented

**Where**: §5 step 8 (consumes nonce), step 9 (audit). Order is consume
then audit then return.

**Problem**: if step 9 fails or the underlying tool execution fails,
the nonce is consumed. The action didn't happen but the nonce can't
be retried. Reviewer may flag this.

**Fix**: add explicit paragraph in §5 documenting "nonce is consumed
on first verification, regardless of downstream failure. This is
intentional: it prevents replay even if the system is in a
partially-failed state. Clients must use idempotencyKey (M5 future)
if they need retry-safety."

### M7 — `SameSite=Strict` may break Google OAuth callback

**Where**: §3.2 step 7 ("`SameSite=Strict`"), §7.2 mitigations.

**Problem**: we have Google OAuth sign-in (`/api/auth/google-callback`).
Strict can drop the session cookie on the cross-site redirect from
google.com back to localhost.

**Fix**: confirm by testing. If it breaks, downgrade to
`SameSite=Lax` with strict origin/Referer checks server-side. Either
way document.

### M8 — Pen-test scope missing LLM-injection scenario

**Where**: PM plan M5 pen-test scenarios (5 listed), `passkey-session-signing.md`
§7.7 (LLM-injection mitigations described but not tested).

**Fix**: add to PM plan M5 acceptance: "LLM-injection scenario:
inject crafted text via an A2A endpoint that attempts to construct a
high-risk WalletAction. Verifier rejects."

---

## Low findings (polish)

### L1 — `dispatch.ts` not referenced in design doc

PM plan M2 mentions `apps/web/src/lib/wallet-action/dispatch.ts` as
the entry point. Design doc doesn't. Add a note in §3.

### L2 — No diagram for HKDF derivation pattern (H1)

If H1 lands, add a diagram showing master KMS key →
session-signer-derive call → in-memory derived key. Helps reviewers
see why per-session KMS keys aren't needed.

### L3 — Signing oracle in same blast radius as web app

The session signer service lives in `apps/web` per §3.1. A compromised
web app gets access to the signing oracle. Splitting it into a
separate process (its own listener, its own IAM identity, can only
sign — not classify, not dispatch) limits damage.

**Suggestion**: at least a non-goal note in §2 saying "out-of-process
signing oracle deferred; in-process for v1." Future hardening.

### L4 — Defenses §15 says "A- security, A UX"

Currently aspirational. Recommend changing to "A- security pending
fixes C1–C7, A UX." Sets expectations for reviewer.

### L5 — §15 refers to "§7" — section was renumbered

Spot-check section cross-references. If §7 was renumbered the link
may be stale.

### L6 — `apps/verifier-mcp/src/registry.ts` doesn't exist yet

PM plan M3 references it as a deliverable, fine. Design doc §6.1 says
"Future verifiers must be added to `apps/verifier-mcp/registry.ts`
with a documented policy." Confirm path is correct.

### L7 — Action expiry of 5 minutes

§4.2 hard-codes "≤ 5 min from createdAt." Comment is in the type
definition, not a configurable. Locking 5 min is fine but document
explicitly that this is policy-as-code, not config.

### L8 — Session-signer entropy

§3.2 line 113 says "K-->>W: signerAddress + keyref". Implementation
detail: ensure `crypto.getRandomValues` (or KMS GenerateRandom) is
used, not `Math.random`. Defensive note.

---

## Decisions to confirm before fix-up PR

1. **C5 audience model** — list-of-strings (recommended) or
   per-service-grant?
2. **H1 KMS strategy** — HKDF-derive (recommended) or per-session KMS
   keys (current)?
3. **H6 inter-service token** — embed `actor` in WalletActionV1 or
   separate `DelegatedRequest.v1` envelope?
4. **C6 audit log custody** — separate sqlite owned by person-mcp
   (recommended), or shared DB with role-based write-only IAM?
5. **L3 out-of-process signing oracle** — defer (recommended) or
   include in M5 hardening?

Once decisions confirm, fixes are ~1 day of doc updates.

---

## Status

| Tier | Count | Effect on go/no-go |
| --- | ---: | --- |
| Critical (C1–C7) | 6 | **Blocking** — design has correctness bugs / contradictions that would survive into implementation |
| High (H1–H7) | 7 | Needs decision before M2 ships |
| Medium (M1–M8) | 8 | Clean up before M5 pen-test |
| Low (L1–L8) | 8 | Polish; address opportunistically |

**Net**: don't start M1 implementation until Critical are resolved
in the design doc. The High items are "decide and document," not
"fix code." Mediums are tracked work; Lows are nice-to-haves.

The architecture's *direction* is correct. The *draft* needs another
pass.
