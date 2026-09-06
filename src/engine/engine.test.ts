import { describe, expect, it } from "vitest";
import { buildDemoGraph } from "./demo/ai-saas-demo";
import { parseGraph } from "./graph/schema";
import { indexGraph } from "./graph/queries";
import { simulateFailure } from "./simulation/failure";
import { traceFlow } from "./simulation/trace";
import { analyzeArchitecture } from "./analysis";
import { applyPatch } from "./graph/patch";
import { component, edge, graph } from "./graph/builder";

describe("demo graph", () => {
  it("validates against the schema with referential integrity", () => {
    const r = parseGraph(buildDemoGraph());
    expect(r.ok).toBe(true);
  });
});

describe("failure simulation", () => {
  const g = buildDemoGraph();

  it("propagates a hard synchronous dependency failure to every flow", () => {
    const r = simulateFailure(g, { kind: "component", targetId: "redis" });
    expect(r.userImpact).toBe("total_outage");
    expect(r.isSpof).toBe(true);
    expect(r.affected.map((a) => a.componentId)).toContain("api");
    expect(r.flows.every((f) => f.state === "down")).toBe(true);
  });

  it("treats soft dependencies as degradation, not outage", () => {
    const r = simulateFailure(g, { kind: "component", targetId: "qdrant" });
    expect(r.userImpact).toBe("partial");
    const api = r.affected.find((a) => a.componentId === "api");
    expect(api?.state).toBe("degraded");
    expect(r.flows.find((f) => f.flowId === "f-rag")?.state).toBe("down");
    expect(r.flows.find((f) => f.flowId === "f-read")?.state).toBe("degraded");
  });

  it("region failure takes down everything in a single-region deployment", () => {
    const r = simulateFailure(g, { kind: "region", targetId: "azure-centralindia" });
    expect(r.userImpact).toBe("total_outage");
    expect(r.recovery).toBe("none");
  });

  it("honours redundancy: a multi-replica automatic-failover component is not a SPOF", () => {
    const r = simulateFailure(g, { kind: "component", targetId: "api-lb" });
    expect(r.isSpof).toBe(false);
    expect(r.recovery).toBe("automatic");
  });
});

describe("request tracing", () => {
  it("annotates hops with boundary crossings and warnings", () => {
    const t = traceFlow(buildDemoGraph(), "f-rag");
    expect(t.steps.length).toBeGreaterThan(4);
    const llm = t.steps.find((s) => s.componentId === "openai");
    expect(llm?.edge?.leavesOrganisation).toBe(true);
    expect(t.warnings.some((w) => /PII|CONFIDENTIAL/.test(w))).toBe(true);
  });
});

describe("destruction engine on the demo", () => {
  const report = analyzeArchitecture(buildDemoGraph());
  const has = (category: string, componentId?: string) =>
    report.findings.some((f) => f.category === category && (!componentId || f.affectedComponentIds.includes(componentId)));

  it("finds the single points of failure", () => {
    expect(has("single_point_of_failure", "redis")).toBe(true);
    expect(has("single_point_of_failure", "postgres")).toBe(true);
  });
  it("finds the unrealistic scaling assumptions with a named mechanism", () => {
    const worker = report.findings.find((f) => f.category === "bottleneck_job_throughput");
    expect(worker).toBeDefined();
    expect(worker!.mechanism).toMatch(/fixed instance/);
    expect(report.scalability.breakOrder[0].multiplier).toBeLessThanOrEqual(2);
    const conn = report.findings.find((f) => f.category === "bottleneck_connections");
    expect(conn?.mechanism).toMatch(/max_connections/);
  });
  it("finds the trust-boundary problems", () => {
    expect(has("public_data_store", "qdrant")).toBe(true);
    expect(has("no_waf", "api-lb")).toBe(true);
    expect(has("excessive_privilege", "cicd")).toBe(true);
  });
  it("finds the operational weaknesses", () => {
    expect(has("missing_alerting")).toBe(true);
    expect(has("unsafe_migrations", "postgres")).toBe(true);
    expect(report.operations.threeAmVerdict).toBe("no");
  });
  it("finds the cost inefficiencies with an optimised estimate", () => {
    expect(has("oversized_database", "postgres")).toBe(true);
    expect(has("unmanaged_ai_spend", "openai")).toBe(true);
    expect(report.cost.optimizedMonthly.max).toBeLessThan(report.cost.monthly.max);
  });
  it("finds the AI-specific risks", () => {
    expect(has("single_model_provider", "openai")).toBe(true);
    expect(has("prompt_injection", "openai")).toBe(true);
    expect(has("tenant_isolation", "qdrant")).toBe(true);
    expect(report.aiApplicable).toBe(true);
  });
  it("labels evidence and never presents assumptions as facts", () => {
    for (const f of report.findings) {
      expect(f.evidence.length).toBeGreaterThan(0);
      for (const e of f.evidence) expect(["fact", "inference", "assumption", "unknown"]).toContain(e.level);
    }
    expect(report.scores.evidenceSummary.facts).toBeGreaterThan(0);
  });
  it("ranks three critical findings from different engines at the top", () => {
    expect(report.criticalFindings).toHaveLength(3);
    expect(new Set(report.criticalFindings.map((f) => f.engine)).size).toBe(3);
  });
});

