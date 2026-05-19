# Phase B — A2A Signer Model (Hybrid Session Flow)

> **Status**: ✅ Implemented (2026-05-18). All 46 new Phase B tests pass;
> 504/504 forge tests (Phase A + A.5) still green; pnpm typecheck clean
> across the workspaces Phase B touched (sdk, a2a-agent, web).
> See `IMPLEMENTATION_NOTES.md` § Phase B for divergences.
> **Depends on**: Phase A (`bundlerSigner` + `sessionIssuer` exist on chain;
> AgentAccount supports both Variant A and Variant B delegation paths).
> **Unblocks**: Phase C (web side can rely on the session-key signing path).

## Summary

`apps/a2a-agent/src/routes/onchain-redeem.ts:639–651` currently signs the
inner userOp signature with the master EOA — this works today only
because master is a co-owner of every account (M-1 of the audit). After
Phase A drops co-ownership, this site will fail validation. Phase B
implements the **hybrid session flow**:

- A new `POST /session/init` endpoint accepts a `scope` declaration,
  classifies risk tier, and routes to Variant A (off-chain caveated
  delegation) or Variant B (on-chain delegation registration).
- Variant A: user signs an EIP-712 caveated delegation; a2a-agent stores
  it (encrypted) in person-mcp's `session_store`. At action time,
  `onchain-redeem.ts` submits a userOp that calls
  `DelegationManager.redeemDelegation(...)`.
- Variant B: a2a-agent builds a delegation + register-on-chain userOp;
  the user signs the userOp; a2a-agent submits via EntryPoint.
- Master signs the relay envelope only (`handleOps` outer tx); master
  is never the inner authority signer.

## Goals

1. Inner `userOp.signature` recovers to a user (passkey, EOA) or to a
   session-key whose authority traces to a user-signed delegation
   (Variant A redemption OR Variant B on-chain registration).
2. `getMasterSigner()` in `onchain-redeem.ts` is reachable only by the
   `writeContract({ functionName: 'handleOps', ... })` relay path, not
   by any signing path that determines authority.
3. The session-init endpoint correctly classifies risk tier and never
   silently downgrades a high-risk request to Variant A.
4. The route exposes the same external API; clients don't see the
   internal Variant A/B routing.
5. No silent fallback: if neither a user signature nor a valid session
   delegation is presentable, the route returns 401 — never master-signs
   the userOp as a fallback.

## Concrete deliverables

### 1. `apps/a2a-agent/src/routes/session-init.ts` (new file)

`POST /session/init` accepts a request body:

```ts
{
  user: { kind: 'passkey' | 'eoa' | 'demo-eoa', address: Address, ... },
  scope: ActionDescriptor[],   // declared action set (target + selector tuples)
  validUntil: number,
  metadata?: Record<string, string>
}
```

Flow:

1. Authenticate the inbound MAC (existing a2a-agent host context).
2. Generate a fresh session-key (secp256k1 EOA in v1; P-256 for passkey
   compat in v2).
3. Call `classifySessionRiskTier(scope)` (SDK helper, see below).
4. Branch:
   - **Variant A** (`low` / `medium`):
     - Build an EIP-712 `Delegation` struct (delegator = user account,
       delegate = session-key, caveats = [TimestampEnforcer,
       AllowedTargetsEnforcer, AllowedMethodsEnforcer, ValueEnforcer]
       derived from scope + validUntil).
     - Return the EIP-712 signing payload to the web client.
     - The client collects the user signature (passkey prompt or EOA
       signMessage), POSTs the signed delegation back to
       `POST /session/init/finalize`.
     - a2a-agent stores the signed delegation encrypted (KMS envelope)
       in person-mcp `session_store` via `personMcp.upsertSession(...)`.
     - Returns a `sessionId` to the client.
   - **Variant B** (`high` / `critical`):
     - Build a delegation struct AND a userOp whose calldata calls
       `DelegationManager.registerDelegation(delegation)` on chain.
     - Return the userOp + userOpHash to the web client for the user to
       sign (passkey or EOA against `userOpHash`).
     - Client POSTs the signed userOp back; a2a-agent submits via
       EntryPoint with master as bundler-relayer.
     - On success, returns a `sessionId` keyed to the on-chain
       delegation hash.

Audit-row written for both variants: `session_id`, `variant`,
`risk_tier`, `delegate_address`, `validUntil`, `scope_hash`,
`onchain_tx_hash` (Variant B only).

### 2. `apps/a2a-agent/src/routes/onchain-redeem.ts` (rewritten)

Rewrite `:609–700`. The route now:

1. Resolves the `sessionId` against person-mcp `session_store`.
2. Looks up the stored delegation (Variant A) OR the on-chain delegation
   hash (Variant B).
