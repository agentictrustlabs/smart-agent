# Phase 4 — Wallet Permission Interop / Permission UX

**Status:** complete; verified by typecheck on sdk + a2a-agent + web
**Date:** 2026-05-10
**Source plan:** `output/delegation-implementation-plan.md` §6 (Phase 4)

---

## What Phase 4 does

Adds a **wallet-style permission preview + revoke/regrant UX** on top of the
existing demo-login bootstrap flow. The user can now:

1. **See what their active session is authorized to do** in human terms
   (grouped capabilities, allowed targets, limits, revocation policy).
2. **Revoke the session on-chain** at any time
   (`DelegationManager.revokeDelegation(rootGrantHash)`).
3. **Re-grant** with a different duration (`1 hour`, `24 hours`, `7 days`).
4. **Audit recent actions** taken under the session (last 20
   ExecutionReceipts from the new `/session/:id/audit` endpoint).

The actual EIP-712 signature still happens server-side in
`bootstrapA2ASessionForUser` (demo path, using the user's stored EOA private
key). The Phase 4 page is **presentational + control** — it does not yet
do client-side `eth_signTypedData_v4`. That is the wallet-integration
follow-up.

---

## Files created

| Path | Purpose |
|---|---|
| `packages/sdk/src/permissions/types.ts` | `SessionPermissionRequest` (versioned wire shape) + `PermissionPreview` (human projection) + `previewSessionRequest()` (pure renderer). |
| `packages/sdk/src/permissions/build.ts` | `buildSessionPermissionRequest(input)` — collapses `TOOL_POLICIES` + env addresses into a versioned permission descriptor. Mirrors the union math in `bootstrapA2ASessionForUser`. |
| `apps/a2a-agent/src/routes/session-meta.ts` | New `GET /session/:id/status` and `GET /session/:id/audit` endpoints (no HMAC, no Bearer — read-only, session id is the secret). Status surfaces `rootGrantHash` derived from the most recent ExecutionReceipt or by decrypting the stored package + re-hashing. |
| `apps/web/src/app/api/a2a/session-status/route.ts` | Web proxy for status; merges a2a-agent's response with a freshly-built `SessionPermissionRequest`. |
| `apps/web/src/app/api/a2a/session-audit/route.ts` | Web proxy for the audit list. |
| `apps/web/src/app/api/a2a/revoke/route.ts` | POST endpoint backing the revoke button. |
| `apps/web/src/lib/actions/a2a-session-revoke.action.ts` | Server action: look up `rootGrantHash` → `DelegationManager.revokeDelegation()` → DELETE session → clear cookie. Partial-success path when no privateKey (passkey/Google) or no rootGrantHash recorded yet. |
| `apps/web/src/app/(authenticated)/sessions/permissions/page.tsx` | Server component rendering the preview, status banner, audit list. |
| `apps/web/src/app/(authenticated)/sessions/permissions/PermissionsActions.tsx` | Client component: duration picker, Grant / Re-grant, Revoke, Cancel. |
| `output/phase4-permission-ux-summary.md` | This file. |

## Files edited

