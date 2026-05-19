# C1 — Threat Model

> Audience: external security reviewers and the board sub-committee that
> signs off on spec 007. This document enumerates the cryptographic
> actors in Smart Agent, the adversary classes that threaten them, and
> the per-class mitigation inventory. Every claim about current behaviour
> cites code; everything we have not yet built is marked with `[OPEN]`
> or stated as a residual risk.

---

## 1. System trust model

### 1.1 Actor inventory

The system distinguishes **user principals** (whose authority is
load-bearing), **system principals** (operational identities that
should never carry user authority post-Phase-A), and **service
principals** (MCP-level identities used for inbound MAC verification).

| Actor | Kind | Authority surface | Key custody |
|---|---|---|---|
| User EOA (demo) | User | Owner of user's `AgentAccount` (`AgentAccount._owners`). Recovers `op.signature` to user's address. Cite: `packages/contracts/src/AgentAccount.sol:141-149`, `:764-773`. | `localUserAccounts.privateKey` (web DB) in demo; intended to migrate to user-held EOA. |
| User passkey | User | Owner-equivalent via WebAuthn P-256. `_validateSig` dispatches on signature-type byte `0x01` → `_verifyWebAuthn`. Cite: `AgentAccount.sol:736-762`, `:791-797`. | WebAuthn authenticator (platform: TPM / Secure Enclave / Android Keystore; roaming: hardware token). |
| User SIWE wallet | User | Owner of user's `AgentAccount` via EOA `_owners` entry, signed with whatever EVM wallet the user holds. | User wallet (MetaMask, Frame, Rabby, etc.). |
| Demo EOA (per-user `localUserAccounts.privateKey`) | User (demo-only) | Same as user EOA — registered as owner of user's AgentAccount at factory init. | Web app's local SQLite (will move to Postgres in Phase F.2). Demo-only; not a prod identity. |
| Master signer | System | **Post-Phase-A**: signs (a) inter-service MAC envelopes, (b) ERC-4337 `handleOps` outer relay tx. Does NOT sign user authority. **Pre-Phase-A** (current code): co-owner of every AgentAccount; signs userOps for users (M-1 finding). | LocalStack KMS in dev (asymmetric secp256k1); AWS KMS or GCP Cloud KMS in prod (`AWS_KMS_SIGNER_KEY_ID` / `GCP_KMS_MASTER_SIGNER_VERSION`). Cite: `packages/sdk/src/key-custody/aws-kms-signer.ts:96-100`, `packages/sdk/src/key-custody/gcp-kms-signer.ts:96-100`. |
| bundlerSigner | System (NEW in Phase A) | Submits ERC-4337 EntryPoint `handleOps`; signs `BUNDLER_ENVELOPE` digest verified by `AgentAccount.executeFromBundler`. NOT an owner. Cite: `AgentAccount.sol:358-385`, `AgentAccountFactory.sol:33-58`. | Separate KMS key (`BUNDLER_KMS_KEY_ID`). |
| sessionIssuer | System (NEW in Phase A) | For Variant B sessions, the user signs a userOp that calls `acceptSessionDelegation(hash)` on their own account; sessionIssuer is the EOA referenced as the off-chain orchestrator of session-init. NOT an owner. Cite: `AgentAccount.sol:281-317`, `AgentAccountFactory.sol:38-58`. | Separate KMS key (`SESSION_ISSUER_KMS_KEY_ID`). |
| Deployer EOA | System (legacy) | Pre-Phase-C: still signs class-assertion observers (`lib/onchain/*Assertion.ts`), boot-seed (`lib/demo-seed/*`), and the documented stateless-passkey-SIWE fallback (`apps/web/src/lib/ssi/signer.ts:48-50`). Post-Phase-C: NOT used at runtime for any user-authored action. | Deployer EOA; loaded from `process.env.DEPLOYER_PRIVATE_KEY`. Post-Phase-C: removed from `apps/web/src/` runtime paths. |
| `AgentAccountFactory` | Contract | Deploys ERC1967Proxy of AgentAccount; stores immutable `bundlerSigner` + `sessionIssuer` (Phase A) for downstream resolution. Cite: `AgentAccountFactory.sol:26-58`. | N/A. |
| `AgentAccount` (per-user proxy) | Contract | The user's identity anchor + ERC-1271 / ERC-4337 / ERC-7710 / UUPS surface. Cite: `AgentAccount.sol:24-41`. | Per-account on-chain storage (owners, passkeys, modules, accepted session delegations). |
| `DelegationManager` | Contract | Singleton. Validates Delegation chains (EIP-712 sigs), runs caveat `beforeHook` / `afterHook` enforcers, executes through delegator's `execute(...)`. Cite: `packages/contracts/src/DelegationManager.sol`. | N/A. |
| `EntryPoint` (ERC-4337) | Contract | Singleton from `account-abstraction/`. Drives `validateUserOp` + `handleOps`. | N/A. |
| Caveat enforcers (×8 in tree + 8 extension) | Contract | `TimestampEnforcer`, `ValueEnforcer`, `AllowedTargetsEnforcer`, `AllowedMethodsEnforcer`, `CallDataHashEnforcer`, `RateLimitEnforcer`, etc. Each implements `ICaveatEnforcer.beforeHook` / `afterHook` and runs inside `DelegationManager.redeemDelegation`. Cite: `packages/contracts/src/enforcers/`. | N/A. |
| `person-mcp` | Service | Holds the user's encrypted session package (Variant A delegation lives here), PII, AnonCreds link secret custody (today). | Inbound: MAC under `a2a-to-person`. KMS data-key custody. |
| `org-mcp` | Service | Holds private org state (pool/round config, member rosters, treasury custody metadata). | Inbound: MAC under `a2a-to-org`. |
| `family-mcp` | Service | Family / household membership state. | Inbound: MAC under `a2a-to-family`. |
| `people-group-mcp` | Service | Group memberships. | Inbound: MAC under `a2a-to-people-group`. |
| `geo-mcp` | Service | Geographic claims / `pg.*` data. | Inbound: MAC under `a2a-to-geo`. |
| `verifier-mcp` | Service | AnonCreds verification + credential issuance. | Inbound: MAC under `a2a-to-verifier`. |
| `skill-mcp` | Service | Skill definitions + endorsements. | Inbound: MAC under `a2a-to-skill`. |
| `hub-mcp` | Service | Writes to GraphDB (the only writer per IA P4). | Inbound: MAC scoped to system-only callers. |
| `a2a-agent` | Service | A2A protocol agent — challenge auth, delegation minting, the only signer of outbound MACs in service-to-service paths. | Master + bundlerSigner + sessionIssuer KMS keys + tool-executor KMS keys (one per tool family). |
| `apps/web` | Service | Next.js front-end + server actions. Origin of user signatures (passkey ceremonies, EOA `signTypedData`). | Sessions in HttpOnly cookies; demo private keys in DB (pre-F.2); no master/bundler/session-issuer keys reach this process. |
| GraphDB | Service (external) | Mirror of on-chain claim graph + ontology. **Authoritative for nothing** — every assertion in GraphDB is sourced from an on-chain event. | Username/password creds in env. |

### 1.2 Cryptographic gate inventory

Every authority decision in the system passes through exactly one of
these gates. Reviewers should be able to find every one of them in the
code.

| Gate | Where | What it proves |
|---|---|---|
| ERC-4337 `validateUserOp` | `AgentAccount._validateSignature` (`AgentAccount.sol:692-697` → `_validateSig:741-762`) | The userOp's signature recovers to a user credential (EOA `_owners` entry OR registered passkey). |
| Bundler envelope re-check | `AgentAccount.executeFromBundler` (`AgentAccount.sol:358-385`) | The off-chain relay envelope was signed by `bundlerSigner`. Defence-in-depth on top of `validateUserOp`. |
| `_authorizeUpgrade` | `AgentAccount._authorizeUpgrade` (`AgentAccount.sol:197`) — `onlySelf` modifier | The UUPS upgrade call originated from a self-call inside `upgradeToWithAuthorization` (`:216-232`), which itself required an owner ECDSA signature over the `(UPGRADE, newImpl, address(this), chainId)` digest. |
| Session-delegation acceptance (Variant B) | `AgentAccount.acceptSessionDelegation` (`AgentAccount.sol:311-317`) — `onlySelf` | The session-delegation hash was registered via a userOp signed by an owner; `onlySelf` ensures no external caller (including session-issuer or master) can register a session unilaterally. |
| Owner-set mutation | `AgentAccount.addOwner` / `removeOwner` (`:819-836`) — `onlySelf` + last-signer invariant | Owner-set changes require a userOp signed by an existing owner. |
| Passkey registration | `AgentAccount.addPasskey` / `removePasskey` (`:868-889`) — `onlySelf` + last-signer invariant | Passkey changes require a userOp signed by an existing owner. |
| Module install / uninstall | `AgentAccount.installModule` / `uninstallModule` (`:460-528`) — `onlyOwnerOrSelf` | ERC-7579 modules can only be installed by an existing owner; module changes are too sensitive to delegate. |
| Delegation EIP-712 signature | `DelegationManager._validateSignature` (`DelegationManager.sol:225-240`) | The delegation's signature recovers to its declared `delegator` (or to a smart-account owner via ERC-1271 fall-through). |
| Caveat enforcement | Per-enforcer `beforeHook` inside `DelegationManager._runBeforeHooks` (`DelegationManager.sol:158-177`) | Time-window / target / selector / value / data-hash / rate-limit checks all pass. Any single failure reverts the redemption. |
| Inter-service MAC | `apps/a2a-agent/src/auth/inter-service.ts:137-264` | Inbound service hops are signed by the calling service's enrolled KMS MAC key over canonical-v2 `${ts}\|${nonce}\|${path}\|${sha256(body)}`. |
| Web→a2a MAC | `apps/a2a-agent/src/auth/service-auth-web.ts` (same canonical) | Same as inter-service, with a dedicated key (`web-to-a2a`). |

### 1.3 Authority chain examples

#### Chain example 1 — "Maria votes on a proposal" (post-Phase-A)

