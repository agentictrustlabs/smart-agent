# Phase F — Storage Layer (Postgres, LOCKED)

> **Status**: LOCKED v1 — F.2 chosen as the spec deliverable.
> **Depends on**: none (parallelizable with B/C/D/E/H after Phase A).
> **Unblocks**: Phase G CI guard around storage assumptions.

## Summary

External review P0-7: SQLite is single-instance-only; multiple processes
writing concurrently corrupt the DB or block. Currently every backend
service uses SQLite in dev (and many production runbooks still default
to it). **This phase migrates the production storage layer to Postgres.**

## Decision — F.2 is locked

The original draft offered two options:

- **F.1 — single-instance guard**: refuse to boot when SQLite + unset
  `DEPLOYMENT_SINGLE_INSTANCE_ACK`. ~1 day. Considered and **rejected**:
  the user chose long-term-correct architecture over a short-term
  unblock. F.1 asserts the deployment shape that the storage choice
  supports, but it leaves the underlying single-instance assumption in
  the code — every future feature has to remember not to violate it.
- **F.2 — full Postgres migration**: all production paths on Postgres;
  SQLite remains only as a `local-dev` opt-in. ~10–14 days. **LOCKED.**

Rationale (user direction 2026-05-18): the project rule against "patches
in dev mode" extends to architectural rails. Single-instance is a patch;
real multi-instance storage is the architecture. F.2 closes P0-7 once,
not "until we hit the next scale wall."

F.1 is documented here for the record only; no F.1 code lands.

## Table inventory (per service, what moves to Postgres)

Every table listed below moves out of SQLite and into Postgres. The
left column is the table; the right column is the owning service.

| Table                  | Owning service     | Notes |
|------------------------|--------------------|-------|
| `sessions`             | person-mcp         | Variant A delegation envelope + Variant B `sessionId`-to-onchain-hash binding. |
| `inter_service_nonces` | a2a-agent          | MAC replay protection; UNIQUE `(scope, nonce)`. |
| `action_nonces`        | a2a-agent          | Per-user action ordering; UNIQUE `(account, nonce)`. |
| `revocation_epochs`    | person-mcp         | Variant A off-chain revocation list (Phase B). |
| `action_counters`      | a2a-agent, org-mcp | `liveAcknowledgementCount` and similar IA-coordination counters. |
| `audit_rows`           | a2a-agent, all MCPs| Durable audit log; writes MUST complete pre-HTTP-response. |
| `credential_metadata`  | person-mcp         | AnonCred custodial metadata (links to issuer/holder records). |

Existing `users`, `orgs`, `pools`, etc. that live in `apps/web/src/db/`
also move to Postgres for production; the web layer is becoming thin
per the data-store consolidation initiative, so most of `web`'s SQLite
data has already migrated to person-mcp / org-mcp. What remains in web's
SQLite (session cookies, OAuth state) also moves.

## Schema choice — shared Postgres instance, database-per-MCP

**DECISION: shared Postgres server, separate database per owning service.**

- One `postgres:16-alpine` instance.
- Databases: `web`, `a2a_agent`, `person_mcp`, `org_mcp`,
  `people_group_mcp`, `family_mcp`, `geo_mcp`, `verifier_mcp`,
  `skill_mcp`.
- Each service connects to its own database via a service-specific env
  var: `PERSON_MCP_PG_URL`, `ORG_MCP_PG_URL`, `A2A_AGENT_PG_URL`,
  `WEB_PG_URL`, etc.