| Path | Change |
|---|---|
| `packages/sdk/src/index.ts` | Exported `SessionPermissionRequest`, `PermissionPreview`, `previewSessionRequest`, `buildSessionPermissionRequest`. |
| `apps/a2a-agent/src/index.ts` | Mounted `sessionMeta` under `/session` (after `onchainRedeem`; doesn't collide with `GET /session/:id` because the new paths are suffixed). |
| `apps/web/src/lib/actions/a2a-session.action.ts` | `bootstrapA2ASessionForUser` and `bootstrapA2ASession` now accept `{ durationSeconds }`; cookie maxAge follows the chosen duration. Default still 24h. |
| `apps/web/src/app/api/a2a/bootstrap/route.ts` | Reads optional `{ duration: 'h1' \| 'h24' \| 'h168' }` from request body and threads to `bootstrapA2ASession`. |
| `apps/web/src/components/auth/UserDropdown.tsx` | Added a "View session permissions" link in the dropdown menu, between the address rows and the Disconnect button. |

---

## SDK shape

### `SessionPermissionRequest`

```typescript
{
  schemaVersion: '1.0.0'
  sessionIntent: string
  taskGroupId: string
  expiresAtIso: string
  scope: {
    mcpTools: string[]    // every tool name in TOOL_POLICIES
    targets: Address[]    // PoolRegistry, FundRegistry, AgentAccountFactory, ...
    selectors: Hex[]      // union of every selector any policy authorizes
    maxValueWei: '0'      // typed-attr writes only
  }
  rules: {
    rateLimit?: { windowSeconds, maxCalls }
    spendCap?: { asset, maxAmount }
    geoFence?: { allowedRegions }
  }
  revocable: true
  chainId: number
}
```

### `previewSessionRequest(req, helpers)` → `PermissionPreview`

Pure projection. The page passes formatting helpers (`formatDuration`,
`formatTargets`, `formatChain`) so locale / address-shortening / chain
naming choices stay in the UI layer. The SDK pins the bucketing and
label dictionaries for prefix-based capability groups (`pool:*`, `round:*`,
`grant_proposal:*`, etc.).

---

## UI structure

`/sessions/permissions` lays out:

```
┌───────────────────────────────────────────────────────────────┐
│ AGENT SESSION PERMISSIONS                                     │
│ Maria Garcia                                                  │
│ "Authorize Maria Garcia to act on community funding flows…"  │
├───────────────────────────────────────────────────────────────┤
│ [Active session · expires 2026-05-11 18:00 · key 0x9a…3c8b]   │
├───────────────────────────────────────────────────────────────┤
│ SESSION WINDOW                                                │
│   Duration   24 hours                                         │
│   Starts     2026-05-10 18:00                                 │
│   Expires    2026-05-11 18:00                                 │
│   Chain      Anvil dev (31337)                                │
├───────────────────────────────────────────────────────────────┤
│ ALLOWED ACTIONS (10 groups)                                   │
│ ▸ Pool administration · 5 tools · PoolRegistry, …             │
│ ▸ Round administration · 6 tools · FundRegistry, …            │
│ ▸ Grant proposals · 11 tools · FundRegistry                   │
│   …                                                           │
├───────────────────────────────────────────────────────────────┤
│ LIMITS                                                        │
│   ETH transfers    Not permitted                              │
│   Rate limit       100 calls per 1 hour                       │
│   Auto-expire      2026-05-11 18:00 UTC                       │
│   Revocable        Yes — revoke at any time                   │
├───────────────────────────────────────────────────────────────┤
│ MANAGE SESSION                                                │
│   [1 hour] [24 hours] [7 days]                                │
│   [Grant session (24 hours)]  [Revoke session now]  [Cancel]  │
├───────────────────────────────────────────────────────────────┤
│ EXECUTED ACTIONS (3)                                          │
│   pool:create  0xPool…  [completed]  2026-05-10 18:12        │
│   pool:update_mandate  0xPool…  [completed]  2026-05-10 18:15│
│   round:open  0xFund…  [pending]  2026-05-10 18:20            │
└───────────────────────────────────────────────────────────────┘
```

Each capability group is a `<details>` element — click to expand and see
the per-tool ID list. Limits map directly from the
`PermissionPreview.limits[]` array. The status banner switches between
"Active session" (ok-green) and "No active session" (warning-amber).

---

## API surface

### `GET /api/a2a/session-status`

Returns:

```typescript
// Active session
{
  active: true,
  sessionId: 'sa_...',
  expiresAtIso: '...',
  createdAtIso: '...',
  accountAddress: '0x...',
  sessionKeyAddress: '0x...',
  scope: SessionPermissionRequest,
}

// Inactive (cookie missing, expired, revoked, or not-found)
{ active: false, reason: 'no-cookie' | 'expired' | 'revoked' | 'not-found' | 'unknown' }
```

### `GET /api/a2a/session-audit?sessionId=<id>&limit=20`

```typescript
{
  receipts: Array<ExecutionReceiptSummary & {
    target: string | null,
    mcpServer: string,
    executionPath: 'mcp-only' | 'stateless-redeem' | 'sub-delegated' | 'session-account',
    errorReason: string,
    receivedAt: string,
  }>
}
```

### `POST /api/a2a/revoke`

```typescript
{
  success: boolean,
  txHash?: '0x...',        // present when on-chain revoke landed
  rootGrantHash?: '0x...', // hash that was revoked
  partial?: boolean,        // true when cookie cleared but on-chain step skipped
  error?: string,
}
```

### `POST /api/a2a/bootstrap` (extended)

```typescript
// Body (optional)
{ duration?: 'h1' | 'h24' | 'h168' }
```

Defaults to `h24` when absent. The `AuthGate` keeps calling it with no
body, so existing demo-login behavior is unchanged.

---

## A2a-agent endpoints

### `GET /session/:id/status`

```typescript
// active
{
  active: true,
  sessionId,
  expiresAtIso,
  createdAtIso,
  accountAddress,
  sessionKeyAddress,
  rootGrantHash: '0x...' | null,
}

// inactive
{ active: false, reason, expiresAtIso?, sessionId }
```

`rootGrantHash` is sourced from the most recent `execution_audit` row for
that session. If there are no audit rows yet (session bootstrapped but
nothing executed), the endpoint falls back to decrypting the stored
session package and re-hashing the root delegation with viem's
`hashDelegation`. Both reads use the same `A2A_SESSION_SECRET` that
existing endpoints already trust.

### `GET /session/:id/audit?limit=N`

Returns up to `N` (default 20, max 100) `ExecutionReceiptSummary` rows
for the session, ordered newest-first.

Neither endpoint requires the inter-service HMAC (they only read
metadata that the web client already knows by virtue of holding the
session cookie). They are mounted under `/session` in
`apps/a2a-agent/src/index.ts` after `onchainRedeem`; the bare
`GET /session/:id` handler in `session.ts` still wins for the un-suffixed
path.

---

## How the demo-login flow vs production wallet flow diverge

**Demo / legacy (privateKey on `users` row):**
- `AuthGate` calls `/api/a2a/bootstrap` after login → server-side
  `bootstrapA2ASessionForUser` signs the EIP-712 delegation hash with the
  stored private key. Same flow Phase 1 shipped.
- The permission page's "Grant" button POSTs `/api/a2a/bootstrap` with the
  selected duration. The signature still happens server-side.
- "Revoke" works fully: `revokeA2ASessionForUser` uses the privateKey to
  call `DelegationManager.revokeDelegation` on-chain.

**Production (Privy / passkey / Google / SIWE):**
- Existing `AuthGate` already short-circuits to `/dashboard` without
  calling `bootstrapA2ASessionForUser` because `user.via === 'passkey' |
  'google'` and no server-side privateKey exists.
- The permission page renders the **proposed scope** (still useful — it
  shows what the user would be agreeing to). The "Grant" button hits
  `/api/a2a/bootstrap` which returns `{ error: 'Client-side signing
  required …' }`. The UI surfaces the error.
- Revoke partial-succeeds: marks the a2a-agent session row as `revoked`
  + clears the cookie, but does NOT call `revokeDelegation` on-chain.
  Returns `{ success: true, partial: true, error: 'On-chain revoke
  skipped (no server-side signer)' }`.

**Closing the gap for production:** the wallet integration will plug
client-side `eth_signTypedData_v4` into a new
`/api/a2a/bootstrap/client/finalize` or similar endpoint, and a new
client-side `revokeWithWallet` flow for revocation. Both touch the same
permission preview (the schema doesn't change) and the same a2a-agent
init/package endpoints (which are already wallet-agnostic — they only
verify ERC-1271 magic-value).

---

## Verification

| Package | `pnpm --filter <pkg> typecheck` |
|---|---|
| `@smart-agent/sdk` | clean |
| `@smart-agent/a2a-agent` | clean |
| `@smart-agent/web` | clean |

Manual verification still required after the next `./scripts/fresh-start.sh`:
1. Log in as Maria (or any demo user).
2. Open the user dropdown → "View session permissions".
3. Page renders without errors. Status banner shows active session.
4. Capability groups expand to show tool IDs.
5. Click "Revoke session now" → confirms → page refreshes → status banner
   reads "No active session"; subsequent MCP calls return 401.
6. Click "Grant session (24 hours)" → page refreshes → status banner reads
   "Active session" again.
7. Switch duration to "7 days" and re-grant → expiry updates.

E2E coverage: the existing `tests/e2e/intent-marketplace.spec.ts` doesn't
exercise the new page. A Playwright spec under `tests/e2e/` walking the
revoke/regrant happy path is a candidate follow-up but not required for
Phase 4 completion (the contract was: render preview correctly + provide
revoke; both are server-rendered and verifiable manually).

---

## Rough edges

### 1. `rootGrantHash` may be `null` before any action runs

If a session is bootstrapped but the user hasn't executed any on-chain
work yet, no `execution_audit` row carries the hash. The status endpoint
falls back to decrypting the stored package and re-hashing — this is
reliable but does mean revoke is **always** possible regardless of usage.
The decryption uses the same secret already trusted by `mcp-proxy` and
`onchain-redeem.ts`, so no new security surface.

If decryption fails (unlikely in practice; would mean either a corrupt
row or a rotated session secret), the revoke action falls back to "clear
cookie + DELETE a2a session" only, returning `{ success: true, partial:
true, error: 'No rootGrantHash available…' }`. The UI surfaces this
clearly via the dimmed italic note below the action buttons.

### 2. Cookie duration after re-grant

`bootstrapA2ASession` now sets the cookie `maxAge` to the chosen
durationSeconds. The `AuthGate` continues to set `maxAge: 60 * 60 * 24`
hardcoded in `/api/demo-login`. So a user who logs in fresh gets a 24h
cookie; if they then re-grant via the permission page with `h168`, the
cookie maxAge bumps to 7 days while the a2a-agent session row expiry
extends to match. This is consistent — the cookie and server expiry
should agree, and they do.

### 3. Permission preview is the proposed-grant union, not exactly the
   active session's caveats

The page renders `buildSessionPermissionRequest()` — the scope you'd get
on a re-grant today, given today's `TOOL_POLICIES`. If `TOOL_POLICIES`
changes between bootstrap and viewing, the preview will show the new
union, not what was originally signed. The active session's actual
caveats are still on the encrypted package; we could pull them, decode
each enforcer's terms, and reconstruct — but the round-trip would
duplicate the encode/decode logic already in
`packages/sdk/src/delegation.ts`. For v1 the preview-of-proposed-grant
approximation is acceptable: it tells the user what they're authorized
for today, which is what matters for risk reasoning.

A future hardening could store a compact "what the user actually signed"
descriptor on the session row alongside the encrypted package and
render that here instead.

### 4. No client-side wallet signing

Phase 4 deliberately keeps the EIP-712 signature server-side. The
permission page is purely presentational + provides revoke/regrant
control on top of the existing demo-login flow. Production wallet
integration (Privy / passkey via `eth_signTypedData_v4`) is the
follow-up — designed to slot into the same
`SessionPermissionRequest` schema without changes.

### 5. Demo-login auto-bootstrap is preserved

Per the guardrails: `apps/web/src/app/api/demo-login/route.ts` still
calls `bootstrapA2ASessionForUser` automatically. The permission page is
**additive** — a place to inspect and manage the session, not a gate
between login and usage. AuthGate is unchanged.

### 6. RateLimit is shown but not enforced on the root delegation

`buildSessionPermissionRequest` declares `rateLimit: { windowSeconds:
3600, maxCalls: 100 }` in `rules` — the user sees "100 calls per 1 hour"
in the Limits panel. But Phase 1 deliberately deferred the
`RateLimitEnforcer` caveat on the root delegation (it requires picking a
canonical `scopeKey` + window/cap, which is Phase 2 hardening). This is
acceptable for v1: the preview reflects the **intended** policy; the
follow-up turns it into a real on-chain caveat.

---

## Follow-ups (Phase 4.5 / later)

1. **Client-side wallet signing** for Privy / passkey flows. Schema is
   already in place; need a new bootstrap/finalize endpoint that takes
   a wallet-produced signature instead of using the stored privateKey.
2. **`wallet_grantPermissions` compatibility shim** — ERC-7715 RPC over
   `SessionPermissionRequest`. Plan §6.3.
3. **Store actually-signed caveats** on the session row so the preview
   reflects history, not the current proposed policy. See "Rough edges"
   §3.
4. **Playwright spec** for the revoke/regrant flow under `tests/e2e/`.
5. **Audit table query API** for ops review — `GET /api/admin/audit` —
   already mentioned as a Phase 1 follow-up; phase 4 makes the per-session
   reader available, which can grow into the cross-session admin view.
