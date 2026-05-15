# Local Development Orchestration

This document describes the local development process topology, fresh-start flow, deployment, seeding, and readiness checks.

## Local Process Topology

```mermaid
flowchart TB
  dev["Developer"]
  fresh["scripts/fresh-start.sh"]
  anvil["Anvil :8545"]
  deploy["scripts/deploy-local.sh"]
  web["apps/web :3000"]
  a2a["apps/a2a-agent :3100"]
  person["person-mcp :3200"]
  peopleGroup["people-group-mcp :3300"]
  org["org-mcp :3400"]
  family["family-mcp :3500"]
  geo["geo-mcp :3600"]
  verifier["verifier-mcp :3700"]
  skill["skill-mcp :3800"]
  hub["hub-mcp :3900"]
  seeds["seed scripts and boot-seed"]
  readiness["system readiness checks"]

  dev --> fresh
  fresh --> anvil
  fresh --> deploy
  fresh --> web
  fresh --> a2a
  fresh --> person
  fresh --> peopleGroup
  fresh --> org
  fresh --> family
  fresh --> geo
  fresh --> verifier
  fresh --> skill
  fresh --> hub
  fresh --> seeds
  fresh --> readiness
```

## Fresh Start Lifecycle

```mermaid
sequenceDiagram
  participant Dev as Developer
  participant Fresh as fresh-start.sh
  participant Disk as Local DBs and stores
  participant Anvil as Anvil
  participant Deploy as deploy-local.sh
  participant Services as Web, A2A, MCPs
  participant Seed as Seed routes and scripts
  participant Ready as Readiness checks

  Dev->>Fresh: Run fresh start
  Fresh->>Disk: Wipe local DBs and Askar stores
  Fresh->>Anvil: Start local chain
  Fresh->>Deploy: Deploy contracts
  Deploy->>Anvil: Broadcast Foundry script
  Deploy-->>Fresh: Contract addresses
  Fresh->>Services: Start service processes
  Fresh->>Seed: Run boot and demo seeds
  Seed->>Services: Populate local data
  Fresh->>Ready: Check system readiness
  Ready-->>Dev: Local stack ready
```

Key files:

- `scripts/fresh-start.sh`
- `scripts/deploy-local.sh`
- `scripts/seed-*.sh`
- `scripts/seed-*.ts`
- `apps/web/src/app/api/boot-seed/route.ts`
- `apps/web/src/app/api/system-readiness/route.ts`
- `apps/web/src/app/api/ontology-sync/route.ts`

## Deploy Flow

```mermaid
flowchart LR
  forge["Forge deploy script"]
  anvil["Anvil RPC"]
  addresses["Deployed addresses"]
  env["apps/web/.env"]
  web["Web"]
  mcps["MCPs"]

  forge --> anvil --> addresses --> env
  env --> web
  env --> mcps
```

Deployment writes contract addresses into local env so the web app and services can read:

- account factory address
- delegation manager address
- caveat enforcer addresses
- registry addresses
- token and treasury-related addresses

## Local State Wipe

The fresh-start flow wipes local state including:

- `apps/web/local.db`
- MCP local SQLite databases
- A2A local SQLite database
- Askar stores
- generated local bootstrap state

This is expected in dev. Do not rely on local DB persistence across fresh starts unless the script is changed.

## Service Startup Model

The root `package.json` includes:

- `pnpm dev` for web plus A2A
- `pnpm dev:web`
- `pnpm dev:a2a`
- `pnpm dev:mcp` for person MCP

`fresh-start.sh` starts the full multi-service stack, including all MCP services.

## Readiness Model

```mermaid
flowchart TD
  readiness["/api/system-readiness"]
  webEnv["Web env and DB"]
  chain["RPC and deployed contracts"]
  a2a["A2A service"]
  mcpHealth["MCP health endpoints"]
  graph["GraphDB and ontology sync"]

  readiness --> webEnv
  readiness --> chain
  readiness --> a2a
  readiness --> mcpHealth
  readiness --> graph
```

Readiness checks intentionally use direct health endpoints. This is an allowed bypass because it is operational, not user-authorized domain work.

## Logs And PIDs

The orchestration scripts write process state and logs under local temp paths such as:

- `tmp/pids`
- `tmp/logs`

Use these for debugging long-running local services.

## Development Guidance

- Use `fresh-start.sh` for a clean full-stack local reset.
- Use `deploy-local.sh` after contract changes.
- Re-run seed scripts when demo data or registry shape changes.
- If a service appears healthy but the UI is stale, check GraphDB sync and local web caches.
- Treat direct health checks as operational exceptions to the A2A-first architecture.
