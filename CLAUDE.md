# Smart Agent — Root Agent Context

## Project Overview
Smart Agent is an **Agent Smart Account Kit** — an ERC-4337 smart-account framework where agents are first-class principals operating under programmable delegation, session-scoped authority, and trust-graph-aware policy.

**Substrate independence (P1)**: We build our own contracts, our own SDK, our own wallet substrate. We learn from external products (Safe, Privy, MetaMask Delegation Toolkit, Aragon, Llama, Endaoment, Bulla, …) but **do not depend on them at runtime**. Open standards (ERC-4337, ERC-7710, ERC-1271, AnonCreds, OID4VCI, WebAuthn, SIWE) are protocols and are implemented ourselves. See **`docs/architecture/principles.md`** for the full rule + anti-patterns + waiver process.

pnpm monorepo, Next.js 15, Foundry, TypeScript strict.

## Structure
```
apps/web/              Next.js 15 App Router (passkey + SIWE auth, demo + Google OAuth, agent deployment UI)
apps/a2a-agent/        A2A protocol agent (Hono server, challenge auth, delegation minting)
apps/person-mcp/       Person MCP server (PII storage, delegation-verified tools)
packages/types/        Shared TypeScript types
packages/sdk/          TypeScript SDK (viem-based, delegation, sessions, crypto)
packages/discovery/    Knowledge base SDK (GraphDB SPARQL data access)
packages/contracts/    Foundry smart contracts (our own ERC-4337 + delegation)
docs/agents/           Role-specific agent guides
docs/ontology/         Agentic trust ontology (T-Box/C-Box/A-Box turtle files)
docs/specs/            Architecture spec and roadmap
```

## Architecture Navigation

All agents should start architecture-sensitive work from `docs/architecture/INDEX.md`.
It routes by concern area and role across system, technical, information, UX, operational,
GraphDB, A2A/MCP, on-chain, and funding architecture.

Use it before changing:
- service boundaries or MCP tools,
- data ownership or persistence,
- on-chain registries or GraphDB sync,
- auth, sessions, delegation, or permissions,
- UX flows that affect actions, funding, treasury, credentials, or trust,
- local orchestration, readiness, seed, or deployment behavior.

## Commands
```bash
pnpm dev               # Start web dev server → http://localhost:3000
pnpm build             # Build all packages
pnpm test              # Run all tests
pnpm lint              # Lint all packages
pnpm typecheck         # TypeScript check all packages
pnpm format            # Auto-format with Prettier
forge build            # Compile Solidity contracts (in packages/contracts)
forge test             # Run Forge tests
```

### Fresh start (canonical reset)

`scripts/fresh-start.sh` is the single command for "wipe everything and rebuild from zero" — new contract addresses, fresh SQLite + Askar, all services restarted, demo community re-seeded. Use it whenever:

- A contract change requires a redeploy.
- Demo state is corrupt or you want clean wallets/orgs/hubs.
- You're debugging something that smells like stale data.

```bash
./scripts/fresh-start.sh                 # full reset, wait for readiness
./scripts/fresh-start.sh --no-wait       # don't poll readiness
./scripts/fresh-start.sh --no-services   # only deploy + seed; skip server startup
```

Logs land in `tmp/logs/<service>.log`; pids in `tmp/pids/<service>.pid`.

When **adding new state or new services**, update three places (commented at the top of the script):
- `SERVICES` array — new backend services.
- `WIPE_PATHS` array — new on-disk DB / cache paths.
- `seed_after_deploy()` — extra forge / curl seed steps.

## Smart Contracts (packages/contracts)

| Contract | Purpose |
|----------|---------|
| `AgentAccount` | ERC-4337 smart account — agent identity, multi-owner, ERC-1271 |
| `AgentAccountFactory` | Deterministic CREATE2 deployment of account proxies |
| `DelegationManager` | Delegation issuance, EIP-712 signing, caveat enforcement, revocation |
| `ICaveatEnforcer` | Interface for caveat enforcer contracts |
| `TimestampEnforcer` | Time-window caveat (validAfter/validUntil) |
| `ValueEnforcer` | Max ETH value per call |
| `AllowedTargetsEnforcer` | Restrict to specific target contracts |
| `AllowedMethodsEnforcer` | Restrict to specific function selectors |

## SDK (packages/sdk)

| Export | Purpose |
|--------|---------|
| `AgentAccountClient` | Deploy accounts, query owners, encode execute calls |
| `DelegationClient` | Issue/sign/redeem/revoke delegations |
| `createAgentSession` | Session key generation + delegation packaging |
| `encodeTimestampTerms` | Build timestamp enforcer terms |
| `encodeValueTerms` | Build value enforcer terms |
| `encodeAllowedTargetsTerms` | Build allowed targets terms |
| `encodeAllowedMethodsTerms` | Build allowed methods terms |
| `buildCaveat` | Build Caveat struct from enforcer + terms |

## Discovery SDK (packages/discovery)

All reads from the GraphDB knowledge base go through `DiscoveryService` — no raw SPARQL in app code.

