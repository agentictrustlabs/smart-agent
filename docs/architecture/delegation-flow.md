# Delegation flow — web → a2a-agent → mcp

How a user authorizes the system to act on their behalf for resource
access, and what a2a-agent's session management does at each step.

This is a quick-read overview of the architecture documented in:

- `output/delegation-architecture-tradeoffs.md` — design + options
- `output/delegation-implementation-plan.md` — implementation plan
- `output/phase1-delegation-summary.md` — Phase 1 shipped (one-hop)
- `output/phase2-delegation-summary.md` — Phase 2 shipped (two-hop)
- `output/CHAINED-DELEGATION-RESTORATION-PLAN.md` — unwind of recent drift

---

## TL;DR

**The user signs ONE root delegation off-chain. That delegation grants
the a2a-agent's per-session key authority to act on the user's behalf,
under a set of caveats the user explicitly approved (allowed
contracts, allowed function selectors, time window, value cap, allowed
MCP tools).**

For low-value MCP tools, the session key directly redeems the user's
delegation on chain. For high-value tools, the a2a-agent mints a
per-call sub-delegation to a per-tool-family executor identity that has
even narrower authority + single-use semantics + tool-specific audit.

The user pays no gas. The a2a-agent's relay-only signer covers the
gas; it NEVER signs user-authority bytes. MCPs hold no signing keys.

---

## The principals

```
┌─────────────────────────────────────────────────────────────────────┐
│  USER                                                                │
│  AgentAccount (smart-account address). Owns funds, signs delegations.│
│                                                                      │
│   ▼   ONE off-chain D_root, signed via ERC-1271                      │
│       (passkey / SIWE / demo EOA — whichever the user holds)         │
│       Caveats committed in this signature:                           │
│         • Timestamp(validAfter, validUntil)                          │
│         • AllowedTargets(union of contracts MCPs may call)           │
│         • AllowedMethods(union of 4-byte selectors MCPs may call)    │
│         • ValueEnforcer(maxValue — usually 0n, no ETH outflow)       │
│         • McpToolScopeEnforcer(union of MCP tool names)              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  A2A-AGENT                                                           │
│  Holds the per-session signing key (EOA, encrypted at rest).         │
│  The session key IS a2a-agent's local authority FOR THIS USER        │
│  SESSION. a2a-agent has no global signing identity.                  │
│                                                                      │
│  Also holds:                                                         │
│   • a relay-only signer (pays gas; cannot sign user-authority bytes) │
│   • per-tool-family executor identities (Phase 2; one EOA per family)│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  MCP SERVER (org-mcp / person-mcp / hub-mcp / …)                    │
│  Holds NO signing keys.                                              │
│  Has HMAC keys for inter-service authentication to a2a-agent.        │
│  Validates inbound delegation JWTs (ERC-1271 + caveat enforcement).  │
│  For on-chain ops: forwards to a2a-agent's stateless-redeem endpoint.│
└─────────────────────────────────────────────────────────────────────┘
```

---

## Step-by-step flow

### Step 1 — Web app initiates a session

```
USER (in browser)                              A2A-AGENT
─────────────────                              ─────────
                                               
clicks "Connect" / passkey-login    ──────►    POST /session/hybrid-init
                                                 - generate fresh session keypair
                                                 - classify risk tier from scope
                                                 - build D_root delegation draft
                                                 - return signing payload (EIP-712)
                                                 
signs the EIP-712 payload           ──────►    POST /session/hybrid-finalize
   (passkey / EOA / demo key)                    - verify user's signature via ERC-1271
                                                 - encrypt the session package
                                                   (sessionPrivateKey + signed D_root)
                                                 - fund the session key with ETH from
                                                   the relay-only signer (gasless;
                                                   relay pays gas only, MUST NOT
                                                   sign user-authority bytes)
                                                 - persist session row (status=active)
                                                 - return a session cookie + cookie-bound
                                                   handle to the encrypted package
                                                   
session cookie set in browser       ◄──────    
```

**What the session row stores in a2a-agent's DB:**

