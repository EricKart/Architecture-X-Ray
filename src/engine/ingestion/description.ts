import { component, edge, graph } from "../graph/builder";
import type { ArchitectureGraph, Component, ComponentType, DataFlow, Edge, Provider, Region, ZoneKind } from "../graph/types";

/**
 * Heuristic architecture extraction from a plain-text description.
 *
 * No model is involved: a vocabulary of technologies maps sentences to
 * components, then relationships are inferred from the usual layering
 * (client -> edge -> gateway -> services -> stores) and from explicit
 * "X calls/uses/reads Y" phrases. Everything produced is tagged INFERENCE
 * and every profile field that cannot be determined is listed as UNKNOWN, so
 * the engines never treat a guess as a fact.
 */

interface Vocab {
  match: RegExp;
  type: ComponentType;
  name: string;
  provider?: Provider;
  service?: string;
  zone: ZoneKind;
  stateful?: boolean;
  exposure?: Component["exposure"];
  ai?: Component["ai"];
}

const VOCAB: Vocab[] = [
  { match: /\b(cloudflare)\b/i, type: "waf", name: "Cloudflare (CDN + WAF)", provider: "cloudflare", service: "Cloudflare", zone: "edge", exposure: "public" },
  { match: /\b(cloudfront)\b/i, type: "cdn", name: "CloudFront", provider: "aws", service: "Amazon CloudFront", zone: "edge", exposure: "public" },
  { match: /\b(front ?door)\b/i, type: "waf", name: "Azure Front Door", provider: "azure", service: "Azure Front Door", zone: "edge", exposure: "public" },
  { match: /\b(cdn)\b/i, type: "cdn", name: "CDN", zone: "edge", exposure: "public" },
  { match: /\b(waf|web application firewall)\b/i, type: "waf", name: "WAF", zone: "edge", exposure: "public" },
  { match: /\b(route ?53|azure dns|cloud dns|dns)\b/i, type: "dns", name: "DNS", zone: "edge", exposure: "public" },
  { match: /\b(api gateway|apim|api management|kong|apigee)\b/i, type: "api_gateway", name: "API gateway", zone: "public_subnet", exposure: "public" },
  { match: /\b(load balancer|alb|nlb|application gateway|nginx ingress|ingress)\b/i, type: "load_balancer", name: "Load balancer", zone: "public_subnet", exposure: "public" },
  { match: /\b(auth0|cognito|okta|entra|azure ad|keycloak|firebase auth|identity provider|idp)\b/i, type: "identity_provider", name: "Identity provider", zone: "external_saas", exposure: "public" },
  { match: /\b(next\.?js|react|angular|vue|frontend|web app|spa|static site)\b/i, type: "web_frontend", name: "Web frontend", zone: "managed_service", exposure: "public" },
  { match: /\b(kubernetes|aks|eks|gke|k8s)\b/i, type: "service", name: "Application services (Kubernetes)", zone: "private_subnet" },
  { match: /\b(ecs|fargate|cloud run|container apps|app service|docker containers?)\b/i, type: "service", name: "Application services (containers)", zone: "private_subnet" },
  { match: /\b(lambda|azure functions?|cloud functions?|serverless)\b/i, type: "serverless_function", name: "Serverless functions", zone: "managed_service" },
  { match: /\b(api server|backend|microservices?|rest api|graphql|node\.?js|django|spring|fastapi|express|\.net|golang|go service|rails)\b/i, type: "service", name: "API service", zone: "private_subnet" },
  { match: /\b(workers?|background jobs?|celery|sidekiq|consumers?)\b/i, type: "worker", name: "Background workers", zone: "private_subnet" },
  { match: /\b(redis|memcached|elasticache|cache)\b/i, type: "cache", name: "Redis cache", zone: "managed_service", stateful: true },
  { match: /\b(postgres(?:ql)?|rds|aurora|cloud sql|flexible server)\b/i, type: "relational_db", name: "PostgreSQL", zone: "managed_service", stateful: true },
  { match: /\b(mysql|mariadb)\b/i, type: "relational_db", name: "MySQL", zone: "managed_service", stateful: true },
  { match: /\b(sql server|mssql)\b/i, type: "relational_db", name: "SQL Server", zone: "managed_service", stateful: true },
  { match: /\b(mongo(?:db)?|dynamodb|cosmos ?db|firestore|document db)\b/i, type: "document_db", name: "Document database", zone: "managed_service", stateful: true },
  { match: /\b(pinecone|weaviate|qdrant|milvus|pgvector|vector (?:db|database|store|index)|ai search)\b/i, type: "vector_db", name: "Vector database", zone: "managed_service", stateful: true, ai: { role: "vector_store" } },
  { match: /\b(elasticsearch|opensearch|algolia|solr)\b/i, type: "search", name: "Search index", zone: "managed_service", stateful: true },
  { match: /\b(s3|blob storage|cloud storage|object storage|bucket)\b/i, type: "object_storage", name: "Object storage", zone: "managed_service", stateful: true },
  { match: /\b(sqs|service bus|pub\/?sub|rabbitmq|queue)\b/i, type: "queue", name: "Message queue", zone: "managed_service", stateful: true },
  { match: /\b(kafka|kinesis|event hubs?|event stream)\b/i, type: "stream", name: "Event stream", zone: "managed_service", stateful: true },
  { match: /\b(openai|gpt|chatgpt)\b/i, type: "llm_provider", name: "OpenAI API", provider: "openai", zone: "external_saas", exposure: "public", ai: { role: "llm", provider: "openai", dataSentExternally: true } },
  { match: /\b(anthropic|claude)\b/i, type: "llm_provider", name: "Anthropic API", provider: "anthropic", zone: "external_saas", exposure: "public", ai: { role: "llm", provider: "anthropic", dataSentExternally: true } },
  { match: /\b(azure openai|bedrock|vertex ai|gemini)\b/i, type: "llm_provider", name: "Cloud model endpoint", zone: "managed_service", ai: { role: "llm" } },
  { match: /\b(llm|language model|foundation model)\b/i, type: "llm_provider", name: "LLM provider", zone: "external_saas", exposure: "public", ai: { role: "llm" } },
  { match: /\b(embedding)/i, type: "embedding_service", name: "Embedding service", zone: "external_saas", exposure: "public", ai: { role: "embedding" } },
  { match: /\b(prometheus|grafana|datadog|new relic|cloudwatch|azure monitor|app insights|application insights|monitoring|observability)\b/i, type: "monitoring", name: "Monitoring", zone: "managed_service" },
  { match: /\b(key vault|secrets manager|vault|secret manager)\b/i, type: "secrets_manager", name: "Secrets manager", zone: "managed_service" },
  { match: /\b(github actions|gitlab ci|jenkins|azure devops|ci\/cd|pipeline|argo ?cd)\b/i, type: "ci_cd", name: "CI/CD", provider: "github", zone: "ci_platform", exposure: "public" },
  { match: /\b(stripe|razorpay|payment gateway|paypal)\b/i, type: "payment_provider", name: "Payment provider", zone: "external_saas", exposure: "public" },
  { match: /\b(sendgrid|ses|mailgun|email service|twilio)\b/i, type: "email_service", name: "Email / messaging provider", zone: "external_saas", exposure: "public" },
  { match: /\b(nat gateway|nat)\b/i, type: "nat_gateway", name: "NAT gateway", zone: "public_subnet" },
];

