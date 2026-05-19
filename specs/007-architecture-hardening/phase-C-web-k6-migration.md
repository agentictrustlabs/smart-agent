# Phase C — Web K6 Migration

> **Status**: skeleton — design ready for review; file conversion table locked.
> **Depends on**: Phase A (capability roles exist), Phase B (session-key signing path
> works through `onchain-redeem.ts`).
> **Unblocks**: Phase G (CI guards can forbid `DEPLOYER_PRIVATE_KEY` in
> `apps/web/src` runtime paths only after every consumer is migrated).

## Summary

Sweep `apps/web/src` so that **no runtime path reads
`DEPLOYER_PRIVATE_KEY` to sign user-authored actions**. The legitimate
remaining consumers (env-guard, boot-seed prod-guards, K6 break-glass,
seed-only modules) keep their references; every action / route /
onchain-emitter that signs a user-authority operation is migrated to
either:

- The user's own credential (passkey / EOA), routed through the
  Phase B session signer; OR
- Master signer **as bundler-relayer only**, with inner authority
  recovered to the user's credential.

This closes the K6 web-side migration memory item (`project_kms_initiative.md`,
"K6 web-side migration: replace DEPLOYER_PRIVATE_KEY with master signer — PENDING")
and addresses ~20 violations from the master-key + deployer-drift audit.

## Goals

1. Zero runtime `DEPLOYER_PRIVATE_KEY` reads in `apps/web/src/` outside
   the documented-dev-divergence allowlist.
2. Passkey + SIWE users can complete every flow (register, vote,
   propose, pledge, honor) without `DEPLOYER_PRIVATE_KEY` set.
3. Class-assertion emitters (`apps/web/src/lib/onchain/*Assertion.ts`) no
   longer "silently warn and continue" when missing keys — they fail
   loudly OR they are removed in favor of an A2A-routed emit path.

## File conversion table

| File | Current pattern | Target pattern |
|---|---|---|
| `apps/web/src/lib/ssi/signer.ts:48` | Stateless passkey/SIWE users return `{kind:'eoa', privateKey: deployerKey}` — deployer impersonates user | Return `{kind:'passkey'}` or `{kind:'siwe'}`; caller routes through Phase B session signer; passkey prompt rendered at action time |
| `apps/web/src/lib/contracts.ts:143-145` | `getWalletClient()` is a deployer-backed wallet client used as a generic contract write surface | Split into `getRelayerWalletClient()` (master-via-KMS, relay only) and `getDeployerWalletClient()` (seed-only, throws in non-seed contexts) |
| `apps/web/src/lib/actions/recovery/recovery.action.ts:93,179` | Deployer is single guardian; signs `propose()` and `signMessage(intentHash)` | User-chosen guardian set; guardian signatures collected by org-mcp; recovery proposes via A2A |
| `apps/web/src/lib/actions/passkey/enroll-oauth.action.ts:48,111,166,228,245,286,311` | Deployer as `serverEOA`, deployer in `guardians`, deployer signs userOp envelope | Passkey + OAuth identity creates new AgentAccount with passkey as owner; bundler relays; recovery via user-chosen guardians (separate spec, here just: stop using deployer) |
| `apps/web/src/lib/actions/passkey/register.action.ts:42,102` | Server-action that registers a WebAuthn credential requires `DEPLOYER_KEY` to proceed | The credential registration is a self-call on the user's AgentAccount; userOp signed by user (Phase B); master bundler-relays |
| `apps/web/src/lib/actions/passkey/sign-demo.action.ts:39,178` | Demo signing path uses deployer | Demo users have `users.privateKey`; sign with theirs (already supported); remove deployer fallback |
| `apps/web/src/lib/actions/passkey/remove.action.ts:26,73` | Remove passkey credential via deployer | Self-call on AgentAccount signed by user |
| `apps/web/src/lib/actions/onboarding/repair-account.action.ts:41,119,231` | "Repair" routes require deployer | Repair is owner-only; user signs; if user is locked out, recovery flow (not deployer override) |
| `apps/web/src/lib/actions/onboarding/setup-agent.action.ts:186,187` | Setup requires deployer | User-initiated; user signs via Phase B |
| `apps/web/src/lib/actions/a2a-session.action.ts:104-109` | "Deployer-signed fallback" for passkey users when signing the delegation hash | Passkey signs the delegation hash directly (WebAuthn); for SIWE users, injected wallet signs |
| `apps/web/src/lib/actions/update-group.action.ts:13-21` | Group-health resolver writes signed by deployer | Group-steward signs; route through A2A; resolver writes attributed to steward |
| `apps/web/src/lib/onchain/matchInitiationAssertion.ts:60,93` | Deployer is "operator key" for class assertion emit; silently null-returns on missing | Emit via A2A `/onchain/assertion-emit` (new route in Phase D-adjacent); A2A uses master as relayer; inner authority is the user's session |
| `apps/web/src/lib/onchain/poolPledgeAssertion.ts:56,93` | Same | Same |
| `apps/web/src/lib/onchain/poolPledgedTotalAssertion.ts:40,64` | Aggregate; deployer signs | Aggregate is system role — KEEP master signing (relay only), but stop reading `DEPLOYER_PRIVATE_KEY`; read from KMS |
| `apps/web/src/lib/onchain/disbursementAssertion.ts:46,66` | Deployer signs disbursement anchor | Donor's owner signs (this is user-authority anchor, not aggregate); route through A2A |
| `apps/web/src/app/api/invites/[code]/accept/route.ts:93` | Invite-accept signs relationship-create with deployer | User signs the relationship-create via Phase B |
| `apps/web/src/app/api/agents/governance/route.ts:198` | Governance write signed by deployer | Member of governance signs; route through org-mcp |
| `apps/web/src/lib/agent-resolver.ts:62,87` | Generic resolver writes signed by deployer | Caller passes the resolved signer; resolver doesn't carry signing authority |
| `apps/web/src/lib/treasury/provision.ts:83,282` | Treasury provisioning signed by deployer | User-initiated; user signs; master bundler-relays |
| `apps/web/src/lib/actions/{geo-claim,skill-claim,explorer-edit,agent-metadata,deploy-org-agent,deploy-from-template,create-agent-from-explorer,record-tee-validation,data-delegation,genmap,simulate-tee,deploy-ai-agent}.action.ts` | Numerous user-action server-actions still route through `getWalletClient()` (deployer) | Each migrates to user signer via Phase B (per-file PR; conversion list tracked in checklist below) |
| `apps/web/src/app/api/auth/check-agent-name/route.ts:47` | DOCUMENTED-DEV-DIVERGENCE — only resolves deployer address for name collision check | KEEP (no signing); documented |
| `apps/web/src/lib/env-guard.ts:38-62` | Warn-only in prod | KEEP |
| `apps/web/src/lib/__tests__/env-guard.test.ts` | Test fixtures | KEEP |
| `apps/web/src/lib/demo-seed/**` | Seed-only; on K6 allowlist | KEEP (seed-time only) |

