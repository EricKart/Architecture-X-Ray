import { analyzeArchitecture } from "../analysis";
import type { AnalysisReport } from "../analysis/types";
import type { Component } from "../graph/types";
import { indexGraph } from "../graph/queries";
import { generateArchitecture, type ADR, type DeploymentPlan, type GeneratedArchitecture, type ObservabilityPlan } from "./generator";
import type { Requirements } from "./requirements";

export interface InventoryItem {
  componentId: string;
  name: string;
  purpose: string;
  technology: string;
  reason: string;
  dependencies: string[];
  dependents: string[];
  scalingModel: string;
  failureBehaviour: string;
  security: string;
  costCategory: string;
  operations: string;
  alternatives: string[];
}

export interface ArchitectPackage extends GeneratedArchitecture {
  requirements: Requirements;
  report: AnalysisReport;
  inventory: InventoryItem[];
  adrs: ADR[];
  deployment: DeploymentPlan;
  observability: ObservabilityPlan;
}

/** Requirements -> complete architecture package, including a destruction scan of the proposal. */
export function buildArchitecture(req: Requirements): ArchitectPackage {
  const generated = generateArchitecture(req);
  const report = analyzeArchitecture(generated.graph);
  const idx = indexGraph(generated.graph);
  const inventory: InventoryItem[] = generated.graph.components
    .filter((c) => c.type !== "client")
    .map((c) => ({
      componentId: c.id,
      name: c.name,
      purpose: c.purpose ?? "",
      technology: [c.service, c.technology].filter(Boolean).join(" - "),
      reason: c.rationale ?? "",
      dependencies: idx.dependencies(c.id).map((e) => idx.component(e.target).name),
      dependents: idx.dependents(c.id).map((e) => idx.component(e.source).name),
      scalingModel: describeScaling(c),
      failureBehaviour: describeFailure(c),
      security: describeSecurity(c),
      costCategory: `${c.cost.category.replace("_", " ")}${c.cost.monthlyUsd ? ` (~$${c.cost.monthlyUsd.min.toLocaleString("en-US")}-${c.cost.monthlyUsd.max.toLocaleString("en-US")}/mo, estimate)` : ""}`,
      operations: describeOps(c),
      alternatives: c.alternatives ?? [],
    }));
  return { ...generated, requirements: req, report, inventory };
}

function describeScaling(c: Component) {
  const s = c.scaling;
  if (s.model === "horizontal_auto") return `Horizontal autoscaling ${s.minInstances ?? "?"}-${s.maxInstances ?? "?"} instances${s.rpsPerInstance ? ` (~${s.rpsPerInstance} rps each)` : ""}${s.jobsPerSecondPerInstance ? ` (~${s.jobsPerSecondPerInstance} jobs/s each)` : ""}.`;
  if (s.model === "managed" || s.model === "serverless") return `Provider-managed scaling${s.requestsPerMinuteLimit ? `; quota ${s.requestsPerMinuteLimit.toLocaleString("en-US")} req/min` : ""}.`;
  if (s.model === "vertical") return `Vertical scaling${s.readReplicas ? ` + ${s.readReplicas} read replica(s)` : ""}${s.connectionPooler ? ", pooled connections" : ""}${s.maxConnections ? ` (max ${s.maxConnections} connections)` : ""}.`;
  return s.model;
}

function describeFailure(c: Component) {
  const r = c.redundancy;
  const parts: string[] = [];
  if (r.replicas > 1 && r.failover === "automatic") parts.push(`${r.replicas} replicas, automatic failover${r.failoverSeconds ? ` in ~${r.failoverSeconds}s` : ""}`);
  else if (r.failover === "manual") parts.push("standby with manual failover");
  else parts.push("single instance");
  if (r.multiAz) parts.push("zone-redundant");
  if (r.multiRegion) parts.push("multi-region");
  if (c.backup?.enabled) parts.push(`backup: ${c.backup.frequency ?? "enabled"}${c.backup.pointInTimeRecovery ? ", PITR" : ""}`);
  return parts.join("; ") + ".";
}

function describeSecurity(c: Component) {
  const s = c.security;
  const parts: string[] = [];
  if (s.authentication) parts.push(`auth ${s.authentication}`);
  if (s.secretsSource) parts.push(`secrets via ${s.secretsSource.replace("_", " ")}`);
  if (s.iamScope) parts.push(`${s.iamScope.replace("_", " ")} IAM`);
  if (s.encryptionAtRest) parts.push("encrypted at rest");
  if (s.encryptionInTransit) parts.push("TLS in transit");
  if (s.publicEndpoint === false) parts.push("private endpoint only");
  if (s.auditLogging) parts.push("audit logging");
  if (s.rateLimiting) parts.push("rate limiting");
  return parts.length ? parts.join(", ") + "." : "No specific controls declared.";
}

function describeOps(c: Component) {
  const o = c.operations;
  const parts: string[] = [];
  if (o.owner) parts.push(`owner: ${o.owner}`);
  if (o.deployMethod) parts.push(`deploy: ${o.deployMethod.replace("_", "/")}`);
  if (o.iac) parts.push("IaC");
  if (o.runbook) parts.push("runbook");
  if (o.rollback) parts.push(`rollback ${o.rollback}`);
  if (o.migrationStrategy) parts.push(`migrations ${o.migrationStrategy}`);
  const obs = c.observability;
  parts.push(`telemetry: ${["metrics", "logs", "traces", "alerts"].filter((k) => obs[k as keyof typeof obs]).join("/") || "none"}`);
  return parts.join(", ") + ".";
}

export { generateArchitecture };
export type { ADR, DeploymentPlan, ObservabilityPlan, GeneratedArchitecture };
