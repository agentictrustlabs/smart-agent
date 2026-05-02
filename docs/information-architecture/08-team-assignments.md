# 08 — Team Assignments

Who does what to deliver this migration. Roles are from `docs/agents/`.

## Roster

| Role | Guide | Primary responsibility on this initiative |
|---|---|---|
| **Information Architect** (NEW) | [docs/agents/information-architect.md](../agents/information-architect.md) | Owns this folder. Approves every table placement and delegation scope. Resolves ownership disputes. Sequences phases in [07-build-plan.md](07-build-plan.md). |
| **Ontologist** | [docs/agents/ontologist.md](../agents/ontologist.md) | Adds the new T-Box terms in [06-data-ontology.md](06-data-ontology.md). Maintains C-Box enums. Confirms domain-neutrality of every new class. Updates GraphDB sync to publish new projections. |
| **Security** | [docs/agents/security.md](../agents/security.md) | Drafts and reviews the delegation-scope catalog for org-mcp (mirror of person-mcp's). Reviews every MCP tool's auth gate. Threat-models cross-principal delegation grants and the public-projection writer. |
| **Developer** | [docs/agents/developer.md](../agents/developer.md) | Implements the schemas, MCP tools, public-projection writers, on-chain event listeners, and rewires web actions. The bulk of code work. |
| **Tester** | [docs/agents/tester.md](../agents/tester.md) | Unit tests for every new MCP tool: happy path, scope-violation, delegation-revocation, JTI overuse, cross-principal grant scope. Tests for public-projection writes (assert GraphDB updated). |
| **Reviewer** | [docs/agents/reviewer.md](../agents/reviewer.md) | Code review against ownership invariants in [01-principles.md](01-principles.md). Rejects PRs that introduce cross-owner tables, web-side JOINs across boundaries, or shadow ownership. |
| **QA** | [docs/agents/qa.md](../agents/qa.md) | E2E specs for golden-path flows after each phase. Especially: log-in, view oikos, accept match, complete engagement, see review. |
| **Test User** | [docs/agents/user.md](../agents/user.md) | After each phase, runs `fresh-start.sh` and confirms the demo community looks right end-to-end. First to surface "this should still work" gaps. |
| **Infra** | [docs/agents/infra.md](../agents/infra.md) | Updates `scripts/fresh-start.sh` (`SERVICES`, `WIPE_PATHS`, `seed_after_deploy()`). Updates `scripts/deploy-local.sh` env propagation if MCPs need new contract addresses. CI: enforce `fresh-start.sh` smoke per merge. |
| **Documentarian** | [docs/agents/documentarian.md](../agents/documentarian.md) | Keeps this folder in sync as decisions evolve. Updates `docs/architecture/information-architecture.md` (the on-chain ER) to point at this folder. Records open-decisions outcomes. |
| **PM** | [docs/agents/pm.md](../agents/pm.md) | Files GitHub issues for each phase task in [07-build-plan.md](07-build-plan.md). Tracks gating between phases. Owns the per-phase acceptance criteria. |
| **Orchestrator** | [docs/agents/orchestrator.md](../agents/orchestrator.md) | Spawns sub-agents per phase. Holds quality gates. Merges only after IA approves the placement of each new concept. |

## Per-Phase Lead

| Phase | Primary | Supporting |
|---|---|---|
| 0 — Decisions + scaffolding | IA | Ontologist, Security, Developer, Infra |
| 1 — Person-MCP domain expansion | Developer | IA (review), Tester, Reviewer, QA, Test User |
| 2 — Org-MCP foundation | Developer | IA, Security (auth review), Tester, Reviewer |
| 3 — Org business data | Developer | IA, Tester, Reviewer, QA |
| 4 — Owner-routed intents | Developer | IA, Ontologist (projections), Reviewer, Tester, QA |
| 5 — Engagement decomposition | Developer | IA, Reviewer, Tester, QA, Test User |
| 6 — Trust deposits cleanup | Developer | Ontologist (aggregates), Tester |
| Final cleanup | Documentarian | IA, Infra |

## Hand-Off Contracts (so nothing falls between roles)

- **IA → Ontologist:** ownership-map row exists with chosen T-Box class name. Ontologist adds the term within one PR; if the class name changes, IA updates the ownership map.
- **IA → Developer:** target schema in [03-target-architecture.md](03-target-architecture.md) is the spec. Developer does not invent fields beyond it without filing an IA decision.
- **Security → Developer:** delegation-scope catalog is the source of truth for tool gates. Developer maps each tool to a scope from the catalog; new scopes require Security approval.
- **Developer → Tester:** every PR that adds an MCP tool includes a unit test for the happy path AND a scope-violation test.
- **Reviewer → IA:** reviewer flags any PR that introduces a cross-owner table, multi-store join, or unscoped tool to IA before approving.
- **Test User → PM:** if `fresh-start.sh` produces a demo that doesn't match the previous golden path, PM files a follow-up before merging the next phase.

## Integration with the Existing Pipeline

The Standard Feature Workflow in [docs/agents/orchestrator.md](../agents/orchestrator.md) is `PM → Developer → Tester → Reviewer → QA → Test User → merge`. For this initiative, insert IA at two points:

```
PM → IA (scope review) → Developer → Tester ┐
                                             ├→ QA → Test User → merge
                                  → Reviewer ┘
                                  → Ontologist (if T-Box change)
                                  → Security (if new delegation scope)
```

IA scope review is fast (≤1 day): does the proposed table belong where the issue says? Is the visibility tier right? Does the T-Box term exist? Is the delegation scope drafted?

## RACI (compact)

| Decision/Artifact | R | A | C | I |
|---|---|---|---|---|
| Where does concept X live? | IA | IA | Ontologist, Security, Developer | PM, Reviewer |
| New T-Box term | Ontologist | IA | Developer | Reviewer |
| New delegation scope | Security | IA | Developer | Reviewer |
| Schema implementation | Developer | Reviewer | IA, Tester | PM, QA |
| Fresh-start update | Infra | IA | Developer | PM |
| Public projection write | Developer | Ontologist | IA, Security | QA |
| Phase merge | Orchestrator | Orchestrator | All gates | PM |

Legend: R=Responsible, A=Accountable (final say), C=Consulted, I=Informed.
