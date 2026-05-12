# Spec 005 — v2 Backlog

Work explicitly out of v1 scope. Each item has a one-line scope + a one-line rationale for why
it's not in v1.

---

## V1 was scoped down to these constraints

- USDC-only honor path (donor → pool treasury USDC transfer).
- Mark-paid auth = direct fund owner only (no cross-delegation).
- Evidence storage = sha256 hash on chain; admin pastes pre-computed hash; no HTTP fetch.
- Treasury identity = bound to person agent (linkable, NOT donor-anonymous).
- No streaming / recurring auto-honor.

Everything below is deferred but explicitly captured.

---

## V2.1 — Cross-delegation for steward mark-paid

**Scope**: Let a pool steward (delegate of the fund owner via cross-delegation) call
`PledgeRegistry.markPaid` when they aren't the direct fund owner.

**Why deferred**: requires extending the registry's auth modifier to support delegated-call
verification (read DelegationManager state from the registry). Adds complexity not needed for
v1 demos. v1 admin = direct owner only.

**Pattern**: similar to `requireOrgPrincipalViaCrossDelegation` in org-mcp's principal-context.

---

## V2.2 — Non-USDC settlement for non-monetary pledges

**Scope**: Honor pledges denominated in `prayer-minutes`, `hours`, `meals`, `coaching-hours`,
etc., with appropriate settlement evidence (logs, attestations) rather than ERC-20 transfers.

**Why deferred**: requires either (a) an attested honor rail that's NOT the markPaid rail —
e.g. "logged 30 prayer-minutes" as a holder-signed attestation, OR (b) bespoke per-unit
settlement contracts (a "prayer log" registry).

**v1 workaround**: non-USDC pledges use `markPaid` attestation only. UI surfaces "Honor via
external mark-paid only" copy.

---

## V2.3 — Shielded donor anonymity

**Scope**: Allow honoring without revealing the link between donor's person agent and the
pool. Today `personalTreasury` is linkable via `sa:hasPersonalTreasury` and the on-chain
transfer.

**Why deferred**: requires a shielded pool, mixer, or ZK-proof of payment without revealing
the source. Significant cryptographic engineering. Probably depends on a Semaphore or MACI-
style nullifier system layered on top of token transfers.

**v1 stance**: documented as explicit trade-off in `threat-model.md`. Treasuries are
linkable BY DESIGN in v1.

---

## V2.4 — IPFS / Arweave evidence resolvers

**Scope**: In addition to org-mcp blob storage, support `ipfs://`-prefixed or `ar://`-prefixed
URIs in `pledgeEvidenceHash`. Or: keep the hash on chain, but add a side-channel registry of
"where to find a blob with this hash" (IPFS pin, Arweave tx, mirror server, etc.).

**Why deferred**: would require an IPFS pin infra (Pinata, NFT.Storage, web3.storage) that
violates P1 if we depend on a hosted SaaS. Self-hosting an IPFS node is significant infra.

**v1 stance**: org-mcp blob is the only resolver. Hash-on-chain is the anchor; org-mcp serves
the blob.

---

## V2.5 — HTTP `/evidence/:hash` fetch endpoint on org-mcp

**Scope**: org-mcp serves `GET /evidence/:hash` returning the blob, gated on viewer being a
member of the pool/fund whose pledge references this hash.

**Why deferred**: requires evidence-membership ACL logic + cross-org resolution (some orgs may
host evidence for hashes owned by other orgs). v1 keeps it simple: admin pastes the hash,
sees the doc locally, anyone who has the doc can verify.

---

## V2.6 — Treasury reporting UX

**Scope**: Batch-payment composer (honor multiple pledges in one tx), payroll-style summaries,
expense categorization, period reports.

**Why deferred**: not a primitive — pure UX layer. Build after the primitive lands and we see
which patterns matter.

---

## V2.7 — Streaming honor via Sablier / Superfluid

**Scope**: For recurring pledges (`monthly`, `annual`, `recurring` cadence), optionally back
them with a token stream from donor treasury to pool. Monthly drip auto-triggers
`recordHonor`.

**Why deferred**: Sablier / Superfluid integration would either (a) violate P1 if we depend on
their contracts, or (b) require re-implementing streaming ourselves. Either way, not a v1
deliverable.

**v1 stance**: recurring pledges are committed monthly amounts; donor honors each period
manually.

---

## V2.8 — Treasury balance views as on-chain reads

**Scope**: Replace any web-side balance fetches with an indexed view (subgraph-style) so
historical balance changes are queryable without per-tx RPC calls.

**Why deferred**: v1 reads balance per page render. Fine at demo scale, slow at production
scale. Solution is an in-house indexer (per P1, no SaaS subgraph).

---

## V2.9 — Multi-currency reconciliation aggregates

**Scope**: When a pool accepts pledges in multiple units (USD + EUR + prayer-minutes), present
a unified "pool settled %" that's meaningful across units. Requires an FX policy.

**Why deferred**: opinionated UX. v1 shows per-unit aggregates only.

---

## V2.10 — Treasury rotation / multi-owner

**Scope**: Add/remove owners on the personal treasury without redeploying. Multi-owner mode
for "household" treasuries.

**Why deferred**: AgentAccount already supports `addOwner` / `removeOwner` — but no UI for
treasuries specifically. v1 personal treasury = single-owner = the user's person agent
owner.

---

## How items move from V2 backlog → spec

When ready: create `specs/00X-<name>/` per the pattern in this folder, with `plan.md` +
`comparison.md` (per P1) + per-domain docs.
