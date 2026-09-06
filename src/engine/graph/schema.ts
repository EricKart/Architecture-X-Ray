import { z } from "zod";
import type { ArchitectureGraph } from "./types";
import { validateGraphIntegrity } from "./builder";

/**
 * Zod schema for the architecture graph. Used to validate anything that
 * arrives over the API boundary (structured ingestion, AI extraction output,
 * client round-trips) before it reaches the engines.
 */

const evidence = z.enum(["fact", "inference", "assumption", "unknown"]);

export const componentTypeSchema = z.enum([
  "client", "dns", "cdn", "waf", "load_balancer", "api_gateway", "identity_provider",
  "web_frontend", "service", "worker", "serverless_function", "container_platform",
  "queue", "stream", "cache", "relational_db", "document_db", "vector_db", "search",
  "object_storage", "llm_provider", "embedding_service", "ml_inference", "monitoring",
  "logging", "tracing", "secrets_manager", "kms", "ci_cd", "external_api",
  "payment_provider", "email_service", "nat_gateway", "vpn", "bastion", "private_link",
  "scheduler", "llm_gateway",
]);

const layerSchema = z.enum([
  "client", "edge", "identity", "api", "compute", "messaging", "cache", "data", "storage",
  "ai", "observability", "security", "platform", "external",
]);

const providerSchema = z.enum([
  "azure", "aws", "gcp", "generic", "cloudflare", "openai", "anthropic", "auth0", "github", "vercel",
  "self_hosted", "saas", "unknown",
]);

const authMethod = z.enum(["none", "api_key", "jwt", "oauth2", "mtls", "iam", "password", "unknown"]);
const dataClassification = z.enum(["public", "internal", "confidential", "pii", "regulated", "secrets"]);

export const scalingSchema = z.object({
  model: z.enum(["none", "manual", "vertical", "horizontal_auto", "managed", "serverless"]),
  minInstances: z.number().optional(),
  maxInstances: z.number().optional(),
  currentInstances: z.number().optional(),
  rpsPerInstance: z.number().optional(),
  maxConnections: z.number().optional(),
  maxWriteOps: z.number().optional(),
  maxReadOps: z.number().optional(),
  requestsPerMinuteLimit: z.number().optional(),
  tokensPerMinuteLimit: z.number().optional(),
  maxMessagesPerSecond: z.number().optional(),
  jobsPerSecondPerInstance: z.number().optional(),
  readReplicas: z.number().optional(),
  connectionPooler: z.boolean().optional(),
  clusterMode: z.boolean().optional(),
});

