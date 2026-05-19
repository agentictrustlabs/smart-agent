# Phase G — Isolation + CI Guards

> **Status**: skeleton — design ready for review.
> **Depends on**: A, B, C, D, E, F (this phase ratifies their invariants
> in CI; running earlier would lock in violations).

## Summary

Multi-tenant isolation is currently a convention ("write the WHERE
clause correctly this time"). External review M-3 / M-5: not all MCP
tools have negative tests asserting cross-tenant data access is
impossible. Phase G converts every invariant the prior phases
established into a CI guard, plus adds the property tests that make
isolation a property of the system rather than a convention.

## Goals

1. Every MCP tool has a property test: tenant A cannot read or write
   tenant B's data.
2. CI guards lock the invariants of A–F in place — re-introducing a
   violation breaks CI.
3. The shared SDK exports a single canonical MAC payload builder; no
   per-service reimplementation can drift.

## Concrete deliverables

### Property tests

- `apps/*/test/property/tenant-isolation.test.ts` (one per MCP):
  - Given two tenants T1, T2, attempt every tool call as T1 with a
    payload targeting T2's data. Each call must return 403 / 404 /
    empty — never T2's data.
  - Generated via property-based fuzzing (`fast-check`) over the tool
    surface enumerated in `mcp-proxy-allowlist.ts`.

### CI guards

- `tools-comment-matches-route.test.ts` — parses every
  `apps/a2a-agent/src/routes/**/*.ts`; for each route whose top-of-file
  comment claims "requires inbound MAC" / "requires session" / "is
  system-only," asserts the route uses the corresponding middleware.
- `no-server-only-in-tsx.test.ts` — lints `apps/web/src/`; any
  `'server-only'` import inside a `.tsx` file is a build break.
- `no-silent-catch-on-primitives.test.ts` — AST lint of
  `apps/web/src apps/a2a-agent/src apps/*-mcp/src`; flags any
  `try { … } catch { console.warn(…); return … }` whose body calls
  one of: `signMessage`, `signTypedData`, `signUserOp`, `writeContract`,
  `kmsClient.sign`, or `fetch(<configured service>)`.
- `no-deployer-key-in-actions.test.ts` — flags any `DEPLOYER_PRIVATE_KEY`
  read outside the documented-dev-divergence allowlist (see Phase C).
- `every-mcp-route-has-inbound-mac.test.ts` — parses
  `apps/*-mcp/src/routes/`; asserts `requireInboundServiceAuth` is
  applied.

### Shared canonical MAC

- `@smart-agent/sdk/auth/canonical-mac-payload.ts` exports
  `canonicalizeMacPayload({ method, path, body, ts, nonce })` →
  `Uint8Array`.
- Every MAC sender + verifier imports and uses this single function.
- CI guard `canonical-mac-payload-no-reimplementation.test.ts` flags
  any local hand-rolled equivalent.

## Acceptance criteria

- [ ] Property test suite passes in CI for every MCP.
- [ ] Each CI guard is wired into `pnpm test` (or a dedicated
      `pnpm test:guards` script invoked by CI).
- [ ] A deliberately-introduced violation in a test branch breaks CI
      with a clear error pointing at the violating file:line.
- [ ] The shared MAC payload builder is used by every sender + verifier.

## Open questions

- **G1**: Should property tests run on every PR or only nightly?
  Proposed: every PR for the canonical "no cross-tenant access" set;
  nightly for the full fuzz suite.
- **G2**: How is the silent-catch lint robust to legitimate "best-effort
  observability" try/catch blocks? Proposed: opt-in marker comment
  `// eslint-disable-next-line silent-catch — observability only` is
  required; the comment is itself flagged in PR review.
