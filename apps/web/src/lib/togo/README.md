# Togo Revenue-Sharing Pilot — Extensions

This directory contains **Togo-specific** derived relationships, roles, delegation
configurations, and helper functions that extend the general Smart Agent platform
for the ILAD Mission Collective revenue-sharing pilot in Lomé, Togo.

## Architecture

The general platform provides:
- `src/db/schema.ts` — revenue_reports, capital_movements, training_modules/completions, proposals/votes tables
- `src/app/(authenticated)/revenue/` — Revenue reporting page (general)
- `src/app/(authenticated)/training/` — Training tracking page (general)
- `src/app/(authenticated)/portfolio/` — Portfolio health page (general)
- `src/app/(authenticated)/governance/` — Proposal & voting page (general)

This directory adds Togo-specific:
- **Derived roles** — BDC Trainer, Local Coordinator, Training Assessor, Business Owner mapped to delegation authority
- **Delegation configs** — What each Togo role can do (method + target + value caveats)
- **Wave definitions** — Investment wave progression logic (Wave 1 → 2 → 3 → Graduated)
- **BDC modules** — Training module definitions for the Business Development Center curriculum
- **Health scoring** — Business health score computation from revenue + training + time data

## Key Files

| File | Purpose |
|------|---------|
| `roles.ts` | Togo-specific role definitions and delegation authority mappings |
| `waves.ts` | Investment wave definitions, graduation criteria, pipeline logic |
| `bdc-modules.ts` | BDC training curriculum module definitions |
| `health.ts` | Business health score computation |

## Relationship to General Platform

Togo extensions never modify general platform code. They:
1. Export configs consumed by general UI components via template detection
2. Provide computed values (health scores, wave status) that general components display
3. Define seed data for the Togo demo environment

The general platform detects Togo use-case via `templateId` on org agents:
- `impact-investor` → CIL (shows portfolio, capital deployment views)
- `field-agency` → ILAD (shows training tracking, field ops views)
- `oversight-committee` → OOC (shows governance voting, review dashboards)
- `portfolio-business` → Individual businesses (shows revenue reporting, health)
