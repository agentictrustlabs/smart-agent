# Smart Agent — Root Agent Context

## Project Overview
Smart Agent is an **Agent Smart Account Kit** — an ERC-4337 smart-account framework where agents are first-class principals operating under programmable delegation, session-scoped authority, and trust-graph-aware policy.

Own contracts, own SDK. Delegation patterns inspired by ERC-7710 and MetaMask DeleGator concepts, but fully independent implementation.

pnpm monorepo, Next.js 15, Foundry, TypeScript strict.

## Structure
```
apps/web/              Next.js 15 App Router (Privy auth, agent deployment UI)
packages/types/        Shared TypeScript types
packages/sdk/          TypeScript SDK (viem-based, no external smart account deps)
packages/contracts/    Foundry smart contracts (our own ERC-4337 + delegation)
docs/agents/           Role-specific agent guides
docs/specs/            Architecture spec and roadmap
```

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

| Role         | Guide                          |
|--------------|--------------------------------|
| Orchestrator | docs/agents/orchestrator.md    |
| PM           | docs/agents/pm.md              |
| Developer    | docs/agents/developer.md       |
| Tester       | docs/agents/tester.md          |
| Reviewer     | docs/agents/reviewer.md        |
| QA           | docs/agents/qa.md              |
| Infra        | docs/agents/infra.md           |
| Test User    | docs/agents/user.md            |
| Documentarian| docs/agents/documentarian.md   |

### Feature Pipeline
```
PM → Developer → Tester → Reviewer → QA → Test User → merge
```
