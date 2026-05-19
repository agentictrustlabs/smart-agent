# Phase D — MCP Edge Closure (inbound MAC everywhere)

> **Status**: skeleton — design ready for review.
> **Depends on**: Phase C (web-side signers exist so they can sign
> outbound MACs to MCPs).
> **Unblocks**: Phase G (CI guard can assert every MCP route requires
> an inbound MAC).

## Summary

External review P1-3: not every MCP edge validates an inbound MAC.
person-mcp and org-mcp do; people-group-mcp, family-mcp, geo-mcp,
verifier-mcp, skill-mcp are partial or missing. After this phase,
every MCP route under the A2A proxy is unreachable without a valid
inbound `a2a-to-<mcp>` MAC.

## Goals

1. Every MCP route validates an inbound MAC at the route boundary; no
   "internal-only" routes without a MAC.
2. `apps/a2a-agent/src/routes/mcp-proxy.ts` has a concrete `macKeyId`
   for every downstream — no `undefined`, no `pending`.
3. Per-MCP shared verification utility (no per-service reimplementation
   that drifts).

## Concrete deliverables

- For each of {people-group-mcp, family-mcp, geo-mcp, verifier-mcp,
  skill-mcp}:
  - Add `requireInboundServiceAuth` middleware on every `/tools/*`
    route.
  - Provision a service-pair MAC key (LocalStack KMS + AWS + GCP).
  - Update `mcp-proxy.ts` to populate `macKeyId` for the service pair.
  - Update the per-MCP `.env.example` with the new key var.
- Shared SDK utility `@smart-agent/sdk/auth/inbound-mac` exposes
  `verifyInboundMac(req, expectedKeyId)` — every MCP imports the same
  implementation.
- Integration test per MCP: posting without the MAC returns 401;
  posting with a forged/expired MAC returns 401.

## Acceptance criteria

- [ ] `grep -rn 'requireInboundServiceAuth\|verifyInboundMac' apps/*-mcp/src/`
      shows usage on every `/tools/*` route.
- [ ] `mcp-proxy.ts` has no `macKeyId: undefined` or `macKeyId: 'pending'`.
- [ ] For each MCP, a negative-path test exists asserting unauthenticated
      requests are rejected.
- [ ] Phase G CI guard "every MCP route has inbound MAC" passes.

## Open questions

- **D1**: Per-tenant MAC keys vs per-service-pair MAC keys? Proposed:
  per-service-pair (one MAC key for `a2a → people-group-mcp`),
  multi-tenant isolation enforced at the principal-context layer, not at
  the MAC. Lock at Phase D kickoff.
- **D2**: How frequently are MAC keys rotated? Proposed: 90 days; key
  rotation done via dual-key acceptance window (old + new both valid for
  a window).