```
sessions {
  id                        sa_<uuid>
  accountAddress            user's smart-account address
  sessionKeyAddress         session EOA address
  encryptedPackage          AES-GCM(sessionPrivateKey + signed D_root)
                            wrapped under a KMS data-key
  iv, encryptedDataKey,     standard KMS envelope metadata
  keyVersion, kmsKeyId
  variant                   'A' (low/medium risk) or 'B' (high/critical)
  riskTier                  'low' | 'medium' | 'high' | 'critical'
  expiresAt                 ISO timestamp (clamped per tier)
  sessionDelegationHash     keccak256 of D_root (for Variant B on-chain accept)
  status                    'pending' (init) → 'active' (finalize) → 'expired'
}
```

The encrypted package is the ONLY place the session private key + the
signed D_root exist. Everything else in the session row is metadata.

### Step 2 — Web action calls an MCP tool

```
WEB SERVER                          A2A-AGENT (proxy)              MCP SERVER (org-mcp)
──────────                          ────────────────              ────────────────────
                                                                  
server action handles a click                                     
  e.g. recordOutcome(...)                                         
                                                                  
fetch /mcp/org/commitment:record_outcome
  Authorization: Bearer <sessionCookie>
  Body: { ...args }              ────►  POST /mcp/org/<tool>
                                          requireSession middleware
                                            decrypts the session package
                                          
                                          mints a DelegationToken (JWT) carrying:
                                            v: 3, alg: 'session-ecdsa'
                                            iss: 'smart-agent-a2a'
                                            aud: 'urn:mcp:server:org'
                                            sub: user.smartAccount
                                            sessionKeyAddress
                                            delegation: D_root (delegator, delegate,
                                                       caveats, signature)
                                            jti: per-call UUID
                                            usageLimit, exp
                                          
                                          signs the JWT canonical string with
                                          sessionPrivateKey (Layer 1 ECDSA)
                                          
                                          POST <mcpServer>/tools/<tool>
                                            Body: {
                                              tool, args + token,
                                              _a2aSessionId (for back-call)
                                            }
                                            Headers: HMAC-SHA-256 envelope
                                              over (ts | nonce | path | sha256(body))
                                              under A2A_INTERSERVICE_HMAC_KEY_<mcp>
                                            ────►  org-mcp:
                                                     requireInboundServiceAuth (HMAC OK)
                                                     verifyDelegationAndExtractOrgPrincipal:
                                                       1. ECDSA recover session signer
                                                          (must match claims.sessionKeyAddress)
                                                       2. ERC-1271 verify D_root.signature
                                                          against claims.delegation.delegator
                                                          (the user's smart account)
                                                       3. DM.isRevoked(hash(D_root)) check
                                                       4. caveat-evaluator fail-closed dispatch
                                                          over D_root.caveats
                                                          (timestamp, targets, methods,
                                                           value, mcpToolScope, …)
                                                       5. atomic jti usage tracking
                                                          (replay defense)
                                                     execute the tool's handler.
```