```
1. Maria authenticates to apps/web via passkey OR demo EOA OR SIWE.
   - apps/web sets an HttpOnly session cookie. No server-side `users` row
     for passkey/SIWE (memory: project_sessionless_passkey_siwe).
2. UI calls a server action that calls a2a-agent /session/init (Phase B,
   not yet landed at the date of writing).
   - Risk-tier classifier: voting on a low-quorum round is `medium` →
     Variant A.
   - a2a-agent generates a fresh session-key (secp256k1 EOA).
   - a2a-agent returns an EIP-712 `Delegation` payload to apps/web.
3. apps/web returns the payload to the browser; Maria signs via passkey
   (P-256 WebAuthn) or her EOA (ECDSA secp256k1).
4. apps/web POSTs the signed delegation to /session/init/finalize.
   - a2a-agent encrypts the delegation with the per-session data key
     (envelope encryption via KMS) and stores it in person-mcp
     session_store via the canonical-v2 MAC'd /session-store/upsert.
5. Maria clicks "vote yes" in the UI. apps/web posts the action to
   a2a-agent /onchain-redeem (Phase B-rewritten endpoint).
6. a2a-agent:
   a. Loads the encrypted session package from person-mcp.
   b. Decrypts under the same KMS key envelope.
   c. Builds the inner userOp:
      - sender = Maria's AgentAccount address
      - callData = `DelegationManager.redeemDelegation(
          [delegation], target=VoteRegistry, value=0, data=cast(roundId, choice)
        )`
   d. Signs the userOp with the session-key (the EOA generated in step
      2). The session-key is held in the encrypted package so it never
      sits in process state long-term.
   e. Wraps the userOp with the `BUNDLER_ENVELOPE` digest and signs
      that with bundlerSigner (KMS call).
   f. Submits via EntryPoint.handleOps([signedUserOp], relayer=bundlerSigner).
      bundlerSigner pays gas via the paymaster (today the deployer pays
      in dev; post-Phase-H the paymaster is its own surface).
7. EntryPoint calls Maria.AgentAccount.validateUserOp:
   - _validateSig recovers op.signature to the session-key.
   - The session-key is NOT in _owners.
   - validateUserOp returns SIG_VALIDATION_FAILED → unless we route
     through DelegationManager.
   - The userOp's calldata is execute(DelegationManager, 0, data); the
     DelegationManager.redeemDelegation call inside that payload
     recovers the delegation's signature to Maria's owner. Authority
     traces to Maria's user credential.
8. Caveat enforcers run in DelegationManager._runBeforeHooks:
   - TimestampEnforcer: validAfter <= now <= validUntil
   - AllowedTargetsEnforcer: target == VoteRegistry
   - AllowedMethodsEnforcer: selector == 0x???cast?(...)
   - ValueEnforcer: value == 0
   All pass. DelegationManager._executeFromDelegator calls
   Maria.AgentAccount.execute(target=VoteRegistry, 0, data).
9. VoteRegistry.cast records the vote. msg.sender == Maria.AgentAccount
   (because AgentAccount.execute itself called the target).
```

Every authority arrow in this chain traces back to step 3 — Maria's
signature. The master, the session-issuer, the bundlerSigner, and the
deployer all participate operationally but none carries user authority.

#### Chain example 2 — "Treasury withdrawal" (Phase B Variant B)

This is the high-risk path. The risk-tier registry tags the treasury
target/selector as `high` → Variant B is required at session-init.

```
1-3. Same as above, except risk-tier classifier returns `high`.
4. a2a-agent does NOT return an EIP-712 delegation; instead, it returns
   a userOp whose calldata is `Maria.AgentAccount.acceptSessionDelegation(hash)`
   where `hash` is the keccak of the session-delegation envelope.
5. Maria signs the userOpHash (via passkey or EOA).
6. apps/web posts the signed userOp to a2a-agent /session/init/finalize.
7. a2a-agent submits via EntryPoint (bundler relay), gas via paymaster.
8. EntryPoint → Maria.AgentAccount.validateUserOp → recovers op.signature
   to Maria's owner → OK.
9. Maria.AgentAccount.execute(self, 0, acceptSessionDelegation(hash)) →
   _acceptedSessionDelegations[hash] = true. Event SessionDelegationAccepted
   emitted on chain.
10. At action time, a2a-agent does the same redeem-flow as Variant A
    but the DelegationManager looks up the on-chain acceptance instead
    of relying solely on the off-chain EIP-712 signature.
11. Caveats run. Treasury withdrawal executes.
```

The difference is that step 9 produces an on-chain witness of session
existence. Revocation is then an on-chain transaction; off-chain
`revocation_epochs` is no longer authoritative for this session.

#### Chain example 3 — "person-mcp tool call" (today, post-Sprint-5)

```
1. apps/web server action calls callMcp('person', toolName, args).
2. callMcp signs canonical-v2 `${ts}|${nonce}|${path}|${sha256(body)}`
   with the web-to-a2a HMAC key and forwards to a2a-agent.
3. a2a-agent verifies the web-to-a2a MAC.
4. a2a-agent decides which downstream MCP to route to (here: person-mcp)
   via mcp-proxy.ts.
5. a2a-agent re-signs the same canonical-v2 message with the
   a2a-to-person MAC key (per inter-service.ts:64-81).
6. person-mcp's require-inbound-service-auth middleware verifies the MAC.
7. person-mcp processes the tool call; the call carries a user-bound
   delegation receipt that person-mcp's onchain-redeem helper verifies
   against the on-chain delegation manager (this is the
   `project_mcp_onchain_auth` pattern).
```

Two MAC layers (web→a2a, a2a→mcp) + one on-chain delegation gate. Three
inbound checks before any user data is read or written.

### 1.4 Trust assumption inventory

We trust:

- **The Anvil / mainnet EVM consensus** for ordering, finality, and
  contract code immutability. If consensus is broken, every assumption
  here breaks.
- **KMS vendor attestation** (AWS HSM FIPS 140-2 L3 or GCP HSM FIPS 140-2
  L3) for key isolation. A KMS compromise breaks the bundler + master +
  session-issuer + MAC keys + tool-executor keys. Documented in C1 A6.
- **OIDC token issuers** — Vercel OIDC (for AWS STS federation) and
  Google's WIF OIDC (for GCP service-account impersonation). Token
  expiry windows are short (15 min); replay is bounded.
- **TLS PKI** — for every service-to-service hop and every external API
  call. We bind body hashes into our own MAC inside TLS so a TLS-MITM
  alone does not let an attacker forge a request, but a successful MITM
  can downgrade or strip an entire request.
- **The WebAuthn authenticator's attestation** — passkey users' platform
  authenticator. We do NOT today verify WebAuthn attestation (RP server
  side); we rely on the device's local biometric / PIN unlock. A
  compromised cloud-sync of a passkey (iCloud Keychain compromise, for
  example) drops to C1 A5.
- **Postgres TLS + auth** (post Phase F.2). Today (pre-F.2) we trust the
  SQLite file ACL.
- **GraphDB credentials** (READ + WRITE). Mitigated by on-chain being
  the authoritative store (C1 A11).
- **`@noble/curves` library correctness** — used everywhere we
  manipulate secp256k1 directly. The library is small and audited; the
  bypass guard (`scripts/check-no-bypass.sh`) ensures we don't silently
  drift away from it.

We explicitly do NOT trust:

- The browser-resident user-agent (cross-site scripting, supply chain).
  See C1 A9. CSP + SRI are deployment-time mitigations.
- Any single MCP service. See C1 A7. Each MCP can read its own data
  only; no MCP is allowed to write to GraphDB (P4).
- Any single off-chain table to be authoritative about on-chain state.
  Every on-chain → GraphDB sync is verifiable from on-chain events; the
  GraphDB mirror is reconstructible.
- The deployer EOA at runtime. Phase C removes its runtime presence in
  `apps/web/src/`; remaining sites are seed / observer / break-glass
  with explicit env guards (`ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL=<ISO>`).

---

## 2. Adversary classes

For each adversary class:

- **Pre-condition** — how the attacker reached this state.
- **Attack mechanic** — what they can do, step by step.
- **Blast radius** — best-case + worst-case impact in concrete terms.
- **Current mitigation (post-spec-007)** — code references.
- **Residual risk** — what's still possible after mitigations.
- **Detection** — how would we notice.
- **Recovery** — containment + remediation steps.

The numbering is stable; downstream documents and audit reports cite
these IDs.

---

### A1 — Compromised bundler key (KMS-isolated)

**Pre-condition.** The attacker has obtained `kms:Sign` permission on
the `BUNDLER_KMS_KEY_ID` CMK — either via an IAM role compromise, a
compromised CI principal that holds the role, or a vendor-side incident
where KMS itself is breached. The plaintext private key cannot be
extracted from KMS even in this state (FIPS 140-2 L3 module); only the
ability to invoke `kms:Sign` against this specific CMK.

**Attack mechanic.** The attacker can produce valid `BUNDLER_ENVELOPE`
signatures over arbitrary `userOpHash` values. The signed envelope is
the input to `AgentAccount.executeFromBundler` (`AgentAccount.sol:358-385`).
The attacker can therefore:

1. Construct a userOp targeting any user's AgentAccount.
2. Sign the `BUNDLER_ENVELOPE` digest themselves (legitimate use of the
   compromised key).