## Concrete deliverables

- Per-file migration PRs (small, reviewable); each PR includes:
  - Removed `DEPLOYER_PRIVATE_KEY` read.
  - New Phase B signer wiring.
  - Updated test asserting the action works without `DEPLOYER_PRIVATE_KEY` set.
  - Negative test: action FAILS with a clear error when user signature
    is unavailable (no silent fallback).
- New module `apps/web/src/lib/signer-context.ts` — single
  per-action signer resolver that consumes `requireSession()` and emits
  one of:
  - `{ kind: 'user-eoa', signer }` (demo users with `users.privateKey`).
  - `{ kind: 'user-passkey', signer }` (stateless passkey users).
  - `{ kind: 'user-siwe', signer }` (stateless SIWE users; injected wallet).
- Remove `getWalletClient()` callers outside seed; rename remaining seed
  caller to `getDeployerWalletClient()` that throws if `__SEED_CONTEXT__`
  env flag is not set.
- Onchain assertion emitters move into A2A as POST `/onchain/assertion-emit`
  (master-relayed); web callers POST instead of signing locally.

## Acceptance criteria

- [ ] `grep -rn 'DEPLOYER_PRIVATE_KEY' apps/web/src/` returns only:
  - `env-guard.ts` (warn-only).
  - `boot-seed.ts` (prod-guards).
  - `__tests__/env-guard.test.ts` (test fixtures).
  - `check-agent-name/route.ts` (documented dev divergence).
  - `lib/demo-seed/**` (seed-only).
- [ ] `grep -rn 'getWalletClient(' apps/web/src/` returns zero hits
      outside `lib/contracts.ts` and `lib/demo-seed/**`.
- [ ] Passkey users complete the full demo flow (register → vote → pledge
      → honor → propose → close round → release tranche) without
      `DEPLOYER_PRIVATE_KEY` set in `apps/web/.env`.
- [ ] Phase G's CI guard `no-deployer-key-in-actions.test.ts` passes.
- [ ] Per-file migration checklist (above table) is closed.

## Open questions

- **C1**: For SIWE users without an injected wallet (e.g. iframe), what
  is the signing surface? Proposed: out-of-scope here — the SIWE flow
  requires an injected wallet; absence of one is a UX error, not a
  signing fallback.
- **C2**: Do class-assertion emitters STAY in `apps/web` (POSTing to A2A)
  or MOVE entirely into A2A (web calls a higher-level action)? Proposed:
  MOVE — the emitter is a system role; the web caller writes the SQL row
  and POSTs the publish request. Locks at Phase C kickoff.
- **C3**: Recovery flow guardian set replacement — who chooses
  guardians at account creation? Proposed: out-of-scope here; spec 007
  takes "user-chosen guardian set" as the assumption and defers the UX
  to spec 008 (or the UX overhaul). For now: hard-fail any
  recovery-propose that would otherwise have used the deployer; surface
  in UI as "Recovery not configured."
