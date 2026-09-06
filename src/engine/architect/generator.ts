import { component, edge, graph } from "../graph/builder";
import type { ArchitectureGraph, Component, DataFlow, Edge, NetworkZone, Provider, Region, RedundancyProfile, BackupProfile } from "../graph/types";
import type { CloudProvider, Requirements } from "./requirements";

/**
 * Architect mode - rules-based generator.
 *
 * Every architectural choice is made by an explicit rule that records an
 * Architecture Decision Record. The output graph uses the same model as the
 * destruction engine, so the proposal is immediately scannable.
 */

export interface ADR {
  id: string;
  title: string;
  decision: string;
  context: string;
  alternatives: string[];
  tradeoffs: string;
  consequences: string;
  reason: string;
  componentIds: string[];
}

export interface DeploymentPlan {
  cicd: string;
  environments: string[];
  artifactStrategy: string;
  deploymentStrategy: string;
  rollback: string;
  migrations: string;
  secretsAndConfig: string;
  infrastructureAsCode: string;
}

export interface ObservabilityPlan {
  metrics: string[];
  logs: string[];
  traces: string[];
  alerts: string[];
  slos: string[];
  dashboards: string[];
  hardToDiagnose: string[];
}

export interface GeneratedArchitecture {
  graph: ArchitectureGraph;
  adrs: ADR[];
  deployment: DeploymentPlan;
  observability: ObservabilityPlan;
  warnings: string[];
}

type Svc = Record<CloudProvider, string>;
const S = {
  dns: { azure: "Azure DNS", aws: "Route 53", gcp: "Cloud DNS", generic: "Your hosts file for local testing; a free dynamic-DNS name (e.g. DuckDNS) if you want it reachable from outside your machine" } as Svc,
  cdnWaf: { azure: "Azure Front Door Premium (CDN + WAF)", aws: "CloudFront + AWS WAF", gcp: "Cloud CDN + Cloud Armor", generic: "Nginx reverse proxy with basic rate limiting (open source)" } as Svc,
  gateway: { azure: "Azure API Management (internal) + Application Gateway", aws: "API Gateway + ALB", gcp: "API Gateway + internal HTTPS LB", generic: "Nginx or Traefik as a reverse proxy (open source, runs in its own container)" } as Svc,
  compute: { azure: "AKS (Azure Kubernetes Service)", aws: "EKS", gcp: "GKE Autopilot", generic: "Docker Compose on your machine (or a $5-6/mo VPS if you want it always-on)" } as Svc,
  serverless: { azure: "Azure Container Apps", aws: "ECS Fargate", gcp: "Cloud Run", generic: "Docker Compose (one container per service)" } as Svc,
  identity: { azure: "Microsoft Entra External ID", aws: "Amazon Cognito", gcp: "Identity Platform", generic: "Keycloak (self-hosted, open source, runs as a container)" } as Svc,
  postgres: { azure: "Azure Database for PostgreSQL Flexible Server", aws: "Amazon RDS for PostgreSQL (Multi-AZ)", gcp: "Cloud SQL for PostgreSQL (HA)", generic: "PostgreSQL (official Docker image)" } as Svc,
  document: { azure: "Azure Cosmos DB (NoSQL)", aws: "Amazon DynamoDB", gcp: "Firestore", generic: "MongoDB (official Docker image)" } as Svc,
  cache: { azure: "Azure Cache for Redis (Standard, replicated)", aws: "ElastiCache for Redis (Multi-AZ)", gcp: "Memorystore for Redis (Standard)", generic: "Redis (official Docker image)" } as Svc,
  queue: { azure: "Azure Service Bus Premium", aws: "Amazon SQS + SNS", gcp: "Cloud Pub/Sub", generic: "RabbitMQ (official Docker image, open source, has a web console)" } as Svc,
  storage: { azure: "Azure Blob Storage (ZRS, lifecycle tiers)", aws: "Amazon S3 (lifecycle tiers)", gcp: "Cloud Storage (lifecycle tiers)", generic: "MinIO (S3-compatible, self-hosted, official Docker image)" } as Svc,
  vector: { azure: "Azure AI Search (vector)", aws: "Amazon OpenSearch Serverless (vector)", gcp: "Vertex AI Vector Search", generic: "Qdrant (self-hosted, open source, official Docker image)" } as Svc,
  monitoring: { azure: "Azure Monitor + Log Analytics + Application Insights", aws: "CloudWatch + X-Ray", gcp: "Cloud Monitoring + Cloud Logging + Cloud Trace", generic: "Prometheus + Grafana (both open source, official Docker images)" } as Svc,
  secrets: { azure: "Azure Key Vault (workload identity)", aws: "AWS Secrets Manager (IRSA)", gcp: "Secret Manager (Workload Identity)", generic: "A git-ignored .env file for local dev (see the Security findings for why this doesn't scale to production)" } as Svc,
  kms: { azure: "Azure Key Vault (customer-managed keys)", aws: "AWS KMS", gcp: "Cloud KMS", generic: "Not needed at this scale" } as Svc,
  natOrLink: { azure: "Private Endpoints + NAT Gateway (zone-redundant)", aws: "VPC Endpoints + NAT Gateway per AZ", gcp: "Private Service Connect + Cloud NAT", generic: "Docker's internal network - containers reach each other by service name; nothing is exposed unless you publish a port" } as Svc,
  ci: { azure: "GitHub Actions (OIDC to Azure)", aws: "GitHub Actions (OIDC to AWS)", gcp: "GitHub Actions (Workload Identity Federation)", generic: "GitHub Actions (the free tier comfortably covers a learning project)" } as Svc,
  iac: { azure: "Terraform (azurerm) or Bicep", aws: "Terraform (aws) or CDK", gcp: "Terraform (google)", generic: "docker-compose.yml checked into the repository" } as Svc,
  llmNative: { azure: "Azure OpenAI Service (in-region, private endpoint)", aws: "Amazon Bedrock (in-region)", gcp: "Vertex AI (in-region)", generic: "Ollama running an open-weight model (e.g. Llama 3 8B) on your machine" } as Svc,
  regions: { azure: ["Central India", "South India"], aws: ["ap-south-1 (Mumbai)", "ap-south-2 (Hyderabad)"], gcp: ["asia-south1 (Mumbai)", "asia-south2 (Delhi)"], generic: ["Your machine (single node)", "N/A - a second node needs real infrastructure"] } as Record<CloudProvider, [string, string]>,
};

