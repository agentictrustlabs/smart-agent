# API Route Inventory

_Generated: 2026-05-17T23:40:17.014Z_  
_Source: `apps/web/src/app/api/**/route.ts`_  
_Regenerate: `pnpm generate:route-inventory`_  
_Drift-check: `pnpm generate:route-inventory --check` (CI gate)_

This file is auto-generated from the `@sa-*` JSDoc tags on every API route handler. Editing it by hand will be undone the next time the generator runs — change the route's JSDoc and regenerate.

Why this exists: the Next.js middleware (`apps/web/src/middleware.ts`) lets every `/api/*` path through unauthenticated; each handler mints / checks its own auth. Without this inventory, route auth coverage is unauditable.

## Summary

| Section | Handlers |
|---------|----------|
| Public routes | 3 |
| Web-auth routes (require session cookie) | 58 |
| Bootstrap routes (special-purpose unauthenticated) | 9 |
| Service-only routes (require HMAC envelope) | 0 |
| Admin-only routes (operator scope) | 0 |
| Dev-only routes (404 in production) | 9 |
| **Total** | **79** |

## Public routes

Unauthenticated by design (health probes, public discovery). Must rate-limit if they touch any DB / network.

| Route | Method | Auth | Rate Limit | Audit Event | Risk | Validated? | Prod Gate | Source |
|-------|--------|------|------------|-------------|------|------------|-----------|--------|
| `/api/auth/check-agent-name` | GET | none | 60/min | — | — | — | — | [`app/api/auth/check-agent-name/route.ts`](../../apps/web/src/app/api/auth/check-agent-name/route.ts) |
| `/api/naming/check` | GET | none | 60/min | — | — | — | — | [`app/api/naming/check/route.ts`](../../apps/web/src/app/api/naming/check/route.ts) |
| `/api/system-readiness` | GET | none | 60/min | — | — | — | — | [`app/api/system-readiness/route.ts`](../../apps/web/src/app/api/system-readiness/route.ts) |

## Web-auth routes (require session cookie)

Standard authenticated browser surface. Handler checks `getSession()` / `getCurrentUser()` and 401s on miss.

