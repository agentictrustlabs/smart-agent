# Tier 2 — DelegationManager redemption in org-mcp pool/round tools

Replaces the deployer-direct signing path with `DelegationManager.redeemDelegation`
backed by a user-signed chained delegation (D_onchain). The user's AgentAccount
becomes the cryptographic root of every pool/round on-chain mutation; org-mcp
holds no privileged signing capability over user pools.

## Files touched

### T2.1 — D_onchain mint and threading

- `apps/web/src/lib/auth/onchain-delegation-constants.ts` (NEW) — cookie name
  (`sa_onchain_delegation`) and TTL (24h).
- `apps/web/src/lib/auth/get-onchain-delegation.ts` (NEW) — server-side cookie
  reader. Validates address/hex shapes, decodes the first caveat (timestamp)
  to short-circuit expired delegations, returns the JSON-friendly struct
  (salt as decimal string).
- `apps/web/src/lib/actions/a2a-session.action.ts` — extended
  `bootstrapA2ASessionForUser` to also build and sign D_onchain after D_auth.
  Uses the same private-key-signing path; failure is non-fatal for the auth
  session (logged, downstream actions return a clear "session expired" error).
  Also clears the new cookie in `clearA2ASession`.
  - Selectors are computed at runtime via `toFunctionSelector(abiItem)` so the
    caveat stays in lockstep with ABI changes.
  - Delegated methods: PoolRegistry `{open, close, updateMandate,
    rotateStewards, setAcceptedRestrictions}` + FundRegistry `{openRound,
    setRoundStatus, setRoundAwardsRoot, setRoundMandate,
    setRoundMilestoneTemplate, setRoundValidatorRequirements}` (11 total).
- `apps/web/src/lib/actions/poolCreate.action.ts` — fetch D_onchain, return
  error if missing, forward as `onchainDelegation` arg.
- `apps/web/src/lib/actions/poolAdmin.action.ts` — same pattern in
  `updatePoolMandate` and `rotatePoolStewards`.
- `apps/web/src/lib/actions/roundOpen.action.ts` — same pattern around the
  `round:open` call.
