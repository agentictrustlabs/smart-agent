# Phase E — MCP Proxy Hardening

> **Status**: skeleton — design ready for review.
> **Depends on**: Phase D (every MCP edge validates inbound MAC).
> **Unblocks**: Phase G (CI guard for proxy allowlist).

## Summary

External review P0-4: `apps/a2a-agent/src/routes/mcp-proxy.ts` accepts a
catch-all `/<mcp>/:tool` path with no per-tool allowlist. Anything the
downstream MCP exposes is reachable through the proxy, regardless of
whether the A2A-level surface intended to expose it. Phase E closes this
to a per-downstream allowlist plus an env kill-switch.

## Goals

1. The proxy serves only tools on a per-downstream allowlist; everything
   else is `403 Tool not permitted`.
2. `DISABLE_GENERIC_MCP_PROXY=true` makes every catch-all route 404 —
   useful for incident response.
3. Allowlist lives in source (not env), is reviewed in PRs, and is
   matched 1:1 with the downstream's documented tool surface.

## Concrete deliverables

- New `apps/a2a-agent/src/routes/mcp-proxy-allowlist.ts` exporting a
  map `{ <mcp-id>: Set<toolName> }`.
- `mcp-proxy.ts` middleware that returns 403 if `req.params.tool` is
  not in the allowlist for `req.params.mcp`.
- `DISABLE_GENERIC_MCP_PROXY` env flag short-circuits before the
  allowlist check.
- Integration tests:
  - `proxy-tool-allowlist.test.ts`: posting to an unlisted tool returns
    403.
  - `proxy-kill-switch.test.ts`: with `DISABLE_GENERIC_MCP_PROXY=true`,
    every proxy route returns 404.

## Acceptance criteria

- [ ] Every `mcp-proxy` route checks the allowlist before dispatching.
- [ ] Allowlist file enumerates exactly the tools the spec documentation
      claims are publicly callable; PR review process catches new
      additions.
- [ ] Kill-switch tested.
- [ ] Phase G CI guard "every proxy entry has an allowlist row" passes.

## Open questions

- **E1**: How do internal tools (used by other A2A routes but not
  intended for public proxy) opt out? Proposed: such tools never appear
  in the proxy allowlist; they are called from A2A routes via direct
  fetch, not via the proxy.
- **E2**: What is the audit-log retention for proxy denials? Proposed:
  90 days; flushed to org-mcp audit-log MCP via existing infra.
