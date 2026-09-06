# Architecture X-Ray

Design architectures and understand why they fail. An architecture reasoning tool with two modes:

- **Destruction mode** - load an architecture, scan it, and watch six independent analysis engines (reliability, scalability, security, cost, operations, AI) find realistic ways it breaks. Click a finding to see the exact components and relationships behind it, attack any component to see the blast radius, follow a request hop by hop, apply a fix and compare before/after.
- **Architect mode** - requirements to a complete architecture (next slice; not wired yet).

The reasoning is deterministic and runs over a typed architecture graph. No external services are needed to run the demo.

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
src/app/api/           Thin HTTP layer over the engine (demo, analyze, simulate, trace, fix, health)
src/lib/               Client store (zustand) and API client
src/components/        UI: canvas (React Flow + ELK layout), right panel, bottom panel, shell
docs/                  Architecture documentation
```

See `docs/ARCHITECTURE.md` for the data model, the engines and how to extend them.