describe("fix and diff", () => {
  it("applying a SPOF fix removes the SPOF finding and changes scores", () => {
    const g = buildDemoGraph();
    const before = analyzeArchitecture(g);
    const f = before.findings.find((x) => x.category === "single_point_of_failure" && x.affectedComponentIds[0] === "postgres")!;
    const after = analyzeArchitecture(applyPatch(g, f.fix!));
    expect(after.findings.some((x) => x.id === f.id)).toBe(false);
    expect(after.scores.dimensions[0].score).toBeGreaterThan(before.scores.dimensions[0].score);
    expect(after.cost.monthly.max).toBeGreaterThan(before.cost.monthly.max);
  });
});

describe("a well-built architecture", () => {
  it("scores high and has no critical findings", () => {
    const g = graph({
      id: "good",
      name: "good",
      description: "",
      source: "structured",
      regions: [{ id: "r1", name: "R1", role: "primary", availabilityZones: ["1", "2", "3"] }],
      zones: [
        { id: "internet", name: "Internet", kind: "internet", trustLevel: 0 },
        { id: "edge", name: "Edge", kind: "edge", trustLevel: 1 },
        { id: "priv", name: "Private", kind: "private_subnet", trustLevel: 3, regionId: "r1" },
      ],
      components: [
        component({ id: "u", name: "Users", type: "client", zoneId: "internet", exposure: "public", scaling: { model: "none" }, cost: { model: "free", category: "low" } }),
        component({ id: "waf", name: "WAF", type: "waf", zoneId: "edge", exposure: "public", criticality: "critical", scaling: { model: "managed" }, redundancy: { replicas: 3, multiAz: true, multiRegion: true, failover: "automatic" }, observability: { metrics: true, logs: true, traces: true, alerts: true }, security: { rateLimiting: true, tlsCertificate: "managed" }, operations: { iac: true, runbook: true, owner: "platform", deployMethod: "ci_cd" }, cost: { model: "usage", category: "low", monthlyUsd: { min: 20, max: 50 } } }),
        component({ id: "api", name: "API", type: "service", zoneId: "priv", regionId: "r1", criticality: "critical", scaling: { model: "horizontal_auto", minInstances: 2, maxInstances: 30, rpsPerInstance: 200 }, redundancy: { replicas: 3, multiAz: true, multiRegion: false, failover: "automatic", failoverSeconds: 30 }, observability: { metrics: true, logs: true, traces: true, alerts: true }, security: { secretsSource: "managed_identity", iamScope: "least_privilege", authentication: "jwt", encryptionInTransit: true, auditLogging: true }, operations: { iac: true, runbook: true, owner: "backend", deployMethod: "ci_cd", rollback: "automatic", stagingEnvironment: true }, cost: { model: "provisioned", category: "medium", monthlyUsd: { min: 200, max: 400 } } }),
        component({ id: "db", name: "DB", type: "relational_db", zoneId: "priv", regionId: "r1", criticality: "critical", scaling: { model: "vertical", maxConnections: 500, connectionPooler: true, maxWriteOps: 5000, maxReadOps: 30000, readReplicas: 1 }, redundancy: { replicas: 2, multiAz: true, multiRegion: false, failover: "automatic", failoverSeconds: 60 }, backup: { enabled: true, pointInTimeRecovery: true, crossRegion: true, restoreTested: true, frequency: "continuous" }, observability: { metrics: true, logs: true, traces: false, alerts: true }, security: { encryptionAtRest: true, encryptionInTransit: true, authentication: "iam", auditLogging: true, dataClassification: "pii" }, operations: { iac: true, runbook: true, owner: "backend", migrationStrategy: "automated", rollback: "manual" }, cost: { model: "provisioned", category: "high", monthlyUsd: { min: 400, max: 800 } } }),
      ],
      edges: [
        edge({ source: "u", target: "waf", kind: "calls", protocol: "https", encrypted: true, authentication: "jwt" }),
        edge({ source: "waf", target: "api", kind: "routes_to", protocol: "https", encrypted: true, authentication: "mtls" }),
        edge({ source: "api", target: "db", kind: "writes", protocol: "postgres", encrypted: true, authentication: "iam", connectionsPerInstance: 10 }),
      ],
      flows: [{ id: "f", name: "request", kind: "normal_request", description: "", trafficShare: 1, steps: [{ componentId: "u", action: "call" }, { componentId: "waf", edgeId: "u->waf:calls", action: "filter" }, { componentId: "api", edgeId: "waf->api:routes_to", action: "serve" }, { componentId: "db", edgeId: "api->db:writes", action: "query" }] }],
      traffic: { baselineRps: 100, peakRps: 300, readRatio: 0.8, evidence: "fact" },
      targets: { availability: 99.9 },
    });
    const r = analyzeArchitecture(g);
    expect(r.findings.filter((f) => f.severity === "critical")).toHaveLength(0);
    expect(r.scores.overall).toBeGreaterThan(60);
    expect(indexGraph(g).attackPath("db")).toEqual(["u", "waf", "api", "db"]);
  });
});