3. Submit the userOp via the legitimate ERC-4337 EntryPoint.
4. Pay gas (which they bear themselves, or burn paymaster budget if
   paymaster sponsorship isn't gated correctly).

The userOp's *inner* signature still has to recover to an owner of the
target AgentAccount (`AgentAccount._validateSignature`,
`AgentAccount.sol:692-697`). The bundler key alone does NOT recover to
`_owners` — the bundler is never in `_owners` post-Phase-A (factory
constructor at `AgentAccountFactory.sol:48-58` passes only the
`initialOwner` to `_owners`).

The attacker can:

- Construct userOps with **forged inner signatures** that they hope
  pass — these fail at `_validateSig` (`AgentAccount.sol:741-762`).
- Construct userOps with **stolen inner signatures** captured elsewhere
  (e.g., a captured user EIP-712 delegation signature). For Variant A
  delegations, replay is bounded by caveats (C2 analysis).
- **Submit garbage userOps** that the EntryPoint will reject during
  `validateUserOp`. The bundler ends up paying gas for failed
  validations (ERC-4337 § "Bundlers MUST pay for failed validations").
- **Censor / reorder legitimate userOps** by simply not submitting them.

**Blast radius.**

- **Best case** (attacker has only bundler key, target accounts are
  defended by Phase A): NO ability to author user actions. Attacker can
  grief by spamming failed userOps, eating their own gas. Attacker can
  refuse to relay specific users' userOps if they're the only relayer
  in deployment.
- **Worst case** (bundler key compromised + master key compromised,
  i.e., C-chain-1): see C1 A3 — attacker has all envelope-level
  capabilities including MAC and bundler. Still cannot author user
  actions, but can grief the entire user base.

**Current mitigation (post-spec-007).**

- Bundler is NOT in `_owners`. Cite: `AgentAccountFactory.sol:80-83`
  (only `delegationManager` + `address(this)` passed to `initialize`,
  not `bundlerSigner`).
- `AgentAccount._verifySignerEcdsa` (`AgentAccount.sol:779-789`) is used
  ONLY by `executeFromBundler` to verify the bundler envelope; recovery
  is `address`-pinned (`expected == bundlerSigner()`), not
  `_owners`-set-pinned.
- bundlerSigner has its own KMS key (`BUNDLER_KMS_KEY_ID`) with
  least-privilege IAM (only `kms:Sign` on that one key; no
  `kms:GetPublicKey`, no `kms:GenerateDataKey`, no symmetric KMS
  access). Cite: `docs/runbooks/aws-kms-setup.md` planned IAM stanza per
  spec 007 Phase H.
- `executeFromBundler` is a view function (`AgentAccount.sol:362`); it
  cannot execute the userOp by itself. EntryPoint drives execution and
  re-runs `validateUserOp`.
- The bundler envelope is bound to `address(this)` and `block.chainid`
  (`AgentAccount.sol:366-373`) so a captured signature from chain A
  cannot be replayed against chain B or against a different account.
- The inner sig is re-verified inside `executeFromBundler` against the
  owner set (`AgentAccount.sol:381-383`). A relay layer cannot smuggle
  in a non-owner inner sig because the contract checks again.

**Residual risk.**

- **Denial of service.** A compromised bundler can refuse to relay any
  userOp. Mitigation: ERC-4337 is permissionless at the EntryPoint
  layer — users could submit through any other bundler. Smart Agent's
  default deployment ships ONE bundler; redundancy is a Phase H+1
  follow-on.
- **Paymaster budget exhaustion.** If the paymaster sponsors gas for
  arbitrary bundler-submitted userOps (current dev state), a compromised
  bundler can burn the paymaster's deposit. Mitigation: paymaster gating
  is `[OPEN]` — Phase H scopes paymaster policy as out-of-scope for v1
  (spec 007 § Phase B B3). For prod, the paymaster MUST gate sponsorship
  on at least the AnonCreds marketplace credential.

**Detection.**

- Spike in `validateUserOp` failures from the bundler relayer. Audit
  row pattern: `eventType: 'request_finalized'` with `outcome:
  'reverted_at_validate_user_op'`. Threshold-based alerting (`> 5%
  failed validations in 5-min window`).
- KMS CloudTrail / GCP audit log spike in `kms:Sign` calls against the
  bundler key from unexpected source IPs or unexpected request volumes.
  Smart Agent emits a `kms-sign` audit row per call (`a2a-signer.ts`
  → `makeSignerAudit` → `auditAppend({eventType: 'kms-sign', mcpTool:
  'kms:sign:master'})`).

**Recovery.**

1. Disable the compromised CMK via `kms:DisableKey`. Effect is immediate
   in AWS (eventual consistency < 1 minute); GCP is similar.
2. Rotate to a new `BUNDLER_KMS_KEY_ID`. The new key has a new EOA
   address. AgentAccount's `bundlerSigner()` resolver
   (`AgentAccount.sol:270-273`) consults the factory, so the rotation
   path is:
   - Deploy new factory with new bundlerSigner.
   - All NEW AgentAccounts pick up the new factory's `bundlerSigner()`.
   - EXISTING AgentAccounts read the old factory's `bundlerSigner()` —
     they need a factory-rotation mechanism to pick up the new key.
     **This is `[OPEN]`** — spec 007 Phase A § D1 notes the rotation
     cadence ("quarterly") but does not currently spec the rotation
     mechanism for EXISTING accounts. Recommendation: add
     `setFactory(address newFactory)` gated by user owner sig, or accept
     that bundler key rotation requires a fresh-start (acceptable in v1
     where there are no prod accounts).
3. Audit-stream review: identify how many userOps the compromised key
   submitted between compromise and disable; check inner sigs to
   confirm none authored user authority.

---

### A2 — Compromised session-issuer key

**Pre-condition.** Same model as A1 but for `SESSION_ISSUER_KMS_KEY_ID`.
Separate IAM, separate CMK, separate rotation. Cite:
`AgentAccountFactory.sol:48-58`, spec 007 Phase A § D1.

**Attack mechanic.** The session-issuer's role under Phase B is to
co-sign `SessionAuthorization` envelopes alongside the user signature
in Variant B. The contract surface that gates this is
`AgentAccount.acceptSessionDelegation(bytes32 sessionDelegationHash)`
(`AgentAccount.sol:311-317`), which is `onlySelf` — it can only be
reached via a userOp signed by an owner. The session-issuer cannot
unilaterally call this function; the user's signature is mandatory.

The session-issuer's authority is therefore limited to:

1. Constructing the EIP-712 `SessionAuthorization` payload that the user
   signs at session-init.
2. Co-signing that payload (a step that exists for audit-trail purposes
   in some Variant B designs; spec 007 Phase A § D2 leaves the exact
   shape of the co-signature open). Whether the co-signature is
   load-bearing or audit-only is `[OPEN]` and called out below.

If the session-issuer is compromised, the attacker can produce
co-signatures over arbitrary payloads — but the user signature is still
required, and the user signs the payload they see in their UI. If the
attacker also has XSS in apps/web (A9), they can mutate the payload
before the user signs it — but that's an A9 + A2 chain (covered in
C-chain-1's adversarial variants).

**Blast radius.**

- **Best case**: NO ability to mint sessions. Co-signature alone is
  insufficient.
- **Worst case** (session-issuer + A9 chain): attacker can present a
  malicious `SessionAuthorization` payload to the user, the user signs
  it, the attacker submits — but this is a UI integrity problem
  (A9), not a session-issuer-key problem. The session-issuer key alone
  contributes nothing.

**Current mitigation (post-spec-007).**

- `acceptSessionDelegation` is `onlySelf` (`AgentAccount.sol:311`); the
  ONLY caller path is `address(this)` (a self-call after a userOp signed
  by an owner reaches `execute`).
- session-issuer is NOT in `_owners` (`AgentAccountFactory.sol:80-83`).
- session-issuer has its own KMS key with its own IAM (spec 007 Phase A
  § D1; runbooks in Phase H).
- The session-delegation hash itself binds the session key, scope, and
  validUntil; the user's signature is over a payload that includes
  these fields. A captured user signature for session X cannot be used
  for session Y (binding fields differ).

**Residual risk.**

- **`[OPEN]` — exact role of co-signature.** If the co-signature is
  load-bearing (e.g., the contract verifies it), then a compromised
  session-issuer + a user signature captured elsewhere = ability to
  install a session. Spec 007 Phase A § D2 should be tightened to make
  the co-signature audit-only OR to bind it into the digest the user
  signs (so user explicitly authorizes a specific session-issuer pubkey).
- **No on-chain session-issuer rotation surface for existing accounts**
  (same gap as A1's recovery step 2).

**Detection.** `kms:Sign` audit log volume on the session-issuer key.
Session-init audit rows (one per call) — if the rate exceeds the
historical baseline for the user population, alarm.

**Recovery.** Rotate session-issuer KMS key. New address; existing
sessions valid until `validUntil`; new sessions provisioned under the
new key. No on-chain accounts need migration because session-issuer is
factory-scoped (`AgentAccount.bundlerSigner()` /
`AgentAccount.sessionIssuer()` resolve via factory at
`AgentAccount.sol:270-279`).

---

### A3 — Compromised master key (CRITICAL — deepest-dive)

**Pre-condition.** The attacker has `kms:Sign` permission on the master
CMK (`AWS_KMS_SIGNER_KEY_ID` in AWS, `GCP_KMS_MASTER_SIGNER_VERSION` in
GCP) AND `kms:GenerateMac` / `kms:VerifyMac` permission on the master
HMAC keys (`AWS_KMS_MAC_KEY_ID_A2A_TO_*` × N services). The master is
the most-used identity in the runtime (signs every inbound MAC
verification + every outbound MAC + the ERC-4337 relay envelopes
pre-Phase-A; post-Phase-A is reduced to MAC + `handleOps` outer tx
gas payment).

**Attack mechanic.**

The mechanic differs sharply pre- and post-Phase-A. We document both
because Phase A is in flight and reviewers need to assess both states.

**Pre-Phase-A (current code, M-1 finding):**

The master is a co-owner of every AgentAccount because
`AgentAccountFactory` (old constructor `(IEntryPoint, address dm,
address serverSigner)`) passes `serverSigner` to `AgentAccount.initialize`
which adds it to `_owners` (per the M-1 audit finding referenced in
`specs/007-architecture-hardening/phase-A-contract-role-split.md:32-72`).

Cite the current vulnerable code site:
`apps/a2a-agent/src/routes/onchain-redeem.ts:638-651`:

```ts
// ─── Sign the userOpHash ──────────────────────────────────────────
// The master signer is registered as serverSigner / co-owner on every
// AgentAccount minted via AgentAccountFactory (factory passes it as
// the second initialize() arg). AgentAccount._validateSignature
// recovers the ECDSA signer and checks _owners[recovered] — the
// master signer satisfies that gate without needing the user's
// private key at runtime.
const masterEoa = await getMasterSigner()
const signature = await masterEoa.signMessage({ message: { raw: userOpHash } })
const signedOp = { ...op, signature }
```

The attacker with master key can:

1. Construct a userOp for ANY user's AgentAccount with arbitrary inner
   calldata.
2. Sign the userOp's inner signature with the compromised master key.
3. The `_validateSig` recovery passes because master is in `_owners`.
4. The userOp executes. The attacker has just authored an action as the
   user.

This is **takeover of every user account**. Worst case = drain every
treasury, vote on every proposal, transfer every NFT, upgrade every
account to malicious code via `upgradeToWithAuthorization` (because
master is in `_owners` so its sig satisfies `_verifyEcdsa`).

**Post-Phase-A:**

The master is NOT in `_owners`. `AgentAccountFactory.createAccount`
(`AgentAccountFactory.sol:66-92`) passes only `(owner, delegationManager,
address(this))` to `initialize`. Master compromise means:

1. Attacker can produce valid MAC headers (`x-a2a-signature`) for any
   service-to-service hop. Cite: `apps/a2a-agent/src/auth/inter-service.ts:64-81`
   maps each service to its own KMS MAC key — but if "the master" is the
   composite of multiple MAC keys, the per-key partition limits blast
   radius. Spec 007 design intent (per memory `project_kms_initiative`,
   line 30 "K3-extension defense-in-depth: each MCP signs with ITS OWN
   key") makes this NOT a single-key compromise; the runtime "master"
   role is partitioned into ~7 MAC keys + 1 envelope-encryption KMS key
   + 1 signing KMS key.
2. With the inter-service MAC capability, attacker can:
   - POST malicious payloads to any MCP that accepts the corresponding
     service identity.
   - Read PII from person-mcp (if a2a's IAM lets master read).
   - Write malicious session_store rows (planting a fake delegation
     under a victim's sessionId).
3. Attacker can sign `handleOps` outer relay txs and submit userOps
   to EntryPoint — but the **inner** userOp signature must still recover
   to an owner. So submission alone doesn't get them user authority.
4. Attacker can sign the canonical `sa:sign:v1` digest (per
   `aws-kms-signer.ts:122-152`) for any (sessionId, accountAddress,
   chainId, actionId) — but this digest is used only for the master's
   own audit-bound A2A actions, not for on-chain authority.

The chained attack of concern is **forging fake delegations in
person-mcp's session_store**:

```
1. Attacker uses master to sign canonical-v2 MAC for /session-store/upsert.
2. Attacker posts a session_store row containing:
   - victim_id = Maria's smart account
   - encrypted_package = an attacker-crafted delegation with delegate
     = attacker-controlled session key, with broad scope
   - signature = attacker-signed
3. Attacker calls a2a-agent /onchain-redeem with their session-key.
4. a2a-agent loads the session, recovers the delegation's signature,
   and submits via EntryPoint.
```

This attack fails because: **the delegation's signature is recovered
to the declared `delegator` (Maria's smart account)** inside
`DelegationManager._validateSignature` (`DelegationManager.sol:225-240`),
which calls `IERC1271(signer).isValidSignature(digest, signature)` —
which is `AgentAccount.isValidSignature` — which recovers ECDSA to
`_owners`. The attacker, holding only master, does NOT have a key in
Maria's `_owners` set. The forged delegation's signature does not
recover and `DelegationManager` reverts with `InvalidSignature` at line
233.

The key property that prevents A3 from cascading to user authority
post-Phase-A is: **the master is removed from every `_owners` set, and
no off-chain MAC capability can mint an on-chain `_owners` entry**.
Module install, owner add/remove, passkey add/remove are all `onlySelf`
gated (`AgentAccount.sol:819-836`, `:868-889`), and `onlySelf` requires
a userOp signed by an existing owner.

**Blast radius.**

- **Pre-Phase-A**: catastrophic. Takeover of every account.
- **Post-Phase-A best case**: inter-service MAC capability only. No
  user authority. Attacker can read MCP data (depending on per-MCP IAM)
  and pollute MCP-side state, but cannot move on-chain assets, cannot
  vote, cannot upgrade accounts.
- **Post-Phase-A worst case (compound)**: A3 + A9 (XSS) =
  attacker shows malicious payloads in user's UI and harvests
  signatures. A3 alone is insufficient.

**Current mitigation (post-spec-007).**

- **Phase A removes master from `_owners`** — the single most important
  mitigation. Cite the design lock: `phase-A-contract-role-split.md:32-72`
  for the problem statement; `:104-160` for the new initialize signature
  that omits `serverSigner`; `:404-414` for `test_MasterCannotSignUserOps`
  as the load-bearing acceptance criterion.
- **Per-service MAC key partition** (memory `project_kms_initiative`:
  "K3-extension defense-in-depth: each MCP signs with ITS OWN key").
  Master is the composite of multiple keys; an attacker compromising
  ONE MCP's signing capability cannot impersonate a different MCP.
- **Canonical-v2 MAC binding** (sprint 5 P0-1/P0-2/P0-3): timestamp +
  fresh per-request nonce + path + body-hash all inside the signed
  bytes (`apps/a2a-agent/src/auth/inter-service.ts:105-113`). A captured
  MAC for one path/body cannot be replayed against a different path or
  body within the ±60s window.
- **Single-use nonce table** (sprint 5 P0-1/P0-2/P0-3, hardening
  §1.10): even an identical-envelope replay within the timestamp window
  is caught by `recordNonce` at `apps/a2a-agent/src/auth/inter-service.ts:248`.
- **Delegation-signature ERC-1271 path** (`DelegationManager.sol:225-240`)
  requires the recovered signer to be an owner of the declared delegator
  account; master is not in any user's `_owners`.

**Residual risk.**

- **MCP data exfiltration.** If the attacker can construct a valid MAC
  for `/session-store/list` (or any read endpoint), they can read every
  encrypted session package — but the packages are envelope-encrypted
  with KMS data keys, and the attacker without the KMS Decrypt grant on
  those data keys cannot recover plaintext (per IAM least privilege).
  However if the master KMS principal ALSO holds the KMS Decrypt grant
  (which it does today for session-package encryption — see
  `apps/a2a-agent/src/auth/encryption.ts:30-36`), then A3 = read every
  session package. Mitigation: split the encryption KEK from the master
  signing key (current design — `AWS_KMS_KEY_ID` is the K2 symmetric
  envelope key, `AWS_KMS_SIGNER_KEY_ID` is the K4 asymmetric signer;
  cite `aws-kms-signer.ts:19-23`). But the a2a-agent process holds BOTH
  IAM roles. **A compromised a2a-agent host = both keys' Sign /
  Decrypt capability**. The KMS module itself is uncompromised; the
  attacker just has the runtime grants. **This is the highest
  remaining residual risk in the model** and is called out in § 4.
- **Inter-MCP authority spoofing within the partition.** If the
  attacker compromises `a2a-to-person` they can impersonate a2a-agent
  to person-mcp — but per spec design they CANNOT impersonate
  a2a-agent to org-mcp (different key). Property test in Phase G
  asserts this isolation.

**Detection.**

- KMS `kms:Sign` and `kms:GenerateMac` audit-log volume anomaly
  detection — each call emits a `kms-sign` row (`apps/a2a-agent/src/
  auth/a2a-signer.ts:53-87`).
- Inter-service `MAC VERIFY FAIL` spike (the temp debug logger at
  `inter-service.ts:223-232` writes a structured fail to stderr;
  production should route this to a SIEM).
- Audit-chain checkpoint divergence — Sprint 5 W2 introduces a periodic
  external anchor; a mass forgery would either (a) appear in the
  audit-chain hash but go undetected until the next checkpoint, or
  (b) bypass the audit chain entirely if the attacker also has Postgres
  write (then we're in C-chain-4 territory).
- `kms-mac-verify-failed` audit-row spike (`inter-service.ts:208`,
  `:237`).

**Recovery.**

1. Disable master KMS keys (sign + MAC, both).
2. Provision new master keys. New master EOA address; bundler-relayer
   path is broken until the new master is wired in.
3. Restart a2a-agent + all MCPs with new env. Inter-service MAC keys
   are reissued and re-enrolled at each MCP.
4. Audit the action stream from compromise time to disable; flag every
   inter-service write under the compromised key.
5. **Post-quantum scenario** (out of scope today but documented in C3):
   if the attacker captured ciphertext encrypted under the master KEK
   pre-compromise, they may have plaintext access to historical session
   packages. PII rotation may be required depending on jurisdiction.

---

### A4 — Compromised single user EOA

**Pre-condition.** Attacker has obtained the private key for ONE user
EOA — either through password-manager compromise, malware on the user's
device, phishing the user into revealing the key, or capturing the demo
EOA's privateKey from the web SQLite (demo accounts only; production
won't have server-stored EOAs except for the documented stateless
fallback which is removed in Phase C).

**Attack mechanic.**

1. Sign userOps directly with the captured EOA. The EOA is in `_owners`
   of the user's AgentAccount. `_validateSig` recovers to the EOA and
   accepts.
2. Author any action: vote, propose, pledge, honor, transfer, upgrade
   (via `upgradeToWithAuthorization` — owner sig over `(UPGRADE,
   newImpl, address(this), chainId)`).
3. Add a new owner (`addOwner(attackerAddr)` via self-call) and pin the
   account.

**Blast radius.**

- One user's AgentAccount fully owned. Treasury drained, on-chain
  assertions forged, account upgraded to attacker implementation.
- NO horizontal spread. A4 compromises one user; other users'
  AgentAccounts are independent — different owner sets, different
  `_owners` entries.

**Current mitigation (post-spec-007).**

- Standard owner-key custody hygiene: passkeys (A5 is the relevant
  attack class) are stronger than EOAs because they're authenticator-
  bound. Demo EOAs are an explicit dev-only weakness.
- The `_authorizeUpgrade` gate (`AgentAccount.sol:197`) is `onlySelf`,
  and `upgradeToWithAuthorization` (`:216-232`) verifies an owner
  signature — which means a user with a compromised EOA AND a registered
  passkey could in principle remove the compromised EOA via a passkey-
  signed userOp before the attacker uses it, IF the user notices fast
  enough. This is opportunistic recovery, not a guarantee.
- No master / system key can restore the account from compromise
  (because master is not an owner post-Phase-A) — recovery requires the
  user's other credentials.

**Residual risk.**

- **No social-recovery mechanism exists today.** Spec 007 does not add
  one; that's a future spec. Recommendation: a multi-day-delay
  guardian-based recovery `addOwner` path with a delay window where the
  user can veto via passkey. This is `[OPEN]` and called out in § 4.
- **A4 is a per-user catastrophe**, not a system-wide one. The
  architectural focus is on bounding blast radius to ONE user.

**Detection.**

- On-chain `OwnerAdded` event for a user account whose user did not
  initiate it (correlate with apps/web audit rows showing no `addOwner`
  action from the user's session).
- Sudden large outbound transfers from a treasury that historically had
  small transfers.

**Recovery.**

1. Use any other registered owner (passkey, recovery EOA) to
   `removeOwner` the compromised one.
2. If only the compromised EOA exists, the account is unrecoverable
   without social-recovery infrastructure.
3. Transfer assets to a new fresh AgentAccount (manual via a userOp
   signed by another owner).

---

### A5 — Compromised user passkey

**Pre-condition.** Attacker has obtained the user's WebAuthn credential
private key. This is significantly harder than A4 because the private
key is authenticator-bound, but is possible via:

- **iCloud Keychain / Google Password Manager compromise** for synced
  passkeys (the user's cloud account is compromised, and the cloud
  syncs the passkey across devices). Passkeys with `discoverable:
  preferred` set are cloud-sync candidates.
- **Authenticator firmware compromise** — Touch ID / Face ID on
  jailbroken iOS, FIDO2 token firmware extraction (very expensive,
  rarely seen in practice).
- **Cross-origin phishing** — the attacker tricks the user into using
  their passkey on an attacker-controlled origin. Mitigated by the
  WebAuthn origin binding (the authenticator refuses to sign for
  `attacker.example` if it was registered for `smart-agent.example`).
- **Browser-bound passkeys** with a compromised browser extension that
  has access to `navigator.credentials.get`. Mitigated by Chrome / Safari
  passkey APIs being out-of-process and gated by user gesture.

**Attack mechanic.** Same as A4, but the signature type byte is `0x01`
and the signature payload is an `abi.encode(WebAuthnLib.Assertion)`
(`AgentAccount.sol:755-760`, `:791-797`). The attacker can:

1. Use the WebAuthn assertion to sign userOps.
2. The `_verifyWebAuthn` (`AgentAccount.sol:791-797`) verifies the P-256
   ECDSA signature against the stored `(x, y)` public key and accepts.
3. Author any action.

**Blast radius.** Same as A4 — one user. Passkeys do not cross
accounts.

**Current mitigation (post-spec-007).**

- WebAuthn origin binding: even an attacker-controlled origin cannot
  trigger a passkey signature for `smart-agent.example` (browser refuses).
- WebAuthn user-gesture requirement: every passkey use requires a fresh
  biometric / PIN check. Silent reuse is not possible.
- Replay protection via `clientDataJSON.challenge` binding: the WebAuthn
  challenge is the EIP-712 `userOpHash`, so a captured passkey assertion
  for one userOp cannot be replayed against a different userOp.
- The passkey storage slot in `AgentAccount` is namespaced via ERC-7201
  (`AgentAccount.sol:844-846`) so future upgrades cannot clobber it.

**Residual risk.**

- **iCloud Keychain / Google Password Manager exposure**. Smart Agent
  cannot influence whether the user's authenticator opts into cloud
  sync. Mitigation: encourage users to use hardware-bound passkeys
  (e.g., YubiKey, platform "discoverable: never" mode) for high-stakes
  accounts. Document this in `docs/privacy/anoncreds-custodial.md`
  (Phase H deliverable) and the user-facing security page.
- **Cross-device sync attack**. If the user's iCloud account is
  compromised, every device's passkey is exposed. This is a known
  WebAuthn ecosystem risk and is partially mitigated by the
  authenticator's local biometric / PIN unlock (which is checked even
  on synced passkeys).
- **Passkey attestation is NOT verified** today. We accept any
  authenticator. A malicious software authenticator could exfiltrate
  the credential, but this requires the user to register a malicious
  authenticator deliberately. Adding attestation verification is
  `[OPEN]`.

**Detection.** Same as A4 — anomalous on-chain events tied to the user.
Optionally, WebAuthn assertions include a `signCount` (passkey usage
counter) that we could verify monotonicity on; today we don't store the
counter so this defence is unavailable. Adding `signCount` verification
is a low-cost hardening item.

**Recovery.** Same as A4 — `removeOwner` via passkey OR removal of the
compromised passkey via another registered signer.
`AgentAccount.removePasskey` (`:881-889`) enforces the last-signer
invariant so the user cannot accidentally zero out their authentication.

---

### A6 — Compromised KMS account (all 3 keys at once)

**Pre-condition.** Attacker has full AWS / GCP account compromise of
the Smart Agent runtime account, with access to ALL three KMS keys:
master signer, bundler signer, session issuer. May also include the
symmetric envelope-encryption key (K2 / G2) and the inter-service MAC
keys.

This is catastrophic by definition. The model question is **how bad is
catastrophic** post-Phase-A.

**Attack mechanic.**

Attacker has the union of A1 + A2 + A3.

1. From A3: can MAC any inter-service request → can read every MCP's
   data (subject to per-MCP IAM partitioning, which doesn't help if
   master has all per-MCP keys).
2. From A1: can sign bundler envelopes → can submit userOps.
3. From A2: can sign session-issuer co-signatures.
4. **What they STILL cannot do**: forge a user owner's signature, because
   no user owner key is in KMS. User owners are EOAs / passkeys held by
   users on their own devices.

Therefore:

- The attacker can DOS the entire system (refuse to relay).
- The attacker can read MCP-stored data (PII, encrypted session
  packages — packages decryptable because KMS Decrypt grant is the
  attacker's).
- The attacker CANNOT forge userOp inner signatures. The
  `_validateSig` path requires the inner sig to recover to an owner;
  no owner is in KMS.
- The attacker CANNOT upgrade accounts. `_authorizeUpgrade` requires
  owner sig over UPGRADE digest; no owner is in KMS.

This is the load-bearing property of Phase A and the M-1 mitigation: a
total KMS compromise does NOT cascade to user authority because user
owners live outside KMS.

**Compared to historic 1-key scenario** (pre-Phase-A): pre-Phase-A had
ONE master key that was co-owner of every account. Compromising that
ONE key compromised every account. Post-Phase-A, no single key (and
indeed no combination of system keys) can author user actions.

**Blast radius.**

- **Best case**: read access to MCP data (PII exposure), DoS, possible
  GraphDB poisoning if hub-mcp credentials are also compromised (A11).
  No user authority forgery.
- **Worst case**: the above + persistence — attacker plants malicious
  KMS key versions, malicious IAM roles, malicious CloudWatch rules to
  hide their tracks.

**Current mitigation (post-spec-007).**

- **No user authority lives in KMS.** This is the architectural
  invariant. Every user action requires a user-held credential
  (EOA / passkey / SIWE wallet) outside the KMS account.
- Per-key IAM partitioning limits cross-key reasoning (a `kms:Sign`
  grant on the bundler key does not grant Decrypt on the K2 KEK; see
  `aws-kms-signer.ts:19-23` and `aws-kms-provider.ts` IAM stanza).
- Vercel OIDC federation: no static AWS access keys exist in the Smart
  Agent runtime. STS tokens are short-lived; rotating the OIDC trust
  policy is the recovery surface.
- GCP WIF mirror: similar; `GOOGLE_APPLICATION_CREDENTIALS` is forbidden
  in prod (memory `project_kms_initiative`, line 40).

**Residual risk.**

- **MCP data exfiltration.** All PII, all encrypted session packages,
  all GraphDB credentials are accessible. AnonCreds link secrets in
  person-mcp are particularly sensitive (HNDL applies — even if the
  attacker can't use them today, they may be useful future-decrypted).
  See C3 § 2 on HNDL.
- **GraphDB poisoning.** If hub-mcp credentials are KMS-managed, A6
  enables GraphDB write. Mitigation: on-chain is authoritative; GraphDB
  rebuilds from on-chain events. **Catalog any non-on-chain GraphDB
  data** (memory: `reference_graphdb.md`) and treat the destruction of
  that data as the recovery cost.
- **Persistence**. Attacker can plant key material that survives the
  initial response. Forensic IR plan needed.

**Detection.**

- Anomalous CloudTrail / GCP audit log volume across multiple KMS keys
  simultaneously.
- Failure of audit-chain external anchor (Sprint 5 W2): if the
  attacker corrupts audit rows in a2a-agent's database, the periodic
  external checkpoint will diverge from the local chain hash.
- Unusual IAM activity: new roles, new trust policies, new key
  versions, key disable / re-enable events.

**Recovery.**

1. **Burn the KMS account.** Disable every CMK. Don't try to rotate;
   provision fresh keys in a fresh AWS / GCP account.
2. Re-deploy contracts? No — Phase A is designed so user owners survive
   KMS compromise. Existing AgentAccounts continue to function; the
   factory's `bundlerSigner()` / `sessionIssuer()` get rotated by
   deploying a new factory and migrating accounts via factory-rotation
   (see A1 § Recovery — currently `[OPEN]`; effective practical recovery
   today is `fresh-start.sh` since prod has no real accounts yet).
3. **Reissue user-facing credentials**. AnonCreds credentials may need
   reissue if the attacker had Decrypt grant on link secrets. PII in
   person-mcp may need a notify-affected-users action depending on
   jurisdiction.
4. **GraphDB rebuild from on-chain events**.
5. **Forensic IR**: tag every audit row from compromise-window to
   disable; identify customer impact.

---

### A7 — Compromised single MCP (e.g., person-mcp)

**Pre-condition.** Attacker has root on the host running ONE MCP
process — say person-mcp. The attacker can read/write the MCP's
database (today: SQLite; post-F.2: dedicated Postgres database), read
the MCP's env (so they have the per-MCP MAC key plaintext in dev; in
prod the MCP only has IAM grants for its own KMS MAC verify key, so the
attacker has IAM-mediated access to that key).

**Attack mechanic.**

1. Attacker reads all of person-mcp's PII tables (private user profiles,
   relationship data, encrypted session packages).
2. Attacker writes new rows into person-mcp's tables (plants fake
   session packages, modifies PII).
3. Attacker uses the `a2a-to-person` MAC verify capability to
   selectively accept or reject inbound requests from a2a-agent. This
   is a passive-only capability — the MCP receives MACs, it does not
   issue them. The attacker on the MCP host can only verify MACs from
   a2a-agent, not produce MACs that other MCPs would accept.
4. Attacker decrypts encrypted session packages — **if and only if**
   the attacker also has Decrypt grant on the K2 KEK. In prod, person-mcp
   does NOT have the K2 Decrypt grant directly — a2a-agent decrypts
   session packages and sends person-mcp only the parts person-mcp
   needs to see (the canonical session_store flow stores ciphertext at
   person-mcp; a2a-agent holds the decrypt grant). Cite:
   `apps/a2a-agent/src/auth/encryption.ts:30-36` (a2a-agent's
   `getProvider()` is the only call site of K2 decrypt for session
   packages). **This is a load-bearing property** and Phase G should
   add a property test enforcing it.

**Blast radius.**

- One MCP's data exposed. Cross-MCP exposure does NOT cascade because:
  - org-mcp uses a different MAC key (`a2a-to-org`). person-mcp's
    compromise does not let the attacker forge org-mcp inbound MACs.
  - Each MCP's DB / KMS scope is its own.

**Current mitigation (post-spec-007).**

- **Per-MCP MAC key partitioning** (memory `project_kms_initiative`
  line 30; `apps/a2a-agent/src/auth/inter-service.ts:64-81`). Each MCP
  signs / verifies with its own key.
- **K2 decrypt grant scoped to a2a-agent** (current design — verify via
  IAM policy review in Phase H). person-mcp stores ciphertext, doesn't
  hold the key.
- **Phase D inbound MAC closure**: people-group-mcp, family-mcp,
  geo-mcp, verifier-mcp, skill-mcp ALL get inbound MAC at Phase D
  landing. Pre-Phase-D some of these are unauthenticated edges (P1-3
  finding from the external review).
- **Phase F.2 per-MCP databases**: separation of DB scope per MCP. A
  compromised person-mcp host cannot read org-mcp's DB (different DB,
  different credentials).

**Residual risk.**

- **Replay of legitimate a2a→person-mcp MACs.** If the attacker captured
  inbound MAC requests pre-compromise, the canonical-v2 binding +
  per-request nonce + ±60s clock window prevent replay outside the
  window. Within the window, the single-use nonce table closes the gap.
  Cite: `apps/a2a-agent/src/auth/inter-service.ts:248`.
- **Audit-chain integrity** within person-mcp itself: if the attacker
  has DB write, they can tamper with person-mcp's audit rows. Mitigated
  by the global audit chain at a2a-agent (`p0_5` two-row audit chain;
  memory `project_kms_initiative` line 17). Person-mcp's local audit is
  defense-in-depth, not authoritative.
- **AnonCreds link secret theft.** Link secrets are stored in
  person-mcp's Askar wallet. Compromise = full holder-wallet exposure.
  Mitigation: spec 007 Phase H documents the custodial relationship
  (`docs/privacy/anoncreds-custodial.md` planned). Long-term migration
  to holder-self-custody is documented as v2 future work
  (`specs/007-architecture-hardening/plan.md` § "Deferred to v2").

**Detection.**

- Cross-MCP audit chain divergence — a2a-agent's audit chain ties
  inter-service writes to outcomes; person-mcp's local view should
  match. Phase G property test.
- DB anomaly: row counts, recent-modified-at distribution, schema
  changes.

**Recovery.**

1. Rebuild person-mcp from clean image.
2. Replay relevant on-chain events into a fresh DB (where applicable).
3. AnonCreds: if Askar wallet was exposed, link secrets are
   compromised — issue new link secrets, reissue affected credentials.
   This is a multi-user impact.
4. Re-issue the MAC key.

---

### A8 — Compromised hub-mcp (GraphDB writer)

**Pre-condition.** Attacker has root on hub-mcp's host. hub-mcp is the
ONLY service authorised to write to GraphDB (per IA P4 — memory
`reference_graphdb.md` and `docs/information-architecture/`).

**Attack mechanic.**

1. Attacker issues SPARQL UPDATEs to GraphDB. The GraphDB credentials
   are in hub-mcp's env (post-Phase-H: AWS Secrets Manager / GCP Secret
   Manager).
2. Attacker can:
   - Add false `sa:` triples (e.g., `:Maria sa:isOwnerOf :Treasury`).
   - Remove existing triples (silent denial).
   - Replace existing triples (silent alteration).
3. Discovery SDK reads (`packages/discovery/`) return attacker-shaped
   data to consumers. Apps/web UIs render attacker's view of the trust
   graph.

**Blast radius.**

- GraphDB UI and discovery queries return false data. Users see false
  relationships, fake credentials, fake reputations.
- On-chain state is UNAFFECTED. Wallet actions, votes, transfers all
  continue to function correctly.

**Current mitigation (post-spec-007).**

- **On-chain is the source of truth.** Every visible assertion in
  GraphDB has a corresponding on-chain event; GraphDB is reconstructible
  by replaying events from block 0. Discovery layer architecture: any
  consumer can choose to verify a GraphDB triple by querying the
  on-chain event log.
- **Phase H IaC** rotates GraphDB credentials and provisions audit-log
  routing from GraphDB to SIEM.
- **GraphDB write is hub-mcp only** (P4 invariant). A compromised
  person-mcp / org-mcp / family-mcp cannot reach GraphDB write.

**Residual risk.**

- **Real-time UI drift between compromise and detection.** Users may
  make decisions on poisoned data during the window.
- **External audit anchor (Sprint 5 W2)** is for the audit-chain DB,
  not for GraphDB. Adding a GraphDB integrity anchor is `[OPEN]` and
  recommended.

**Detection.**

- Periodic GraphDB → on-chain reconciliation job. Phase H delivery.
- Inspect SPARQL UPDATE volume vs. baseline.
- Hub-mcp's own audit rows for write operations.

**Recovery.**

1. Snapshot GraphDB.
2. Wipe the affected named graph (`DATA_GRAPH` per
   `@smart-agent/discovery`).
3. Replay on-chain events from block 0 (or from last clean checkpoint
   if hash-anchored).
4. Re-deploy hub-mcp with fresh GraphDB credentials.

---

### A9 — Compromised web frontend (XSS / supply chain)

**Pre-condition.** Attacker has injected JavaScript that runs in users'
browser sessions on `smart-agent.example`. Vectors:

- **Cross-site scripting** (input not properly escaped in a Server
  Component, dangerouslySetInnerHTML misuse, etc.).
- **Compromised npm dependency** that ships malicious code in a transitive
  package. The Smart Agent supply chain includes Next.js, React, viem,
  noble curves, OZ contracts, drizzle, hono, etc. — hundreds of packages.
- **Compromised CDN** (if static assets are served via a third-party CDN).

**Attack mechanic.**

1. Attacker JS runs in user's session.
2. Attacker reads HttpOnly session cookies? NO — HttpOnly cookies are
   not accessible to JS. But the attacker can call server actions with
   the user's session active.
3. Attacker constructs a fake "Vote yes on proposal #123" UI; user
   clicks "Sign". Server action calls `prepareWalletActionForPasskey(action)`
   (`apps/web/src/lib/ssi/signer.ts:137-151`). The browser invokes
   `navigator.credentials.get(challenge=hash)`. The hash is over the
   ATTACKER-CHOSEN action.
4. User's passkey signs. Attacker captures the signature, posts it to
   the verifier — passes ERC-1271 (it's a valid passkey sig for the
   victim's account).

The attack: **the passkey signs whatever the page tells it to sign.**
The user only sees a browser prompt ("authenticate to smart-agent.example
using your passkey"); the prompt does NOT show the structured EIP-712
action payload because WebAuthn's challenge is opaque bytes.

**Blast radius.**

- Per-session: every action the user takes in the compromised session
  can be replaced with an attacker-chosen action.
- Persistent: attacker can add a new owner via `addOwner` (the user signs
  the underlying userOp without realising) — gaining persistent control
  even after the user closes the browser.

**Current mitigation (post-spec-007).**

- **Content-Security-Policy headers** — `[OPEN]`, Phase H IaC adds
  strict CSP. Today's CSP posture in `apps/web/next.config.ts` is not
  audited in this document; assume work needed.
- **Sub-resource integrity** for any CDN-served assets — `[OPEN]`.
- **No third-party JS** in the critical-path bundle. The Next.js bundle
  is self-hosted; we don't include Google Analytics, Hotjar, or other
  third-party trackers in the signing-flow pages.
- **viem + noble are tree-shaken locally** — see substrate-independence
  principle. We do NOT call `metamask-sdk` or `@privy-io/react` in the
  signing path.
- **The action description in the user-visible prompt is RP-controlled**
  — the Smart Agent web app could (and should) show the user a clear
  human-readable summary of the action being signed before invoking
  `navigator.credentials.get`. **This is `[OPEN]` and called out in §
  4** — Phase H or later spec should land "show the user what they're
  signing" UX with a non-bypassable confirmation step.
- **Risk-tier routing**: high-risk actions are Variant B (on-chain
  delegation registration), which means each high-risk action is a
  separate user-signed userOp — the attacker cannot bundle "vote yes"
  with "transfer treasury" in a single click. Mitigation: user sees
  more friction for high-stakes actions.

**Residual risk.**

- **The user-visible confirmation gap.** WebAuthn's spec doesn't
  require the authenticator to display the action; the RP is responsible
  for showing the user what they're signing. Today's UI does not
  reliably do this for every action — `[OPEN]`.
- **Supply-chain attacks.** Even with SRI + CSP, a compromised npm
  package can land in production via an automated dependency update.
  Mitigation: Phase G has dependency-pin CI; Renovate / Dependabot
  reviews. Out of scope for crypto posture; covered separately.

**Detection.**

- CSP violation reporting endpoint (`Reporting-Endpoints` header).
- On-chain anomaly detection (sudden owner-add events, sudden owner-set
  changes).

**Recovery.**

1. Patch XSS / pull poisoned package.
2. Notify affected users; users review their account's owner set on a
   read-only audit page and `removeOwner` any unrecognised entries via
   passkey-signed userOp.
3. Reissue server-side cookies (invalidate all sessions).

---

### A10 — Compromised Postgres database (post Phase F.2)

**Pre-condition.** Attacker has read/write to one of the per-MCP
Postgres databases — say the a2a-agent or person-mcp database. Mechanism:
managed Postgres credential leak, SQL injection in a service (unlikely
with Drizzle parameterized queries), pg-pool TLS MITM (mitigated by
TLS), or a compromised CI principal with DB grants.

**Attack mechanic.**

1. Attacker reads tables: `sessions`, `inter_service_nonces`,
   `action_nonces`, `revocation_epochs`, `action_counters`, `audit_rows`,
   `credential_metadata` (per spec 007 Phase F § acceptance criteria).
2. Attacker writes:
   - Plant a fake session row pointing to attacker-controlled
     encrypted_package. Without Decrypt grant on K2 KEK they can't
     produce valid ciphertext, so the row decrypts to garbage and
     fails downstream. But they can `DELETE` legitimate session rows
     to deny user access.
   - Modify `audit_rows` to hide attacker actions. Mitigated by the
     audit chain hash linking each row to its predecessor — a tamper
     produces an inconsistent chain. Sprint 5 P0-5 added the audit
     chain (memory `project_kms_initiative` line 17).
   - Modify `inter_service_nonces` to bypass replay protection — but
     attacker still needs valid MACs, which they don't have without
     KMS.
3. Attacker reads `audit_rows` — sees historical action stream, useful
   for reconnaissance.

**Blast radius.**

- Read: historical action stream visible. PII may leak if any PII is in
  audit rows (Smart Agent's policy: NO PII in audit rows, only
  identifiers + outcome codes).
- Write: DoS via row deletion; audit-chain tampering (detected).
- Cannot author actions (no KMS access).

**Current mitigation (post-spec-007).**

- **Audit chain hash linking** (Sprint 5 P0-5): each audit row's hash
  includes the prior row's hash. Tamper → chain breaks → detected at
  next external checkpoint anchor.
- **Bypass guard `forbid UPDATE on execution_audit`** (memory
  `project_kms_initiative` line 17) — only INSERT is allowed at the
  ORM layer. A DB-direct attacker can UPDATE, but the chain detects it.
- **Row-level encryption** for session packages (KMS envelope). DB read
  alone yields ciphertext.
- **TLS to Postgres** (Phase F.2 acceptance criterion includes managed
  PG with TLS).
- **Postgres credentials in KMS Secrets Manager** (Phase H IaC).
- **`(scope, nonce)` UNIQUE + `ON CONFLICT DO NOTHING`** (Phase F.2
  acceptance) — DB-direct attacker could DELETE rows from
  `inter_service_nonces` to enable replay; mitigated by the canonical-v2
  ±60s clock skew window (attacker also needs a fresh MAC, which needs
  KMS).

**Residual risk.**

- **Audit-chain external anchor frequency**. The chain hash is anchored
  externally periodically (Sprint 5 W2). Between anchors, an attacker
  with DB write could rewrite history and disable detection until the
  next anchor. Anchor cadence is a deployment decision; reviewer should
  audit it. `[OPEN]` how short the cadence is.
- **Read-side PII**. We claim no PII in audit rows but the bypass guard
  doesn't enforce that — it's a policy. Phase G could add a CI test
  that asserts audit rows don't carry obvious PII shapes (emails,
  phone numbers).

**Detection.** Audit-chain hash mismatch at anchor checkpoint.
Postgres-side audit (pgaudit) for unusual query patterns.

**Recovery.**

1. Restore Postgres from last good backup.
2. Rotate Postgres credentials.
3. Replay audit chain from last good anchor checkpoint.

---

### A11 — Compromised GraphDB credentials

**Pre-condition.** Attacker has the GraphDB READ and/or WRITE
credentials. GraphDB credentials are stored in hub-mcp's env (Phase H:
Secrets Manager). Compromise via env leak, CI principal compromise, or
hub-mcp host compromise (A8).

**Attack mechanic.**

1. **READ compromise**: attacker can SELECT-query the entire graph.
   Confidentiality breach — names, relationships, claims.
2. **WRITE compromise**: same as A8 (hub-mcp compromise) — can INSERT /
   DELETE arbitrary triples.

**Blast radius.**

- Read: full graph confidentiality breach.
- Write: same as A8 (false data, UI poisoning).

**Current mitigation (post-spec-007).**

- **GraphDB is not authoritative for any cryptographic claim**. On-chain
  is the source of truth.
- **Hub-mcp is the only service with WRITE creds**. READ creds are wider
  (any service that needs to query via discovery SDK has READ creds).
- **Phase H IaC** moves creds to Secrets Manager.

**Residual risk.**

- **Privacy leak**. The trust graph contains personal information by
  nature (who knows whom). A read-side compromise exposes this.
  Mitigation: don't put PII in the graph; use opaque identifiers and
  resolve to PII only in MCP-side stores. Today's policy is roughly
  this, but enforcement is by-convention; Phase G could add a SHACL
  shape that rejects PII-shaped literals in the data graph.
- **No incremental rollback** if GraphDB is poisoned: a wholesale
  rebuild from on-chain events is the recovery path.

**Detection.** SPARQL audit log volume; periodic graph-hash anchor
(`[OPEN]`).

**Recovery.** Rotate GraphDB creds. Rebuild graph from on-chain events
if WRITE was compromised.

---

### A12 — Compromised CI/CD pipeline

**Pre-condition.** Attacker has push access to the Smart Agent
production repo, OR has compromised the CI runner image, OR has injected
into a release pipeline.

**Attack mechanic.**

1. Attacker merges malicious code into a release branch.
2. Build / deploy emits malicious binary to production.
3. Malicious binary has full runtime access — including all KMS grants,
   all DB creds, all MAC keys.

**Blast radius.** Catastrophic. The runtime is fully under attacker
control. This is equivalent to A6 + A10 + A11 simultaneously, plus
persistence.

**Current mitigation (post-spec-007).**

- **Branch protection**: require N reviewers for merges to `master` /
  release branches. Phase H mention.
- **Signed releases**: tag signing and SBOM emission per release. Phase
  H deliverable in Terraform / IaC.
- **CI principal isolation**: the CI principal has DEPLOY grants but not
  STEADY-STATE-READ grants (e.g., the CI principal cannot read
  production data — only deploy code). Cite IAM policy review in Phase
  H.
- **Phase G CI guards** detect architectural drift (`tools-comment-
  matches-route`, `no-server-only-in-tsx`, `no-silent-catch-on-primitives`,
  `risk-tier-classification`).
- **Bypass guard `scripts/check-no-bypass.sh`** (memory
  `project_kms_initiative` line 30): 7 invariants; one of which is
  "route handlers MUST NOT import `@aws-sdk/client-kms` directly".
  A malicious PR that bypasses the key-custody isolation fails CI.

**Residual risk.**

- **The CI principal itself** is a high-value target. Phase H should
  audit the CI's permissions; ideally CI has zero production access and
  deploys via a separate gated step.
- **SBOM does not prevent malicious-but-signed releases**; it provides
  forensic value after the fact.
- **Dependency hijack** is partially mitigated by lockfile pinning;
  the lockfile must be reviewed for unexpected version bumps.

**Detection.**

- Deploy-stream review (manual code review of every release).
- Production-runtime invariant checks at boot (Sprint 5: production
  refuses to boot with `A2A_SESSION_SECRET`, `DEPLOYER_PRIVATE_KEY`
  unless explicit break-glass).

**Recovery.**

1. Revert to last known-good deploy.
2. Forensic IR on attacker's code path.
3. Rotate all KMS keys, all DB creds, all MAC keys.

---

### A13 — Compromised contract upgrade authority

**Pre-condition.** Attacker has captured an owner's signature
authorising an UPGRADE. Mechanisms: A4 (single user EOA), A5 (single
user passkey), A9 (XSS that captures upgrade signature without user
realising).

**Attack mechanic.**

1. Owner signature over `keccak256(abi.encode("UPGRADE", maliciousImpl,
   address(this), block.chainid))` is required by
   `AgentAccount.upgradeToWithAuthorization` (`AgentAccount.sol:216-232`).
2. The attacker submits the upgrade tx. Anybody can pay gas. The user's
   account is upgraded to `maliciousImpl`.
3. `maliciousImpl` has arbitrary code — drains assets, replaces owner
   set, etc.

**Blast radius.**

- **Per-account**: one account upgraded; one user's assets at risk.
- **NO horizontal spread** because the upgrade authority is per-account
  (each AgentAccount's owner authorises its own upgrade).

**Factory upgrade authority is SEPARATE.** The `AgentAccountFactory`
itself is not UUPS upgradeable (cite: no UUPSUpgradeable inheritance in
`AgentAccountFactory.sol:26`); factory has immutable
`accountImplementation`, `delegationManager`, `bundlerSigner`,
`sessionIssuer`. Upgrading the factory means deploying a new factory
contract; existing accounts continue to point at the old factory unless
explicitly migrated (cf. A1 § Recovery). Therefore there is NO global
"upgrade everything" authority surface — Phase A intentionally avoided
creating one.

**Current mitigation (post-spec-007).**

- **`onlySelf` on `_authorizeUpgrade`** (`AgentAccount.sol:197`) means
  no external caller can satisfy it directly. Only `upgradeToWithAuthorization`
  reaches it via self-call after verifying the owner sig (`:226-232`).
- **`UpgradeAuthorized` event** (`:107`, emitted at `:227`) provides
  on-chain audit-trail before the upgrade fires. A user (or an external
  watcher service) can detect the upgrade-pending tx and intervene.
- **No factory upgrade path** — see above.
- **Risk-tier `critical`** on `upgradeToWithAuthorization` would force
  Variant B (on-chain delegation registration at session-init), making
  the attack require both a session-init AND an action-time signature.
  The risk-tier registry in spec 007 Phase B § 4 doesn't currently list
  `upgradeToWithAuthorization` explicitly; **adding it is recommended**.

**Residual risk.**

- **The user sees an opaque WebAuthn challenge.** Same as A9 — the
  attacker can construct an UPGRADE digest that the user signs without
  realising. Mitigation: human-readable confirmation step in the UI.
  `[OPEN]`.
- **No timelock on upgrade.** A passkey-signed UPGRADE goes through
  immediately. A timelock (e.g., 24h delay between signature and
  effective upgrade) is `[OPEN]`. Recommendation: add an optional
  `pendingUpgrade` timelock state for users who opt in.

**Detection.** `UpgradeAuthorized` events on chain. Watcher service
that alarms on any upgrade event for accounts not opted into auto-update.

**Recovery.**

- If the old implementation's storage layout is preserved, the user can
  attempt an upgrade BACK to the original implementation — but this
  requires another owner signature, which the attacker now controls if
  A4/A5 hasn't been mitigated.
- Practical recovery: detect the malicious upgrade pre-execution
  (timelock window), remove the compromised owner via another credential.

---

### A14 — Malicious bundler

**Pre-condition.** The deployed bundler implementation is itself
adversarial OR the bundler's operator is dishonest. (Distinct from A1:
A1 is "an external attacker stole the bundler's key"; A14 is "the
bundler is the attacker").

**Attack mechanic.**

1. **Censorship**: bundler refuses to relay specific users' userOps.
2. **Reordering**: bundler picks the userOp ordering that maximises
   their MEV (e.g., front-running a treasury liquidation by reordering
   the user's stop-loss).
3. **Front-running**: bundler observes user's vote-yes userOp and
   submits their own vote-no on the same round to influence the outcome
   (relevant for narrow-margin votes).
4. **Replay**: ERC-4337 nonces in EntryPoint prevent direct replay of
   the same userOp twice — `_validateAndUpdateNonce` increments the
   nonce inside `validateUserOp`. So a captured userOp cannot be re-used
   after EntryPoint processes it. Cite:
   `lib/account-abstraction/contracts/core/EntryPoint.sol:_validateAndUpdateNonce`.

**Blast radius.**

- Bounded — bundler cannot author new actions, only manipulate the
  ordering / inclusion of user-authored ones.
- For high-stakes timing-sensitive actions (round votes near a tight
  threshold), bundler can influence outcomes.

**Current mitigation (post-spec-007).**

- **EntryPoint nonces** prevent userOp-level replay.
- **Phase A's bundler-envelope signature** (`AgentAccount.executeFromBundler`)
  does NOT prevent bundler dishonesty about ordering — it only proves
  the bundler authored the relay envelope.
- **Multiple bundlers**: ERC-4337 is permissionless at the EntryPoint
  layer. A user can submit through any bundler. Smart Agent's
  default deployment runs ONE bundler; this is a deployment choice and
  is a single point of failure for censorship resistance.

**Residual risk.**

- **MEV / reordering / front-running**: ERC-4337 has the same MEV
  concerns as L1. Mitigations require external infrastructure (private
  mempools, MEV-Boost-style searcher segregation) that are out of scope
  for Smart Agent's own substrate.
- **Single bundler in dev**: a deployment with only one bundler can be
  censored by that bundler. Long-term, Smart Agent's deployment topology
  should permit user-side bundler choice.

**Detection.** Bundler latency / inclusion-rate metrics. Out-of-band
"can my userOp be included by an alternative bundler" test.

**Recovery.** Switch to an alternative bundler. Smart Agent's own
bundler implementation is open-source; users can self-host.

---

### A15 — Network attacker (TLS MITM, BGP hijack)

**Pre-condition.** Attacker can intercept TLS traffic between any two
Smart Agent services OR between a user's browser and apps/web.
Mechanism: BGP hijack, compromised certificate authority, on-path
device with valid (mis-issued) certificate.

**Attack mechanic.**

1. Attacker intercepts user → apps/web traffic.
2. Attacker reads session cookies (TLS makes this hard; mis-issued cert
   makes it possible). If they have the cookie, they're A4-equivalent
   for the user's web session.
3. Attacker intercepts a2a-agent → person-mcp traffic.
4. Attacker reads request bodies (PII) and MAC headers — but cannot
   forge MACs without KMS access.
5. Attacker can **strip / corrupt** requests, causing apparent failures
   — DoS only.

**Blast radius.**

- Confidentiality breach via TLS read.
- DoS via request stripping.
- No authority forgery (MACs are independent of TLS).

**Current mitigation (post-spec-007).**

- **TLS with valid certs from a reputable CA**. CT log monitoring
  (`[OPEN]`).
- **HSTS** on apps/web (`[OPEN]` — confirm in `next.config.ts`).
- **MAC inside TLS** — the canonical-v2 MAC is independent of TLS;
  even a perfect TLS MITM cannot forge a MAC.
- **Cert pinning** — not deployed today; `[OPEN]`. Lower priority
  because Smart Agent is browser-served and cert pinning in browsers is
  deprecated (HPKP). For service-to-service hops, mTLS with private CA
  is a future option.

**Residual risk.**

- **TLS confidentiality** depends on PKI integrity. A nation-state
  adversary with CA access can MITM.
- **Browser cert chains** — if the user's browser trusts a
  attacker-controlled CA (corporate proxy, malware), apps/web traffic
  is readable.

**Detection.** CT log monitoring; user-reported certificate anomalies;
network-level anomaly detection.

**Recovery.** Issue new certificates; revoke compromised ones via OCSP /
CRL; notify users.

---

### A16 — State-level adversary

**Pre-condition.** A state actor with legal compulsion power over the
KMS vendor, the hosting provider, or Smart Agent operators. Examples:
US-issued subpoena, foreign-government national security letter, court
order to disclose decryption keys.

**Attack mechanic.**

1. State compels disclosure of the master KMS key plaintext via the
   vendor. AWS / GCP have published transparency reports — they DO
   honour valid legal orders.
2. State compels disclosure of historical session packages (KMS-encrypted
   ciphertext + corresponding KMS Decrypt).
3. State compels operators to install backdoor code in a future release.

**Blast radius.**

- A2 + A3 + A6 + A10 + A11 combined, plus the inability to detect or
  resist.

**Current mitigation (post-spec-007).**

- **Jurisdiction choice**: KMS key residency (AWS region or GCP location)
  is an operational decision. Smart Agent's prod deployment is in `us-east-2`
  (typical Vercel + AWS US default) — subject to US legal orders.
- **Substrate-independence (P1)** means we can choose a different
  vendor / jurisdiction; we don't depend on Privy / MetaMask. But the
  user-held keys (passkeys, EOAs) still live wherever the user lives.
- **No master key holds user authority** (Phase A). State compulsion
  of master = state can't author user actions; they can read MCP data,
  not act as users.

**Residual risk.**

- **Confidentiality of MCP data is not state-resistant.** PII in
  person-mcp is readable if the state can compel decryption.
- **Future code changes** can be compelled. Mitigation: open-source
  Smart Agent so a backdoor would be visible in the public repo (this
  is the long-term plan; today the substrate is private).
- **Persona-level metadata** (e.g., AnonCreds link secrets) is at risk
  even if user keys are not.

**Detection.** Warrant canary (operator publishes regular "we have not
been served a legal order" statement; absence is signal). Not a
defence; signaling only.

**Recovery.** Move infrastructure to a different jurisdiction. Notify
users.

---

## 3. Cross-class attack chains

These compound scenarios are not exhaustive but cover the realistic
high-impact chains the threat model needs to address explicitly.

### C-chain-1: A14 (malicious bundler) + A3 (master key compromise)

**Question**: can the bundler exploit master compromise to mint fake
MACs?

**Walkthrough**:

1. Bundler operator is dishonest (A14) — controls submission order +
   inclusion.
2. Master key is compromised separately (A3) — attacker has KMS Sign on
   the master CMK + GenerateMac on the master HMAC keys.
3. Attacker (with master) signs `BUNDLER_ENVELOPE` for a userOp with
   forged inner sig. The userOp's inner sig must still recover to an
   owner; master is not in `_owners` post-Phase-A. The userOp fails at
   `_validateSig` / `executeFromBundler.InvalidInnerSignature`.
4. Attacker can sign valid inter-service MACs (A3 capability). With the
   bundler-operator collusion, the attacker can **deliver malicious
   MAC-bearing requests directly to MCPs** without going through the
   public a2a-agent route — the MCPs verify the MAC and accept. This
   gives MCP-side data exfiltration AND write capability (e.g., plant
   a session row).
5. But to USE the planted session, the attacker still needs an inner
   userOp sig that recovers to an owner. They don't have one.

**Outcome**: bundler + master compromise = MCP data exfiltration +
session-store pollution + DoS, but NOT user authority forgery.

**Mitigation**: per-MCP MAC partitioning means the bundler-master
collusion doesn't multiply blast radius across MCPs beyond what A3
alone provides.

### C-chain-2: A12 (CI/CD compromise) + A13 (upgrade authority)

**Question**: can a CI compromise weaponise a user's upgrade authority?

**Walkthrough**:

1. CI compromise (A12) lands malicious `AgentAccount` v3.0.0
   implementation as the new factory's `accountImplementation` (for
   future accounts) AND/OR releases a malicious apps/web bundle that
   prompts users to sign an UPGRADE digest.
2. Users approve the upgrade prompt (A13 mechanic: they sign whatever
   the UI shows).
3. Users' accounts are upgraded to malicious impl.

**Outcome**: catastrophic — every user who runs the upgrade is owned.

**Mitigation**:

- **Code review on CI artefacts** (signing of release commits + SBOM).
- **Upgrade timelock** (`[OPEN]`) — between user signature and effective
  upgrade, a window during which the user can revoke.
- **Watcher service** that publicly emits "your account was upgraded at
  block X" to a side-channel (email, Telegram) so the user notices.

### C-chain-3: A9 (web XSS) + A4 (user EOA capture)

**Question**: the typical phishing chain.

**Walkthrough**:

1. Attacker XSS-injects apps/web (A9) OR phishes user onto attacker
   domain that mimics apps/web.
2. User logs in via demo EOA flow (A4 vector: server-stored EOA
   privateKey).
3. Attacker reads privateKey from web DB if they have web compromise
   (A9 + DB access via server action) — or harvests it from the user's
   browser state if they have JS access.
4. Attacker uses the EOA to sign any action.

**Outcome**: one user fully owned.

**Mitigation**:

- Demo EOAs are dev-only. Production users use passkeys (A5 vector, not
  A4). Passkey phishing is significantly harder because of WebAuthn
  origin binding.
- Server actions that need the EOA are scoped — `apps/web/src/lib/ssi/signer.ts`
  is the chokepoint; an XSS in unrelated UI doesn't reach it.

### C-chain-4: A10 (Postgres) + A11 (GraphDB)

**Question**: full off-chain state compromise.

**Walkthrough**:

1. Attacker has DB write on Postgres (A10) AND GraphDB credentials
   (A11).
2. Attacker plants fake data in BOTH stores consistently — the
   GraphDB mirror matches the (corrupted) DB.
3. Apps/web reads from both, finds them consistent, displays
   attacker-shaped trust graph.

**Outcome**: confidence-attack — users see false data and make
decisions on it. NO direct asset loss because on-chain is unaffected.

**Mitigation**:

- **On-chain reconciliation jobs** — Phase H should add periodic GraphDB
  → on-chain reconcile; mismatch = alarm.
- **Audit-chain external anchor** for Postgres audit rows (Sprint 5
  W2).
- Both DBs require independent compromise; a single host compromise
  doesn't suffice.

### C-chain-5: A1 (bundler) + A2 (session-issuer)

**Question**: can both compromised system keys enable user
impersonation?

**Walkthrough**:

1. Attacker has bundlerSigner key (A1) and sessionIssuer key (A2).
2. Attacker constructs a userOp:
   - sender = Maria's AgentAccount
   - inner sig = attacker's choice
3. With bundlerSigner, attacker signs the `BUNDLER_ENVELOPE` digest.
4. With sessionIssuer, attacker signs whatever sessionIssuer is supposed
   to sign at session-init.
5. They submit. **What gates does the userOp face?**
   - `executeFromBundler`: bundler sig OK. **Inner sig must still
     recover to an owner** (`AgentAccount.sol:381-383`). Master, bundler,
     session-issuer are NONE in `_owners`. The userOp reverts with
     `InvalidInnerSignature`.
   - Alternative path via standard `validateUserOp`: same gate. Inner
     sig must recover to owner. Attacker has no owner key.
6. The attacker cannot register a session via `acceptSessionDelegation`
   either, because that's `onlySelf` (`AgentAccount.sol:311`) — requires
   a userOp signed by an owner, which the attacker doesn't have.

**Outcome**: **bundler + session-issuer compromise = no user authority**.
Both keys can be lost without compromising any user's account.

**This is exactly the Phase A design intent**. The test plan in
`phase-A-contract-role-split.md:402-414` covers tests
`test_BundlerCannotSignAsOwner` and `test_SessionIssuerCannotMintWithoutOwnerAuth`
as the load-bearing acceptance criteria.

**Mitigation**: built into Phase A; no additional work needed if Phase
A lands as designed.

---

## 4. Open questions / accepted residual risks

This section lists everything in the model that is NOT fully mitigated
and the rationale.

### Accepted residual risks (documented; reviewer should confirm acceptance)

| # | Risk | Acceptance rationale |
|---|---|---|
| R1 | A4 (single user EOA compromise) is not recoverable without social-recovery infrastructure. | Recovery primitives (guardian, recovery EOA, time-delayed `addOwner`) are out of scope for spec 007. Per-user blast radius is the architectural defence. |
| R2 | A14 (malicious bundler) MEV / reordering risks are inherent to ERC-4337 and not contained by Smart Agent's substrate. | Multi-bundler permissionlessness is the long-term mitigation; v1 deploys with one bundler. |
| R3 | A15 (TLS MITM) confidentiality risk depends on the broader TLS PKI. | Industry-standard mitigations (CT logs, HSTS) are applied; cert pinning is not feasible in browsers. |
| R4 | A16 (state-level adversary) can compel MCP-data decryption via KMS vendor compulsion. | Jurisdiction choice + warrant canary are operational mitigations. User authority is not state-compellable because user keys live outside the operational KMS. |
| R5 | A6 (KMS account compromise) gives attacker MCP-data exfiltration via the K2 KEK Decrypt grant. | The K2 KEK is partitioned from user-authority KMS keys; the Decrypt grant is held by a2a-agent only. Phase G should add a property test asserting that no MCP holds K2 Decrypt directly. |

### Open questions surfaced by this analysis

These are NOT in spec 007's scope; they need explicit decisions before
the external audit:

| # | Question | Where surfaced | Recommendation |
|---|---|---|---|
| Q1 | Bundler / session-issuer KMS key rotation for EXISTING accounts (factory-pinned). | A1 § Recovery, A2 § Recovery | Either (a) add `AgentAccount.setFactory(newFactory)` gated by user owner sig, or (b) accept fresh-start as the rotation strategy (acceptable while there are no prod accounts; revisit before mainnet). |
| Q2 | Exact role of `sessionIssuer` co-signature in Variant B. Audit-only or load-bearing? | A2 § Residual risk | Lock in Phase B § 4. Recommend audit-only with the sessionIssuer pubkey bound into the digest the user signs (so user can later verify "yes, this session was minted under sessionIssuer X"). |
| Q3 | Add `upgradeToWithAuthorization` to the `@sa-risk-tier critical` registry so it forces Variant B at session-init. | A13 § Current mitigation | Add to `apps/a2a-agent/src/lib/risk-tiers.ts` upon Phase B landing. |
| Q4 | Upgrade timelock for AgentAccount. | A13 § Residual risk, C-chain-2 mitigation | Add optional `pendingUpgrade` state with N-block delay; user opts in at account creation. |
| Q5 | Human-readable confirmation UI for high-stakes signing (the WebAuthn opaque-challenge problem). | A9 § Current mitigation, A13 § Residual risk | Phase H+ UX work; surface to UI Designer. |
| Q6 | CSP / SRI / HSTS baseline. | A9 § Current mitigation | Phase H IaC includes hardened security headers; audit `apps/web/next.config.ts` for current posture. |
| Q7 | WebAuthn `signCount` monotonicity check. | A5 § Detection | Low-cost hardening; add to `_verifyWebAuthn` and store latest signCount in passkey storage. |
| Q8 | WebAuthn attestation verification. | A5 § Residual risk | Higher cost; consider for high-stakes user populations only. |
| Q9 | Audit-chain external anchor cadence. | A10 § Residual risk | Document the cadence in Phase H runbook; recommend ≤ 1h. |
| Q10 | GraphDB integrity anchor. | A8 § Residual risk | Phase H+ deliverable; periodic Merkle-root of named-graph triples published to chain. |
| Q11 | Property test: no MCP holds K2 KEK Decrypt grant. | A6 § Residual risk | Phase G CI guard. |
| Q12 | Paymaster sponsorship gating. | A1 § Residual risk, spec 007 Phase B § B3 | Lock paymaster policy in Phase H; require AnonCreds marketplace credential as the gate. |
| Q13 | CI principal least-privilege audit. | A12 § Residual risk | Phase H IaC review. |
| Q14 | "What is sent to GraphDB?" SHACL shape rejects PII literals. | A11 § Residual risk | Phase H+ T-Box work via Ontologist. |
| Q15 | Single-bundler deployment topology. | A14 § Residual risk | Long-term: deploy with multi-bundler redundancy; v1 acceptable for non-mainnet. |
| Q16 | Sessions per user upper bound (related to A4 blast radius for compromised owner). | A4 § Recovery | Considered in C2 § 4 — recommended `MaxDelegationsPerPeriodEnforcer` caveat. |

### Explicitly NOT mitigated (security theatre would say otherwise)

- **A4/A5: per-user catastrophe is not preventable** at the substrate
  layer. User-key custody hygiene is user responsibility; the substrate
  ensures the blast radius is per-user.
- **Quantum threat to current ECDSA / WebAuthn / AnonCreds**. Addressed
  in C3 — migration plan exists, but no code yet.
- **Insider threat** — operator with legitimate access. Mitigated by
  least-privilege IAM + audit log review; no architectural defence
  against a malicious operator.

---

*End of C1.*