| Route | Method | Auth | Rate Limit | Audit Event | Risk | Validated? | Prod Gate | Source |
|-------|--------|------|------------|-------------|------|------------|-----------|--------|
| `/api/a2a/auth/challenge` | POST | session-cookie | — | — | — | no-body | — | [`app/api/a2a/auth/challenge/route.ts`](../../apps/web/src/app/api/a2a/auth/challenge/route.ts) |
| `/api/a2a/auth/verify` | POST | session-cookie | — | — | — | zod | — | [`app/api/a2a/auth/verify/route.ts`](../../apps/web/src/app/api/a2a/auth/verify/route.ts) |
| `/api/a2a/bootstrap` | POST | session-cookie | — | — | — | zod | — | [`app/api/a2a/bootstrap/route.ts`](../../apps/web/src/app/api/a2a/bootstrap/route.ts) |
| `/api/a2a/bootstrap/client` | POST | session-cookie | — | — | medium | no-body | — | [`app/api/a2a/bootstrap/client/route.ts`](../../apps/web/src/app/api/a2a/bootstrap/client/route.ts) |
| `/api/a2a/bootstrap/complete` | POST | session-cookie | 10/min | — | medium | zod | — | [`app/api/a2a/bootstrap/complete/route.ts`](../../apps/web/src/app/api/a2a/bootstrap/complete/route.ts) |
| `/api/a2a/delegated-profile` | GET | session-cookie | — | — | — | — | — | [`app/api/a2a/delegated-profile/route.ts`](../../apps/web/src/app/api/a2a/delegated-profile/route.ts) |
| `/api/a2a/message` | POST | session-cookie | — | — | — | zod | — | [`app/api/a2a/message/route.ts`](../../apps/web/src/app/api/a2a/message/route.ts) |
| `/api/a2a/profile` | GET | session-cookie | — | — | — | zod | — | [`app/api/a2a/profile/route.ts`](../../apps/web/src/app/api/a2a/profile/route.ts) |
| `/api/a2a/profile` | PUT | session-cookie | — | — | — | zod | — | [`app/api/a2a/profile/route.ts`](../../apps/web/src/app/api/a2a/profile/route.ts) |
| `/api/a2a/revoke` | POST | session-cookie | — | session.revoke | — | no-body | — | [`app/api/a2a/revoke/route.ts`](../../apps/web/src/app/api/a2a/revoke/route.ts) |
| `/api/a2a/session-audit` | GET | session-cookie | — | — | — | — | — | [`app/api/a2a/session-audit/route.ts`](../../apps/web/src/app/api/a2a/session-audit/route.ts) |
| `/api/a2a/session-status` | GET | session-cookie | — | — | — | — | — | [`app/api/a2a/session-status/route.ts`](../../apps/web/src/app/api/a2a/session-status/route.ts) |
| `/api/a2a/session/[id]` | DELETE | session-cookie | — | — | — | path-params | — | [`app/api/a2a/session/[id]/route.ts`](../../apps/web/src/app/api/a2a/session/[id]/route.ts) |
| `/api/a2a/session/[id]` | GET | session-cookie | — | — | — | path-params | — | [`app/api/a2a/session/[id]/route.ts`](../../apps/web/src/app/api/a2a/session/[id]/route.ts) |
| `/api/a2a/session/init` | POST | session-cookie | — | — | — | zod | — | [`app/api/a2a/session/init/route.ts`](../../apps/web/src/app/api/a2a/session/init/route.ts) |
| `/api/a2a/user-info` | GET | session-cookie | — | — | — | — | — | [`app/api/a2a/user-info/route.ts`](../../apps/web/src/app/api/a2a/user-info/route.ts) |
| `/api/agents/can-manage` | GET | session-cookie | — | — | — | — | — | [`app/api/agents/can-manage/route.ts`](../../apps/web/src/app/api/agents/can-manage/route.ts) |
| `/api/agents/governance` | POST | session-cookie | — | — | high | zod | — | [`app/api/agents/governance/route.ts`](../../apps/web/src/app/api/agents/governance/route.ts) |
| `/api/agents/people` | GET | session-cookie | — | — | — | — | — | [`app/api/agents/people/route.ts`](../../apps/web/src/app/api/agents/people/route.ts) |
| `/api/attestations/cast` | POST | session-cookie | — | attestation.cast | — | zod | — | [`app/api/attestations/cast/route.ts`](../../apps/web/src/app/api/attestations/cast/route.ts) |
| `/api/attestations/list` | GET | session-cookie | — | — | — | — | — | [`app/api/attestations/list/route.ts`](../../apps/web/src/app/api/attestations/list/route.ts) |
| `/api/auth/ensure-user` | POST | session-cookie | — | — | — | zod | — | [`app/api/auth/ensure-user/route.ts`](../../apps/web/src/app/api/auth/ensure-user/route.ts) |
| `/api/auth/logout` | POST | session-cookie | — | — | — | no-body | — | [`app/api/auth/logout/route.ts`](../../apps/web/src/app/api/auth/logout/route.ts) |
| `/api/auth/profile` | GET | session-cookie | — | — | — | zod | — | [`app/api/auth/profile/route.ts`](../../apps/web/src/app/api/auth/profile/route.ts) |
| `/api/auth/profile` | PUT | session-cookie | — | — | — | zod | — | [`app/api/auth/profile/route.ts`](../../apps/web/src/app/api/auth/profile/route.ts) |
| `/api/auth/session` | GET | session-cookie | — | — | — | — | — | [`app/api/auth/session/route.ts`](../../apps/web/src/app/api/auth/session/route.ts) |
| `/api/commitments/attest` | POST | session-cookie | — | commitment.attest | — | zod | — | [`app/api/commitments/attest/route.ts`](../../apps/web/src/app/api/commitments/attest/route.ts) |
| `/api/commitments/release` | POST | session-cookie | — | commitment.release | high | zod | — | [`app/api/commitments/release/route.ts`](../../apps/web/src/app/api/commitments/release/route.ts) |
| `/api/disbursements/claim` | POST | session-cookie | — | disbursement.claim | — | zod | — | [`app/api/disbursements/claim/route.ts`](../../apps/web/src/app/api/disbursements/claim/route.ts) |
| `/api/disbursements/list` | GET | session-cookie | — | — | — | — | — | [`app/api/disbursements/list/route.ts`](../../apps/web/src/app/api/disbursements/list/route.ts) |
| `/api/disbursements/mark-paid` | POST | session-cookie | — | disbursement.markPaid | — | zod | — | [`app/api/disbursements/mark-paid/route.ts`](../../apps/web/src/app/api/disbursements/mark-paid/route.ts) |
| `/api/explorer/names` | GET | session-cookie | — | — | — | zod | — | [`app/api/explorer/names/route.ts`](../../apps/web/src/app/api/explorer/names/route.ts) |
| `/api/explorer/names` | POST | session-cookie | — | — | — | zod | — | [`app/api/explorer/names/route.ts`](../../apps/web/src/app/api/explorer/names/route.ts) |
| `/api/explorer/records` | GET | session-cookie | — | — | — | — | — | [`app/api/explorer/records/route.ts`](../../apps/web/src/app/api/explorer/records/route.ts) |
| `/api/explorer/resolve` | GET | session-cookie | — | — | — | — | — | [`app/api/explorer/resolve/route.ts`](../../apps/web/src/app/api/explorer/resolve/route.ts) |
| `/api/explorer/stats` | GET | session-cookie | — | — | — | — | — | [`app/api/explorer/stats/route.ts`](../../apps/web/src/app/api/explorer/stats/route.ts) |
| `/api/explorer/tree` | GET | session-cookie | — | — | — | — | — | [`app/api/explorer/tree/route.ts`](../../apps/web/src/app/api/explorer/tree/route.ts) |
| `/api/graph` | GET | session-cookie | — | — | — | — | — | [`app/api/graph/route.ts`](../../apps/web/src/app/api/graph/route.ts) |
| `/api/invites` | GET | session-cookie | — | — | — | zod | — | [`app/api/invites/route.ts`](../../apps/web/src/app/api/invites/route.ts) |
| `/api/invites` | POST | session-cookie | — | — | — | zod | — | [`app/api/invites/route.ts`](../../apps/web/src/app/api/invites/route.ts) |
| `/api/invites/[code]/accept` | POST | session-cookie | — | invite.accept | — | path-params | — | [`app/api/invites/[code]/accept/route.ts`](../../apps/web/src/app/api/invites/[code]/accept/route.ts) |
| `/api/messages` | GET | session-cookie | — | — | — | no-body | — | [`app/api/messages/route.ts`](../../apps/web/src/app/api/messages/route.ts) |
| `/api/messages` | POST | session-cookie | — | — | — | no-body | — | [`app/api/messages/route.ts`](../../apps/web/src/app/api/messages/route.ts) |
| `/api/messages/[id]` | PUT | session-cookie | — | — | — | path-params | — | [`app/api/messages/[id]/route.ts`](../../apps/web/src/app/api/messages/[id]/route.ts) |
| `/api/ontology-sync` | POST | session-cookie | — | — | — | no-body | — | [`app/api/ontology-sync/route.ts`](../../apps/web/src/app/api/ontology-sync/route.ts) |
| `/api/org-context` | GET | session-cookie | — | — | — | — | — | [`app/api/org-context/route.ts`](../../apps/web/src/app/api/org-context/route.ts) |
| `/api/pool-admin/mandate` | POST | session-cookie | — | pool.updateMandate | — | zod | — | [`app/api/pool-admin/mandate/route.ts`](../../apps/web/src/app/api/pool-admin/mandate/route.ts) |
| `/api/pool-admin/stewards` | POST | session-cookie | — | pool.rotateStewards | — | zod | — | [`app/api/pool-admin/stewards/route.ts`](../../apps/web/src/app/api/pool-admin/stewards/route.ts) |
| `/api/round-admin/add-voter` | POST | session-cookie | — | round.addVoter | — | zod | — | [`app/api/round-admin/add-voter/route.ts`](../../apps/web/src/app/api/round-admin/add-voter/route.ts) |
| `/api/round-admin/config` | POST | session-cookie | — | round.updateConfig | — | zod | — | [`app/api/round-admin/config/route.ts`](../../apps/web/src/app/api/round-admin/config/route.ts) |
| `/api/round-admin/finalize` | POST | session-cookie | — | round.finalize | high | zod | — | [`app/api/round-admin/finalize/route.ts`](../../apps/web/src/app/api/round-admin/finalize/route.ts) |
| `/api/round-admin/lifecycle` | POST | session-cookie | — | round.lifecycle | — | zod | — | [`app/api/round-admin/lifecycle/route.ts`](../../apps/web/src/app/api/round-admin/lifecycle/route.ts) |
| `/api/treasury/fund` | POST | session-cookie | — | treasury.fund | — | zod | — | [`app/api/treasury/fund/route.ts`](../../apps/web/src/app/api/treasury/fund/route.ts) |
| `/api/user-context` | GET | session-cookie | — | — | — | — | — | [`app/api/user-context/route.ts`](../../apps/web/src/app/api/user-context/route.ts) |
| `/api/votes/cast` | POST | session-cookie | — | vote.cast | — | zod | — | [`app/api/votes/cast/route.ts`](../../apps/web/src/app/api/votes/cast/route.ts) |
| `/api/votes/eligibility` | GET | session-cookie | — | — | — | — | — | [`app/api/votes/eligibility/route.ts`](../../apps/web/src/app/api/votes/eligibility/route.ts) |
| `/api/votes/my-vote` | GET | session-cookie | — | — | — | — | — | [`app/api/votes/my-vote/route.ts`](../../apps/web/src/app/api/votes/my-vote/route.ts) |
| `/api/votes/tally` | GET | session-cookie | — | — | — | — | — | [`app/api/votes/tally/route.ts`](../../apps/web/src/app/api/votes/tally/route.ts) |

