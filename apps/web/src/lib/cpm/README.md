# Church Planting Movement (CPM) — Extensions

This directory contains **CPM-specific** models, health scoring, and helper
functions that extend the general Smart Agent platform for church planting
movement tracking — inspired by tools like GAPP (thegapp.app).

## Architecture

The general platform provides:
- `src/db/schema.ts` — `activity_logs` and `gen_map_nodes` tables
- `src/app/(authenticated)/activities/` — General activity logging page
- `src/app/(authenticated)/genmap/` — Generational map visualization

This directory adds CPM-specific:
- **Group health model** — Four Fields / Church Circle health markers
- **Generational tree logic** — Computing generation depth, stream health, multiplication rate
- **Movement metrics** — Aggregate movement indicators across all streams
- **Role mappings** — CPM-specific delegation authority

## Key Files

| File | Purpose |
|------|---------|
| `group-health.ts` | Four Fields church health model and scoring |
| `generations.ts` | Generational tree computation, stream analysis |
| `index.ts` | Barrel export |

## Org Templates

- `movement-network` — Multi-agency coordination (shows gen map, movement metrics)
- `church-planting-team` — Field team (logs activities, manages groups)
- `local-group` — Individual house church / discipleship group

## Relationship to General Platform

CPM extensions detect their use case via `templateId`:
- `movement-network` → Shows gen map, movement analytics, cross-team activities
- `church-planting-team` → Shows activity logging, group health, gen map for own groups
- `local-group` → Shows own health data, activity logging
