/**
 * Architect mode - requirements model.
 *
 * `inferRequirements` reads a plain-language brief and fills the structured
 * form with defaults; every inferred value is reported with its reason so the
 * UI can distinguish "you said" from "we assumed".
 */

export type CloudProvider = "azure" | "aws" | "gcp" | "generic";

export interface Requirements {
  provider: CloudProvider;
  business: {
    applicationType: "saas" | "ai_saas" | "ecommerce" | "fintech" | "healthcare" | "internal_tool" | "api_platform" | "media" | "marketplace";
    description: string;
    expectedUsers: number;
    growthPercentYear: number;
    geography: "single_region" | "multi_region" | "global";
    criticality: "low" | "medium" | "high" | "mission_critical";
    budgetMonthlyUsd: number;
  };
  traffic: {
    baselineRps: number;
    peakRps: number;
    readRatio: number;
    growthMultiplier12m: number;
  };
  reliability: {
    availabilityTarget: 99 | 99.9 | 99.95 | 99.99;
    rtoMinutes: number;
    rpoMinutes: number;
    acceptableDegradation: "none" | "read_only" | "partial_features" | "full_outage_ok";
  };
  performance: {
    p95LatencyMs: number;
    throughputRps: number;
  };
  data: {
    volumeGb: number;
    databasePreference: "relational" | "document" | "both" | "no_preference";
    consistency: "strong" | "eventual" | "mixed";
    retentionDays: number;
    backupRequired: boolean;
    fileUploads: boolean;
  };
  security: {
    authentication: "oauth_oidc" | "saml_sso" | "password" | "api_key" | "none";
    authorization: "rbac" | "abac" | "simple" | "none";
    sensitiveData: Array<"pii" | "payment" | "health" | "credentials">;
    compliance: Array<"gdpr" | "soc2" | "hipaa" | "pci_dss" | "iso27001">;
    networkIsolation: "public" | "private_subnets" | "fully_private";
  };
  ai: {
    enabled: boolean;
    modelProvider: "openai" | "anthropic" | "azure_openai" | "aws_bedrock" | "google_vertex" | "self_hosted";
    modelType: "llm_chat" | "embedding" | "both" | "custom_ml";
    inferenceRequestsPerDay: number;
    rag: boolean;
    vectorDatabase: "managed" | "pgvector" | "self_hosted";
    promptDataSecurity: "standard" | "redact_pii" | "no_external";
    latencyTargetMs: number;
    fallbackRequired: boolean;
    modelAvailabilityTarget: 99 | 99.9 | 99.95;
  };
  operations: {
    monitoring: boolean;
    logging: boolean;
    alerting: boolean;
    deploymentStrategy: "rolling" | "blue_green" | "canary";
    disasterRecovery: "backup_restore" | "pilot_light" | "warm_standby" | "active_active";
    scaling: "auto" | "manual";
    teamSize: number;
  };
}

export const DEFAULT_REQUIREMENTS: Requirements = {
  provider: "azure",
  business: { applicationType: "saas", description: "", expectedUsers: 10_000, growthPercentYear: 50, geography: "single_region", criticality: "high", budgetMonthlyUsd: 5000 },
  traffic: { baselineRps: 50, peakRps: 200, readRatio: 0.8, growthMultiplier12m: 2 },
  reliability: { availabilityTarget: 99.9, rtoMinutes: 60, rpoMinutes: 15, acceptableDegradation: "partial_features" },
  performance: { p95LatencyMs: 500, throughputRps: 200 },
  data: { volumeGb: 100, databasePreference: "relational", consistency: "strong", retentionDays: 365, backupRequired: true, fileUploads: true },
  security: { authentication: "oauth_oidc", authorization: "rbac", sensitiveData: ["pii"], compliance: ["gdpr", "soc2"], networkIsolation: "private_subnets" },
  ai: { enabled: false, modelProvider: "azure_openai", modelType: "both", inferenceRequestsPerDay: 50_000, rag: true, vectorDatabase: "managed", promptDataSecurity: "redact_pii", latencyTargetMs: 3000, fallbackRequired: true, modelAvailabilityTarget: 99.9 },
  operations: { monitoring: true, logging: true, alerting: true, deploymentStrategy: "canary", disasterRecovery: "pilot_light", scaling: "auto", teamSize: 6 },
};

