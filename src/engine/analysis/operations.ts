import type { ArchitectureGraph } from "../graph/types";
import { indexGraph } from "../graph/queries";
import type { Finding, OperationsReport } from "./types";

/**
 * Operational attack: "Could a real team operate this at 3 AM?"
 * Checks alerting coverage, ownership, deployment safety, migrations,
 * rollback, IaC drift, manual recovery and hidden dependencies.
 */
export function analyzeOperations(graph: ArchitectureGraph): { findings: Finding[]; report: OperationsReport } {
  const idx = indexGraph(graph);
  const findings: Finding[] = [];
  const important = graph.components.filter((c) => c.type !== "client" && (c.criticality === "critical" || c.criticality === "high"));
  const checklist: OperationsReport["checklist"] = [];

  // Alerting coverage on important components.
  const unalerted = important.filter((c) => !c.observability.alerts && idx.zoneOf(c.id)?.kind !== "external_saas");
  checklist.push({ item: "Alerting on critical/high components", status: unalerted.length === 0 ? "pass" : unalerted.length <= 2 ? "warn" : "fail", detail: unalerted.length ? `No alert rules: ${unalerted.map((c) => c.name).join(", ")}` : "All important components have alert rules." });
  if (unalerted.length) {
    findings.push({
      id: "ops-no-alerts",
      engine: "operations",
      category: "missing_alerting",
      severity: unalerted.some((c) => c.criticality === "critical") ? "high" : "medium",
      confidence: "high",
      title: `${unalerted.length} important components have no alert rules (${unalerted.map((c) => c.name).join(", ")}); the first signal of failure will be a customer ticket.`,
      evidence: [
        { level: "fact", statement: `observability.alerts = false on: ${unalerted.map((c) => c.name).join(", ")}.`, componentIds: unalerted.map((c) => c.id) },
        { level: "fact", statement: `Metrics collected but unalerted: ${unalerted.filter((c) => c.observability.metrics).map((c) => c.name).join(", ") || "none"}.` },
      ],
      mechanism: "Dashboards do not wake anyone up. Connection exhaustion, queue backlog growth or disk pressure develop over minutes and are only noticed when the API error rate finally spikes - by which point recovery is harder.",
      impact: "Longer mean-time-to-detect; incidents discovered by users; SLO breaches that could have been prevented.",
      recommendation: "Define SLO-based alerts (error rate, latency, saturation) for every critical dependency: DB connections and replication lag, queue depth and age, cache memory, provider 429 rate, certificate expiry.",
      tradeoff: "Alert tuning takes iterations; badly tuned alerts cause fatigue.",
      affectedComponentIds: unalerted.map((c) => c.id),
      affectedEdgeIds: [],
      dimensions: { operability: 1 },
      fix: { description: "Add alert rules", updateComponents: unalerted.map((c) => ({ id: c.id, patch: { observability: { ...c.observability, metrics: true, alerts: true } } })) },
    });
  }

  // Distributed tracing across multiple services.
  const services = graph.components.filter((c) => c.type === "service" || c.type === "worker" || c.type === "serverless_function");
  const traced = services.filter((c) => c.observability.traces);
  checklist.push({ item: "Distributed tracing", status: services.length < 2 || traced.length === services.length ? "pass" : traced.length ? "warn" : "fail", detail: traced.length ? `${traced.length}/${services.length} services emit traces` : "No service emits traces." });
  if (services.length >= 2 && traced.length < services.length) {
    findings.push({
      id: "ops-no-tracing",
      engine: "operations",
      category: "no_tracing",
      severity: "medium",
      confidence: "high",
      title: `Requests cross ${services.length} services and external providers but only ${traced.length} emit traces; latency problems cannot be attributed to a hop.`,
      evidence: [{ level: "fact", statement: `observability.traces = false on: ${services.filter((c) => !c.observability.traces).map((c) => c.name).join(", ")}.`, componentIds: services.filter((c) => !c.observability.traces).map((c) => c.id) }],
      mechanism: "A slow request touches auth, cache, database, vector search and the model provider. Without a trace ID propagated through each hop, 'the API is slow' is the only available diagnosis.",
      impact: "Hours spent bisecting slowness by guesswork; provider latency blamed on the application and vice versa.",
      recommendation: "Instrument with OpenTelemetry (auto-instrumentation for HTTP, DB, queue clients), propagate context through the queue, and export to a tracing backend with tail sampling.",
      tradeoff: "Small CPU/network overhead and storage cost for traces.",
      affectedComponentIds: services.map((c) => c.id),
      affectedEdgeIds: [],
      dimensions: { operability: 0.7 },
      fix: { description: "Enable tracing", updateComponents: services.map((c) => ({ id: c.id, patch: { observability: { ...c.observability, traces: true } } })) },
    });
  }

  // Ownership and runbooks.
  const noRunbook = important.filter((c) => c.operations.runbook === false && idx.zoneOf(c.id)?.kind !== "external_saas");
  const noOwner = important.filter((c) => !c.operations.owner);
  checklist.push({ item: "Runbooks and ownership", status: noRunbook.length === 0 && noOwner.length === 0 ? "pass" : noRunbook.length > 3 || noOwner.length > 2 ? "fail" : "warn", detail: `${noRunbook.length} without runbook, ${noOwner.length} without owner.` });
  if (noRunbook.length) {
    findings.push({
      id: "ops-no-runbooks",
      engine: "operations",
      category: "missing_runbooks",
      severity: noRunbook.some((c) => c.stateful) ? "high" : "medium",
      confidence: "high",
      title: `No runbooks exist for ${noRunbook.length} critical components${noOwner.length ? ` and ${noOwner.length} have no declared owner` : ""}; recovery at 3 AM depends on whoever remembers how it was built.`,
      evidence: [
        { level: "fact", statement: `runbook = false: ${noRunbook.map((c) => c.name).join(", ")}.`, componentIds: noRunbook.map((c) => c.id) },
        noOwner.length ? { level: "fact", statement: `No owner: ${noOwner.map((c) => c.name).join(", ")}.`, componentIds: noOwner.map((c) => c.id) } : { level: "fact", statement: "Every important component has a declared owner." },
      ],
      mechanism: "Manual failover, restore and rollback steps that live in people's heads are executed slowly and wrongly under stress. Ambiguous ownership adds a paging delay while the incident is bounced between teams.",
      impact: "Recovery time measured in hours instead of minutes; higher chance of a second, self-inflicted incident during recovery.",
      recommendation: "Write a one-page runbook per critical component (symptoms, dashboards, failover/restore steps, rollback, escalation) and assign an owning team with an on-call rotation; rehearse them in game days.",
      tradeoff: "Documentation upkeep; game days cost engineering time.",
      affectedComponentIds: [...new Set([...noRunbook, ...noOwner].map((c) => c.id))],
      affectedEdgeIds: [],
      dimensions: { operability: 0.8, maintainability: 0.3 },
      fix: { description: "Runbooks + owners", updateComponents: [...new Set([...noRunbook, ...noOwner])].map((c) => ({ id: c.id, patch: { operations: { ...c.operations, runbook: true, owner: c.operations.owner ?? "platform", onCall: true } } })) },
    });
  }

  // Deployment safety.
  const ci = idx.byType("ci_cd");
  const manualDeploys = graph.components.filter((c) => c.operations.deployMethod === "manual" && c.type !== "client");
  const noStaging = ci.filter((c) => c.operations.stagingEnvironment === false);
  const manualRollback = services.filter((c) => c.operations.rollback === "manual" || c.operations.rollback === "none");
  checklist.push({ item: "Deployment pipeline", status: !ci.length || manualDeploys.length ? "fail" : noStaging.length || manualRollback.length ? "warn" : "pass", detail: !ci.length ? "No CI/CD component." : `${manualDeploys.length} manually deployed, staging = ${noStaging.length ? "no" : "yes"}, ${manualRollback.length} services with manual/no rollback.` });
  if (!ci.length || manualDeploys.length || noStaging.length) {
    const parts: string[] = [];
    if (!ci.length) parts.push("there is no CI/CD pipeline");
    if (manualDeploys.length) parts.push(`${manualDeploys.map((c) => c.name).join(", ")} ${manualDeploys.length === 1 ? "is" : "are"} deployed by hand`);
    if (noStaging.length) parts.push("merges go straight to production with no staging environment");
    findings.push({
      id: "ops-deploy-safety",
      engine: "operations",
      category: "unsafe_deployment",
      severity: noStaging.length || !ci.length ? "high" : "medium",
      confidence: "high",
      title: `Deployments are unsafe: ${parts.join("; ")}.`,
      evidence: [
        ...(noStaging.length ? [{ level: "fact" as const, statement: `${noStaging.map((c) => c.name).join(", ")}: stagingEnvironment = false.`, componentIds: noStaging.map((c) => c.id) }] : []),
        ...(manualDeploys.length ? [{ level: "fact" as const, statement: `deployMethod = manual: ${manualDeploys.map((c) => c.name).join(", ")}.`, componentIds: manualDeploys.map((c) => c.id) }] : []),
        ...(manualRollback.length ? [{ level: "fact" as const, statement: `rollback = manual/none: ${manualRollback.map((c) => c.name).join(", ")}.`, componentIds: manualRollback.map((c) => c.id) }] : []),
      ],
      mechanism: "Every change is tested for the first time in production. A bad build reaches all users at once; rolling back means finding the previous image tag by hand while the error rate climbs.",
      impact: "Deploys become the leading cause of incidents; teams respond by deploying less often, which makes each deploy riskier.",
      recommendation: "Add a staging environment with the same IaC, gate production on smoke tests, use progressive delivery (canary or blue/green) and one-click rollback to the previous artifact; deploy the vector DB and other hand-managed components through the same pipeline.",
      tradeoff: "Staging costs roughly 20-40% of production if run permanently (less with scale-to-zero); pipeline work upfront.",
      affectedComponentIds: [...ci.map((c) => c.id), ...manualDeploys.map((c) => c.id)],
      affectedEdgeIds: [],
      dimensions: { operability: 0.8, reliability: 0.3 },
      fix: { description: "Staging + progressive delivery + rollback", updateComponents: [...ci.map((c) => ({ id: c.id, patch: { operations: { ...c.operations, stagingEnvironment: true, rollback: "automatic" as const } } })), ...manualDeploys.map((c) => ({ id: c.id, patch: { operations: { ...c.operations, deployMethod: "ci_cd" as const, iac: true } } })), ...manualRollback.map((c) => ({ id: c.id, patch: { operations: { ...c.operations, rollback: "automatic" as const } } }))] },
    });
  }

  // Database migrations.
  const manualMigrations = graph.components.filter((c) => (c.type === "relational_db" || c.type === "document_db") && (c.operations.migrationStrategy === "manual" || c.operations.migrationStrategy === "none"));
  checklist.push({ item: "Schema migrations", status: manualMigrations.length ? "fail" : "pass", detail: manualMigrations.length ? `Manual migrations on ${manualMigrations.map((c) => c.name).join(", ")}` : "Automated." });
  for (const c of manualMigrations) {
    findings.push({
      id: `ops-migrations-${c.id}`,
      engine: "operations",
      category: "unsafe_migrations",
      severity: "high",
      confidence: "high",
      title: `Schema changes on ${c.name} are applied manually, with no rollback and ${c.backup?.pointInTimeRecovery ? "PITR as the only safety net" : "no point-in-time recovery to fall back on"}.`,
      evidence: [{ level: "fact", statement: `${c.name}: migrationStrategy = ${c.operations.migrationStrategy}, rollback = ${c.operations.rollback ?? "unknown"}, PITR = ${c.backup?.pointInTimeRecovery ?? false}.`, componentIds: [c.id] }],
      mechanism: "Hand-run DDL against a single primary locks tables under live traffic and cannot be reversed if it fails halfway; the application version and the schema version drift apart.",
      impact: "Migration-induced outages and, in the worst case, irrecoverable data corruption.",
      recommendation: "Adopt versioned, expand/contract migrations run by the pipeline before deploy, with online schema-change tooling for large tables and a rehearsed restore path.",
      tradeoff: "Discipline: two-phase changes take longer to land.",
      affectedComponentIds: [c.id],
      affectedEdgeIds: [],
      dimensions: { operability: 0.7, reliability: 0.3 },
      fix: { description: `Automated migrations for ${c.name}`, updateComponents: [{ id: c.id, patch: { operations: { ...c.operations, migrationStrategy: "automated" as const, rollback: "manual" as const } } }] },
    });
  }

  // Infrastructure as code / drift.
  const noIac = graph.components.filter((c) => c.operations.iac === false && c.type !== "client" && idx.zoneOf(c.id)?.kind !== "external_saas");
  checklist.push({ item: "Infrastructure as code", status: noIac.length === 0 ? "pass" : noIac.length <= 2 ? "warn" : "fail", detail: noIac.length ? `Hand-managed: ${noIac.map((c) => c.name).join(", ")}` : "All infrastructure is code-managed." });
  if (noIac.length) {
    findings.push({
      id: "ops-config-drift",
      engine: "operations",
      category: "config_drift",
      severity: noIac.some((c) => c.stateful && c.criticality === "critical") ? "high" : "medium",
      confidence: "high",
      title: `${noIac.length} components (${noIac.map((c) => c.name).join(", ")}) are managed by hand outside IaC, so their real configuration is unknown and cannot be rebuilt.`,
      evidence: [{ level: "fact", statement: `operations.iac = false: ${noIac.map((c) => c.name).join(", ")}.`, componentIds: noIac.map((c) => c.id) }],
      mechanism: "Portal changes accumulate (parameters, firewall rules, sizes) and are never captured. In a disaster the environment cannot be recreated faithfully, and staging never matches production.",
      impact: "Long rebuild times after a regional incident; unreproducible bugs between environments.",
      recommendation: "Import the hand-built resources into Terraform/Bicep, enable drift detection in CI, and remove portal write access for humans in production.",
      tradeoff: "Import effort and a temporary freeze on manual changes.",
      affectedComponentIds: noIac.map((c) => c.id),
      affectedEdgeIds: [],
      dimensions: { operability: 0.6, maintainability: 0.6, reliability: 0.2 },
      fix: { description: "Import into IaC", updateComponents: noIac.map((c) => ({ id: c.id, patch: { operations: { ...c.operations, iac: true } } })) },
    });
  }

  // Manual recovery of critical stateful components.
  const manualRecovery = graph.components.filter((c) => c.stateful && c.criticality === "critical" && c.redundancy.failover !== "automatic");
  checklist.push({ item: "Automatic failover on critical state", status: manualRecovery.length ? "fail" : "pass", detail: manualRecovery.length ? `Manual/none: ${manualRecovery.map((c) => c.name).join(", ")}` : "Automatic." });

  // Restore rehearsal.
  const untested = graph.components.filter((c) => c.backup?.enabled && c.backup.restoreTested === false);
  checklist.push({ item: "Backup restores rehearsed", status: untested.length ? "warn" : "pass", detail: untested.length ? `Never restored: ${untested.map((c) => c.name).join(", ")}` : "Rehearsed or n/a." });
  if (untested.length) {
    findings.push({
      id: "ops-untested-restore",
      engine: "operations",
      category: "untested_restore",
      severity: "medium",
      confidence: "high",
      title: `Backups of ${untested.map((c) => c.name).join(", ")} have never been restored, so nobody knows whether they work or how long a restore takes.`,
      evidence: [{ level: "fact", statement: `backup.restoreTested = false on ${untested.map((c) => c.name).join(", ")}.`, componentIds: untested.map((c) => c.id) }],
      mechanism: "A backup is a hope until it is restored. Untested restores fail on missing extensions, wrong versions, permissions, or simply take far longer than the RTO allows.",
      impact: "RTO is unknown; in the worst case the backup is unusable.",
      recommendation: "Automate a monthly restore into an isolated environment, verify row counts and application smoke tests, and record the restore time against the RTO.",
      tradeoff: "Compute cost of the restore environment for a few hours a month.",
      affectedComponentIds: untested.map((c) => c.id),
      affectedEdgeIds: [],
      dimensions: { operability: 0.5, reliability: 0.4 },
      fix: { description: "Rehearse restores", updateComponents: untested.map((c) => ({ id: c.id, patch: { backup: { ...c.backup!, restoreTested: true } } })) },
    });
  }

  // Hidden dependencies: edges that were inferred, and components with unmonitored fan-in.
  const inferredEdges = graph.edges.filter((e) => e.evidence === "inference" || e.evidence === "assumption");
  checklist.push({ item: "Dependency map completeness", status: inferredEdges.length === 0 ? "pass" : inferredEdges.length > 5 ? "fail" : "warn", detail: inferredEdges.length ? `${inferredEdges.length} dependencies are inferred, not declared.` : "All dependencies declared." });
  if (inferredEdges.length > 3 && graph.source !== "architect") {
    findings.push({
      id: "ops-hidden-deps",
      engine: "operations",
      category: "hidden_dependencies",
      severity: "medium",
      confidence: "medium",
      title: `${inferredEdges.length} dependencies had to be inferred rather than read from the architecture; the real blast radius of failures is larger than what is documented.`,
      evidence: [{ level: "inference", statement: `Inferred edges: ${inferredEdges.slice(0, 8).map((e) => `${idx.component(e.source).name} -> ${idx.component(e.target).name}`).join("; ")}${inferredEdges.length > 8 ? "; ..." : ""}.`, edgeIds: inferredEdges.map((e) => e.id) }],
      mechanism: "Undocumented dependencies are discovered during incidents, when a 'harmless' component turns out to be on the critical path.",
      impact: "Wrong incident triage; changes that break unrelated features.",
      recommendation: "Generate the dependency graph from telemetry (service map from traces) and keep the architecture description in the repository next to the code.",
      tradeoff: "Requires tracing to be in place.",
      affectedComponentIds: [...new Set(inferredEdges.flatMap((e) => [e.source, e.target]))],
      affectedEdgeIds: inferredEdges.map((e) => e.id),
      dimensions: { operability: 0.4, maintainability: 0.5 },
    });
  }

  const fails = checklist.filter((c) => c.status === "fail").length;
  const warns = checklist.filter((c) => c.status === "warn").length;
  const threeAmVerdict: OperationsReport["threeAmVerdict"] = fails >= 3 ? "no" : fails >= 1 || warns >= 3 ? "with_difficulty" : "yes";
  const verdictReason = threeAmVerdict === "no"
    ? `${fails} operational controls are missing outright (${checklist.filter((c) => c.status === "fail").map((c) => c.item.toLowerCase()).join(", ")}). An on-call engineer would be diagnosing blind and recovering by hand.`
    : threeAmVerdict === "with_difficulty"
      ? `Most controls exist but ${fails ? `${fails} are missing and ` : ""}${warns} are partial; recovery would be slow and depend on specific people.`
      : "Alerting, tracing, runbooks, pipelines and failover are in place; an on-call engineer has what they need.";

  return { findings, report: { threeAmVerdict, verdictReason, checklist } };
}
