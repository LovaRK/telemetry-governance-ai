# ARCHITECTURE MAP

## Preserved Flow
Splunk -> Normalization -> Deterministic KPIs -> LLM reasoning -> Governance -> UI

## Bottleneck Severity Table

| Subsystem | Severity | Evidence | Estimated Gain | Phase |
|---|---:|---|---:|---|
| Dashboard query duplication | High | Multiple route-level fetches and dashboard-specific API calls across `apps/web/app/page.tsx` and related APIs | High | P3 |
| Executive summary rebuild | High | `apps/web/app/api/executive-summary/route.ts` combines variance, KPI trends, and summary synthesis on request | High | P6 |
| Splunk fetch latency | High | Per-source fetch flow in runtime path; current plan targets Splunk-side optimization first | High | P5 |
| KPI recomputation | Medium-High | Current pipeline recomputes deterministic KPIs per refresh and per delta path | Medium-High | P4/P6 |
| Browser rendering | Medium | Wide KPI/cards/charts surface and audit evidence paths; layout has already needed fixes | Medium | P2/P10 |
| Settings/runtime validation | Medium | Anthropic and explainability settings path required runtime QA and persistence fixes | Medium | Phase 1 |

## Inventory Snapshot
- Modules cruised: 387
- Dependencies cruised: 467
- Circular dependencies: 0
- Route pages: 11
- Route APIs: 68
- Migrations present: 40

## Evidence Source
- Source-only dependency graph generated from `madge` after excluding `node_modules`
- `dependency-cruiser` was attempted, but the clean inventory artifact in this workspace is the source-only graph captured in `dependency-graph.json`

## Freeze Boundary
- `v0.9-trust-baseline` = trust/explainability frozen
- `v1.0-incremental-baseline` = incremental pipeline frozen
- `v1.1-runtime-stable` = runtime QA frozen
