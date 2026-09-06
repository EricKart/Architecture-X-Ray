import type {
  ArchitectureGraph,
  Component,
  ComponentType,
  DataFlow,
  Edge,
  EvidenceLevel,
  Layer,
  NetworkZone,
  Region,
} from "./types";

/**
 * Small helpers for constructing graphs with sensible defaults. Used by the
 * demo, the architect generator and the ingestion extractors so that every
 * component has a complete profile (engines never have to null-check).
 */

export const LAYER_FOR_TYPE: Record<ComponentType, Layer> = {
  client: "client",
  dns: "edge",
  cdn: "edge",
  waf: "edge",
  load_balancer: "edge",
  api_gateway: "api",
  identity_provider: "identity",
  web_frontend: "compute",
  service: "compute",
  worker: "compute",
  serverless_function: "compute",
  container_platform: "platform",
  queue: "messaging",
  stream: "messaging",
  cache: "cache",
  relational_db: "data",
  document_db: "data",
  vector_db: "ai",
  search: "data",
  object_storage: "storage",
  llm_provider: "ai",
  embedding_service: "ai",
  ml_inference: "ai",
  llm_gateway: "ai",
  monitoring: "observability",
  logging: "observability",
  tracing: "observability",
  secrets_manager: "security",
  kms: "security",
  ci_cd: "platform",
  external_api: "external",
  payment_provider: "external",
  email_service: "external",
  nat_gateway: "edge",
  vpn: "edge",
  bastion: "security",
  private_link: "edge",
  scheduler: "platform",
};

const STATEFUL_TYPES = new Set<ComponentType>([
  "relational_db",
  "document_db",
  "vector_db",
  "cache",
  "object_storage",
  "search",
  "queue",
  "stream",
]);

export type ComponentInput = Partial<Omit<Component, "id" | "name" | "type" | "zoneId">> &
  Pick<Component, "id" | "name" | "type" | "zoneId">;

export function component(input: ComponentInput): Component {
  const evidence: EvidenceLevel = input.evidence ?? "fact";
  const type = input.type;
  return {
    layer: LAYER_FOR_TYPE[type],
    exposure: "private",
    stateful: STATEFUL_TYPES.has(type),
    criticality: "medium",
    scaling: { model: "manual" },
    redundancy: { replicas: 1, multiAz: false, multiRegion: false, failover: "none" },
    observability: { metrics: false, logs: false, traces: false, alerts: false },
    security: {},
    cost: { model: "usage", category: "low" },
    operations: {},
    ...input,
    evidence,
  };
}

export type EdgeInput = Partial<Omit<Edge, "id" | "source" | "target" | "kind">> &
  Pick<Edge, "source" | "target" | "kind"> & { id?: string };

export function edge(input: EdgeInput): Edge {
  const id = input.id ?? `${input.source}->${input.target}:${input.kind}`;
  const sync = input.sync ?? (input.kind === "publishes" || input.kind === "consumes" ? "async" : "sync");
  return {
    criticality: "hard",
    evidence: "fact",
    ...input,
    id,
    sync,
  };
}

export function zone(input: NetworkZone): NetworkZone {
  return input;
}

export function region(input: Region): Region {
  return input;
}

export interface GraphInput {
  id: string;
  name: string;
  description: string;
  source: ArchitectureGraph["source"];
  regions?: Region[];
  zones: NetworkZone[];
  components: Component[];
  edges: Edge[];
  flows?: DataFlow[];
  traffic?: ArchitectureGraph["traffic"];
  targets?: ArchitectureGraph["targets"];
  assumptions?: string[];
  unknowns?: string[];
  metadata?: Record<string, unknown>;
}

export function graph(input: GraphInput): ArchitectureGraph {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    regions: [],
    flows: [],
    assumptions: [],
    unknowns: [],
    ...input,
  };
}

/** Structural validation that does not need zod: referential integrity. */
export function validateGraphIntegrity(g: ArchitectureGraph): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const zoneIds = new Set(g.zones.map((z) => z.id));
  const regionIds = new Set(g.regions.map((r) => r.id));
  for (const c of g.components) {
    if (ids.has(c.id)) errors.push(`Duplicate component id: ${c.id}`);
    ids.add(c.id);
    if (!zoneIds.has(c.zoneId)) errors.push(`Component ${c.id} references unknown zone ${c.zoneId}`);
    if (c.regionId && !regionIds.has(c.regionId))
      errors.push(`Component ${c.id} references unknown region ${c.regionId}`);
  }
  const edgeIds = new Set<string>();
  for (const e of g.edges) {
    if (edgeIds.has(e.id)) errors.push(`Duplicate edge id: ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.source)) errors.push(`Edge ${e.id} has unknown source ${e.source}`);
    if (!ids.has(e.target)) errors.push(`Edge ${e.id} has unknown target ${e.target}`);
    if (e.source === e.target) errors.push(`Edge ${e.id} is a self-loop`);
  }
  for (const f of g.flows) {
    for (const s of f.steps) {
      if (!ids.has(s.componentId)) errors.push(`Flow ${f.id} references unknown component ${s.componentId}`);
      if (s.edgeId && !edgeIds.has(s.edgeId)) errors.push(`Flow ${f.id} references unknown edge ${s.edgeId}`);
    }
  }
  return errors;
}

export function cloneGraph(g: ArchitectureGraph): ArchitectureGraph {
  return JSON.parse(JSON.stringify(g)) as ArchitectureGraph;
}
