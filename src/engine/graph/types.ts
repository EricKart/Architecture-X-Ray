/**
 * Architecture X-Ray - core graph model.
 *
 * Every architecture (demo, generated, ingested) is normalised into this
 * structure before any analysis runs. Engines never look at free text; they
 * reason over components, edges, zones and profiles.
 *
 * Edge direction convention: `source` NEEDS `target`.
 *   API --calls--> PostgreSQL   means the API depends on PostgreSQL.
 */

/** How we know something. Never present an assumption as a fact. */
export type EvidenceLevel = "fact" | "inference" | "assumption" | "unknown";

export type ComponentType =
  | "client"
  | "dns"
  | "cdn"
  | "waf"
  | "load_balancer"
  | "api_gateway"
  | "identity_provider"
  | "web_frontend"
  | "service"
  | "worker"
  | "serverless_function"
  | "container_platform"
  | "queue"
  | "stream"
  | "cache"
  | "relational_db"
  | "document_db"
  | "vector_db"
  | "search"
  | "object_storage"
  | "llm_provider"
  | "embedding_service"
  | "ml_inference"
  | "monitoring"
  | "logging"
  | "tracing"
  | "secrets_manager"
  | "kms"
  | "ci_cd"
  | "external_api"
  | "payment_provider"
  | "email_service"
  | "nat_gateway"
  | "vpn"
  | "bastion"
  | "private_link"
  | "scheduler"
  | "llm_gateway";

export type Layer =
  | "client"
  | "edge"
  | "identity"
  | "api"
  | "compute"
  | "messaging"
  | "cache"
  | "data"
  | "storage"
  | "ai"
  | "observability"
  | "security"
  | "platform"
  | "external";

export type Provider =
  | "azure"
  | "aws"
  | "gcp"
  | "cloudflare"
  | "openai"
  | "anthropic"
  | "auth0"
  | "github"
  | "vercel"
  | "self_hosted"
  | "saas"
  | "unknown";

export type Criticality = "critical" | "high" | "medium" | "low";
export type Exposure = "public" | "private" | "internal";

export interface Region {
  id: string;
  name: string;
  provider?: Provider;
  role: "primary" | "secondary" | "dr";
  availabilityZones: string[];
}

export type ZoneKind =
  | "internet"
  | "edge"
  | "public_subnet"
  | "private_subnet"
  | "isolated_subnet"
  | "managed_service"
  | "external_saas"
  | "ci_platform";

export interface NetworkZone {
  id: string;
  name: string;
  kind: ZoneKind;
  /** 0 = untrusted internet ... 4 = isolated, no ingress. */
  trustLevel: number;
  regionId?: string;
}

export type ScalingModel =
  | "none"
  | "manual"
  | "vertical"
  | "horizontal_auto"
  | "managed"
  | "serverless";

export interface ScalingProfile {
  model: ScalingModel;
  minInstances?: number;
  maxInstances?: number;
  currentInstances?: number;
  /** Requests per second one instance can serve before saturating. */
  rpsPerInstance?: number;
  /** Data stores: hard cap on concurrent connections. */
  maxConnections?: number;
  /** Data stores: sustained write throughput (ops per second). */
  maxWriteOps?: number;
  /** Data stores / caches: sustained read throughput (ops per second). */
  maxReadOps?: number;
  /** External APIs / LLM providers. */
  requestsPerMinuteLimit?: number;
  tokensPerMinuteLimit?: number;
  /** Queues: throughput cap. */
  maxMessagesPerSecond?: number;
  /** Workers: jobs one instance completes per second. */
  jobsPerSecondPerInstance?: number;
  readReplicas?: number;
  connectionPooler?: boolean;
  clusterMode?: boolean;
}

export interface RedundancyProfile {
  replicas: number;
  multiAz: boolean;
  multiRegion: boolean;
  failover: "automatic" | "manual" | "none";
  failoverSeconds?: number;
}

export interface BackupProfile {
  enabled: boolean;
  pointInTimeRecovery?: boolean;
  crossRegion?: boolean;
  frequency?: string;
  retentionDays?: number;
  restoreTested?: boolean;
}

export interface ObservabilityProfile {
  metrics: boolean;
  logs: boolean;
  traces: boolean;
  alerts: boolean;
  healthCheck?: boolean;
  dashboards?: boolean;
  logRetentionDays?: number;
}

export type AuthMethod =
  | "none"
  | "api_key"
  | "jwt"
  | "oauth2"
  | "mtls"
  | "iam"
  | "password"
  | "unknown";

export type DataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "pii"
  | "regulated"
  | "secrets";

export interface SecurityProfile {
  encryptionAtRest?: boolean;
  encryptionInTransit?: boolean;
  authentication?: AuthMethod;
  secretsSource?:
    | "secrets_manager"
    | "env_var"
    | "config_file"
    | "hardcoded"
    | "managed_identity"
    | "unknown";
  iamScope?: "least_privilege" | "broad" | "admin" | "unknown";
  publicEndpoint?: boolean;
  rateLimiting?: boolean;
  auditLogging?: boolean;
  networkAcl?: boolean;
  dataClassification?: DataClassification;
  tlsCertificate?: "managed" | "manual" | "unknown";
  tenantIsolation?: boolean;
}

export interface CostProfile {
  model: "fixed" | "usage" | "provisioned" | "free";
  category: "low" | "medium" | "high" | "very_high";
  /** Monthly USD range. Treated as an assumption unless the component evidence is fact. */
  monthlyUsd?: { min: number; max: number };
  notes?: string;
  lifecyclePolicy?: boolean;
}