export interface InferredValue {
  path: string;
  value: string | number | boolean | string[];
  reason: string;
}

export interface InferenceResult {
  requirements: Requirements;
  inferred: InferredValue[];
}

/** Parse a user count like "100k", "1.5M", "250,000". */
function parseCount(s: string): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)\s*(k|m|million|thousand|lakh|crore)?\b/i.exec(s);
  if (!m) return undefined;
  let n = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1_000;
  else if (unit === "m" || unit === "million") n *= 1_000_000;
  else if (unit === "lakh") n *= 100_000;
  else if (unit === "crore") n *= 10_000_000;
  return Math.round(n);
}

export function inferRequirements(brief: string, base: Requirements = DEFAULT_REQUIREMENTS): InferenceResult {
  const req: Requirements = JSON.parse(JSON.stringify(base));
  const inferred: InferredValue[] = [];
  const text = brief.toLowerCase();
  const set = <T extends string | number | boolean | string[]>(path: string, value: T, reason: string) => {
    setPath(req as unknown as Record<string, unknown>, path, value);
    inferred.push({ path, value, reason });
  };
  req.business.description = brief.trim();

  const users = /(\d[\d,.]*\s*(?:k|m|million|thousand|lakh|crore)?)\s*(?:\+\s*)?(?:daily |monthly |active |concurrent |registered )*(?:users|customers|members|tenants|employees)/i.exec(brief);
  if (users) {
    const n = parseCount(users[1]);
    if (n) {
      set("business.expectedUsers", n, `"${users[0].trim()}" in the brief`);
      const rps = Math.max(5, Math.round((n * 0.3 * 60) / (8 * 3600)));
      set("traffic.baselineRps", rps, `${n.toLocaleString("en-US")} users, 30% active daily, ~60 requests each over an 8-hour window`);
      set("traffic.peakRps", rps * 4, "peak assumed at 4x baseline");
      set("performance.throughputRps", rps * 4, "sized to peak");
      if (/concurrent/i.test(users[0])) set("traffic.baselineRps", Math.round(n / 5), "concurrent users / 5 s think time");
    }
  }
  const rps = /(\d[\d,]*)\s*(?:rps|requests? per second|req\/s)/i.exec(brief);
  if (rps) {
    const n = Number(rps[1].replace(/,/g, ""));
    set("traffic.baselineRps", n, `"${rps[0]}" in the brief`);
    set("traffic.peakRps", n * 3, "peak assumed at 3x stated rps");
  }

  const isAi = /\b(ai|llm|gpt|chatbot|copilot|assistant|rag|embedding|openai|anthropic|claude|gemini|generative|machine learning|ml)\b/.test(text);
  if (isAi) {
    set("ai.enabled", true, "brief mentions AI/LLM capabilities");
    set("business.applicationType", "ai_saas", "AI-powered product");
    if (/\b(rag|documents?|knowledge base|search over|pdf|files?)\b/.test(text)) set("ai.rag", true, "retrieval over documents mentioned");
    else set("ai.rag", false, "no document retrieval mentioned");
    if (/\bopenai|gpt\b/.test(text)) set("ai.modelProvider", req.provider === "azure" ? "azure_openai" : "openai", "OpenAI models mentioned");
    if (/\banthropic|claude\b/.test(text)) set("ai.modelProvider", "anthropic", "Anthropic/Claude mentioned");
    const perDay = Math.round(req.business.expectedUsers * 0.1 * 3);
    set("ai.inferenceRequestsPerDay", perDay, "10% of users make ~3 AI requests per day (assumption)");
  }
  if (/\b(aws|amazon)\b/.test(text)) set("provider", "aws", "AWS mentioned");
  else if (/\b(gcp|google cloud)\b/.test(text)) set("provider", "gcp", "Google Cloud mentioned");
  else if (/\bazure\b/.test(text)) set("provider", "azure", "Azure mentioned");

  // No cloud account: student projects, portfolio work, bootcamps, hobby builds. Design for Docker Compose
  // on one machine instead of a cloud provider, so the architecture is something the reader can actually run.
  if (/\b(student|college project|university project|capstone|portfolio project|learning project|no cloud account|without a cloud account|no aws account|no azure account|no gcp account|free tier only|on my laptop|on my (?:own )?machine|run(?:s|ning)? locally|self-?host(?:ed|ing)?|docker compose|no budget|zero budget|hobby project|side project|for practice|to learn|bootcamp)\b/.test(text)) {
    set("provider", "generic", "the brief describes a learning/portfolio project with no cloud account");
    set("business.budgetMonthlyUsd", 0, "designed to run at no cost, entirely in Docker");
    set("operations.teamSize", 1, "solo builder assumed");
    set("operations.disasterRecovery", "backup_restore", "single machine: there is no second region to fail over to");
    set("operations.deploymentStrategy", "rolling", "no load balancer to split traffic for canary/blue-green on one machine");
    if (req.business.criticality === "high" || req.business.criticality === "medium") set("business.criticality", "low", "a learning project, not a production business");
    if (req.reliability.availabilityTarget > 99.9) set("reliability.availabilityTarget", 99.9, "a single machine cannot honestly promise more than this");
    if (req.ai.enabled) {
      set("ai.modelProvider", "self_hosted", "no cloud account: route AI through a local open-weight model (Ollama) instead of a paid API");
      set("ai.vectorDatabase", "pgvector", "fewer containers to run locally");
    }
  }

  if (/\b(global|worldwide|international|multiple countries)\b/.test(text)) set("business.geography", "global", "global audience mentioned");
  else if (/\b(multi[- ]region|two regions|regions)\b/.test(text)) set("business.geography", "multi_region", "multiple regions mentioned");

  if (/\b(payment|checkout|e-?commerce|shop|cart|order)\b/.test(text)) {
    set("security.sensitiveData", ["pii", "payment"], "payments/e-commerce mentioned");
    set("security.compliance", ["gdpr", "pci_dss"], "payment card data implies PCI DSS");
    if (!isAi) set("business.applicationType", "ecommerce", "commerce vocabulary in the brief");
    set("data.consistency", "strong", "orders and payments need strong consistency");
  }
  if (/\b(health|patient|clinic|medical|hospital|hipaa)\b/.test(text)) {
    set("security.sensitiveData", ["pii", "health"], "health data mentioned");
    set("security.compliance", ["hipaa", "soc2"], "health data implies HIPAA");
    set("security.networkIsolation", "fully_private", "regulated health data");
    if (!isAi) set("business.applicationType", "healthcare", "healthcare vocabulary in the brief");
  }
  if (/\b(bank|fintech|trading|ledger|wallet|loan)\b/.test(text)) {
    set("business.criticality", "mission_critical", "financial system");
    set("reliability.availabilityTarget", 99.99, "financial systems typically target four nines");
    set("reliability.rpoMinutes", 0, "no data loss acceptable for ledgers");
    set("data.consistency", "strong", "financial data");
    if (!isAi) set("business.applicationType", "fintech", "finance vocabulary in the brief");
  }
  if (/\b(enterprise|b2b|sso|saml|okta|azure ad|entra)\b/.test(text)) set("security.authentication", "saml_sso", "enterprise SSO mentioned");
  if (/\b(internal tool|back[- ]office|admin tool|employees)\b/.test(text)) {
    set("business.applicationType", "internal_tool", "internal tool mentioned");
    set("business.criticality", "medium", "internal tools are rarely mission critical");
    set("reliability.availabilityTarget", 99, "internal tool");
  }
  if (/\b(video|media|streaming|images?)\b/.test(text)) {
    set("data.volumeGb", 5000, "media workloads are storage heavy");
    set("data.fileUploads", true, "media uploads");
  }
  if (/\b(99\.99|four nines)\b/.test(text)) set("reliability.availabilityTarget", 99.99, "stated availability");
  else if (/\b(99\.95)\b/.test(text)) set("reliability.availabilityTarget", 99.95, "stated availability");
  else if (/\b(99\.9|three nines)\b/.test(text)) set("reliability.availabilityTarget", 99.9, "stated availability");
  if (/\b(mission[- ]critical|zero downtime|always on)\b/.test(text)) {
    set("business.criticality", "mission_critical", "stated as mission critical");
    if (req.reliability.availabilityTarget < 99.95) set("reliability.availabilityTarget", 99.95, "mission critical implies at least 99.95%");
  }
  const budget = /(?:budget|spend)[^\d$]*\$?\s*(\d[\d,]*)\s*(k)?/i.exec(brief);
  if (budget) set("business.budgetMonthlyUsd", Number(budget[1].replace(/,/g, "")) * (budget[2] ? 1000 : 1), `"${budget[0].trim()}" in the brief`);
  if (/\b(startup|mvp|small team|two engineers|solo)\b/.test(text)) {
    set("operations.teamSize", 2, "small team mentioned");
    set("operations.disasterRecovery", "backup_restore", "small teams cannot operate warm standbys");
  }
  if (req.business.expectedUsers >= 500_000 || req.business.geography !== "single_region") {
    if (req.operations.disasterRecovery === "pilot_light") set("operations.disasterRecovery", "warm_standby", "scale/geography justify a warm standby");
  }
  if (req.reliability.availabilityTarget >= 99.99 && req.operations.disasterRecovery !== "active_active") set("operations.disasterRecovery", "active_active", "99.99% is not achievable from a single region");
  return { requirements: req, inferred };
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

/** Field specification used by the Architect form. */
export interface FieldSpec {
  section: string;
  path: string;
  label: string;
  type: "number" | "select" | "multiselect" | "boolean";
  options?: Array<{ value: string | number; label: string }>;
  hint?: string;
  aiOnly?: boolean;
}

const opt = (values: Array<string | number>, labels?: string[]) => values.map((v, i) => ({ value: v, label: labels?.[i] ?? String(v).replace(/_/g, " ") }));

export const FIELD_SPECS: FieldSpec[] = [
  { section: "Business", path: "provider", label: "Cloud provider", type: "select", options: opt(["generic", "azure", "aws", "gcp"], ["Generic / self-hosted (no cloud account needed)", "Azure", "AWS", "Google Cloud"]) },
  { section: "Business", path: "business.applicationType", label: "Application type", type: "select", options: opt(["saas", "ai_saas", "ecommerce", "fintech", "healthcare", "internal_tool", "api_platform", "media", "marketplace"]) },
  { section: "Business", path: "business.expectedUsers", label: "Expected users", type: "number" },
  { section: "Business", path: "business.growthPercentYear", label: "Growth % / year", type: "number" },
  { section: "Business", path: "business.geography", label: "Geography", type: "select", options: opt(["single_region", "multi_region", "global"]) },
  { section: "Business", path: "business.criticality", label: "Business criticality", type: "select", options: opt(["low", "medium", "high", "mission_critical"]) },
  { section: "Business", path: "business.budgetMonthlyUsd", label: "Budget / month (USD)", type: "number" },
  { section: "Traffic", path: "traffic.baselineRps", label: "Baseline requests/s", type: "number" },
  { section: "Traffic", path: "traffic.peakRps", label: "Peak requests/s", type: "number" },
  { section: "Traffic", path: "traffic.readRatio", label: "Read ratio (0-1)", type: "number", hint: "0.8 = 80% reads" },
  { section: "Traffic", path: "traffic.growthMultiplier12m", label: "Traffic growth 12m (x)", type: "number" },
  { section: "Reliability", path: "reliability.availabilityTarget", label: "Availability target", type: "select", options: opt([99, 99.9, 99.95, 99.99], ["99% (3.6 days/yr)", "99.9% (8.7 h/yr)", "99.95% (4.4 h/yr)", "99.99% (52 min/yr)"]) },
  { section: "Reliability", path: "reliability.rtoMinutes", label: "RTO (minutes)", type: "number" },
  { section: "Reliability", path: "reliability.rpoMinutes", label: "RPO (minutes)", type: "number" },
  { section: "Reliability", path: "reliability.acceptableDegradation", label: "Acceptable degradation", type: "select", options: opt(["none", "read_only", "partial_features", "full_outage_ok"]) },
  { section: "Performance", path: "performance.p95LatencyMs", label: "p95 latency (ms)", type: "number" },
  { section: "Performance", path: "performance.throughputRps", label: "Required throughput (rps)", type: "number" },
  { section: "Data", path: "data.volumeGb", label: "Data volume (GB)", type: "number" },
  { section: "Data", path: "data.databasePreference", label: "Database preference", type: "select", options: opt(["relational", "document", "both", "no_preference"]) },
  { section: "Data", path: "data.consistency", label: "Consistency", type: "select", options: opt(["strong", "eventual", "mixed"]) },
  { section: "Data", path: "data.retentionDays", label: "Retention (days)", type: "number" },
  { section: "Data", path: "data.backupRequired", label: "Backups required", type: "boolean" },
  { section: "Data", path: "data.fileUploads", label: "File uploads", type: "boolean" },
  { section: "Security", path: "security.authentication", label: "Authentication", type: "select", options: opt(["oauth_oidc", "saml_sso", "password", "api_key", "none"], ["OAuth / OIDC", "SAML SSO", "Password", "API key", "None"]) },
  { section: "Security", path: "security.authorization", label: "Authorization", type: "select", options: opt(["rbac", "abac", "simple", "none"], ["RBAC", "ABAC", "Simple", "None"]) },
  { section: "Security", path: "security.sensitiveData", label: "Sensitive data", type: "multiselect", options: opt(["pii", "payment", "health", "credentials"], ["PII", "Payment", "Health", "Credentials"]) },
  { section: "Security", path: "security.compliance", label: "Compliance", type: "multiselect", options: opt(["gdpr", "soc2", "hipaa", "pci_dss", "iso27001"], ["GDPR", "SOC 2", "HIPAA", "PCI DSS", "ISO 27001"]) },
  { section: "Security", path: "security.networkIsolation", label: "Network isolation", type: "select", options: opt(["public", "private_subnets", "fully_private"]) },
  { section: "AI", path: "ai.enabled", label: "AI features", type: "boolean" },
  { section: "AI", path: "ai.modelProvider", label: "Model provider", type: "select", aiOnly: true, options: opt(["self_hosted", "openai", "anthropic", "azure_openai", "aws_bedrock", "google_vertex"], ["Self-hosted / Ollama (free, no account needed)", "OpenAI", "Anthropic", "Azure OpenAI", "AWS Bedrock", "Google Vertex"]) },
  { section: "AI", path: "ai.modelType", label: "Model type", type: "select", aiOnly: true, options: opt(["llm_chat", "embedding", "both", "custom_ml"], ["LLM chat", "Embeddings", "LLM + embeddings", "Custom ML"]) },
  { section: "AI", path: "ai.inferenceRequestsPerDay", label: "Inference requests / day", type: "number", aiOnly: true },
  { section: "AI", path: "ai.rag", label: "RAG over documents", type: "boolean", aiOnly: true },
  { section: "AI", path: "ai.vectorDatabase", label: "Vector database", type: "select", aiOnly: true, options: opt(["managed", "pgvector", "self_hosted"], ["Managed vector service", "pgvector in PostgreSQL", "Self-hosted"]) },
  { section: "AI", path: "ai.promptDataSecurity", label: "Prompt data security", type: "select", aiOnly: true, options: opt(["standard", "redact_pii", "no_external"], ["Standard", "Redact PII", "No external providers"]) },
  { section: "AI", path: "ai.latencyTargetMs", label: "AI latency target (ms)", type: "number", aiOnly: true },
  { section: "AI", path: "ai.fallbackRequired", label: "Fallback model required", type: "boolean", aiOnly: true },
  { section: "AI", path: "ai.modelAvailabilityTarget", label: "Model availability target", type: "select", aiOnly: true, options: opt([99, 99.9, 99.95], ["99%", "99.9%", "99.95%"]) },
  { section: "Operations", path: "operations.monitoring", label: "Monitoring", type: "boolean" },
  { section: "Operations", path: "operations.logging", label: "Logging", type: "boolean" },
  { section: "Operations", path: "operations.alerting", label: "Alerting", type: "boolean" },
  { section: "Operations", path: "operations.deploymentStrategy", label: "Deployment strategy", type: "select", options: opt(["rolling", "blue_green", "canary"]) },
  { section: "Operations", path: "operations.disasterRecovery", label: "Disaster recovery", type: "select", options: opt(["backup_restore", "pilot_light", "warm_standby", "active_active"]) },
  { section: "Operations", path: "operations.scaling", label: "Scaling", type: "select", options: opt(["auto", "manual"]) },
  { section: "Operations", path: "operations.teamSize", label: "Engineering team size", type: "number" },
];