| Export | Purpose |
|--------|---------|
| `DiscoveryService` | High-level data access: `listAgents()`, `getAgentDetail()`, `getOutgoingEdges()`, etc. |
| `GraphDBClient` | Low-level SPARQL query/update/upload client |
| `PREFIXES` / `DATA_GRAPH` | Standard SPARQL namespace prefixes and named graph URI |
| `KBAgent` / `KBAgentDetail` / `KBRelationshipEdge` | Typed response interfaces |
| `AgentQueryOptions` | Filter/sort/paginate options for `listAgents()` |

```typescript
import { DiscoveryService } from '@smart-agent/discovery'
const discovery = DiscoveryService.fromEnv()
const agents = await discovery.listAgents({ agentType: 'org', search: 'church' })
```

## Coding Standards
- TypeScript strict — no `any`, no `@ts-ignore` without explanation
- Solidity `^0.8.28` — optimizer ON, 200 runs
- Server Components by default; `'use client'` only when required
- All blockchain operations server-side
- No private keys in `NEXT_PUBLIC_` variables
- App code imports from `@smart-agent/sdk`, never raw ABIs
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)

## Agent Team

Orchestrator + Sub-agent model. See `docs/agents/` for role guides.

| Role                     | Guide                                  |
|--------------------------|----------------------------------------|
| Orchestrator             | docs/agents/orchestrator.md            |
| PM                       | docs/agents/pm.md                      |
| Developer                | docs/agents/developer.md               |
| Tester                   | docs/agents/tester.md                  |
| Reviewer                 | docs/agents/reviewer.md                |
| QA                       | docs/agents/qa.md                      |
| Infra                    | docs/agents/infra.md                   |
| Test User                | docs/agents/user.md                    |
| Documentarian            | docs/agents/documentarian.md           |
| UI Designer              | docs/agents/ui-designer.md             |
| Ontologist               | docs/agents/ontologist.md              |
| Security                 | docs/agents/security.md                |
| Information Architect    | docs/agents/information-architect.md   |

### Feature Pipeline
```
PM → Developer → Tester → Reviewer → QA → Test User → merge
```

### Information-Architecture Pipeline
```
Concept proposed → IA classifies (store + tier) → Ontologist (T-Box term) → Security (delegation scope) → Developer → standard pipeline
```

Active initiative: data-store consolidation per `docs/information-architecture/`. Web SQL is becoming thin; private user/org data moves to `person-mcp` and `org-mcp`. No backwards-compat — `fresh-start.sh` re-seeds.

### Ontology Pipeline
```
SDK taxonomy change → Ontologist updates T-Box .ttl → Sync to GraphDB → SPARQL validation
```

<!-- SPECKIT START -->
Active feature plan: `specs/005-pledge-honor/plan.md` (Pledge Honor + Personal Treasury — settles spec-002/003 pledges).
Recently landed:
- `specs/004-anoncreds-marketplace-auth/plan.md` — AnonCreds-gated marketplace writes + admin→holder→session delegation chain
- `specs/005-pledge-honor/plan.md` — donor treasury + MockUSDC + two settlement rails (cryptographic + attested); `docs/ontology/SPEC005_PLEDGE_HONOR_AUDIT.md` for predicates
Sibling plans for the three-lane intent marketplace:
- `specs/001-intent-marketplace-discovery/plan.md` — Direct (Relationship) Lane
- `specs/002-intent-marketplace-pool/plan.md` — Pool Lane
- `specs/003-intent-marketplace-proposal/plan.md` — Proposal Lane

All three reuse the composite ranking formula `0.6 * 1/(1+hops) + 0.4 * (fulfilled+1)/(fulfilled+abandoned+2)` (Laplace-smoothed). The pure function lives in `@smart-agent/sdk/matchmaker/ranking.ts` (introduced by spec 001 and reused by 002/003 with side-specific signal computation). Each lane's terminal artifact (MatchInitiation / PoolPledge / GrantProposal) is the explicit contract handed to its downstream spec; field shapes are fixed in the respective plans' contracts/ directories.

All three lanes follow the established Smart Agent persistence pattern: **body in owner's MCP + conditional on-chain assertion + GraphDB mirror via the on-chain → GraphDB sync**. The MCP→GraphDB pipe is forbidden (IA P4); GraphDB only ever holds an instance of a public assertion class if a public on-chain assertion published it first. See `docs/information-architecture/10-intent-marketplace-classification.md` for the canonical persistence rules per artifact, and `docs/ontology/INTENT_MARKETPLACE_AUDIT.md` for the T-Box codification (including the `ProposalSubmission` → `GrantProposal` rename per § 2 O1, the formal `sa:Pool subClassOf sa:OrganizationAgent` and `sa:Fund subClassOf sa:Pool` typing per § 4 F2, and the SHACL visibility-cascade shapes in `docs/ontology/tbox/shacl/visibility.ttl`). The cross-spec `liveAcknowledgementCount` primitive (IA § 3.10) coordinates intent state across MCPs via system-delegation increments; intentionally NOT codified in T-Box (Audit § 2 O5).
<!-- SPECKIT END -->