export function generateArchitecture(req: Requirements): GeneratedArchitecture {
  const p = req.provider;
  const adrs: ADR[] = [];
  const warnings: string[] = [];
  const comps: Component[] = [];
  const edges: Edge[] = [];
  const flows: DataFlow[] = [];
  const provider: Provider = p;
  /** No cloud account: everything runs as containers on one machine via Docker Compose. */
  const isLearning = p === "generic";
  const multiRegion = !isLearning && (req.business.geography !== "single_region" || req.reliability.availabilityTarget >= 99.95 || req.operations.disasterRecovery === "warm_standby" || req.operations.disasterRecovery === "active_active");
  const activeActive = !isLearning && req.operations.disasterRecovery === "active_active";
  const secondaryAuto = activeActive || (!isLearning && req.operations.disasterRecovery === "warm_standby");
  const highAvail = !isLearning && req.reliability.availabilityTarget >= 99.9;
  const regulated = req.security.compliance.some((c) => c === "hipaa" || c === "pci_dss") || req.security.sensitiveData.includes("health") || req.security.sensitiveData.includes("payment");
  const pii = req.security.sensitiveData.length > 0;
  const fullyPrivate = !isLearning && (req.security.networkIsolation === "fully_private" || regulated);
  const peak = Math.max(req.traffic.peakRps, req.performance.throughputRps, req.traffic.baselineRps * 2);
  const growth = Math.max(1, req.traffic.growthMultiplier12m);
  const small = req.business.expectedUsers < 5_000 && peak < 100;
  const useServerlessCompute = small || req.business.applicationType === "internal_tool";
  /** AI routing: a real cloud model service, a third-party API, or a model running on the student's own machine. */
  const cloudNativeAi = req.ai.modelProvider === "azure_openai" || req.ai.modelProvider === "aws_bedrock" || req.ai.modelProvider === "google_vertex";
  const selfHostedAi = req.ai.enabled && (req.ai.modelProvider === "self_hosted" || (cloudNativeAi && isLearning));
  const externalSaasAi = req.ai.enabled && !selfHostedAi && (req.ai.modelProvider === "openai" || req.ai.modelProvider === "anthropic") && req.ai.promptDataSecurity !== "no_external";
  const nativeAi = req.ai.enabled && !selfHostedAi && !externalSaasAi;
  let llmAuth: "none" | "api_key" | "iam" = "iam";
  /** No cloud IAM without a cloud account: services authenticate to each other with plain passwords/keys, same as any local Docker stack. */
  const svcAuth = isLearning ? ("password" as const) : ("iam" as const);
  const R1 = "region-primary";
  const R2 = "region-secondary";
  const regions: Region[] = [{ id: R1, name: S.regions[p][0], provider, role: "primary", availabilityZones: isLearning ? ["single-node"] : ["1", "2", "3"] }];
  if (multiRegion) regions.push({ id: R2, name: S.regions[p][1], provider, role: activeActive ? "secondary" : "dr", availabilityZones: ["1", "2", "3"] });
  if (isLearning) warnings.push("Generic/self-hosted: everything below runs as containers on one machine (Docker Compose). Redundancy, zone/region failover and managed backups do not exist in this mode - the destruction engine will (correctly) flag every stateful component as a single point of failure. That is real and worth understanding: it is exactly what changes when this gets deployed to a cloud provider.");

  const zones: NetworkZone[] = [
    { id: "internet", name: "Internet", kind: "internet", trustLevel: 0 },
    { id: "edge", name: isLearning ? "Reverse proxy" : "Global edge", kind: "edge", trustLevel: 1 },
    { id: "ci", name: "CI platform", kind: "ci_platform", trustLevel: 1 },
    { id: "app", name: isLearning ? "Docker network / app containers" : "VNet / private application subnet", kind: "private_subnet", trustLevel: 3, regionId: R1 },
    { id: "data", name: isLearning ? "Docker network / data containers" : "VNet / isolated data subnet (private endpoints)", kind: "isolated_subnet", trustLevel: 4, regionId: R1 },
    { id: "managed", name: isLearning ? "Docker network / platform containers" : "Managed platform services", kind: "managed_service", trustLevel: 3, regionId: R1 },
  ];
  if (multiRegion) zones.push({ id: "dr", name: `Secondary region (${activeActive ? "active" : "standby"})`, kind: "private_subnet", trustLevel: 3, regionId: R2 });
  if (externalSaasAi || req.security.authentication === "saml_sso") zones.push({ id: "saas", name: "External SaaS", kind: "external_saas", trustLevel: 1 });

  const baseObs = (alerts = true) => isLearning
    ? { metrics: true, logs: true, traces: false, alerts: false, healthCheck: true, dashboards: false, logRetentionDays: 7 }
    : { metrics: true, logs: true, traces: true, alerts, healthCheck: true, dashboards: true, logRetentionDays: 30 };
  const baseOps = (owner: string, extra: Partial<Component["operations"]> = {}) => isLearning
    ? { owner, runbook: false, onCall: false, iac: true, deployMethod: "ci_cd" as const, rollback: "manual" as const, stagingEnvironment: false, ...extra }
    : { owner, runbook: true, onCall: true, iac: true, deployMethod: "ci_cd" as const, rollback: "automatic" as const, stagingEnvironment: true, ...extra };
  const red = (full: RedundancyProfile): RedundancyProfile => (isLearning ? { replicas: 1, multiAz: false, multiRegion: false, failover: "manual" } : full);
  const bak = (full: BackupProfile): BackupProfile => (isLearning ? { enabled: true, pointInTimeRecovery: false, crossRegion: false, frequency: "manual: run a pg_dump / mongodump / volume snapshot script whenever you want a checkpoint", restoreTested: false } : full);
  const redundant = (replicas: number, failoverSeconds = 30) => red({ replicas, multiAz: highAvail, multiRegion: multiRegion, failover: "automatic", failoverSeconds });
  const managedRedundant = () => red({ replicas: 3, multiAz: true, multiRegion: true, failover: "automatic" });
  const cost = (category: Component["cost"]["category"], min: number, max: number, model: Component["cost"]["model"] = "usage", notes?: string) =>
    isLearning
      ? { category: "low" as const, monthlyUsd: { min: 0, max: 0 }, model: "free" as const, notes: notes ? `Runs locally in Docker at no cost. In the cloud: ${notes}` : "Runs locally in Docker at no cost.", lifecyclePolicy: true }
      : { category, monthlyUsd: { min, max }, model, notes, lifecyclePolicy: true };
  const push = (c: Component) => comps.push(c);
  const link = (e: Edge) => edges.push(e);
  const adr = (a: Omit<ADR, "id">) => adrs.push({ id: `adr-${adrs.length + 1}`, ...a });

  // --- Clients and edge -------------------------------------------------
  push(component({ id: "users", name: "Users", type: "client", zoneId: "internet", exposure: "public", criticality: "critical", purpose: `${req.business.expectedUsers.toLocaleString("en-US")} expected users (${req.business.geography.replace("_", " ")}).`, scaling: { model: "none" }, cost: { model: "free", category: "low" }, evidence: "inference" }));
  push(component({ id: "dns", name: "DNS", type: "dns", provider, service: S.dns[p], zoneId: "edge", exposure: "public", criticality: "critical", purpose: "Authoritative DNS with health-checked failover records.", rationale: "Managed anycast DNS with health checks enables regional failover without application changes.", alternatives: ["Cloudflare DNS", "NS1"], scaling: { model: "managed" }, redundancy: managedRedundant(), observability: baseObs(), security: { tlsCertificate: "managed" }, cost: cost("low", 1, 20), operations: baseOps("platform"), evidence: "inference" }));
  push(component({ id: "edge", name: "CDN + WAF", type: "waf", provider, service: S.cdnWaf[p], zoneId: "edge", exposure: "public", criticality: "critical", purpose: "Single public entry point: TLS termination, caching of static assets, WAF managed rules, bot protection and rate limiting for both the web app and the API.", rationale: "Putting every public hostname behind one edge layer means the API cannot be reached while bypassing the WAF, and gives global anycast latency.", alternatives: ["Cloudflare", "Fastly", "Regional application gateway only"], scaling: { model: "managed", rpsPerInstance: 100_000 }, redundancy: managedRedundant(), observability: baseObs(), security: { rateLimiting: true, tlsCertificate: "managed", encryptionInTransit: true, networkAcl: true }, cost: cost("medium", 150, 600, "usage"), operations: baseOps("platform"), evidence: "inference" }));
  adr({ title: "One edge layer in front of every public hostname", decision: `Use ${S.cdnWaf[p]} for web and API traffic.`, context: "Public surfaces attract credential stuffing, scraping and volumetric abuse; the API is the usual bypass.", alternatives: ["Separate CDN for static assets and a bare load balancer for the API", "Third-party edge (Cloudflare)"], tradeoffs: "Slight added latency per request and WAF tuning effort versus a closed attack surface.", consequences: "Origins accept traffic only from the edge; certificate management is fully managed.", reason: "Defence in depth on the path attackers actually use.", componentIds: ["edge"] });

  // --- Identity ---------------------------------------------------------
  const sso = req.security.authentication === "saml_sso";
  push(component({ id: "idp", name: sso ? "Identity provider (SSO)" : "Identity provider", type: "identity_provider", provider: sso ? "saas" : provider, service: sso ? "Enterprise IdP federation (SAML/OIDC) via " + S.identity[p] : S.identity[p], zoneId: sso ? "saas" : "managed", exposure: "public", criticality: "critical", purpose: `${req.security.authentication.replace("_", "/").toUpperCase()} login, token issuance, ${req.security.authorization.toUpperCase()} claims.`, rationale: "Managed identity avoids storing credentials and supports MFA and enterprise federation out of the box.", alternatives: ["Auth0", "Keycloak (self-hosted)", "Custom auth service"], scaling: { model: "managed", requestsPerMinuteLimit: 20_000 }, redundancy: managedRedundant(), observability: baseObs(), security: { authentication: "oauth2", encryptionInTransit: true, auditLogging: true }, cost: cost("medium", 50, 800, "usage"), operations: baseOps("platform"), evidence: "inference" }));

  // --- Gateway and compute ------------------------------------------------
  push(component({ id: "gateway", name: "API gateway (internal)", type: "api_gateway", provider, service: S.gateway[p], zoneId: "app", regionId: R1, exposure: "private", criticality: "critical", purpose: "Internal ingress: JWT validation with cached JWKS, per-tenant quotas, routing, request size limits.", rationale: "Validating tokens at the gateway keeps auth out of every service and enforces quotas centrally.", alternatives: ["Ingress controller with auth plugin", "Service mesh ingress"], scaling: { model: "managed", rpsPerInstance: 10_000 }, redundancy: redundant(3), observability: baseObs(), security: { authentication: "jwt", encryptionInTransit: true, rateLimiting: true, secretsSource: isLearning ? "env_var" : "managed_identity", iamScope: isLearning ? undefined : "least_privilege" }, cost: cost("medium", 100, 500, "provisioned"), operations: baseOps("platform"), evidence: "inference" }));

  const rpsPer = 150;
  const minInst = isLearning ? 1 : Math.max(highAvail ? 3 : 2, Math.ceil((req.traffic.baselineRps * 1.5) / rpsPer));
  const maxInst = isLearning ? Math.max(1, Math.ceil((peak * growth) / rpsPer)) : Math.max(minInst * 3, Math.ceil((peak * growth * 1.3) / rpsPer));
  const poolPer = 10;
  push(component({ id: "api", name: "Application services", type: "service", provider, service: useServerlessCompute ? S.serverless[p] : S.compute[p], technology: "Stateless containers (one deployment per bounded context)", zoneId: "app", regionId: R1, exposure: "private", criticality: "critical", purpose: "Product API: domain logic, tenancy, authorization decisions, orchestration of data stores and async work.", rationale: useServerlessCompute ? "At this scale a serverless container platform removes cluster operations entirely." : "A managed Kubernetes platform gives autoscaling, zone spreading, progressive delivery and a mature ecosystem for a team of this size.", alternatives: [useServerlessCompute ? S.compute[p] : S.serverless[p], "Virtual machines with autoscale sets", "Functions"], scaling: { model: "horizontal_auto", minInstances: minInst, maxInstances: maxInst, currentInstances: minInst, rpsPerInstance: rpsPer }, redundancy: red({ replicas: minInst, multiAz: true, multiRegion, failover: "automatic", failoverSeconds: 30 }), observability: baseObs(), security: { authentication: "jwt", secretsSource: isLearning ? "env_var" : "managed_identity", iamScope: isLearning ? undefined : "least_privilege", encryptionInTransit: true, auditLogging: regulated }, cost: cost(peak > 500 ? "high" : "medium", Math.round(minInst * 45), Math.round(maxInst * 45 * 0.5), "provisioned", `${minInst}-${maxInst} instances, ~${rpsPer} rps each (estimate)`), operations: baseOps("backend", { migrationStrategy: "automated" }), evidence: "inference" }));
  adr({ title: useServerlessCompute ? "Serverless containers for application compute" : "Managed Kubernetes for application compute", decision: `Run application services on ${useServerlessCompute ? S.serverless[p] : S.compute[p]} with autoscaling ${minInst}-${maxInst} instances.`, context: `Peak ${peak} rps today, ${growth}x growth expected in 12 months; team of ${req.operations.teamSize}.`, alternatives: [useServerlessCompute ? "Kubernetes (more control, more operations)" : "Serverless containers (less control over networking and sidecars)", "VM scale sets"], tradeoffs: useServerlessCompute ? "Less control over networking/sidecars and cold starts versus zero cluster operations." : "Cluster upgrades and node management versus flexibility for meshes, jobs and GPU pools.", consequences: "All services are stateless; state lives in managed stores. Capacity is expressed as rps per instance and revisited quarterly.", reason: small ? "Small scale does not justify cluster operations." : "Scale and growth justify a platform with fine-grained scheduling.", componentIds: ["api"] });

  // --- Cache --------------------------------------------------------------
  const cacheNeeded = req.traffic.readRatio >= 0.6 || req.business.expectedUsers >= 10_000;
  if (cacheNeeded) {
    push(component({ id: "cache", name: "Redis cache", type: "cache", provider, service: S.cache[p], zoneId: "data", regionId: R1, exposure: "private", criticality: "high", purpose: "Read-through cache for hot entities, rate-limit counters, idempotency keys. Sessions are stateless tokens, so the cache is an accelerator, not a source of truth.", rationale: `${Math.round(req.traffic.readRatio * 100)}% of traffic is reads; caching protects the database and meets the p95 target.`, alternatives: ["In-process cache only", "Database read replicas only"], scaling: { model: "vertical", maxReadOps: 200_000, maxConnections: 10_000, clusterMode: peak > 2000 }, redundancy: red({ replicas: 2, multiAz: highAvail, multiRegion: false, failover: "automatic", failoverSeconds: 30 }), backup: { enabled: false }, observability: baseObs(), security: { encryptionAtRest: !isLearning, encryptionInTransit: !isLearning, authentication: svcAuth, networkAcl: !isLearning }, cost: cost("medium", 100, 400, "provisioned"), operations: baseOps("backend"), evidence: "inference" }));
    adr({ title: "Cache as accelerator, never as the only copy", decision: "Replicated Redis for reads, counters and idempotency; sessions are signed tokens.", context: "Read-heavy traffic and a strict latency target.", alternatives: ["Sessions in Redis (simpler, but Redis becomes a hard dependency)", "No cache"], tradeoffs: "Cache invalidation logic and eventual staleness (short TTLs) versus database load and latency.", consequences: "Losing the cache degrades latency but nothing fails; rate limits reset.", reason: "Avoids the classic single-node session store SPOF.", componentIds: ["cache"] });
  }

  // --- Databases ----------------------------------------------------------
  const wantRelational = req.data.databasePreference !== "document";
  const wantDocument = req.data.databasePreference === "document" || req.data.databasePreference === "both";
  const dbMax = Math.min(5000, 200 + Math.ceil(req.data.volumeGb / 10));
  const dbWrite = req.data.consistency === "strong" ? 5000 : 8000;
  if (wantRelational) {
    push(component({ id: "db", name: "PostgreSQL (system of record)", type: "relational_db", provider, service: S.postgres[p], technology: "PostgreSQL 16, zone-redundant HA, PITR, connection pooling", zoneId: "data", regionId: R1, exposure: "private", criticality: "critical", purpose: "Transactional system of record: tenants, users, domain entities, billing.", rationale: req.data.consistency === "strong" ? "Strong consistency and relational integrity are required; managed PostgreSQL with synchronous standby provides both." : "Relational model with read replicas covers mixed consistency needs.", alternatives: ["MySQL", S.document[p], "CockroachDB / distributed SQL"], scaling: { model: isLearning ? "manual" : "vertical", maxConnections: isLearning ? 100 : dbMax, connectionPooler: !isLearning, maxWriteOps: dbWrite, maxReadOps: 20_000, readReplicas: isLearning ? 0 : req.traffic.readRatio >= 0.7 || multiRegion ? 1 : 0 }, redundancy: red({ replicas: 2, multiAz: highAvail, multiRegion, failover: "automatic", failoverSeconds: 60 }), backup: bak({ enabled: true, pointInTimeRecovery: true, crossRegion: multiRegion || req.data.backupRequired, frequency: "continuous (WAL) + daily snapshot", retentionDays: Math.min(35, Math.max(7, Math.ceil(req.data.retentionDays / 10))), restoreTested: true }), observability: baseObs(), security: { encryptionAtRest: !isLearning, encryptionInTransit: !isLearning, authentication: svcAuth, auditLogging: !isLearning && (pii || regulated), publicEndpoint: false, networkAcl: !isLearning, dataClassification: req.security.sensitiveData.includes("health") ? "regulated" : pii ? "pii" : "confidential" }, cost: cost("high", 300 + Math.round(req.data.volumeGb * 0.2), 900 + Math.round(req.data.volumeGb * 0.4), "provisioned", "zone-redundant pair; scales vertically"), operations: baseOps("backend", { migrationStrategy: "automated", rollback: "manual" }), evidence: "inference" }));
    adr({ title: "Managed PostgreSQL with zone-redundant standby and PITR", decision: `${S.postgres[p]} with synchronous standby, continuous backup${multiRegion ? " and an asynchronous cross-region replica" : ""}, behind a connection pooler.`, context: `RPO ${req.reliability.rpoMinutes} min, RTO ${req.reliability.rtoMinutes} min, ${req.data.consistency} consistency, ${req.data.volumeGb} GB.`, alternatives: ["Single-zone instance with daily backups (cheaper, misses RPO)", "Distributed SQL (higher cost and operational novelty)", "Document store"], tradeoffs: "About 2x the cost of a single instance and a small synchronous-commit latency versus meeting RPO/RTO.", consequences: "Failover is a ~60 s blip; applications must reconnect and be idempotent. Schema changes use expand/contract migrations.", reason: "The database is the component whose loss is unrecoverable; redundancy here is non-negotiable.", componentIds: ["db"] });
  }
  if (wantDocument) {
    push(component({ id: "docdb", name: "Document store", type: "document_db", provider, service: S.document[p], zoneId: "data", regionId: R1, exposure: "private", criticality: "high", purpose: "High-volume, schema-flexible data (events, activity feeds, per-tenant documents).", rationale: "Elastic throughput and multi-region replication without operational overhead.", alternatives: ["MongoDB Atlas", "PostgreSQL JSONB"], scaling: { model: isLearning ? "manual" : "managed", maxWriteOps: 50_000, maxReadOps: 200_000 }, redundancy: red({ replicas: 3, multiAz: true, multiRegion, failover: "automatic", failoverSeconds: 30 }), backup: bak({ enabled: true, pointInTimeRecovery: true, crossRegion: multiRegion, frequency: "continuous", restoreTested: true }), observability: baseObs(), security: { encryptionAtRest: !isLearning, encryptionInTransit: !isLearning, authentication: svcAuth, auditLogging: !isLearning && pii, networkAcl: !isLearning, dataClassification: pii ? "pii" : "internal" }, cost: cost("medium", 150, 800, "usage"), operations: baseOps("backend", { migrationStrategy: "automated" }), evidence: "inference" }));
  }

  // --- Storage, queue, workers --------------------------------------------
  const asyncWork = req.data.fileUploads || req.ai.enabled || req.business.applicationType !== "internal_tool";
  if (req.data.fileUploads || req.data.volumeGb > 500) {
    push(component({ id: "storage", name: "Object storage", type: "object_storage", provider, service: S.storage[p], zoneId: "managed", regionId: R1, exposure: "private", criticality: "high", purpose: "Uploads, exports, derived artifacts; lifecycle rules move cold objects to cheaper tiers.", rationale: "Durable, cheap, versioned and private-endpoint reachable.", alternatives: ["Database BLOBs", "Managed file shares"], scaling: { model: isLearning ? "manual" : "managed" }, redundancy: red({ replicas: 3, multiAz: true, multiRegion: multiRegion, failover: "automatic" }), backup: bak({ enabled: true, crossRegion: multiRegion, frequency: "versioning + soft delete", restoreTested: true }), observability: baseObs(), security: { encryptionAtRest: !isLearning, encryptionInTransit: !isLearning, authentication: isLearning ? "api_key" : svcAuth, publicEndpoint: false, networkAcl: !isLearning, dataClassification: pii ? "confidential" : "internal" }, cost: cost("medium", Math.round(req.data.volumeGb * 0.03) + 20, Math.round(req.data.volumeGb * 0.06) + 80, "usage"), operations: baseOps("backend"), evidence: "inference" }));
  }
  if (asyncWork) {
    push(component({ id: "queue", name: "Message queue", type: "queue", provider, service: S.queue[p], zoneId: "managed", regionId: R1, exposure: "private", criticality: "high", purpose: "Decouples slow work (uploads processing, emails, AI ingestion, webhooks) from the request path; dead-letter queue for poison messages.", rationale: "Asynchronous work keeps the API latency bounded and absorbs bursts.", alternatives: ["Kafka (higher throughput, more operations)", "Database-backed job table"], scaling: { model: isLearning ? "manual" : "managed", maxMessagesPerSecond: 10_000 }, redundancy: red({ replicas: 3, multiAz: true, multiRegion: false, failover: "automatic" }), observability: baseObs(), security: { encryptionAtRest: !isLearning, encryptionInTransit: !isLearning, authentication: svcAuth, networkAcl: !isLearning }, cost: cost("low", 30, 200, "usage"), operations: baseOps("backend"), evidence: "inference" }));
    const wMin = isLearning ? 1 : 2;
    const wMax = isLearning ? Math.max(1, Math.ceil(peak * 0.1)) : Math.max(10, Math.ceil(peak * 0.1));
    push(component({ id: "workers", name: "Background workers", type: "worker", provider, service: useServerlessCompute ? S.serverless[p] : `${S.compute[p]} (KEDA queue-depth autoscaling)`, zoneId: "app", regionId: R1, exposure: "private", criticality: "high", purpose: "Consume the queue: process uploads, send notifications, run AI ingestion and scheduled jobs. Scale on queue depth.", rationale: "Queue-depth autoscaling matches consumer capacity to backlog instead of a fixed pool.", alternatives: ["Fixed worker pool", "Serverless functions per message"], scaling: { model: "horizontal_auto", minInstances: wMin, maxInstances: wMax, currentInstances: wMin, jobsPerSecondPerInstance: 5 }, redundancy: red({ replicas: wMin, multiAz: true, multiRegion: false, failover: "automatic", failoverSeconds: 30 }), observability: baseObs(), security: { secretsSource: isLearning ? "env_var" : "managed_identity", iamScope: isLearning ? undefined : "least_privilege", encryptionInTransit: !isLearning }, cost: cost("medium", wMin * 45, Math.round(wMax * 45 * 0.3), "provisioned"), operations: baseOps("backend"), evidence: "inference" }));
    adr({ title: "Asynchronous processing with queue-depth autoscaling", decision: `${S.queue[p]} with a dead-letter queue and workers scaled on backlog (${wMin}-${wMax}).`, context: "Uploads, notifications and AI ingestion are bursty and slow.", alternatives: ["Do the work inline in the API", "Fixed worker pool"], tradeoffs: "Eventual completion and idempotency requirements versus bounded API latency and burst absorption.", consequences: "Every job must be idempotent; the queue age becomes a key SLO.", reason: "Fixed pools fall behind at 2x traffic; inline work couples latency to the slowest dependency.", componentIds: ["queue", "workers"] });
  }

  // --- AI -------------------------------------------------------------------
  if (req.ai.enabled) {
    const aiRps = Math.max(0.5, req.ai.inferenceRequestsPerDay / (8 * 3600));
    const aiMeta = selfHostedAi
      ? { name: "Local LLM (Ollama)", zone: "app", exposure: "private" as const, service: isLearning ? S.llmNative.generic : "Ollama (self-hosted, open-weight model) on a GPU-equipped VM", providerVal: "self_hosted" as Provider, auth: "none" as const, dataExternal: false,
          rationale: "No per-token cost and no data leaves the machine; quality trails a frontier model but is enough to learn RAG, prompt engineering and the operational patterns for free.",
          alternatives: ["OpenAI API (paid, higher quality)", "Anthropic API (paid, higher quality)", "A hosted free tier such as Groq"] }
      : externalSaasAi
      ? { name: `${req.ai.modelProvider === "anthropic" ? "Anthropic" : "OpenAI"} API`, zone: "saas", exposure: "public" as const, service: `${req.ai.modelProvider === "anthropic" ? "Anthropic" : "OpenAI"} platform (zero-retention agreement)`, providerVal: (req.ai.modelProvider === "anthropic" ? "anthropic" : "openai") as Provider, auth: "api_key" as const, dataExternal: true,
          rationale: "Frontier model quality; data handled under a zero-retention agreement with redaction upstream.",
          alternatives: ["Self-hosted open-weight models (free, lower quality)", S.llmNative[p]] }
      : { name: "Model endpoint (in-cloud)", zone: "managed", exposure: "private" as const, service: S.llmNative[p], providerVal: provider, auth: "iam" as const, dataExternal: false,
          rationale: "In-region managed endpoint keeps data inside the cloud boundary with private connectivity.",
          alternatives: ["Self-hosted open-weight models on GPU nodes", "Direct provider API (OpenAI/Anthropic)"] };
    llmAuth = aiMeta.auth;
    push(component({ id: "llm-gateway", name: "Model gateway", type: "llm_gateway", provider, service: selfHostedAi ? "A small script or LiteLLM proxy in front of Ollama" : `${useServerlessCompute ? S.serverless[p] : S.compute[p]} service (LiteLLM / custom)`, zoneId: "app", regionId: R1, exposure: "private", criticality: "critical", purpose: "Single choke point for every model call: per-tenant token budgets, prompt/response caching, PII redaction, retries with backoff, circuit breaker and routing to a fallback model; streams tokens to clients.", rationale: "Provider limits, cost and safety controls belong in one place rather than in every service.", alternatives: ["Call providers directly from services", "Managed AI gateway product"], scaling: { model: "horizontal_auto", minInstances: 2, maxInstances: 20, rpsPerInstance: 200 }, redundancy: red({ replicas: 2, multiAz: true, multiRegion: false, failover: "automatic", failoverSeconds: 30 }), observability: baseObs(), security: { secretsSource: isLearning ? "env_var" : "managed_identity", iamScope: isLearning ? undefined : "least_privilege", encryptionInTransit: true, auditLogging: true }, cost: cost("low", 90, 300, "provisioned"), operations: baseOps("ml"), ai: { role: "gateway", rateLimitHandling: "circuit_breaker", promptInjectionControls: true, piiRedaction: req.ai.promptDataSecurity !== "standard", costCap: true, responseCaching: true, timeoutMs: Math.min(15_000, req.ai.latencyTargetMs * 3), toolAccess: false, modelPinned: true, modelRouting: true, tenantIsolation: true, untrustedInput: req.ai.rag }, evidence: "inference" }));
    push(component({ id: "llm", name: aiMeta.name, type: "llm_provider", provider: aiMeta.providerVal, service: aiMeta.service, zoneId: aiMeta.zone, regionId: aiMeta.zone === "managed" ? R1 : undefined, exposure: aiMeta.exposure, criticality: "high", purpose: `Primary chat/completion${req.ai.modelType !== "llm_chat" ? " and embedding" : ""} models.`, rationale: aiMeta.rationale, alternatives: aiMeta.alternatives, scaling: selfHostedAi ? { model: "none" } : { model: "managed", requestsPerMinuteLimit: Math.max(1000, Math.ceil(aiRps * 60 * 3)), tokensPerMinuteLimit: Math.max(500_000, Math.ceil(aiRps * 60 * 1500 * 3)) }, redundancy: selfHostedAi ? { replicas: 1, multiAz: false, multiRegion: false, failover: "none" } : red({ replicas: 2, multiAz: true, multiRegion: true, failover: "automatic" }), observability: baseObs(), security: { authentication: aiMeta.auth, encryptionInTransit: !selfHostedAi, secretsSource: selfHostedAi ? undefined : isLearning ? "env_var" : "managed_identity", dataClassification: pii ? "pii" : "confidential" }, cost: selfHostedAi ? cost("low", 0, isLearning ? 0 : 50, "free", "No per-token cost; a GPU speeds inference up but is optional for small models.") : cost(req.ai.inferenceRequestsPerDay > 20_000 ? "very_high" : "high", Math.round(req.ai.inferenceRequestsPerDay * 30 * 0.001), Math.round(req.ai.inferenceRequestsPerDay * 30 * 0.006), "usage", "token pricing estimate: ~1.5k tokens per request, half of calls routed to a small model ($0.001-0.006 per request)"), operations: baseOps("ml"), ai: { role: "llm", provider: selfHostedAi ? "self_hosted" : nativeAi ? p : req.ai.modelProvider, model: selfHostedAi ? "pinned model tag (e.g. llama3:8b)" : "pinned model version", fallbackProvider: req.ai.fallbackRequired ? (selfHostedAi ? "a second, smaller local model" : "secondary provider / region") : undefined, fallbackModel: req.ai.fallbackRequired ? "equivalent model" : undefined, rateLimitHandling: selfHostedAi ? "none" : "queue", piiRedaction: !selfHostedAi && req.ai.promptDataSecurity !== "standard", dataSentExternally: aiMeta.dataExternal, costCap: true, responseCaching: true, modelPinned: true, promptInjectionControls: true, toolAccess: false, untrustedInput: req.ai.rag, modelRouting: !selfHostedAi, timeoutMs: selfHostedAi ? 30_000 : 15_000 }, evidence: "inference" }));
    if (req.ai.fallbackRequired) {
      push(component({ id: "llm-fallback", name: selfHostedAi ? "Fallback local model (smaller/faster)" : "Fallback model endpoint", type: "llm_provider", provider: selfHostedAi ? "self_hosted" : nativeAi ? provider : "saas", service: selfHostedAi ? "A second Ollama model tag, e.g. a 1-3B model that answers when the main one is overloaded" : nativeAi ? `${S.llmNative[p]} - second region / deployment` : "Secondary provider or in-cloud deployment", zoneId: selfHostedAi ? "app" : nativeAi ? "managed" : "saas", exposure: selfHostedAi ? "private" : nativeAi ? "private" : "public", criticality: "medium", purpose: "Receives traffic when the primary is throttled or unavailable; evaluated continuously against the primary with a golden prompt set.", rationale: `Model availability target ${req.ai.modelAvailabilityTarget}% cannot rest on one model/provider.`, alternatives: ["No fallback (accept outages when the primary is down)"], scaling: selfHostedAi ? { model: "none" } : { model: "managed", requestsPerMinuteLimit: 1000, tokensPerMinuteLimit: 500_000 }, redundancy: selfHostedAi ? { replicas: 1, multiAz: false, multiRegion: false, failover: "none" } : red({ replicas: 2, multiAz: true, multiRegion: true, failover: "automatic" }), observability: baseObs(false), security: { authentication: selfHostedAi ? "none" : nativeAi ? "iam" : "api_key", encryptionInTransit: !selfHostedAi, secretsSource: selfHostedAi ? undefined : isLearning ? "env_var" : "managed_identity" }, cost: selfHostedAi ? cost("low", 0, 0, "free", "No per-token cost.") : cost("low", 0, Math.round(req.ai.inferenceRequestsPerDay * 30 * 0.001), "usage", "pay only when used"), operations: baseOps("ml"), ai: { role: "llm", modelPinned: true, rateLimitHandling: selfHostedAi ? "none" : "circuit_breaker", piiRedaction: !selfHostedAi, costCap: true, promptInjectionControls: true, toolAccess: false, dataSentExternally: !selfHostedAi && !nativeAi, modelRouting: true, responseCaching: true, standby: true }, evidence: "inference" }));
    }
    if (req.ai.rag) {
      const pgvector = (req.ai.vectorDatabase === "pgvector" || isLearning) && wantRelational;
      const selfHostedVector = req.ai.vectorDatabase === "self_hosted" || isLearning;
      if (!pgvector) {
        push(component({ id: "vector", name: "Vector index", type: "vector_db", provider: selfHostedVector ? "self_hosted" : provider, service: selfHostedVector ? (isLearning ? S.vector.generic : "Qdrant cluster (3 nodes, snapshots to object storage)") : S.vector[p], zoneId: "data", regionId: R1, exposure: "private", criticality: "high", purpose: "Per-tenant vector collections for retrieval; embedding model id stored with every vector.", rationale: selfHostedVector ? "Full control over index parameters, no managed-service cost." : "Managed service removes index operations and scales with data.", alternatives: ["pgvector in PostgreSQL (simpler, lower ceiling)", "Pinecone / Weaviate Cloud"], scaling: { model: selfHostedVector ? "horizontal_auto" : "managed", maxReadOps: 2000 }, redundancy: red({ replicas: 3, multiAz: true, multiRegion: false, failover: "automatic", failoverSeconds: 30 }), backup: bak({ enabled: true, frequency: "hourly snapshots", restoreTested: true }), observability: baseObs(), security: { encryptionAtRest: !isLearning, encryptionInTransit: true, authentication: isLearning ? "none" : "iam", tenantIsolation: true, networkAcl: true, dataClassification: "confidential" }, cost: cost("medium", 150, 900, selfHostedVector ? "provisioned" : "usage"), operations: baseOps("ml"), ai: { role: "vector_store", tenantIsolation: true, modelPinned: true }, evidence: "inference" }));
      }
      adr({ title: pgvector ? "pgvector inside PostgreSQL for retrieval" : `${selfHostedVector ? "Self-hosted" : "Managed"} vector index for retrieval`, decision: pgvector ? "Store embeddings in PostgreSQL with pgvector and per-tenant row-level security." : `Use ${selfHostedVector ? "a self-hosted Qdrant" : S.vector[p]} with one collection per tenant.`, context: "RAG over user documents across tenants.", alternatives: ["Single shared collection filtered by tenant_id (leak-prone)", pgvector ? "Dedicated vector service" : "pgvector"], tradeoffs: pgvector ? "Lower query ceiling and shared database load versus one less system to run." : "Another container/service to run versus scale and isolation.", consequences: "Embedding model version is part of the schema; upgrades are migrations with re-embedding.", reason: isLearning ? "Fewer moving parts to run locally; pgvector ships inside the PostgreSQL container you already have." : "Isolation by structure, not by query filter.", componentIds: [pgvector ? "db" : "vector"] });
    }
    adr({ title: "All model traffic through a gateway with a fallback model", decision: `A model gateway enforces budgets, caching, redaction and routing to ${aiMeta.name}${req.ai.fallbackRequired ? " with an automatic fallback" : ""}.`, context: `${req.ai.inferenceRequestsPerDay.toLocaleString("en-US")} inferences/day, ${req.ai.promptDataSecurity.replace("_", " ")} data policy, ${req.ai.latencyTargetMs} ms target.`, alternatives: ["Direct SDK calls from each service", "Managed AI gateway product"], tradeoffs: "One more service and prompt-compatibility testing across models versus provider lock-in, uncontrolled spend and outages that follow the provider's calendar.", consequences: "Every AI feature degrades gracefully; spend is attributable per tenant.", reason: "Provider limits are organisation-wide; fairness and safety must be enforced before the provider sees traffic.", componentIds: ["llm-gateway", "llm", ...(req.ai.fallbackRequired ? ["llm-fallback"] : [])] });
  }

  // --- Platform: observability, secrets, CI, networking --------------------
  push(component({ id: "observability", name: "Observability platform", type: "monitoring", provider, service: S.monitoring[p], zoneId: "managed", regionId: R1, exposure: "private", criticality: "medium", purpose: "Metrics, structured logs (30-day hot, archive after), distributed traces with tail sampling, SLO-based alerting and on-call routing.", rationale: "Native platform telemetry with OpenTelemetry keeps vendor lock-in at the SDK layer.", alternatives: ["Datadog", "Grafana Cloud", "Self-hosted Prometheus/Loki/Tempo"], scaling: { model: "managed" }, redundancy: managedRedundant(), observability: { ...baseObs(), logRetentionDays: 30 }, security: { encryptionAtRest: !isLearning, encryptionInTransit: !isLearning, authentication: isLearning ? "password" : "iam" }, cost: cost("medium", 150, 700, "usage", "30-day hot retention, sampled traces"), operations: baseOps("platform"), evidence: "inference" }));
  push(component({ id: "secrets", name: isLearning ? "Configuration (.env)" : "Secrets + keys", type: "secrets_manager", provider, service: S.secrets[p], zoneId: "managed", regionId: R1, exposure: "private", criticality: "high", purpose: isLearning ? "Database passwords, API keys, and other config, kept out of source control in a single .env file." : "Runtime secrets fetched via workload identity, automatic rotation; customer-managed keys for data stores where compliance demands it.", rationale: isLearning ? "The simplest thing that works for one machine; the fix for a real deployment is a runtime secrets manager - see the Security findings." : "No static credentials in manifests, CI or images.", alternatives: ["Kubernetes secrets only", "HashiCorp Vault"], scaling: { model: "managed" }, redundancy: managedRedundant(), observability: baseObs(), security: { encryptionAtRest: !isLearning, encryptionInTransit: !isLearning, authentication: isLearning ? undefined : "iam", auditLogging: !isLearning }, cost: cost("low", 5, 60, "usage"), operations: baseOps("platform"), evidence: "inference" }));
  push(component({ id: "cicd", name: "CI/CD pipeline", type: "ci_cd", provider: "github", service: S.ci[p], zoneId: "ci", exposure: "public", criticality: "medium", purpose: `Build, test, scan (SAST, dependencies, containers), publish immutable images, deploy through staging with ${req.operations.deploymentStrategy.replace("_", "/")} releases and automatic rollback on SLO regression.`, rationale: isLearning ? "GitHub Actions is free for this and doubles as a portfolio signal: green checks on every commit." : "OIDC federation gives the pipeline short-lived, scoped credentials.", alternatives: ["Azure DevOps / AWS CodePipeline / Cloud Build", "Argo CD (GitOps)"], scaling: { model: "managed" }, redundancy: managedRedundant(), observability: baseObs(false), security: { iamScope: isLearning ? undefined : "least_privilege", secretsSource: "secrets_manager", authentication: "oauth2", auditLogging: !isLearning }, cost: cost("low", 0, 150, "usage"), operations: baseOps("platform"), evidence: "inference" }));
  push(component({ id: "net", name: isLearning ? "Docker network" : "Private networking", type: "private_link", provider, service: S.natOrLink[p], zoneId: "app", regionId: R1, exposure: "private", criticality: isLearning ? "medium" : "high", purpose: isLearning ? "Containers reach each other by service name over Docker's internal network; only the reverse proxy publishes a port to the host." : "Private endpoints for every managed data service; zone-redundant NAT for the little egress that remains; no public IPs on data stores.", rationale: fullyPrivate ? "Regulated data requires no public data-plane exposure." : isLearning ? "The default and free way to isolate containers from the internet." : "Private connectivity removes the data stores from the attack surface entirely.", alternatives: isLearning ? ["Publishing every container's port (defeats the purpose)"] : ["Service endpoints", "Public endpoints with firewall rules"], scaling: { model: "managed" }, redundancy: red({ replicas: 3, multiAz: true, multiRegion: false, failover: "automatic" }), observability: baseObs(), security: { encryptionInTransit: !isLearning, networkAcl: !isLearning }, cost: cost("low", 60, 250, "usage"), operations: baseOps("platform"), evidence: "inference" }));
  adr(isLearning
    ? { title: "No ports published except the reverse proxy", decision: "Every data store and internal service stays on Docker's internal network with no published port; only the reverse proxy binds to the host.", context: "Single-machine deployment with no cloud network to configure.", alternatives: ["Publish each service's port directly (easier to debug, exposes everything)"], tradeoffs: "You need `docker compose exec` (not a host port) to reach a database directly during development.", consequences: "The findings below still flag password-only auth and unencrypted intra-container traffic - real risks even on one machine, and exactly what a cloud deployment fixes with private endpoints and mTLS.", reason: "The free version of network isolation: don't expose what doesn't need to answer the internet.", componentIds: ["net", "secrets", "cicd"] }
    : { title: "Private data plane, workload identity, least privilege", decision: "All data stores reachable only via private endpoints; services authenticate to stores with workload identity; CI uses OIDC with resource-group scoped roles.", context: `${req.security.compliance.map((c) => c.toUpperCase()).join(", ") || "No"} compliance obligations; sensitive data: ${req.security.sensitiveData.join(", ") || "none"}.`, alternatives: ["Public endpoints with IP allow-lists", "Static secrets in manifests"], tradeoffs: "Private DNS and bastion access for operators versus a data plane that cannot be reached from the internet at all.", consequences: "Secrets never appear in CI logs; a compromised pipeline cannot touch production data.", reason: "Network reachability is the first link in every attack chain.", componentIds: ["net", "secrets", "cicd"] });

  if (multiRegion) {
    push(component({ id: "dr", name: activeActive ? "Secondary region (active)" : "Secondary region (warm standby)", type: "container_platform", provider, service: `${useServerlessCompute ? S.serverless[p] : S.compute[p]} + replicated data services in ${S.regions[p][1]}`, zoneId: "dr", regionId: R2, exposure: "private", criticality: "high", purpose: activeActive ? "Serves traffic concurrently; DNS/edge steers by health and geography." : "Minimal running footprint with continuously replicated data; promoted by runbook-driven automation when the primary fails.", rationale: `${req.operations.disasterRecovery.replace("_", " ")} posture required for ${req.reliability.availabilityTarget}% / RTO ${req.reliability.rtoMinutes} min.`, alternatives: ["Backup/restore only (hours of RTO)", "Pilot light"], scaling: { model: "horizontal_auto", minInstances: activeActive ? minInst : 1, maxInstances: maxInst, rpsPerInstance: rpsPer }, redundancy: { replicas: activeActive ? minInst : 1, multiAz: true, multiRegion: true, failover: secondaryAuto ? "automatic" : "manual", failoverSeconds: 300 }, observability: baseObs(), security: { secretsSource: "managed_identity", iamScope: "least_privilege", encryptionInTransit: true }, cost: cost("high", activeActive ? 800 : 300, activeActive ? 2500 : 900, "provisioned", activeActive ? "full second stack" : "reduced footprint + replicas"), operations: baseOps("platform"), evidence: "inference" }));
    adr({ title: `${req.operations.disasterRecovery.replace("_", " ")} disaster recovery in a second region`, decision: `Deploy ${activeActive ? "an active" : "a standby"} stack in ${S.regions[p][1]} with asynchronous data replication and health-based DNS/edge failover.`, context: `Target ${req.reliability.availabilityTarget}%; a regional incident exceeds the error budget of a single region.`, alternatives: ["Single region with cross-region backups", "Active/active with global database"], tradeoffs: `Roughly ${activeActive ? "70-100%" : "25-45%"} additional infrastructure cost and cross-region replication lag (RPO of seconds to minutes) versus regional resilience.`, consequences: "Failover is rehearsed quarterly; write conflicts are avoided by a single writer region.", reason: "Four nines or multi-region audiences cannot be served from one fault domain.", componentIds: ["dr"] });
  } else {
    warnings.push("Single-region deployment: a regional incident is a full outage. Backups are copied to a second region so the stack can be rebuilt (backup/restore posture).");
  }

  // --- Edges ------------------------------------------------------------------
  const E = (e: Parameters<typeof edge>[0]) => link(edge({ evidence: "inference", encrypted: true, ...e }));
  E({ source: "users", target: "dns", kind: "resolves", protocol: "dns", label: "resolve" });
  E({ source: "users", target: "edge", kind: "calls", protocol: "https", authentication: "jwt", label: "web + api" });
  E({ source: "users", target: "idp", kind: "authenticates_with", protocol: "https", authentication: "oauth2", label: "login", criticality: "soft", fallback: "existing sessions remain valid" });
  E({ source: "edge", target: "gateway", kind: "routes_to", protocol: "https", authentication: "mtls", label: "origin (private link)" });
  E({ source: "gateway", target: "idp", kind: "authenticates_with", protocol: "https", authentication: "oauth2", label: "JWKS (cached 24h)", criticality: "soft", fallback: "cached signing keys", timeoutMs: 3000, circuitBreaker: true });
  E({ source: "gateway", target: "api", kind: "routes_to", protocol: "https", authentication: "mtls" });
  if (cacheNeeded) E({ source: "api", target: "cache", kind: "reads", protocol: "redis", authentication: svcAuth, criticality: "soft", fallback: "read through to the database", connectionsPerInstance: 5 });
  if (wantRelational) E({ source: "api", target: "db", kind: "writes", protocol: "postgres", authentication: svcAuth, connectionsPerInstance: poolPer, dataClassification: pii ? "pii" : "confidential", timeoutMs: 5000 });
  if (wantDocument) E({ source: "api", target: "docdb", kind: "writes", protocol: "https", authentication: svcAuth, dataClassification: pii ? "pii" : "internal", timeoutMs: 3000, criticality: wantRelational ? "soft" : "hard" });
  if (comps.some((c) => c.id === "storage")) E({ source: "api", target: "storage", kind: "writes", protocol: "https", authentication: isLearning ? "api_key" : svcAuth, label: "signed upload URLs", criticality: "soft", dataClassification: "confidential" });
  if (asyncWork) {
    E({ source: "api", target: "queue", kind: "publishes", protocol: "amqp", authentication: svcAuth, criticality: "soft", fallback: "outbox table, retried" });
    E({ source: "workers", target: "queue", kind: "consumes", protocol: "amqp", authentication: svcAuth });
    if (wantRelational) E({ source: "workers", target: "db", kind: "writes", protocol: "postgres", authentication: svcAuth, connectionsPerInstance: 3 });
    if (comps.some((c) => c.id === "storage")) E({ source: "workers", target: "storage", kind: "reads", protocol: "https", authentication: isLearning ? "api_key" : svcAuth });
  }
  E({ source: "api", target: "secrets", kind: "fetches_secrets_from", protocol: "https", authentication: isLearning ? "none" : svcAuth, criticality: "soft", fallback: isLearning ? "read once at container start from the .env file" : "cached at startup, refreshed hourly" });
  if (asyncWork) E({ source: "workers", target: "secrets", kind: "fetches_secrets_from", protocol: "https", authentication: isLearning ? "none" : svcAuth, criticality: "soft", fallback: isLearning ? "read once at container start from the .env file" : "cached at startup" });
  if (req.ai.enabled) {
    E({ source: "api", target: "llm-gateway", kind: "calls", protocol: "grpc", authentication: isLearning ? "none" : "mtls", label: "streamed inference", criticality: "soft", fallback: "AI features degrade, product keeps working", timeoutMs: 15_000, circuitBreaker: true, dataClassification: pii ? "pii" : "confidential" });
    E({ source: "llm-gateway", target: "llm", kind: "calls", protocol: "https", authentication: llmAuth, label: "primary model", criticality: req.ai.fallbackRequired ? "soft" : "hard", fallback: req.ai.fallbackRequired ? "route to fallback model" : undefined, timeoutMs: 15_000, retries: 2, circuitBreaker: true, dataClassification: req.ai.promptDataSecurity === "standard" && pii ? "pii" : "confidential" });
    if (req.ai.fallbackRequired) E({ source: "llm-gateway", target: "llm-fallback", kind: "calls", protocol: "https", authentication: llmAuth, label: "fallback", criticality: "soft", timeoutMs: 15_000, circuitBreaker: true, dataClassification: "confidential" });
    if (req.ai.rag && comps.some((c) => c.id === "vector")) {
      E({ source: "llm-gateway", target: "vector", kind: "reads", protocol: "https", authentication: isLearning ? "none" : svcAuth, label: "retrieval (tenant collection)", criticality: "soft", fallback: "answer without retrieval", timeoutMs: 2000 });
      if (asyncWork) E({ source: "workers", target: "vector", kind: "writes", protocol: "https", authentication: isLearning ? "none" : svcAuth, label: "upsert embeddings" });
    }
    if (asyncWork) E({ source: "workers", target: "llm-gateway", kind: "calls", protocol: "grpc", authentication: "mtls", label: "embeddings (batched)", criticality: "hard", timeoutMs: 30_000, retries: 3, circuitBreaker: true });
  }
  if (multiRegion) {
    if (wantRelational) E({ source: "db", target: "dr", kind: "replicates_to", sync: "async", criticality: "soft", protocol: "postgres", label: "async replica" });
    if (comps.some((c) => c.id === "storage")) E({ source: "storage", target: "dr", kind: "replicates_to", sync: "async", criticality: "soft", label: "geo-replication" });
    E({ source: "edge", target: "dr", kind: "routes_to", protocol: "https", authentication: "mtls", criticality: "soft", label: activeActive ? "active traffic" : "failover origin" });
  }
  for (const id of ["api", "gateway", "workers", "db", "cache", "queue", "llm-gateway", "vector"]) if (comps.some((c) => c.id === id)) link(edge({ source: "observability", target: id, kind: "monitors", sync: "async", criticality: "soft", evidence: "inference" }));
  for (const id of ["api", "workers", "llm-gateway"]) if (comps.some((c) => c.id === id)) link(edge({ source: "cicd", target: id, kind: "deploys_to", sync: "async", criticality: "soft", evidence: "inference", label: `${req.operations.deploymentStrategy.replace("_", "/")} via staging` }));

  // --- Flows ---------------------------------------------------------------------
  const has = (id: string) => comps.some((c) => c.id === id);
  const eid = (s: string, t: string, k: string) => edges.find((e) => e.source === s && e.target === t && e.kind === k)?.id;
  flows.push({ id: "f-normal", name: "Page load (unauthenticated)", kind: "normal_request", trafficShare: 0.25, description: "A visitor loads the app.", steps: [
    { componentId: "users", action: "Resolve hostname, open the app" },
    { componentId: "dns", edgeId: eid("users", "dns", "resolves"), action: "Health-checked records point at the edge" },
    { componentId: "edge", edgeId: eid("users", "edge", "calls"), action: "Serve cached static assets; WAF and bot rules applied" },
  ] });
  flows.push({ id: "f-auth", name: "Login + authenticated request", kind: "authenticated_request", trafficShare: 0.1, description: "OIDC login, then an API call with a bearer token.", steps: [
    { componentId: "users", action: "Redirect to identity provider, receive tokens" },
    { componentId: "idp", edgeId: eid("users", "idp", "authenticates_with"), action: "Authenticate (MFA / SSO), issue ID + access tokens" },
    { componentId: "edge", edgeId: eid("users", "edge", "calls"), action: "Rate limit per token, forward to origin" },
    { componentId: "gateway", edgeId: eid("edge", "gateway", "routes_to"), action: "Validate JWT against cached JWKS, enforce tenant quota" },
    { componentId: "api", edgeId: eid("gateway", "api", "routes_to"), action: "Authorize (RBAC claims), serve" },
  ] });
  if (wantRelational) {
    flows.push({ id: "f-read", name: "Read entity (cache + DB)", kind: "db_read", trafficShare: 0.3, description: "Read-heavy path with cache in front of the database.", steps: [
      { componentId: "users", action: "GET /items" }, { componentId: "edge", edgeId: eid("users", "edge", "calls"), action: "Forward" }, { componentId: "gateway", edgeId: eid("edge", "gateway", "routes_to"), action: "Validate token" }, { componentId: "api", edgeId: eid("gateway", "api", "routes_to"), action: "Check cache, fall back to DB" },
      ...(cacheNeeded ? [{ componentId: "cache", edgeId: eid("api", "cache", "reads"), action: "Cache lookup (short TTL)" }] : []),
      { componentId: "db", edgeId: eid("api", "db", "writes"), action: "SELECT via pooler, read replica when eventual consistency is acceptable" },
    ] });
    flows.push({ id: "f-write", name: "Write entity", kind: "db_write", trafficShare: 0.1, description: "Transactional write with outbox event.", steps: [
      { componentId: "users", action: "POST /items" }, { componentId: "edge", edgeId: eid("users", "edge", "calls"), action: "Forward" }, { componentId: "gateway", edgeId: eid("edge", "gateway", "routes_to"), action: "Validate token, idempotency key" }, { componentId: "api", edgeId: eid("gateway", "api", "routes_to"), action: "Validate, write in a transaction" },
      { componentId: "db", edgeId: eid("api", "db", "writes"), action: "INSERT + outbox row (synchronous commit to standby)" },
      ...(asyncWork ? [{ componentId: "queue", edgeId: eid("api", "queue", "publishes"), action: "Outbox relay publishes domain event" }] : []),
    ] });
  }
  if (has("storage")) flows.push({ id: "f-upload", name: "File upload", kind: "file_upload", trafficShare: 0.05, description: "Direct-to-storage upload with signed URL.", steps: [
    { componentId: "users", action: "Request signed upload URL, PUT file directly to storage" }, { componentId: "edge", edgeId: eid("users", "edge", "calls"), action: "Forward (size limit enforced)" }, { componentId: "gateway", edgeId: eid("edge", "gateway", "routes_to"), action: "Validate" }, { componentId: "api", edgeId: eid("gateway", "api", "routes_to"), action: "Issue signed URL, create metadata" },
    { componentId: "storage", edgeId: eid("api", "storage", "writes"), action: "Object stored (private, versioned)" },
    ...(asyncWork ? [{ componentId: "queue", edgeId: eid("api", "queue", "publishes"), action: "Enqueue processing job" }] : []),
  ] });
  if (asyncWork) flows.push({ id: "f-job", name: "Background job", kind: "async_job", trafficShare: 0.05, description: "Queue-driven processing with retries and DLQ.", steps: [
    { componentId: "queue", action: "Message available (visibility timeout, max 5 deliveries, then DLQ)" },
    { componentId: "workers", edgeId: eid("workers", "queue", "consumes"), action: "Idempotent handler, scaled on queue depth" },
    ...(has("storage") ? [{ componentId: "storage", edgeId: eid("workers", "storage", "reads"), action: "Read input object" }] : []),
    ...(wantRelational ? [{ componentId: "db", edgeId: eid("workers", "db", "writes"), action: "Persist result" }] : []),
  ] });
  if (req.ai.enabled) {
    flows.push({ id: "f-ai", name: "AI inference (streamed)", kind: "ai_inference", trafficShare: 0.08, description: "Chat completion through the gateway with budget, cache and fallback.", steps: [
      { componentId: "users", action: "POST /chat (streams the answer)" }, { componentId: "edge", edgeId: eid("users", "edge", "calls"), action: "Forward, per-token rate limit" }, { componentId: "gateway", edgeId: eid("edge", "gateway", "routes_to"), action: "Validate token" }, { componentId: "api", edgeId: eid("gateway", "api", "routes_to"), action: "Build prompt; release DB connection before inference" },
      { componentId: "llm-gateway", edgeId: eid("api", "llm-gateway", "calls"), action: "Check tenant budget, cache, redact PII, choose model by task" },
      { componentId: "llm", edgeId: eid("llm-gateway", "llm", "calls"), action: "Stream tokens; on 429/timeout the breaker opens and traffic shifts to the fallback" },
      ...(req.ai.fallbackRequired ? [{ componentId: "llm-fallback", edgeId: eid("llm-gateway", "llm-fallback", "calls"), action: "Serves while the primary is unhealthy" }] : []),
    ] });
    if (req.ai.rag && has("vector")) flows.push({ id: "f-rag", name: "RAG question over documents", kind: "rag_request", trafficShare: 0.07, description: "Retrieval scoped to the tenant collection, retrieved text isolated from instructions.", steps: [
      { componentId: "users", action: "POST /chat with document scope" }, { componentId: "edge", edgeId: eid("users", "edge", "calls"), action: "Forward" }, { componentId: "gateway", edgeId: eid("edge", "gateway", "routes_to"), action: "Validate token" }, { componentId: "api", edgeId: eid("gateway", "api", "routes_to"), action: "Resolve tenant, call gateway" },
      { componentId: "llm-gateway", edgeId: eid("api", "llm-gateway", "calls"), action: "Embed query (cached), retrieve, assemble prompt with retrieved text as data" },
      { componentId: "vector", edgeId: eid("llm-gateway", "vector", "reads"), action: "Top-k search in the tenant's own collection" },
      { componentId: "llm", edgeId: eid("llm-gateway", "llm", "calls"), action: "Generate with injection controls; read-only tools only" },
    ] });
  }

  const traffic = { baselineRps: req.traffic.baselineRps, peakRps: peak, readRatio: req.traffic.readRatio, monthlyActiveUsers: req.business.expectedUsers, aiRequestsPerSecond: req.ai.enabled ? Math.round((req.ai.inferenceRequestsPerDay / (8 * 3600)) * 100) / 100 : undefined, avgTokensPerAiRequest: req.ai.enabled ? 1500 : undefined, evidence: "inference" as const };
  const g = graph({
    id: `architect-${Date.now()}`,
    name: `Proposed architecture - ${req.business.applicationType.replace("_", " ")} (${p.toUpperCase()})`,
    description: req.business.description || `Generated from requirements: ${req.business.expectedUsers.toLocaleString("en-US")} users, ${req.reliability.availabilityTarget}% availability, ${req.business.geography.replace("_", " ")}.`,
    source: "architect",
    regions,
    zones,
    components: comps,
    edges,
    flows,
    traffic,
    targets: { availability: req.reliability.availabilityTarget, rtoMinutes: req.reliability.rtoMinutes, rpoMinutes: req.reliability.rpoMinutes, p95LatencyMs: req.performance.p95LatencyMs },
    assumptions: [
      "Per-instance throughput (~150 rps) and cost ranges are planning estimates, not measurements.",
      "Traffic shares per flow are assumed from the application type.",
      ...(req.ai.enabled ? ["AI cost assumes ~1,500 tokens per request and half of calls routed to a smaller model."] : []),
    ],
    unknowns: ["Actual data access patterns (hot keys, largest tenant) - affects cache and sharding decisions.", "Vendor quota tiers actually granted for model providers."],
    metadata: { requirements: req },
  });

  const deployment: DeploymentPlan = isLearning
    ? {
        cicd: `${S.ci[p]}: on every push, run tests and linters, build each service's image, and push them to GitHub Container Registry (free for public repos).`,
        environments: ["local (docker compose up, on your machine)", "optional: one small VPS ($5-6/mo) if you want a public URL to share"],
        artifactStrategy: "Container images tagged by commit SHA, pulled by `docker compose pull` wherever you run the stack.",
        deploymentStrategy: "docker compose up -d --pull always after each build; there is no traffic-splitting without a load balancer, so a bad build is visible immediately (that tradeoff is itself worth understanding).",
        rollback: "docker compose pull with the previous image tag, then `up -d` again. There is no automatic rollback without a real orchestrator (Kubernetes, Nomad, a managed platform) - this is exactly what you get by adopting one later.",
        migrations: "Run migrations as a one-off `docker compose run` step before restarting the app container; no online schema-change tooling at this scale.",
        secretsAndConfig: "A git-ignored .env file read by docker-compose.yml; GitHub Actions encrypted secrets for anything the pipeline needs. This is the honest beginner setup - the Security findings below explain what changes in production.",
        infrastructureAsCode: "docker-compose.yml IS your infrastructure as code here: it fully describes every container, network and volume, and anyone can reproduce your stack with `docker compose up`.",
      }
    : {
        cicd: `${S.ci[p]}: lint, unit and contract tests, SAST + dependency + container scanning, build once, sign images.`,
        environments: ["dev (ephemeral per PR, scale-to-zero)", "staging (production-like, same IaC, synthetic data)", "production"],
        artifactStrategy: "Immutable container images tagged by commit SHA and signed; the same artifact is promoted from staging to production.",
        deploymentStrategy: req.operations.deploymentStrategy === "canary" ? "Canary: 5% -> 25% -> 100% with automated analysis on error rate and latency SLOs." : req.operations.deploymentStrategy === "blue_green" ? "Blue/green with traffic switch at the gateway and instant rollback." : "Rolling with max-surge and readiness gates.",
        rollback: "Automatic rollback when canary analysis fails; one-click rollback to the previous image otherwise. Database changes are backward compatible so code can roll back independently.",
        migrations: "Expand/contract migrations run by the pipeline before the deploy step; online schema-change tooling for large tables; restore rehearsed monthly.",
        secretsAndConfig: `${S.secrets[p]}: workload identity at runtime, no secrets in manifests or CI variables; configuration as versioned environment overlays.`,
        infrastructureAsCode: `${S.iac[p]} with per-environment state, plan on PR, apply on merge, drift detection nightly.`,
      };
  const observability: ObservabilityPlan = {
    metrics: ["Request rate, error rate, latency (p50/p95/p99) per route and tenant", "Saturation: CPU/memory per service, DB connections and replication lag, queue depth and oldest message age, cache hit ratio", ...(req.ai.enabled ? ["Model latency, 429 rate, tokens per tenant, cost per feature, cache hit ratio for prompts"] : [])],
    logs: ["Structured JSON logs with trace and tenant ids", "30-day hot retention, archive to cold storage afterwards", ...(pii || regulated ? ["Audit logs for data access and admin actions, tamper-evident"] : [])],
    traces: ["OpenTelemetry auto-instrumentation across gateway, services, workers and data clients", "Context propagated through the queue", "Tail sampling keeping all errors and slow traces"],
    alerts: [`Availability SLO burn rate (target ${req.reliability.availabilityTarget}%)`, `Latency SLO (p95 > ${req.performance.p95LatencyMs} ms)`, "DB connections > 80%, replication lag > RPO/2, failover events", "Queue oldest message age > 5 min, DLQ non-empty", "Certificate expiry < 14 days", ...(req.ai.enabled ? ["Model 429 rate, fallback activation, tenant budget at 80%"] : [])],
    slos: [`Availability ${req.reliability.availabilityTarget}% (error budget ${errorBudget(req.reliability.availabilityTarget)})`, `p95 latency ${req.performance.p95LatencyMs} ms for API reads`, "Job completion: 99% within 5 minutes", ...(req.ai.enabled ? [`AI response start < ${req.ai.latencyTargetMs} ms for 95% of requests`] : [])],
    dashboards: ["Service overview (golden signals per service)", "Data tier (DB, cache, queue)", "Release health (canary comparison)", ...(req.ai.enabled ? ["AI spend and quality (per tenant, per model)"] : [])],
    hardToDiagnose: ["Slow requests caused by lock contention in the database (needs query-level tracing)", "Cache stampedes after mass invalidation", ...(req.ai.enabled ? ["Retrieval quality regressions after re-embedding (needs a golden set)"] : []), ...(multiRegion ? ["Replication lag during failover (RPO exceeded silently without lag alerts)"] : [])],
  };

  const estMax = comps.reduce((a, c) => a + (c.cost.monthlyUsd?.max ?? 0), 0);
  if (req.business.budgetMonthlyUsd && estMax > req.business.budgetMonthlyUsd * 1.2) warnings.push(`Upper cost estimate (~$${estMax.toLocaleString("en-US")}/month) exceeds the stated budget ($${req.business.budgetMonthlyUsd.toLocaleString("en-US")}). Levers: smaller database tier, single region with backup/restore, fewer minimum instances, cheaper model routing.`);

  return { graph: g, adrs, deployment, observability, warnings };
}

function errorBudget(target: number): string {
  const minutes = (1 - target / 100) * 365 * 24 * 60;
  return minutes >= 60 ? `${(minutes / 60).toFixed(1)} h/year` : `${minutes.toFixed(0)} min/year`;
}
