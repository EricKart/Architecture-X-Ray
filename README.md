# Architecture X-Ray

Design architectures and understand why they fail. An architecture reasoning tool with two modes:

- **Destruction mode** - load an architecture (the built-in demo, a plain-English description, a diagram image, or a structured JSON graph), scan it, and watch six independent analysis engines (reliability, scalability, security, cost, operations, AI) find realistic ways it breaks. Click a finding to see the exact components and relationships behind it, attack any component to see the blast radius, follow a request hop by hop, apply a fix and compare before/after.
- **Architect mode** - describe a system in a sentence, review the inferred requirements, and generate a complete architecture: component inventory, request flows, Architecture Decision Records, a cost model, and the same destruction-engine scan run against the proposal. Compare it against whatever you scanned in Destruction mode.

The reasoning is deterministic and runs over a typed architecture graph. No external services, and no cloud account, are needed to run this tool or anything it generates.

**No cloud account? No problem.** Architect mode's cloud-provider field includes **Generic / self-hosted** alongside Azure, AWS and Google Cloud. Pick it (or just say "student project", "portfolio project", "no cloud account" or "docker compose" in the brief) and every managed service maps to a free, open-source equivalent that runs in Docker on your own machine - PostgreSQL, Redis, RabbitMQ, MinIO, Keycloak, Qdrant/pgvector, Prometheus+Grafana, and Ollama for AI instead of a paid model API. The generated cost is $0/month, and the destruction engine still scans it honestly: it will correctly flag your single Docker container as a single point of failure, your `.env` file as a weak secrets story, and so on - that's the point. It shows you exactly what changes when the same design moves to a real cloud provider, which is the whole value of this tool for students, early-career engineers, and anyone skilling up without a company card.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000, then press **Scan demo architecture**.

Other commands:

```bash
npm run build      # production build
npm start          # serve the production build
npm test           # engine unit tests (vitest)
npx tsc --noEmit   # type-check
```

## Optional: AI enrichment

Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` to enable AI-assisted ingestion (architecture descriptions and diagram images) and richer explanations. Everything else works without it.

## Project structure

```
src/engine/            Pure TypeScript reasoning engine (no React, no Next.js)
  graph/               Typed architecture graph: types, builder, zod schema, queries, patches
  demo/                Built-in demo architecture (AI document SaaS with hidden weaknesses)
  simulation/          Failure propagation ("attack this component") and request tracing
  analysis/            Independent engines: reliability, scalability, security, cost, operations, ai
  scoring/             Dimension scores with confidence, complexity score
  teaching/            Three-level explanations (beginner / engineer / architect)
  architect/           Requirements model + rules-based generator (Architect mode), incl. the generic/self-hosted provider
  ingestion/           Turns a description, image, or structured JSON into a graph
src/ai/                Optional Anthropic-backed extraction/explanation (used only when ANTHROPIC_API_KEY is set)
src/app/api/           Thin HTTP layer over the engine (demo, analyze, simulate, trace, fix, ingest, architect, explain, health)
src/lib/               Client store (zustand) and API client
src/components/        UI: canvas (React Flow + ELK layout), right/bottom panels, Architect view, import dialog, shell
docs/                  Architecture documentation
```

See `docs/ARCHITECTURE.md` for the data model, the engines and how to extend them.