3. Builds the inner userOp whose calldata is the requested action.
4. Signs the inner userOp with the **session-key** (the EOA generated at
   session-init; private key held in person-mcp encrypted KMS envelope,
   released only for signing through the existing key-custody helper).
5. For Variant A: wraps the action's calldata as
   `DelegationManager.redeemDelegation(delegation, userSig, mode,
   executions)`. The userOp's inner signature is the session-key's; the
   `userSig` field inside the redemption call is the user's delegation
   signature stored at session-init.
6. For Variant B: action's calldata is the raw target call; on-chain
   delegation registration covers authority.
7. Submits the userOp via EntryPoint; master EOA is bundler-relayer and
   signs `handleOps` only (pays gas).

Pseudocode:

```ts
const session = await sessionStore.get(sessionId);
if (!session) return new Response('Session not found', { status: 401 });

const userOp = await buildUserOp({
  sender: session.userAccount,
  callData: session.variant === 'A'
    ? encodeRedeemDelegation(session.delegation, session.userSig, executions)
    : encodeExecute(executions),
});

const userOpHash = await getUserOpHash(userOp, entryPoint, chainId);
userOp.signature = await session.keyCustody.signUserOpHash(userOpHash);

await checkRevocationList(session); // off-chain revocation epochs (Variant A)

const relaySigner = getMasterSigner().relayOnly();
await entryPoint.write.handleOps([userOp], { account: relaySigner });
```

`getMasterSigner()` is restricted via `relayOnly()` flavor — attempting
`sign(userOpHash)` on the relay flavor throws "Master cannot sign user
authority — use a session key."

### 3. SDK helper — `packages/sdk/src/matchmaker/risk-tier.ts` (new file)

```ts
export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface ActionDescriptor {
  target: Address;
  selector: Hex;        // 4-byte function selector
}

export function classifySessionRiskTier(
  scope: ActionDescriptor[],
): RiskTier {
  let max: RiskTier = 'low';
  for (const action of scope) {
    const tier = lookupTier(action.target, action.selector);
    if (rank(tier) > rank(max)) max = tier;
  }
  return max;
}
```

`lookupTier()` consults the registry in `apps/a2a-agent/src/lib/risk-tiers.ts`
(see § Open questions).

### 4. `apps/a2a-agent/src/lib/risk-tiers.ts` (new file)

Single source of truth for action → risk-tier mapping. Derived from
route annotations at build time (a tiny generator script reads
`@sa-risk-tier` JSDoc comments on every route and emits a static map).
Format:

```ts
export const RISK_TIER_REGISTRY: Record<`${Address}:${Hex}`, RiskTier> = {
  '0xTreasury:0xa9059cbb': 'high',        // transfer
  '0xTreasury:0x40c10f19': 'critical',    // mint
  '0xOrg:0xf2fde38b': 'high',             // transferOwnership
  // ...
};
```

The registry is canonical. The classifier defaults to `low` for any
action not present, which means: **new actions must be classified
deliberately, and the missing-classification case fails open at session
init but fails closed at the caveat-enforcer level on chain** (per
Phase A § D2 Q5).

### 5. `apps/a2a-agent/src/auth/key-provider.ts` (modified)

Add `relayOnly()` flavor:

```ts
export interface RelayOnlySigner {
  account: Account;
  signMessage(): never;       // throws
  signTypedData(): never;     // throws
}

getMasterSigner().relayOnly(): RelayOnlySigner;
```

Calls to `sign(userOpHash)` on the relay flavor throw an intentional,
audited error labeled "Master cannot sign user authority — use a session
key." Phase G CI guard greps for `getMasterSigner()` not chained with
`.relayOnly()` and fails the build outside the known relay path.

### 6. SDK key-custody helper

`packages/sdk/src/key-custody/session-signer.ts` exports
`verifyAndSignWithSession(sessionPackage, userOpHash)` — returns the
inner signature derived from whatever credential the session package
carries (session-key for both variants); throws if the session is
revoked or expired.

## Tests

### Variant A round-trip — `phase-b-variant-a.integration.test.ts`

1. Client posts `/session/init` with low-risk scope.
2. Server returns EIP-712 signing payload.
3. Test signs with the user's EOA.
4. Client posts `/session/init/finalize`; receives `sessionId`.
5. Person-mcp `session_store` contains the encrypted delegation.
6. Client posts an action to `/onchain-redeem` with the session.
7. Userop lands on chain; on-chain delegation redemption succeeds via
   `DelegationManager`; action executes.
8. Audit row records `variant: 'A'`, `risk_tier: 'low'`,
   `inner_signer_kind: 'session-key'`.

### Variant B round-trip — `phase-b-variant-b.integration.test.ts`

1. Client posts `/session/init` with high-risk scope (e.g. treasury
   transfer).