What this gives the MCP:
- `orgPrincipal` (= the delegator = the user's smart-account address). 
  This is the identity the MCP knows is acting.
- A guarantee the user explicitly authorized THIS tool (mcpToolScope caveat).
- A guarantee the time window is still open (timestamp caveat).

### Step 3a — Pure off-chain MCP tool (e.g. `commitment:list`)

The MCP handler reads / writes its own DB or a remote system, scoped
by the verified `orgPrincipal`. No on-chain submission. Returns to web.

### Step 3b — Low-value on-chain tool (Phase 1 — `commitment:record_outcome`, `pool:open`, etc.)

```
MCP SERVER (org-mcp)                A2A-AGENT
────────────────────                ─────────

mcpToolPolicy['commitment:record_outcome']
  executionPath = 'stateless-redeem'

build the inner calldata:
  CommitmentRegistry.recordOutcome(
    commitmentSubject, outcomeIdHash, evidenceHash,
  )

callA2aRedeem(sessionId, {
  mcpTool, mcpCallId, a2aTaskId?, target, value, callData
})  ───── HMAC-signed ───────────►  POST /session/:id/redeem-via-account
                                      requireInterServiceAuth (HMAC OK)
                                      look up session, decrypt package
                                      policy lookup: TOOL_POLICIES[mcpTool]
                                        - must exist
                                        - must be executionPath='stateless-redeem'
                                        - target ∈ resolveTargetAddress(policy)
                                        - selector(callData) ∈ policy.allowedSelectors
                                      
                                      build viem wallet from sessionPrivateKey
                                      
                                      insert ExecutionReceipt(status='pending')
                                      
                                      submit on chain:
                                        DM.redeemDelegation(
                                          [D_root], target, value, callData
                                        )
                                        msg.sender = sessionKey = D_root.delegate ✓
                                        gas paid by sessionKey (funded by relay)
                                      
                                      DM runs the on-chain caveat enforcers
                                      (same caveats as off-chain, defense-in-depth)
                                      
                                      DM calls delegator.execute(target, value, data)
                                        msg.sender = user.smartAccount at the target
                                      
                                      wait for receipt
                                      finalize ExecutionReceipt(status, txHash, …)
                                      
                            ◄────  { txHash, executionReceiptId }
return to web                       
```

### Step 3c — High-value on-chain tool (Phase 2 — `pool:close`, `round:close`, `round:set_awards_root`, etc.)

```
MCP SERVER (org-mcp)                A2A-AGENT
────────────────────                ─────────

mcpToolPolicy['round:set_awards_root']
  executionPath = 'sub-delegated'
  toolFamily    = 'ROUND_AWARDS'

callA2aRedeemSubDelegated(sessionId, {
  mcpTool, mcpCallId, a2aTaskId, target, value, callData
})  ───── HMAC-signed ───────────►  POST /session/:id/redeem-subdelegated
                                      same auth + policy as above
                                      
                                      resolve per-tool-family executor:
                                        getExecutorForTool('round:set_awards_root')
                                        → ROUND_AWARDS family executor EOA
                                      
                                      mint D_sub (off-chain):
                                        delegator = sessionKey      (D_root.delegate)
                                        delegate  = executor.address (leaf at redeem)
                                        authority = hash(D_root)
                                        caveats   = [
                                          Timestamp(now, now+60),     # 60s window
                                          AllowedTargets([target]),   # single target
                                          AllowedMethods([selector]), # single selector
                                          Value(body.value),
                                          CallDataHash(keccak256(callData)),  # locks to one call
                                          TaskBinding(keccak256(a2aTaskId)),   # audit tag
                                        ]
                                        salt = random 8 bytes
                                      
                                      sign D_sub with sessionPrivateKey
                                      
                                      insert ExecutionReceipt
                                        executionPath='sub-delegated'
                                        toolGrantHash=hash(D_sub)
                                        toolExecutor=executor.address
                                      
                                      submit on chain FROM executor.address:
                                        DM.redeemDelegation(
                                          [D_sub, D_root], target, value, callData
                                        )
                                        msg.sender = executor = D_sub.delegate ✓
                                        DM walks the chain leaf→root:
                                          D_sub validated against D_root via authority
                                          both signature chains verified
                                          all caveats enforced (chained)
                                      
                                      post-submit: DM.revokeDelegation(hash(D_sub))
                                        single-use semantics — D_sub can never be reused
                                      
                            ◄────  { txHash, executionReceiptId, toolGrantHash, toolExecutor }
```

What Phase 2 buys you over Phase 1:

- **Per-call narrow grant.** Even with a stolen session key, the attacker can
  only redeem calls they already signed; D_sub is locked to a specific
  (target, selector, calldata-hash, value, 60s window) tuple.
- **Per-tool identity.** Cryptographic audit — which executor signed which
  call, mapped to which tool family.
- **Single-use.** Post-submit revocation makes replay impossible.

---

## What a2a-agent's session management is doing in this flow

1. **Issuance.** `/session/hybrid-init` is where the user signs the
   one-time D_root authorization. The user reviews caveats in a UI
   surface before signing; once signed, the user's commitment is bounded
   by those caveats forever (cannot be widened, even by the a2a-agent).
2. **Custody.** The session private key + the signed D_root are
   encrypted under a KMS data-key with AAD bound to
   `(sessionId, accountAddress, chainId, expiresAt, keyVersion)`. Any
   drift in those fields makes decrypt fail closed.
3. **Gas sponsorship.** The relay-only signer pre-funds the session key
   so the user pays no gas for redemptions. The relay's authority is
   strictly "pays gas"; it never signs user-authority bytes (the
   `_RELAY_ONLY_SIGNER_NEVER_AUTHENTICATES` invariant).
4. **Lifecycle.** Status transitions: `pending` (init) → `active`
   (finalize) → `expired` (TTL hit) / `revoked` (admin / user / replay).
   Risk-tier clamps the maximum TTL.
5. **Token minting.** Every MCP call gets a freshly-minted DelegationToken
   JWT with a unique `jti` for replay defense + a per-MCP audience claim.
6. **Stateless redeem proxy.** `/session/:id/redeem-via-account` is the
   single on-chain entrypoint for MCPs. MCPs never sign anything; they
   pass intent (target + calldata) and a2a-agent's session key submits.
7. **Sub-delegated redeem proxy.** `/session/:id/redeem-subdelegated`
   mints per-call D_sub for the four per-tool-family executors
   (`ROUND_AWARDS`, `DISBURSEMENT`, `POOL_LIFECYCLE`, `GRANT_AWARDS`).
8. **Audit.** Every redeem (success or failure) lands a row in
   `execution_audit` with `(rootGrantHash, sessionId, mcpTool, mcpCallId,
   executionPath, toolGrantHash, toolExecutor, target, selector,
   callDataHash, txHash, status, errorReason)` — full cross-service trail.

---

## Variant A vs Variant B (Spec 007 Phase B addition)

Variant A (low + medium risk scopes) ships D_root off-chain only.
Faster setup; same on-chain redeem path.

Variant B (high + critical risk scopes) ALSO registers `hash(D_root)`
on chain at session-init via `AgentAccount.acceptSessionDelegation`. This
takes one userOp through EntryPoint at init time (paymaster-sponsored).
Subsequent redeems still use D_root the same way — the on-chain
registration is an additional safety check at the caveat-enforcer level.

Both variants use the same redemption pipeline. Variant B is additive,
not a replacement.

---

## The boundary rules (to prevent drift)

1. **`delegate == claims.sub` is NOT an invariant.** Anywhere you see a
   check like that, it's drift — delete it. The valid chain shapes are
   `D_root.delegate = sessionKey` (Phase 1) and `D_sub.delegate =
   executor` (Phase 2).
2. **MCPs hold no signing keys.** Only HMAC for inter-service auth.
3. **The session key IS a2a-agent's per-user authority.** No global
   master signer. The relay-only signer pays gas and nothing else.
4. **One user signature, fan-out of caveat-checked calls.** The user
   signs D_root once. Every redemption picks up D_root's caveats; D_sub
   layers narrower caveats on top.
5. **The off-chain caveat evaluator and the on-chain enforcers run the
   SAME checks.** Defense in depth: a bug in one is caught by the other.

---

## File map (where each piece lives)

| Concern | File |
|---|---|
| User-side delegation mint | `apps/web/src/lib/actions/a2a-session.action.ts` |
| Session-init endpoint | `apps/a2a-agent/src/routes/session-init.ts` |
| Stateless-redeem endpoint | `apps/a2a-agent/src/routes/onchain-redeem.ts` |
| Sub-delegated redeem endpoint | `apps/a2a-agent/src/routes/onchain-redeem.ts` (`redeem-subdelegated`) |
| MCP proxy + JWT mint | `apps/a2a-agent/src/routes/mcp-proxy.ts` |
| Session encryption | `apps/a2a-agent/src/auth/encryption.ts` (KMS-backed) |
| Relay-only signer | `apps/a2a-agent/src/auth/a2a-signer.ts` (`getRelayOnlySigner`) |
| Tool-family executors | `apps/a2a-agent/src/lib/tool-executors.ts` |
| Tool policy registry | `packages/sdk/src/policy/tool-policies.ts` |
| Off-chain caveat evaluator | `packages/sdk/src/policy/caveat-evaluator.ts` |
| MCP-side verify | `apps/<mcp>/src/auth/verify-delegation.ts` (one per MCP) |
| SDK JWT verify | `packages/sdk/src/delegation-token.ts` |
| On-chain caveat enforcers | `packages/contracts/src/enforcers/` (15 contracts) |
| On-chain DelegationManager | `packages/contracts/src/DelegationManager.sol` |
| AgentAccount (user) | `packages/contracts/src/AgentAccount.sol` |