- IAM at the database level: each service's Postgres role can read/write
  only its own database. Cross-database joins are impossible by
  construction (consistent with Goal #5 of the master plan).

Considered and rejected:
- **One database, schema-per-MCP**: easier connection management but
  weaker isolation; a leaked connection string would expose all schemas.
- **Postgres-cluster-per-MCP**: maximal isolation but operationally
  expensive; not warranted for current scale.

## Connection pooling

Use `postgres.js` (already used elsewhere in the codebase for its
typed-query support) with the following settings per service:

- `max` connections: 10 (dev), 25 (prod default), tunable per service.
- `idle_timeout`: 30 seconds.
- `connect_timeout`: 5 seconds.
- `prepare`: false in dev (faster iteration), true in prod.

A single pool is created at service boot in `apps/<service>/src/db/pool.ts`
and exported as a typed Drizzle client. No raw query usage outside the
db layer.

## Drizzle migration tooling

Drizzle is already in use for web's SQLite. Repoint it to Postgres for
the migrated tables:

- `packages/db/drizzle.config.ts` adds Postgres dialect alongside
  existing SQLite config.
- Per-service migration directories: `apps/<service>/drizzle/`.
- `drizzle-kit generate` produces migration files; `drizzle-kit migrate`
  applies them.
- Migrations apply at service boot in dev (`fresh-start.sh`); in prod
  they apply via a separate `pnpm migrate:prod` step in the deploy
  pipeline.

## Transactional semantics

### Nonce inserts

`inter_service_nonces` and `action_nonces` use:

```sql
CREATE TABLE inter_service_nonces (
  scope    TEXT     NOT NULL,
  nonce    BYTEA    NOT NULL,
  used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, nonce)
);
```

Insert pattern: `INSERT ... ON CONFLICT (scope, nonce) DO NOTHING
RETURNING used_at`. The application checks whether the row was inserted;
a `null` return means the nonce was a replay and the request is rejected
401.

This replaces the current SQLite "SELECT then INSERT" pattern that is
racy under concurrency.

### Audit-row durability

Audit-row writes complete BEFORE the HTTP response returns. No
fire-and-forget. The application's response handler awaits the audit
INSERT and surfaces any failure as a 500. This is enforced via a
CI guard in Phase G (`no-async-audit-write.test.ts`).

## Local development

`scripts/fresh-start.sh` runs Postgres in Docker by default:

```bash
docker run -d --rm \
  --name smart-agent-postgres \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_USER=devuser \
  postgres:16-alpine
```

Followed by `psql` calls to create each per-service database. The
script's `SERVICES`, `WIPE_PATHS`, and `seed_after_deploy()` arrays gain:

- `WIPE_PATHS`: nothing on disk to wipe (Docker volume removed by `--rm`).
- New step: drop + recreate per-service databases at fresh-start time.
- New step: run `drizzle-kit migrate` per service before the existing
  seed steps.

A `--with-postgres` flag is added for clarity, but Postgres is the
default. Pass `--no-postgres` to skip the docker run (assumes Postgres
is already running, e.g. against a developer-shared instance).

## Production deployment

- AWS: managed Postgres (RDS). Env vars set via Terraform from
  Phase H. Each service's `*_PG_URL` points at its own database on the
  shared RDS instance.
- GCP: Cloud SQL Postgres. Same shape.
- Connection strings include SSL: `?sslmode=require`.
- Managed instance details (size, backups, HA) documented in
  `docs/runbooks/postgres-prod.md` (new doc, Phase H).

## Migration path — existing SQLite data

There is no production SQLite data to migrate (no prod deployment yet).
For developer machines:

- A one-time export script `scripts/export-sqlite-to-postgres.ts` reads
  each service's SQLite DB and writes to the new Postgres database.
- Used only for developers who want to preserve local demo state across
  the F.2 cutover. Most developers will run `fresh-start.sh` and re-seed.
- The script is NOT part of the production deployment pipeline; it is a
  one-shot dev-convenience utility.

## Startup guard

Each service refuses to start when:

- `*_PG_URL` env var is missing, OR
- `*_PG_URL` parses as a `sqlite://` URL, OR
- the Postgres connection probe fails after 3 retries with exponential
  backoff.

The guard runs in each service's `boot-seed.ts` / `index.ts` before any
HTTP listener binds. A failed guard exits process with code 1 and a
loud error message.

Test fixtures that intentionally run against SQLite for unit tests set
an explicit `ALLOW_SQLITE_FOR_TESTS=true` env var checked alongside
`NODE_ENV !== 'production'`. Setting `ALLOW_SQLITE_FOR_TESTS` in
production exits immediately.

## Concrete deliverables

- `packages/db/drizzle.config.ts` adds Postgres dialect.
- Per-service `drizzle/` directories with initial migrations.
- `apps/<service>/src/db/pool.ts` for each service.
- `scripts/fresh-start.sh` runs Postgres + migrations + per-service db
  creation.
- `scripts/export-sqlite-to-postgres.ts` for the one-time dev cutover.
- Updated `docs/runbooks/postgres-prod.md` (new doc).
- Updated env reference: `*_PG_URL` per service.
- Phase G CI guards: `no-sqlite-import-in-production.test.ts`,
  `no-async-audit-write.test.ts`.

## Acceptance criteria

- [ ] Every production code path uses Postgres for the tables in the
      inventory above.
- [ ] `grep -rn "from 'better-sqlite3'" apps/*/src/` returns hits only
      from explicit dev-only files (e.g. `apps/web/src/db/dev-sqlite.ts`
      gated by `ALLOW_SQLITE_FOR_TESTS`).
- [ ] `(scope, nonce)` UNIQUE constraint enforced; nonce replay test
      passes (concurrent identical inserts → exactly one succeeds).
- [ ] Connection pool configured per service; load test confirms no
      "too many clients" errors at expected concurrency.
- [ ] Audit-row writes complete pre-HTTP-response: test instruments a
      slow Postgres and confirms the HTTP response waits.
- [ ] Startup guard test: missing `*_PG_URL` → process exits with code 1.
- [ ] Startup guard test: `sqlite://` URL in production → exit code 1.
- [ ] `fresh-start.sh` boots cleanly with Postgres in Docker by default.
- [ ] All existing integration tests pass against Postgres.
- [ ] Phase G CI guard "no SQLite imports in production paths" passes.

## Open questions

- **F1**: Should each service get its own Postgres user (role) on the
  shared instance, or share a single `devuser`? **Proposed**: per-service
  role, with database-level grants only on the service's own database.
  Locks in the multi-tenant isolation property at the storage layer.
- **F2**: Are there any tables that SHOULD remain SQLite for their
  workload shape (e.g. heavily-written, never-shared local caches)?
  **Proposed**: no. Any local cache is rebuilt on boot; nothing
  authoritative lives in SQLite post-F.2.
- **F3**: How does the `liveAcknowledgementCount` cross-MCP increment
  (IA § 3.10) work across separate databases? **Proposed**: the existing
  system-delegation increment pattern stays; each MCP writes its own
  counter row in its own database; the reconciliation read fans out
  across MCPs. No cross-database join required.

## Considered and rejected

### F.1 — Single-instance guard

Refuse to start when `DATABASE_URL` is SQLite and
`DEPLOYMENT_SINGLE_INSTANCE_ACK !== 'true'`. ~1 day of work.

**Rejected** at user direction 2026-05-18. F.1 prevents the "two
instances against one SQLite file" foot-gun but locks in the
single-instance assumption everywhere else in the code. F.2 closes the
class of problem; F.1 only flags it. The user explicitly chose
long-term-correct architecture over a short-term unblock. No F.1 code
lands.