export const componentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: componentTypeSchema,
  layer: layerSchema,
  provider: providerSchema.optional(),
  service: z.string().optional(),
  technology: z.string().optional(),
  purpose: z.string().optional(),
  rationale: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  zoneId: z.string(),
  regionId: z.string().optional(),
  exposure: z.enum(["public", "private", "internal"]),
  stateful: z.boolean(),
  criticality: z.enum(["critical", "high", "medium", "low"]),
  scaling: scalingSchema,
  redundancy: z.object({
    replicas: z.number(),
    multiAz: z.boolean(),
    multiRegion: z.boolean(),
    failover: z.enum(["automatic", "manual", "none"]),
    failoverSeconds: z.number().optional(),
  }),
  backup: z
    .object({
      enabled: z.boolean(),
      pointInTimeRecovery: z.boolean().optional(),
      crossRegion: z.boolean().optional(),
      frequency: z.string().optional(),
      retentionDays: z.number().optional(),
      restoreTested: z.boolean().optional(),
    })
    .optional(),
  observability: z.object({
    metrics: z.boolean(),
    logs: z.boolean(),
    traces: z.boolean(),
    alerts: z.boolean(),
    healthCheck: z.boolean().optional(),
    dashboards: z.boolean().optional(),
    logRetentionDays: z.number().optional(),
  }),
  security: z.object({
    encryptionAtRest: z.boolean().optional(),
    encryptionInTransit: z.boolean().optional(),
    authentication: authMethod.optional(),
    secretsSource: z
      .enum(["secrets_manager", "env_var", "config_file", "hardcoded", "managed_identity", "unknown"])
      .optional(),
    iamScope: z.enum(["least_privilege", "broad", "admin", "unknown"]).optional(),
    publicEndpoint: z.boolean().optional(),
    rateLimiting: z.boolean().optional(),
    auditLogging: z.boolean().optional(),
    networkAcl: z.boolean().optional(),
    dataClassification: dataClassification.optional(),
    tlsCertificate: z.enum(["managed", "manual", "unknown"]).optional(),
    tenantIsolation: z.boolean().optional(),
  }),
  cost: z.object({
    model: z.enum(["fixed", "usage", "provisioned", "free"]),
    category: z.enum(["low", "medium", "high", "very_high"]),
    monthlyUsd: z.object({ min: z.number(), max: z.number() }).optional(),
    notes: z.string().optional(),
    lifecyclePolicy: z.boolean().optional(),
  }),
  operations: z.object({
    owner: z.string().optional(),
    runbook: z.boolean().optional(),
    onCall: z.boolean().optional(),
    iac: z.boolean().optional(),
    deployMethod: z.enum(["ci_cd", "manual", "scripted", "unknown"]).optional(),
    migrationStrategy: z.enum(["automated", "manual", "none", "unknown"]).optional(),
    rollback: z.enum(["automatic", "manual", "none", "unknown"]).optional(),
    stagingEnvironment: z.boolean().optional(),
  }),
  ai: z
    .object({
      role: z.enum(["llm", "embedding", "vector_store", "orchestrator", "guardrail", "gateway"]),
      provider: z.string().optional(),
      model: z.string().optional(),
      fallbackProvider: z.string().optional(),
      fallbackModel: z.string().optional(),
      rateLimitHandling: z.enum(["none", "retry", "queue", "circuit_breaker"]).optional(),
      promptInjectionControls: z.boolean().optional(),
      piiRedaction: z.boolean().optional(),
      dataSentExternally: z.boolean().optional(),
      tenantIsolation: z.boolean().optional(),
      costCap: z.boolean().optional(),
      responseCaching: z.boolean().optional(),
      timeoutMs: z.number().optional(),
      toolAccess: z.boolean().optional(),
      modelPinned: z.boolean().optional(),
      untrustedInput: z.boolean().optional(),
      modelRouting: z.boolean().optional(),
      standby: z.boolean().optional(),
    })
    .optional(),
  evidence,
  notes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string(),
  target: z.string(),
  kind: z.enum([
    "calls", "reads", "writes", "publishes", "consumes", "authenticates_with",
    "fetches_secrets_from", "routes_to", "serves", "replicates_to", "backs_up_to",
    "monitors", "deploys_to", "egress_via", "resolves",
  ]),
  protocol: z
    .enum(["https", "http", "grpc", "tcp", "amqp", "redis", "postgres", "mysql", "mongodb",
      "websocket", "kafka", "smtp", "dns", "s3", "internal"])
    .optional(),
  sync: z.enum(["sync", "async"]),
  criticality: z.enum(["hard", "soft"]),
  encrypted: z.boolean().optional(),
  authentication: authMethod.optional(),
  dataClassification: dataClassification.optional(),
  timeoutMs: z.number().optional(),
  retries: z.number().optional(),
  circuitBreaker: z.boolean().optional(),
  fallback: z.string().optional(),
  connectionsPerInstance: z.number().optional(),
  label: z.string().optional(),
  evidence,
});

export const flowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum([
    "normal_request", "authenticated_request", "db_read", "db_write", "ai_inference",
    "rag_request", "async_job", "file_upload", "deployment", "custom",
  ]),
  description: z.string(),
  steps: z.array(
    z.object({
      componentId: z.string(),
      edgeId: z.string().optional(),
      action: z.string(),
      detail: z.string().optional(),
    }),
  ),
  trafficShare: z.number().optional(),
});

export const graphSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.literal(1),
  source: z.enum(["demo", "architect", "description", "image", "structured", "terraform", "kubernetes", "unknown"]),
  createdAt: z.string(),
  regions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      provider: providerSchema.optional(),
      role: z.enum(["primary", "secondary", "dr"]),
      availabilityZones: z.array(z.string()),
    }),
  ),
  zones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.enum([
        "internet", "edge", "public_subnet", "private_subnet", "isolated_subnet",
        "managed_service", "external_saas", "ci_platform",
      ]),
      trustLevel: z.number(),
      regionId: z.string().optional(),
    }),
  ),
  components: z.array(componentSchema),
  edges: z.array(edgeSchema),
  flows: z.array(flowSchema),
  traffic: z
    .object({
      baselineRps: z.number(),
      peakRps: z.number(),
      readRatio: z.number(),
      monthlyActiveUsers: z.number().optional(),
      aiRequestsPerSecond: z.number().optional(),
      avgTokensPerAiRequest: z.number().optional(),
      evidence,
    })
    .optional(),
  targets: z
    .object({
      availability: z.number().optional(),
      rtoMinutes: z.number().optional(),
      rpoMinutes: z.number().optional(),
      p95LatencyMs: z.number().optional(),
    })
    .optional(),
  assumptions: z.array(z.string()),
  unknowns: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ParseResult =
  | { ok: true; graph: ArchitectureGraph }
  | { ok: false; errors: string[] };

export function parseGraph(input: unknown): ParseResult {
  const result = graphSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const graph = result.data as ArchitectureGraph;
  const integrity = validateGraphIntegrity(graph);
  if (integrity.length) return { ok: false, errors: integrity };
  return { ok: true, graph };
}