2. Server returns a userOp + userOpHash to sign.
3. Test signs userOpHash with the user's EOA.
4. Client posts the signed userOp; a2a-agent submits via EntryPoint.
5. On-chain `DelegationManager.registerDelegation` succeeds.
6. Client posts the treasury-transfer action.
7. Subsequent action userOp validates via the on-chain delegation;
   action executes.
8. Audit row records `variant: 'B'`, `risk_tier: 'high'`,
   `onchain_tx_hash` populated.

### Risk-tier misclassification adversarial — `phase-b-misclass.integration.test.ts`

1. Build a Variant A session whose declared scope is low-risk.
2. Manually craft a userOp targeting a high-risk selector (skipping the
   web client's classifier).
3. Post to `/onchain-redeem`.
4. Expect: redemption fails. The failure source is either:
   - the off-chain policy gate in a2a-agent (early fail, returns 403); or
   - the on-chain caveat enforcer (`AllowedMethodsEnforcer` rejects),
     surfaced as a userOp revert.
5. Audit row records `outcome: 'rejected_high_risk_in_low_tier_session'`.

### Revocation flow — `phase-b-revocation.integration.test.ts`

Variant A: a session's revocation epoch is incremented in person-mcp's
`revocation_epochs` table. The next `/onchain-redeem` call rejects with
401 before any userOp is built.

Variant B: caller submits a userOp to
`DelegationManager.revoke(delegationHash)`. The next session action
fails on-chain at redemption (`DelegationManager` rejects revoked).

### Master-compromise isolation — `phase-b-master-compromise.integration.test.ts`

Rotate `A2A_MASTER_PRIVATE_KEY` mid-test (simulates compromise). Confirm:

- Existing user sessions (both A and B) still work — they don't depend
  on the master key for authority.
- The attacker-controlled master cannot sign for any account; attempts
  to call `signMessage` on the relay flavor throw; attempts to use the
  raw master EOA against EntryPoint fail because the inner signature
  doesn't recover to an owner.

## Acceptance criteria

- [ ] `grep -nA5 'getMasterSigner' apps/a2a-agent/src/routes/onchain-redeem.ts`
      shows master used only for `writeContract` (relay), never for
      `signMessage` / `signTypedData` against `userOpHash`.
- [ ] `apps/a2a-agent/src/routes/session-init.ts` exists; routes
      Variant A vs Variant B by `classifySessionRiskTier(scope)`.
- [ ] `apps/a2a-agent/src/lib/risk-tiers.ts` exists; populated from
      route annotations; tested.
- [ ] Variant A round-trip integration test passes.
- [ ] Variant B round-trip integration test passes.
- [ ] Risk-tier misclassification adversarial test passes (the bypass
      attempt is rejected — at the policy gate, the caveat enforcer, or
      both, per Phase A § D2 Q5 resolution).
- [ ] Revocation flow test passes for both variants.
- [ ] Master-compromise isolation test passes.
- [ ] Audit-log inspection on a demo flow shows distinct `variant` +
      `risk_tier` values, with `inner_signer_kind == 'session-key'` for
      every session-driven action.
- [ ] Maria can register, vote, propose, pledge, and honor via
      Variant A; a treasury-admin demo path uses Variant B and the
      audit row shows `onchain_tx_hash` at session-init.
- [ ] Fresh-start pre-mints exactly ONE Variant A session per demo user;
      no pre-minted Variant B sessions exist.

## Open questions

- **B1**: Who controls the high-risk action allowlist? **A (locked)**:
  `apps/a2a-agent/src/lib/risk-tiers.ts` is the canonical registry,
  generated at build time from route `@sa-risk-tier` annotations. A
  small codegen script (`scripts/gen-risk-tiers.ts`) parses every
  `apps/*/src/routes/**/*.ts` and emits the map. Hand-edits to the
  generated file fail CI.
- **B2**: For passkey users in stateless sessions, does the web client
  prompt the passkey at `/session/init` (Variant A) and again per
  action, or only once at session-init? **Proposed**: only once per
  session. The session-key holds authority within the caveated scope
  for the session's TTL.
- **B3**: For Variant B, the on-chain delegation registration costs gas
  paid by the user's account (via paymaster). What's the paymaster
  budget enforcement? **Deferred to Phase H / KMS initiative**: paymaster
  policy is its own surface; for v1 the paymaster sponsors session-init
  for accounts that have passed the existing AnonCreds gate.
- **B4 (referred from Phase A § D2 Q5)**: When a Variant A session
  attempts a high-risk action, is the authoritative failure at the
  caveat-enforcer (on-chain) or at a policy gate (off-chain in a2a-agent)?
  **Proposed**: caveat enforcer is authoritative; a2a-agent's off-chain
  check is an early-fail UX optimization. Both layers MUST reject; the
  test suite asserts both layers reject independently.
