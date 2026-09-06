import type { ArchitectureGraph } from "../graph/types";
import { indexGraph } from "../graph/queries";
import type { Finding } from "./types";

/**
 * AI-architecture attack. Only runs when the graph contains model providers,
 * embedding services or vector stores. Security-flavoured AI risks (data
 * leakage, prompt injection, tenant isolation) live in the security engine;
 * this engine covers availability, cost control and operability of AI paths.
 */
export function analyzeAi(graph: ArchitectureGraph): { findings: Finding[]; applicable: boolean } {
  const idx = indexGraph(graph);
  if (!idx.hasAi()) return { findings: [], applicable: false };
  const findings: Finding[] = [];

  for (const c of graph.components) {
    if (!c.ai || c.ai.standby) continue;

    if (c.ai.role === "llm" || c.ai.role === "embedding") {
      if (!c.ai.fallbackProvider && !c.ai.fallbackModel) {
        const callers = idx.dependents(c.id).map((e) => idx.component(e.source));
        findings.push({
          id: `ai-single-provider-${c.id}`,
          engine: "ai",
          category: "single_model_provider",
          severity: "high",
          confidence: "high",
          title: `${c.name} is the only model provider; ${callers.map((x) => x.name).join(" and ")} have no fallback model, region or provider when it is down or throttled.`,
          evidence: [
            { level: "fact", statement: `${c.name}: fallbackProvider = none, fallbackModel = none, rateLimitHandling = ${c.ai.rateLimitHandling ?? "none"}.`, componentIds: [c.id] },
            { level: "fact", statement: `Callers: ${callers.map((x) => x.name).join(", ")}.`, componentIds: callers.map((x) => x.id) },
          ],
          mechanism: "Hosted model APIs have incidents, regional capacity limits and deprecations on their own schedule. Every AI feature (chat, RAG, embeddings for ingestion) shares the same single dependency and fails together.",
          impact: "AI features - the product's core value - are unavailable for the duration of provider incidents; ingestion stalls and queues back up.",
          recommendation: "Introduce a model gateway (self-hosted or managed) with a secondary provider/model, health-based routing, per-tenant limits and a compatibility test suite for prompts across models.",
          tradeoff: "Prompt behaviour differs across models; a gateway is one more component; secondary providers may not offer identical embeddings (keep embeddings pinned to one model and re-embed deliberately).",
          affectedComponentIds: [c.id, ...callers.map((x) => x.id)],
          affectedEdgeIds: idx.dependents(c.id).map((e) => e.id),
          dimensions: { ai: 1, reliability: 0.5 },
          fix: { description: `Fallback model for ${c.name}`, updateComponents: [{ id: c.id, patch: { ai: { ...c.ai, fallbackProvider: "secondary provider", fallbackModel: "equivalent model", rateLimitHandling: "circuit_breaker" }, redundancy: { ...c.redundancy, replicas: 2, failover: "automatic" } } }] },
        });
      }

      if ((c.ai.rateLimitHandling ?? "none") === "none" && c.provider !== "self_hosted") {
        findings.push({
          id: `ai-rate-limit-${c.id}`,
          engine: "ai",
          category: "no_rate_limit_handling",
          severity: "high",
          confidence: "high",
          title: `Provider throttling (HTTP 429) from ${c.name} is passed straight to users: no queue, backoff or circuit breaker exists.`,
          evidence: [
            { level: "fact", statement: `${c.name}: rateLimitHandling = none; limits ${c.scaling.requestsPerMinuteLimit ?? "unknown"} RPM / ${c.scaling.tokensPerMinuteLimit?.toLocaleString() ?? "unknown"} TPM.`, componentIds: [c.id] },
            graph.traffic?.aiRequestsPerSecond
              ? { level: "inference", statement: `Current AI demand ~${graph.traffic.aiRequestsPerSecond * 60} RPM and ~${((graph.traffic.aiRequestsPerSecond * 60 * (graph.traffic.avgTokensPerAiRequest ?? 1000)) / 1000).toFixed(0)}k TPM${c.scaling.tokensPerMinuteLimit ? ` (${Math.round(((graph.traffic.aiRequestsPerSecond * 60 * (graph.traffic.avgTokensPerAiRequest ?? 1000)) / c.scaling.tokensPerMinuteLimit) * 100)}% of the TPM limit)` : ""}.` }
              : { level: "unknown", statement: "AI request volume not supplied." },
          ],
          mechanism: "Provider limits are enforced per organisation, not per user. One tenant's bulk upload consumes the token budget and every other tenant's chat starts failing with 429s. Retries without backoff make it worse.",
          impact: "Noisy-neighbour outages of AI features during exactly the moments of highest usage.",
          recommendation: "Route through a gateway that applies per-tenant token budgets, queues bulk/offline work (embeddings) separately from interactive traffic, retries with jittered backoff, and sheds load gracefully.",
          tradeoff: "Interactive requests may queue briefly; requires a fairness policy between tenants.",
          affectedComponentIds: [c.id],
          affectedEdgeIds: idx.dependents(c.id).map((e) => e.id),
          dimensions: { ai: 0.9, scalability: 0.4 },
          fix: { description: `Rate-limit handling for ${c.name}`, updateComponents: [{ id: c.id, patch: { ai: { ...c.ai, rateLimitHandling: "queue" } } }] },
        });
      }

      const syncCallers = idx.dependents(c.id).filter((e) => e.sync === "sync");
      if (syncCallers.length && (c.ai.timeoutMs ?? 0) >= 30_000) {
        findings.push({
          id: `ai-sync-latency-${c.id}`,
          engine: "ai",
          category: "sync_inference_in_request_path",
          severity: "medium",
          confidence: "medium",
          title: `Model calls to ${c.name} run synchronously inside the request path with a ${(c.ai.timeoutMs ?? 0) / 1000}s timeout, so p95 latency and worker occupancy are set by the provider.`,
          evidence: [
            { level: "fact", statement: `Sync hard callers: ${syncCallers.map((e) => idx.component(e.source).name).join(", ")}; timeoutMs = ${c.ai.timeoutMs}.`, edgeIds: syncCallers.map((e) => e.id) },
            graph.targets?.p95LatencyMs ? { level: "fact", statement: `Latency target p95 = ${graph.targets.p95LatencyMs} ms; a single completion typically takes 1-10 s.` } : { level: "unknown", statement: "No latency target supplied." },
          ],
          mechanism: "Each generation holds an API worker and a database connection for seconds. Under provider slowness, concurrency balloons and the same pods that serve document listing stop responding.",
          impact: "AI slowness becomes whole-product slowness; capacity planning is impossible because request duration is externally controlled.",
          recommendation: "Stream tokens to the client, run generation in a separate worker pool with its own scaling, keep short timeouts for non-streaming calls, and release DB connections before calling the model.",
          tradeoff: "Streaming and job-based flows add client complexity and state management.",
          affectedComponentIds: [c.id, ...syncCallers.map((e) => e.source)],
          affectedEdgeIds: syncCallers.map((e) => e.id),
          dimensions: { ai: 0.6, performance: 0.8, scalability: 0.3 },
          fix: { description: `Isolate inference from ${syncCallers.map((e) => idx.component(e.source).name).join(", ")}`, updateEdges: syncCallers.map((e) => ({ id: e.id, patch: { timeoutMs: 10_000, circuitBreaker: true, fallback: "streamed/degraded response" } })), updateComponents: [{ id: c.id, patch: { ai: { ...c.ai, timeoutMs: 10_000 } } }] },
        });
      }

      if (c.ai.modelPinned === false) {
        findings.push({
          id: `ai-unpinned-model-${c.id}`,
          engine: "ai",
          category: "unpinned_model_version",
          severity: "medium",
          confidence: "high",
          title: `${c.name} is called with an unpinned model alias; a silent provider upgrade changes answers and, for embeddings, invalidates the vector index.`,
          evidence: [{ level: "fact", statement: `${c.name}: modelPinned = false, model = ${c.ai.model ?? "unspecified"}.`, componentIds: [c.id] }],
          mechanism: "Embeddings from two model versions are not comparable; queries embedded with the new version retrieve garbage against vectors from the old one. Chat behaviour changes without a deploy, so regressions cannot be bisected.",
          impact: "Sudden retrieval quality collapse; unexplained behaviour changes; no reproducibility for evaluation.",
          recommendation: "Pin exact model versions in configuration, store the embedding model id with every vector, and treat model upgrades as migrations with re-embedding and evaluation.",
          tradeoff: "Deliberate upgrade work instead of automatic improvements.",
          affectedComponentIds: [c.id],
          affectedEdgeIds: [],
          dimensions: { ai: 0.5, maintainability: 0.4 },
          fix: { description: `Pin model versions on ${c.name}`, updateComponents: [{ id: c.id, patch: { ai: { ...c.ai, modelPinned: true } } }] },
        });
      }

      if (!c.ai.costCap) {
        findings.push({
          id: `ai-no-cost-cap-${c.id}`,
          engine: "ai",
          category: "no_spend_cap",
          severity: "medium",
          confidence: "high",
          title: `No spend cap or per-tenant budget exists for ${c.name}; a retry loop, an abusive tenant or a scraping bot sets the monthly bill.`,
          evidence: [{ level: "fact", statement: `${c.name}: costCap = false; observability.alerts = ${c.observability.alerts}.`, componentIds: [c.id] }],
          mechanism: "Usage-priced APIs have no natural ceiling. Unlike compute, there is no quota to hit before the invoice.",
          impact: "Unbounded cost exposure; gross-margin risk on flat-priced plans.",
          recommendation: "Meter tokens per tenant and per feature, enforce soft and hard budgets, alert on hourly spend anomalies, and add abuse controls on public AI endpoints.",
          tradeoff: "Product decisions on what happens at the limit.",
          affectedComponentIds: [c.id],
          affectedEdgeIds: [],
          dimensions: { ai: 0.5, cost: 0.5 },
          fix: { description: `Spend caps for ${c.name}`, updateComponents: [{ id: c.id, patch: { ai: { ...c.ai, costCap: true }, observability: { ...c.observability, metrics: true, alerts: true } } }] },
        });
      }
    }

    if (c.ai.role === "vector_store") {
      if (!c.backup?.enabled) {
        const embedders = idx.byType("llm_provider", "embedding_service");
        findings.push({
          id: `ai-vector-no-backup-${c.id}`,
          engine: "ai",
          category: "vector_index_unrecoverable",
          severity: "high",
          confidence: "high",
          title: `${c.name} has no snapshots; losing it means re-embedding every document through ${embedders.map((e) => e.name).join(", ") || "the embedding provider"} at full token cost and days of ingestion time.`,
          evidence: [
            { level: "fact", statement: `${c.name}: backup = none, replicas = ${c.redundancy.replicas}, scaling = ${c.scaling.model}.`, componentIds: [c.id] },
            { level: "assumption", statement: "Re-embedding cost scales with the total corpus size; for a 100k-user product this is typically thousands of dollars and limited by provider rate limits." },
          ],
          mechanism: "The vector index is derived data, but rebuilding it requires the original documents, the exact embedding model version and provider throughput. During the rebuild, RAG answers are wrong or empty.",
          impact: "Multi-day degradation of the core feature plus a large one-off model bill.",
          recommendation: "Snapshot the index to object storage on a schedule, run at least two replicas, and record the embedding model id so a rebuild is deterministic.",
          tradeoff: "Storage cost for snapshots; replica cost.",
          affectedComponentIds: [c.id],
          affectedEdgeIds: [],
          dimensions: { ai: 0.8, reliability: 0.4 },
          fix: { description: `Snapshots for ${c.name}`, updateComponents: [{ id: c.id, patch: { backup: { enabled: true, frequency: "hourly snapshot to object storage", restoreTested: false } } }] },
        });
      }
      if (!c.observability.metrics) {
        findings.push({
          id: `ai-vector-blind-${c.id}`,
          engine: "ai",
          category: "unobserved_ai_component",
          severity: "medium",
          confidence: "high",
          title: `${c.name} emits no metrics or logs; retrieval latency, recall and index health are invisible to operators.`,
          evidence: [{ level: "fact", statement: `${c.name}: metrics = false, logs = false, alerts = false.`, componentIds: [c.id] }],
          mechanism: "Vector search degrades gradually (memory pressure, segment growth, stale indexes). Without telemetry the symptom shows up as slow or wrong chat answers with no pointer to the cause.",
          impact: "Long diagnosis times for RAG quality and latency incidents.",
          recommendation: "Export query latency, error rate, collection sizes and memory to the monitoring stack, and track retrieval quality with a small golden set.",
          tradeoff: "Minimal.",
          affectedComponentIds: [c.id],
          affectedEdgeIds: [],
          dimensions: { ai: 0.4, operability: 0.5 },
          fix: { description: `Observability for ${c.name}`, updateComponents: [{ id: c.id, patch: { observability: { ...c.observability, metrics: true, logs: true, alerts: true } } }] },
        });
      }
    }
  }

  return { findings, applicable: true };
}