- `apps/web/src/lib/actions/roundClose.action.ts` — same pattern around both
  `round:set_awards_root` and `round:set_status` calls. (The
  ProposalRegistry.announceAward fan-out remains deployer-signed; that
  contract surface isn't yet on the org-mcp tool surface.)
- `apps/web/src/lib/actions/roundCancel.action.ts` — same pattern.
- `apps/web/src/lib/actions/roundAdmin.action.ts` — same pattern in
  `advanceRoundLifecycle`. `updateRoundVotingConfig` does NOT need
  `onchainDelegation` (no on-chain write — slim row only).

### T2.2 — Org-mcp redeem path

- `apps/org-mcp/src/lib/redeem.ts` (NEW) — `redeemThroughDelegation({
  delegation, target, data, value? })`. Rehydrates the wire-form struct
  (salt-bigint, defaults `caveats[i].args = '0x'`), wraps in `[delegation]`,
  calls `DelegationManager.redeemDelegation` from org-mcp's wallet client,
  waits for the receipt, returns the tx hash.
- `apps/org-mcp/src/config.ts` — `signerPrivateKey` now reads
  `ORG_MCP_EOA_PRIVATE_KEY` first, falling back to `DEPLOYER_PRIVATE_KEY` for
  v1 / fresh-start.
- `apps/org-mcp/src/tools/pools.ts` — full rewrite. Every mutating tool
  (`pool:create`, `pool:update_mandate`, `pool:rotate_stewards`, `pool:close`,
  `pool:set_accepted_restrictions`) now: (a) requires `onchainDelegation` in
  args, (b) encodes the corresponding PoolRegistry call with
  `encodeFunctionData`, (c) calls `redeemThroughDelegation`. The
  `requirePoolSteward` web-style pre-check is GONE — chained delegation
  enforcement is the sole authorization. `pool:create` deploys the pool's
  AgentAccount with `owner = onchainDelegation.delegator` (T2.3) and uses
  `PoolRegistryClient.buildOpenParams(...)` purely as a struct builder
  (no longer instantiates a live client).
- `apps/org-mcp/src/tools/rounds.ts` — same surgery for `round:open`,
  `round:set_status`, `round:close`, `round:cancel`, `round:set_awards_root`.
  Voting-config tools (`round:get_voting_config`,
  `round:update_voting_config`, `round:increment_proposals_received`) are
  unchanged — they're slim-row writes, never on-chain. The
  `requireFundOwner` / `getOnChainFundAgent` helpers were dropped along with
  the live `FundRegistryClient` instance; only the static
  `FundRegistryClient.buildOpenParams` helper is still imported.

### T2.3 — Pool agent ownership

Already inline in the `pool:create` rewrite above:

```ts
const owner = delegation.delegator as Address  // user's AgentAccount
const { address: treasuryAddress } = await deploySmartAccount(owner, salt)
```

Subsequent `PoolRegistry.open` (and any later `updateMandate`,
`rotateStewards`, `close`, `setAcceptedRestrictions`) flowing through
`_executeFromDelegator(rootDelegator = user's AgentAccount)` then satisfy
the registry's `onlyPoolOwner` modifier.

### T2.4 — Deploy script env wiring

- `scripts/deploy-local.sh`:
  - Writes `ORG_MCP_EOA_ADDRESS` + `ORG_MCP_EOA_PRIVATE_KEY` to
    `apps/web/.env` (derived from `cast wallet address $ANVIL_KEY`; for v1
    both equal anvil account 0).
  - Adds the same private key to every issuer-MCP `.env` via the existing
    `update_env_var` loop, plus `POOL_REGISTRY_ADDRESS`,
    `FUND_REGISTRY_ADDRESS`, `AGENT_FACTORY_ADDRESS`. (org-mcp now reads
    `ORG_MCP_EOA_PRIVATE_KEY` first.)
  - Uses `ensure_web_var` (in-place sed) to make sure
    `ALLOWED_TARGETS_ENFORCER_ADDRESS` and `ALLOWED_METHODS_ENFORCER_ADDRESS`
    are present in `apps/web/.env`. (`Deploy.s.sol` already emits them; the
    cat-heredoc block already writes them; this is just the
    insurance-against-stale-env-keys path.)

`packages/contracts/script/Deploy.s.sol` was inspected — it already deploys
all three enforcers (Timestamp / AllowedTargets / AllowedMethods) and emits
their addresses via `_logEnv`. No edit required.

## Verification

- `pnpm --filter @smart-agent/sdk typecheck` — clean.
- `pnpm --filter @smart-agent/org-mcp typecheck` — clean.
- `pnpm --filter @smart-agent/web typecheck` — clean.

End-to-end (anvil + fresh-start) is the user's separate verification step.

## Gotchas / non-obvious bits

1. **BigInt salt round-trip.** D_onchain's salt is a `bigint`. JSON can't
   carry bigints, so the cookie payload stringifies the salt
   (`salt: salt.toString()`). `redeem.ts` rehydrates with `BigInt(salt)`
   before passing to `redeemDelegation` (which expects bigint). The
   `hashDelegation()` helper already accepts `bigint | string`, so the wire
   path also works for the on-disk web-side flow.

2. **Caveat `args` field.** `Delegation`'s `Caveat` type carries an `args`
   field for redeemer-supplied runtime arguments (excluded from the
   delegation hash). The cookie format includes `args: '0x'` for each caveat
   so the rehydrated struct matches the ABI shape DelegationManager expects.
   The signature path uses `hashCaveats` which only consumes
   `{enforcer, terms}`, so adding `args` to the cookie doesn't change the
   signed digest.

3. **Selector computation.** `toFunctionSelector` accepts an ABI item
   directly, so the bootstrap code reads each function from
   `poolRegistryAbi` / `fundRegistryAbi` by name and lets viem emit the
   selector. Avoids hand-typing 4-byte hashes that drift on ABI changes.
   If a function name is missing from the ABI we throw at bootstrap —
   bubble-up is preferred over a silently-empty selector list (which would
   make the AllowedMethodsEnforcer reject every redeem).

4. **AllowedTargetsEnforcer + AllowedMethodsEnforcer term encoding.** The SDK
   encoders return ABI-encoded `address[]` and `bytes4[]` payloads
   respectively. We pass them straight through `buildCaveat`. The test that
   exercises them on chain is the redeem itself — if either enforcer rejects
   the call, `writeContract` reverts with a decoded enforcer error.

5. **Non-fatal D_onchain mint failure.** If `bootstrapA2ASessionForUser`
   succeeds for D_auth but fails for D_onchain (e.g. an env var hasn't
   propagated after a partial fresh-start), the user can still log in and
   read data; web actions that need on-chain mutation return
   "session expired" until they re-bootstrap. This is intentional — we
   don't want a missing `ALLOWED_METHODS_ENFORCER_ADDRESS` to lock users
   out of the whole app.

6. **Pool ownership shift.** Pre-Tier-2, pools were owned by the org-mcp /
   deployer EOA. Post-Tier-2, `pool:create` deploys the AgentAccount with
   `owner = D_onchain.delegator` (the user's smart account). Old pools
   created on the previous schema will fail later admin calls because the
   chained call's rootDelegator no longer equals the AgentAccount owner.
   `fresh-start.sh` re-seeds, so this is intentional and expected.

7. **`requireOrgPrincipalAny` still runs.** The MCP token verification
   (D_auth) is the FIRST line of defense — it authenticates the caller. The
   `onchainDelegation` arg is a SEPARATE delegation that authorizes the
   on-chain call. Two delegations, two distinct purposes; do not collapse
   them.

8. **ProposalRegistry.announceAward.** Still uses the deployer EOA in
   `roundClose.action.ts` (the `wallet.writeContract({...})` block). That
   contract isn't on the org-mcp tool surface yet; relocating it is a
   future Tier-2.x increment. Not in scope for this pass.
