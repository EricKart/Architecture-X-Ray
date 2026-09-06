# Architecture X-Ray - internal architecture

## Pipeline

```
ingestion  ->  architecture graph  ->  analysis engines  ->  scoring  ->  visualisation
(demo / structured JSON / AI extraction)      (reliability, scalability, security,      (dimension scores,    (canvas, panels,
                                               cost, operations, ai)                     confidence)          simulations)
```

Every layer is a plain TypeScript module under `src/engine/` with no framework dependency. The Next.js API routes in `src/app/api/` are a thin HTTP boundary that validates input with zod and calls the engine. The UI never computes findings itself.

## The graph (`src/engine/graph/types.ts`)

An `ArchitectureGraph` holds:

- `components` - typed nodes with complete profiles: `scaling`, `redundancy`, `backup`, `observability`, `security`, `cost`, `operations` and an optional `ai` profile. The builder fills defaults so engines never null-check.
- `edges` - directed relationships where **source NEEDS target**. Each edge carries `kind` (calls, reads, writes, publishes, consumes, authenticates_with, routes_to, egress_via, ...), `sync`/`async`, `hard`/`soft` criticality, protocol, encryption, authentication, data classification, timeout, circuit breaker, fallback, and `connectionsPerInstance` for pool maths.
- `zones` - network/trust boundaries with a numeric trust level; `regions` with availability zones.
- `flows` - canonical request paths (normal, authenticated, db read/write, AI inference, RAG, async job, upload) with a traffic share. Flows drive user-impact estimation and per-component demand.
- `traffic`, `targets`, `assumptions`, `unknowns`.

Every component, edge and evidence statement carries an `EvidenceLevel`: `fact`, `inference`, `assumption` or `unknown`. Findings must cite evidence; the UI renders the level next to every statement.

`GraphIndex` (`queries.ts`) provides dependents/dependencies, transitive closures, trust-boundary checks and BFS attack paths.

## Simulation (`src/engine/simulation/`)

`simulateFailure(graph, scenario)` seeds a failure (component, AZ, region, DNS, certificate, egress, identity provider, AI provider) and propagates it along runtime dependency edges:

| Target state | Edge | Source becomes |
|---|---|---|
| down | hard + sync, no fallback | down |
| down | hard + fallback, or async, or soft | degraded |
| degraded | hard | degraded |

Flows are then evaluated (a flow is down if any step is down). Output: affected components with reasons and depth, flow impact, criticality-weighted blast radius, user impact, recovery path/time and data-loss estimate derived from redundancy and backup profiles, and an `isSpof` verdict.

`traceFlow` annotates each hop of a flow with protocol, boundary crossings, latency estimate and warnings.

## Engines (`src/engine/analysis/`)

Each engine is `analyzeX(graph) -> { findings, report }` and is independent. `index.ts` runs all of them, ranks findings, picks the three most dangerous (preferring engine diversity) and computes scores.

- **reliability** - runs the standard scenario catalogue through the simulator; SPOFs, single region/zone, backup and RPO posture, missing timeouts/circuit breakers on external calls, certificate expiry, provider outages.
- **scalability** - capacity model at 1x/2x/5x/10x/50x. Per component: compute throughput (instances x rps), worker job throughput vs. queue inflow, database connections (sum of dependents' instances x pool size vs. max_connections), write throughput on a single primary, read throughput with replicas and cache absorption, cache ops, vector/search qps, queue msg/s, provider RPM/TPM limits. Produces a break order and one finding per bottleneck with the mechanism spelled out.
- **security** - public data stores, entry points without WAF, unencrypted/unauthenticated edges, secrets source, IAM scope, PII to external AI providers, prompt injection with tool access over untrusted input, multi-tenant vector stores, audit logging. Each finding has an attack path from the internet when one exists.
- **cost** - monthly/annual ranges from component profiles (type-based ranges when absent, labelled as assumptions), category breakdown, and optimisations (overprovisioned floors, oversized databases, unmanaged AI spend, log retention, storage lifecycle, NAT egress) with current vs. optimised totals.
- **operations** - the "3 AM" checklist: alerting, tracing, runbooks/ownership, deployment safety, migrations, IaC drift, failover, restore rehearsal, hidden dependencies.
- **ai** - only when AI components exist: single provider, rate-limit handling, synchronous inference in the request path, unpinned models, spend caps, vector index recoverability and observability.

Findings share one shape (`analysis/types.ts`): severity, confidence, title, evidence[], mechanism, impact, recommendation, tradeoff, affected components/edges, score dimensions, and an optional `fix` (a `GraphPatch`). Patches are applied by `graph/patch.ts`; the fixed graph is re-analysed to produce the before/after diff.

## Scoring (`src/engine/scoring/scores.ts`)

Each dimension starts at 100; findings subtract severity x dimension-weight with diminishing returns per category, then the total is compressed exponentially so a badly broken architecture still spreads between 5 and 40 rather than flooring at zero. Confidence is derived from the share of `fact` evidence behind the contributing findings. AI is scored only when applicable. Maintainability adds a structural complexity penalty.

## Teaching (`src/engine/teaching/explain.ts`)

Three-level explanations are composed from category templates (analogy + systemic framing) and the finding's own evidence, mechanism and tradeoff.

## UI (`src/components/`)

- `AppShell` - navigation (Architect / Destruction), scan control, layout.
- `canvas/ArchitectureCanvas` - React Flow with ELK layered layout; zones are compound nodes. Node/edge styling is derived from store state: selection, finding highlight, failure simulation (down/degraded), request trace (step-by-step).
- `panels/RightPanel` - graph overview, component detail (inventory fields, dependencies, findings, attack/trace actions), finding detail (evidence with FACT/INFERENCE/ASSUMPTION/UNKNOWN chips, attack path, mechanism, impact, recommendation, tradeoff, apply-fix, three-level explanation).
- `panels/BottomPanel` - findings, attack scenarios, request traces, scalability tiers, cost model, operations checklist, scores and before/after diff.
- `lib/store.ts` - zustand store; all engine calls go through `lib/api.ts` to the API routes.

## Extending

- New input format: add a module under `src/engine/ingestion/` that returns an `ArchitectureGraph` (mark evidence as `inference` for anything derived) and register it in the ingest route.
- New engine: implement `analyzeX(graph)` returning findings, add it to `analysis/index.ts`, optionally add a score dimension.
- New failure scenario: extend `ScenarioKind` and `seedsFor` in `simulation/failure.ts`.
- New teaching template: add a category entry in `teaching/explain.ts`.