const ZONE_META: Record<ZoneKind, { name: string; trust: number }> = {
  internet: { name: "Internet", trust: 0 },
  edge: { name: "Edge", trust: 1 },
  external_saas: { name: "External SaaS", trust: 1 },
  ci_platform: { name: "CI platform", trust: 1 },
  public_subnet: { name: "Public subnet", trust: 2 },
  private_subnet: { name: "Private subnet", trust: 3 },
  isolated_subnet: { name: "Isolated subnet", trust: 4 },
  managed_service: { name: "Managed services", trust: 3 },
};

const PROVIDER_PATTERNS: Array<[RegExp, Provider]> = [[/\b(aws|amazon)\b/i, "aws"], [/\bazure\b/i, "azure"], [/\b(gcp|google cloud)\b/i, "gcp"]];

export interface DescriptionExtraction {
  graph: ArchitectureGraph;
  warnings: string[];
  matched: string[];
}

export function extractFromDescription(text: string): DescriptionExtraction {
  const warnings: string[] = [];
  const matched: string[] = [];
  const cloud = PROVIDER_PATTERNS.find(([re]) => re.test(text))?.[1];
  const found = new Map<string, Component>();
  const byType = new Map<ComponentType, Component[]>();
  const unknowns = new Set<string>();

  const add = (v: Vocab) => {
    const id = slug(v.name);
    if (found.has(id)) return;
    const c = component({
      id,
      name: v.name,
      type: v.type,
      provider: v.provider ?? (v.zone === "external_saas" ? "saas" : cloud),
      service: v.service,
      zoneId: v.zone,
      exposure: v.exposure ?? (v.zone === "external_saas" || v.zone === "edge" ? "public" : "private"),
      stateful: v.stateful ?? false,
      criticality: ["relational_db", "document_db", "service", "api_gateway", "load_balancer", "identity_provider", "cache", "llm_provider"].includes(v.type) ? "critical" : "high",
      scaling: { model: v.zone === "managed_service" || v.zone === "external_saas" || v.zone === "edge" ? "managed" : "manual" },
      redundancy: v.zone === "edge" || v.zone === "external_saas" || v.zone === "ci_platform" ? { replicas: 3, multiAz: true, multiRegion: true, failover: "automatic" } : { replicas: 1, multiAz: false, multiRegion: false, failover: "none" },
      ai: v.ai,
      evidence: "inference",
      notes: ["Extracted from the text description; profile fields not stated are unknown."],
    });
    found.set(id, c);
    matched.push(v.name);
    const arr = byType.get(v.type) ?? [];
    arr.push(c);
    byType.set(v.type, arr);
  };

  for (const v of VOCAB) if (v.match.test(text)) add(v);
  if (!found.size) warnings.push("No known technologies were recognised in the description. Try naming the components (e.g. 'React frontend, Node API on Kubernetes, PostgreSQL, Redis, S3, OpenAI').");

  // Sentences mentioning "single", "one instance", "no backup", "public" adjust profiles where attributable.
  for (const c of found.values()) {
    const re = new RegExp(`([^.]*\\b${escape(c.name.split(" ")[0])}\\b[^.]*)`, "i");
    const sentence = re.exec(text)?.[1]?.toLowerCase() ?? "";
    if (/\b(single|one instance|no replica|not replicated|standalone)\b/.test(sentence)) c.redundancy = { replicas: 1, multiAz: false, multiRegion: false, failover: "none" };
    else if (/\b(replica|multi-?az|ha|highly available|cluster)\b/.test(sentence)) c.redundancy = { replicas: 2, multiAz: true, multiRegion: false, failover: "automatic" };
    else if (!["edge", "external_saas", "ci_platform"].includes(c.zoneId)) unknowns.add(`${c.name}: redundancy/failover not stated (assumed single instance).`);
    if (/\bno backup|without backup/.test(sentence)) c.backup = { enabled: false };
    else if (/\bbackup|pitr|point-in-time/.test(sentence)) c.backup = { enabled: true, pointInTimeRecovery: /pitr|point-in-time/.test(sentence) };
    else if (c.stateful) unknowns.add(`${c.name}: backup posture not stated.`);
    if (/\b(public(?:ly)?|exposed|internet-facing)\b/.test(sentence) && c.type !== "client") {
      c.exposure = "public";
      c.security.publicEndpoint = true;
    }
    if (/\bautoscal/.test(sentence)) {
      c.scaling = { model: "horizontal_auto", minInstances: 2, maxInstances: 20 };
      c.redundancy = { replicas: 2, multiAz: true, multiRegion: c.redundancy.multiRegion, failover: "automatic", failoverSeconds: 60 };
    }
    if (/\bmulti-?region|active-active|two regions/.test(sentence)) c.redundancy = { ...c.redundancy, multiRegion: true };
    unknowns.add(`${c.name}: observability, secrets handling and IAM scope not stated.`);
  }

  // Client + regions.
  const users = component({ id: "users", name: "Users", type: "client", zoneId: "internet", exposure: "public", criticality: "critical", scaling: { model: "none" }, cost: { model: "free", category: "low" }, evidence: "inference" });
  found.set("users", users);
  const multiRegion = /\bmulti-?region|two regions|active-active/i.test(text);
  const regionMatch = /\b(us-east-1|us-west-2|eu-west-1|ap-south-1|central india|south india|east us|west europe|north europe|southeast asia|europe-west1|us-central1)\b/i.exec(text);
  const regionName = regionMatch ? regionMatch[1] : cloud ? `${cloud} primary region (unspecified)` : "Primary region (unspecified)";
  const regions: Region[] = [{ id: "r1", name: regionName, provider: cloud, role: "primary", availabilityZones: ["1", "2", "3"] }];
  if (multiRegion) regions.push({ id: "r2", name: "Secondary region", provider: cloud, role: "secondary" as const, availabilityZones: ["1", "2", "3"] });
  for (const c of found.values()) if (["public_subnet", "private_subnet", "managed_service"].includes(c.zoneId)) c.regionId = "r1";

  // Edges by layering plus explicit phrases.
  const edges: Edge[] = [];
  const E = (source: string, target: string, kind: Edge["kind"], extra: Partial<Edge> = {}) => {
    if (!found.has(source) || !found.has(target) || source === target) return;
    const id = `${source}->${target}:${kind}`;
    if (edges.some((e) => e.id === id)) return;
    edges.push(edge({ id, source, target, kind, evidence: "inference", ...extra }));
  };
  const first = (t: ComponentType) => byType.get(t)?.[0]?.id;
  const all = (t: ComponentType) => (byType.get(t) ?? []).map((c) => c.id);
  const entry = first("waf") ?? first("cdn") ?? first("api_gateway") ?? first("load_balancer");
  const gateway = first("api_gateway") ?? first("load_balancer");
  const services = [...all("service"), ...all("serverless_function")];
  const frontend = first("web_frontend");
  if (first("dns")) E("users", first("dns")!, "resolves", { protocol: "dns" });
  if (frontend) {
    if (first("waf") ?? first("cdn")) {
      E("users", (first("waf") ?? first("cdn"))!, "calls", { protocol: "https" });
      E((first("waf") ?? first("cdn"))!, frontend, "serves", { protocol: "https", criticality: "soft" });
    } else E("users", frontend, "calls", { protocol: "https" });
  }
  if (gateway) {
    if (first("waf") && first("waf") !== gateway) { E("users", first("waf")!, "calls", { protocol: "https" }); E(first("waf")!, gateway, "routes_to", { protocol: "https" }); }
    else E("users", gateway, "calls", { protocol: "https" });
    for (const s of services) E(gateway, s, "routes_to", { protocol: "https" });
  } else if (entry) {
    E("users", entry, "calls", { protocol: "https" });
    for (const s of services) E(entry, s, "routes_to", { protocol: "https" });
  } else for (const s of services) E("users", s, "calls", { protocol: "https" });
  for (const s of services) {
    for (const t of all("cache")) E(s, t, "reads", { protocol: "redis", criticality: "soft", fallback: "read through to database" });
    for (const t of [...all("relational_db"), ...all("document_db")]) E(s, t, "writes", { connectionsPerInstance: 10 });
    for (const t of all("object_storage")) E(s, t, "writes", { protocol: "https", criticality: "soft" });
    for (const t of [...all("queue"), ...all("stream")]) E(s, t, "publishes", { criticality: "soft" });
    for (const t of all("search")) E(s, t, "reads", { criticality: "soft" });
    for (const t of all("vector_db")) E(s, t, "reads", { criticality: "soft" });
    for (const t of all("llm_provider")) E(s, t, "calls", { protocol: "https", criticality: "soft", dataClassification: "confidential" });
    for (const t of all("identity_provider")) E(s, t, "authenticates_with", { protocol: "https", authentication: "oauth2", fallback: "cached signing keys" });
    for (const t of all("payment_provider")) E(s, t, "calls", { protocol: "https", criticality: "soft" });
    for (const t of all("email_service")) E(s, t, "calls", { protocol: "https", criticality: "soft", sync: "async" });
    for (const t of all("secrets_manager")) E(s, t, "fetches_secrets_from", { protocol: "https", criticality: "soft" });
    for (const t of all("nat_gateway")) E(s, t, "egress_via", { criticality: "soft" });
  }
  for (const w of all("worker")) {
    for (const t of [...all("queue"), ...all("stream")]) E(w, t, "consumes");
    for (const t of [...all("relational_db"), ...all("document_db")]) E(w, t, "writes", { connectionsPerInstance: 5 });
    for (const t of all("object_storage")) E(w, t, "reads", { protocol: "https" });
    for (const t of [...all("llm_provider"), ...all("embedding_service")]) E(w, t, "calls", { protocol: "https" });
    for (const t of all("vector_db")) E(w, t, "writes");
  }
  for (const m of all("monitoring")) for (const s of [...services, ...all("worker")]) E(m, s, "monitors", { sync: "async", criticality: "soft" });
  for (const ci of all("ci_cd")) for (const s of [...services, ...all("worker"), ...(frontend ? [frontend] : [])]) E(ci, s, "deploys_to", { sync: "async", criticality: "soft" });
  // Explicit "A calls/uses/reads/writes to B" phrases override.
  const verbs = /([A-Za-z][\w .-]{1,30}?)\s+(calls|uses|reads from|writes to|talks to|connects to|publishes to|consumes from|depends on)\s+([A-Za-z][\w .-]{1,30})/gi;
  let m: RegExpExecArray | null;
  while ((m = verbs.exec(text))) {
    const a = resolve(found, m[1]);
    const b = resolve(found, m[3]);
    if (a && b) E(a, b, m[2].startsWith("reads") ? "reads" : m[2].startsWith("writes") ? "writes" : m[2].startsWith("publishes") ? "publishes" : m[2].startsWith("consumes") ? "consumes" : "calls");
  }
  if (!edges.length && found.size > 1) warnings.push("Components were recognised but no relationships could be inferred; the graph has no dependencies.");

  // Flows from the inferred structure.
  const flows: DataFlow[] = [];
  const path = (ids: Array<string | undefined>, action: string[]) => ids.map((id, i) => ({ componentId: id!, action: action[i] ?? "" })).filter((s) => s.componentId && found.has(s.componentId));
  const requestPath = [ "users", entry !== gateway ? entry : undefined, gateway, services[0]].filter((v, i, a) => v && a.indexOf(v) === i);
  if (services[0]) {
    flows.push({ id: "f-normal", name: "Typical request", kind: "normal_request", description: "Inferred request path.", trafficShare: 0.5, steps: path(requestPath, ["Send request", "Filter / cache", "Route", "Handle request"]) });
    const db = first("relational_db") ?? first("document_db");
    if (db) {
      flows.push({ id: "f-read", name: "Database read", kind: "db_read", description: "Inferred read path.", trafficShare: 0.25, steps: path([...requestPath, first("cache"), db], ["Read", "Filter", "Route", "Query", "Cache lookup", "SELECT"]) });
      flows.push({ id: "f-write", name: "Database write", kind: "db_write", description: "Inferred write path.", trafficShare: 0.1, steps: path([...requestPath, db], ["Write", "Filter", "Route", "Validate", "UPDATE/INSERT"]) });
    }
    const llm = first("llm_provider");
    if (llm) flows.push({ id: "f-ai", name: "AI inference", kind: "ai_inference", description: "Inferred model call.", trafficShare: 0.1, steps: path([...requestPath, llm], ["Ask", "Filter", "Route", "Build prompt", "Generate"]) });
    if (llm && first("vector_db")) flows.push({ id: "f-rag", name: "RAG request", kind: "rag_request", description: "Inferred retrieval path.", trafficShare: 0.05, steps: path([...requestPath, first("vector_db"), llm], ["Ask", "Filter", "Route", "Embed + retrieve", "Similarity search", "Generate"]) });
  }
  const q = first("queue") ?? first("stream");
  if (q && first("worker")) flows.push({ id: "f-job", name: "Async job", kind: "async_job", description: "Inferred background processing.", trafficShare: 0.05, steps: path([services[0], q, first("worker"), first("relational_db") ?? first("document_db")], ["Enqueue", "Buffer", "Process", "Persist"]) });
  for (const f of flows) for (let i = 1; i < f.steps.length; i++) {
    const e = edges.find((x) => x.source === f.steps[i - 1].componentId && x.target === f.steps[i].componentId) ?? edges.find((x) => x.target === f.steps[i].componentId && f.steps.slice(0, i).some((s) => s.componentId === x.source));
    if (e) f.steps[i].edgeId = e.id;
  }

  const usedZones = new Set([...found.values()].map((c) => c.zoneId));
  const zones = [...usedZones].map((k) => ({ id: k, name: ZONE_META[k as ZoneKind].name, kind: k as ZoneKind, trustLevel: ZONE_META[k as ZoneKind].trust, regionId: ["public_subnet", "private_subnet", "managed_service"].includes(k) ? "r1" : undefined }));
  const usersMatch = /(\d[\d,.]*\s*(?:k|m|million|thousand)?)\s*(?:\+\s*)?(?:daily |monthly |active |concurrent )*(?:users|customers)/i.exec(text);
  const traffic = usersMatch ? inferTraffic(usersMatch[1]) : undefined;

  const g = graph({
    id: `desc-${Date.now()}`,
    name: "Architecture from description",
    description: text.trim().slice(0, 400),
    source: "description",
    regions,
    zones,
    components: [...found.values()],
    edges,
    flows,
    traffic,
    assumptions: ["Relationships between components were inferred from typical layering; explicit 'A calls B' phrases were honoured where present.", "Cost ranges are type-based assumptions."],
    unknowns: [...unknowns].slice(0, 40),
  });
  return { graph: g, warnings, matched };
}

function inferTraffic(raw: string) {
  const m = /(\d+(?:[.,]\d+)?)\s*(k|m|million|thousand)?/i.exec(raw);
  if (!m) return undefined;
  let n = Number(m[1].replace(/,/g, ""));
  const u = (m[2] ?? "").toLowerCase();
  if (u === "k" || u === "thousand") n *= 1000;
  if (u === "m" || u === "million") n *= 1_000_000;
  const rps = Math.max(5, Math.round((n * 0.3 * 60) / (8 * 3600)));
  return { baselineRps: rps, peakRps: rps * 4, readRatio: 0.8, monthlyActiveUsers: Math.round(n), evidence: "assumption" as const };
}

function resolve(found: Map<string, Component>, phrase: string): string | undefined {
  const p = phrase.trim().toLowerCase();
  for (const c of found.values()) {
    const words = c.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (words.some((w) => p.includes(w))) return c.id;
  }
  return undefined;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