## Bootstrap routes (special-purpose unauthenticated)

Mint sessions / register passkeys / verify SIWE — accept untrusted input by design. CSRF-guarded + middleware-rate-limited.

| Route | Method | Auth | Rate Limit | Audit Event | Risk | Validated? | Prod Gate | Source |
|-------|--------|------|------------|-------------|------|------------|-----------|--------|
| `/api/auth/google-callback` | GET | none-with-csrf | — | — | high | — | — | [`app/api/auth/google-callback/route.ts`](../../apps/web/src/app/api/auth/google-callback/route.ts) |
| `/api/auth/google-start` | GET | none | — | — | — | — | — | [`app/api/auth/google-start/route.ts`](../../apps/web/src/app/api/auth/google-start/route.ts) |
| `/api/auth/passkey-challenge` | GET | none | 10/min | — | — | — | — | [`app/api/auth/passkey-challenge/route.ts`](../../apps/web/src/app/api/auth/passkey-challenge/route.ts) |
| `/api/auth/passkey-signup` | POST | none-with-csrf | 10/min | — | high | zod | — | [`app/api/auth/passkey-signup/route.ts`](../../apps/web/src/app/api/auth/passkey-signup/route.ts) |
| `/api/auth/passkey-verify` | POST | none-with-csrf | 10/min | — | high | zod | — | [`app/api/auth/passkey-verify/route.ts`](../../apps/web/src/app/api/auth/passkey-verify/route.ts) |
| `/api/auth/session-grant/finalize` | POST | none-with-csrf | 10/min | — | high | zod | — | [`app/api/auth/session-grant/finalize/route.ts`](../../apps/web/src/app/api/auth/session-grant/finalize/route.ts) |
| `/api/auth/session-grant/start` | POST | none-with-csrf | 10/min | — | high | zod | — | [`app/api/auth/session-grant/start/route.ts`](../../apps/web/src/app/api/auth/session-grant/start/route.ts) |
| `/api/auth/siwe-challenge` | GET | none | 10/min | — | — | — | — | [`app/api/auth/siwe-challenge/route.ts`](../../apps/web/src/app/api/auth/siwe-challenge/route.ts) |
| `/api/auth/siwe-verify` | POST | none-with-csrf | 10/min | — | high | zod | — | [`app/api/auth/siwe-verify/route.ts`](../../apps/web/src/app/api/auth/siwe-verify/route.ts) |