export interface OperationsProfile {
  owner?: string;
  runbook?: boolean;
  onCall?: boolean;
  iac?: boolean;
  deployMethod?: "ci_cd" | "manual" | "scripted" | "unknown";
  migrationStrategy?: "automated" | "manual" | "none" | "unknown";
  rollback?: "automatic" | "manual" | "none" | "unknown";
  stagingEnvironment?: boolean;
}

export interface AiProfile {
  role: "llm" | "embedding" | "vector_store" | "orchestrator" | "guardrail" | "gateway";
  provider?: string;
  model?: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  rateLimitHandling?: "none" | "retry" | "queue" | "circuit_breaker";
  promptInjectionControls?: boolean;
  piiRedaction?: boolean;
  dataSentExternally?: boolean;
  tenantIsolation?: boolean;
  costCap?: boolean;
  responseCaching?: boolean;
  timeoutMs?: number;
  toolAccess?: boolean;
  modelPinned?: boolean;
  untrustedInput?: boolean;
  modelRouting?: boolean;
}

export interface Component {
  id: string;
  name: string;
  type: ComponentType;
  layer: Layer;
  provider?: Provider;
  service?: string;
  technology?: string;
  purpose?: string;
  rationale?: string;
  alternatives?: string[];
  zoneId: string;
  regionId?: string;
  exposure: Exposure;
  stateful: boolean;
  criticality: Criticality;
  scaling: ScalingProfile;
  redundancy: RedundancyProfile;
  backup?: BackupProfile;
  observability: ObservabilityProfile;
  security: SecurityProfile;
  cost: CostProfile;
  operations: OperationsProfile;
  ai?: AiProfile;
  evidence: EvidenceLevel;
  notes?: string[];
  tags?: string[];
}

export type EdgeKind =
  | "calls"
  | "reads"
  | "writes"
  | "publishes"
  | "consumes"
  | "authenticates_with"
  | "fetches_secrets_from"
  | "routes_to"
  | "serves"
  | "replicates_to"
  | "backs_up_to"
  | "monitors"
  | "deploys_to"
  | "egress_via"
  | "resolves";

export type Protocol =
  | "https"
  | "http"
  | "grpc"
  | "tcp"
  | "amqp"
  | "redis"
  | "postgres"
  | "mysql"
  | "mongodb"
  | "websocket"
  | "kafka"
  | "smtp"
  | "dns"
  | "s3"
  | "internal";

export interface Edge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  protocol?: Protocol;
  sync: "sync" | "async";
  /** hard: source cannot function without target. soft: source degrades. */
  criticality: "hard" | "soft";
  encrypted?: boolean;
  authentication?: AuthMethod;
  dataClassification?: DataClassification;
  timeoutMs?: number;
  retries?: number;
  circuitBreaker?: boolean;
  /** Human description of what happens when the target is gone (cache, queue, secondary provider). */
  fallback?: string;
  /** Connections held open per instance of the source (used for pool math). */
  connectionsPerInstance?: number;
  label?: string;
  evidence: EvidenceLevel;
}

export type FlowKind =
  | "normal_request"
  | "authenticated_request"
  | "db_read"
  | "db_write"
  | "ai_inference"
  | "rag_request"
  | "async_job"
  | "file_upload"
  | "deployment"
  | "custom";

export interface FlowStep {
  componentId: string;
  /** Edge that carried the request to this step (undefined for the first step). */
  edgeId?: string;
  action: string;
  detail?: string;
}

export interface DataFlow {
  id: string;
  name: string;
  kind: FlowKind;
  description: string;
  steps: FlowStep[];
  /** Share of total traffic that follows this flow (0..1). Used by scalability. */
  trafficShare?: number;
}

export interface TrafficProfile {
  baselineRps: number;
  peakRps: number;
  /** 0..1, share of requests that are reads. */
  readRatio: number;
  monthlyActiveUsers?: number;
  aiRequestsPerSecond?: number;
  avgTokensPerAiRequest?: number;
  evidence: EvidenceLevel;
}

export interface Targets {
  availability?: number;
  rtoMinutes?: number;
  rpoMinutes?: number;
  p95LatencyMs?: number;
}

export type GraphSource =
  | "demo"
  | "architect"
  | "description"
  | "image"
  | "structured"
  | "terraform"
  | "kubernetes"
  | "unknown";

export interface ArchitectureGraph {
  id: string;
  name: string;
  description: string;
  version: 1;
  source: GraphSource;
  createdAt: string;
  regions: Region[];
  zones: NetworkZone[];
  components: Component[];
  edges: Edge[];
  flows: DataFlow[];
  traffic?: TrafficProfile;
  targets?: Targets;
  assumptions: string[];
  unknowns: string[];
  metadata?: Record<string, unknown>;
}

/** Edge kinds that transmit runtime failure from target to source. */
export const RUNTIME_DEPENDENCY_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>([
  "calls",
  "reads",
  "writes",
  "publishes",
  "consumes",
  "authenticates_with",
  "fetches_secrets_from",
  "routes_to",
  "serves",
  "egress_via",
  "resolves",
]);

export const DATA_STORE_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  "relational_db",
  "document_db",
  "vector_db",
  "cache",
  "object_storage",
  "search",
  "queue",
  "stream",
]);

export const COMPUTE_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  "service",
  "worker",
  "serverless_function",
  "web_frontend",
  "api_gateway",
  "load_balancer",
  "llm_gateway",
]);

export const EDGE_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  "cdn",
  "waf",
  "dns",
  "load_balancer",
  "api_gateway",
]);

export const AI_TYPES: ReadonlySet<ComponentType> = new Set<ComponentType>([
  "llm_provider",
  "embedding_service",
  "ml_inference",
  "vector_db",
  "llm_gateway",
]);