## Service-only routes (require HMAC envelope)

Internal service-to-service calls. Caller must sign with a shared HMAC key id; never reachable from a browser.

_None._

## Admin-only routes (operator scope)

Reserved for operator-scoped JWT / KMS-signed entry points. Not used yet — listed for completeness.

_None._

## Dev-only routes (404 in production)

Guarded by `requireDev()` (or equivalent prod-gate) — return 404 when `NODE_ENV=production` unless `SMART_AGENT_ENV=dev`.

| Route | Method | Auth | Rate Limit | Audit Event | Risk | Validated? | Prod Gate | Source |
|-------|--------|------|------------|-------------|------|------------|-----------|--------|
| `/api/boot-seed` | GET | none | — | — | — | no-body | requireDev | [`app/api/boot-seed/route.ts`](../../apps/web/src/app/api/boot-seed/route.ts) |
| `/api/boot-seed` | POST | none | — | — | — | no-body | requireDev | [`app/api/boot-seed/route.ts`](../../apps/web/src/app/api/boot-seed/route.ts) |
| `/api/demo-login` | GET | none-with-csrf | 10/min | — | — | zod | requireDev | [`app/api/demo-login/route.ts`](../../apps/web/src/app/api/demo-login/route.ts) |
| `/api/demo-login` | POST | none-with-csrf | 10/min | — | — | zod | requireDev | [`app/api/demo-login/route.ts`](../../apps/web/src/app/api/demo-login/route.ts) |
| `/api/dev-membership-check` | GET | none | — | — | — | — | requireDev | [`app/api/dev-membership-check/route.ts`](../../apps/web/src/app/api/dev-membership-check/route.ts) |
| `/api/dev-patch-hannah` | POST | none | — | — | — | no-body | requireDev | [`app/api/dev-patch-hannah/route.ts`](../../apps/web/src/app/api/dev-patch-hannah/route.ts) |
| `/api/explorer/edit` | POST | none | — | — | — | zod | requireDev | [`app/api/explorer/edit/route.ts`](../../apps/web/src/app/api/explorer/edit/route.ts) |
| `/api/ontology-sync/turtle` | GET | none | — | — | — | — | requireDev | [`app/api/ontology-sync/turtle/route.ts`](../../apps/web/src/app/api/ontology-sync/turtle/route.ts) |
| `/api/test/geo-trust-e2e` | POST | none | — | — | — | no-body | requireDev | [`app/api/test/geo-trust-e2e/route.ts`](../../apps/web/src/app/api/test/geo-trust-e2e/route.ts) |
