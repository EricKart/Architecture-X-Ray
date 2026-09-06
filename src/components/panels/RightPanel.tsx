"use client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { useXRay } from "@/lib/store";
import { Button, ConfidenceChip, EvidenceChip, Eyebrow, KV, SeverityBadge } from "@/components/ui";
import { explainFinding } from "@/engine/teaching/explain";
import type { Finding } from "@/engine/analysis/types";
import type { Component } from "@/engine/graph/types";

export function RightPanel() {
  const graph = useXRay((s) => s.graph);
  const report = useXRay((s) => s.report);
  const selectedComponentId = useXRay((s) => s.selectedComponentId);
  const selectedFindingId = useXRay((s) => s.selectedFindingId);
  const finding = report?.findings.find((f) => f.id === selectedFindingId);
  const component = graph?.components.find((c) => c.id === selectedComponentId);

  if (!graph) return <div className="p-4 text-xs text-ink-3">No architecture loaded.</div>;
  if (finding) return <FindingDetail finding={finding} />;
  if (component) return <ComponentDetail component={component} />;
  return <GraphOverview />;
}

function GraphOverview() {
  const graph = useXRay((s) => s.graph)!;
  const report = useXRay((s) => s.report);
  return (
    <div className="space-y-4 p-4">
      <div>
        <Eyebrow>Architecture</Eyebrow>
        <div className="display mt-1 text-lg leading-tight">{graph.name}</div>
        <p className="mt-2 text-xs leading-relaxed text-ink-2">{graph.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Mini label="Components" value={graph.components.length} />
        <Mini label="Dependencies" value={graph.edges.length} />
        <Mini label="Network zones" value={graph.zones.length} />
        <Mini label="Regions" value={graph.regions.length} />
        <Mini label="Flows" value={graph.flows.length} />
        <Mini label="Source" value={graph.source} />
      </div>
      {graph.traffic && (
        <div>
          <Eyebrow>Traffic profile <EvidenceChip level={graph.traffic.evidence} /></Eyebrow>
          <KV k="Baseline" v={`${graph.traffic.baselineRps} rps`} />
          <KV k="Peak" v={`${graph.traffic.peakRps} rps`} />
          <KV k="Read ratio" v={`${Math.round(graph.traffic.readRatio * 100)}%`} />
          {graph.traffic.aiRequestsPerSecond !== undefined && <KV k="AI requests" v={`${graph.traffic.aiRequestsPerSecond} rps`} />}
        </div>
      )}
      {graph.targets && (
        <div>
          <Eyebrow>Targets</Eyebrow>
          <KV k="Availability" v={graph.targets.availability ? `${graph.targets.availability}%` : undefined} />
          <KV k="RTO / RPO" v={`${graph.targets.rtoMinutes ?? "?"} min / ${graph.targets.rpoMinutes ?? "?"} min`} />
          <KV k="p95 latency" v={graph.targets.p95LatencyMs ? `${graph.targets.p95LatencyMs} ms` : undefined} />
        </div>
      )}
      {graph.assumptions.length > 0 && (
        <div>
          <Eyebrow>Assumptions</Eyebrow>
          <ul className="mt-1 space-y-1 text-xs text-ink-2">{graph.assumptions.map((a, i) => <li key={i} className="flex gap-2"><EvidenceChip level="assumption" /><span>{a}</span></li>)}</ul>
        </div>
      )}
      {graph.unknowns.length > 0 && (
        <div>
          <Eyebrow>Unknowns</Eyebrow>
          <ul className="mt-1 space-y-1 text-xs text-ink-2">{graph.unknowns.map((a, i) => <li key={i} className="flex gap-2"><EvidenceChip level="unknown" /><span>{a}</span></li>)}</ul>
        </div>
      )}
      {!report && <p className="text-xs text-ink-3">Click a component to inspect it, or run a scan to let the destruction engine find what breaks.</p>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-line bg-white px-2 py-1.5">
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className="mono text-sm">{value}</div>
    </div>
  );
}

function ComponentDetail({ component: c }: { component: Component }) {
  const graph = useXRay((s) => s.graph)!;
  const report = useXRay((s) => s.report);
  const simulate = useXRay((s) => s.simulate);
  const selectFinding = useXRay((s) => s.selectFinding);
  const runTrace = useXRay((s) => s.runTrace);
  const loading = useXRay((s) => s.loading);
  const zone = graph.zones.find((z) => z.id === c.zoneId);
  const region = graph.regions.find((r) => r.id === c.regionId);
  const deps = graph.edges.filter((e) => e.source === c.id);
  const dependents = graph.edges.filter((e) => e.target === c.id);
  const findings = report?.findings.filter((f) => f.affectedComponentIds.includes(c.id)) ?? [];
  const flows = graph.flows.filter((f) => f.steps.some((s) => s.componentId === c.id));
  const name = (id: string) => graph.components.find((x) => x.id === id)?.name ?? id;
  const failureBehaviour = c.redundancy.failover === "automatic" && c.redundancy.replicas > 1
    ? `Survives instance loss; ${c.redundancy.multiAz ? "zone-redundant" : "single zone"}; failover ~${c.redundancy.failoverSeconds ?? 60}s.`
    : c.redundancy.failover === "manual" ? "Standby exists but failover is manual." : `Single instance; ${c.stateful ? (c.backup?.enabled ? "restore from backup on loss" : "state is lost on failure") : "redeploy on loss"}.`;

  return (
    <div className="space-y-4 p-4">
      <div>
        <Eyebrow>{c.type.replace(/_/g, " ")} <span className="text-ink-3">/</span> {c.layer} <EvidenceChip level={c.evidence} /></Eyebrow>
        <div className="display mt-1 text-lg leading-tight">{c.name}</div>
        {c.purpose && <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{c.purpose}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {c.type !== "client" && (
          <Button variant="danger" disabled={loading.simulation} onClick={() => simulate({ kind: "component", targetId: c.id })}>Attack this component</Button>
        )}
        {flows[0] && <Button variant="secondary" onClick={() => runTrace(flows[0].id)}>Follow a request through it</Button>}
      </div>
      <Section title="Technology">
        <KV k="Service" v={c.service} />
        <KV k="Technology" v={c.technology} />
        <KV k="Provider" v={c.provider} />
        <KV k="Zone" v={zone ? `${zone.name} (trust ${zone.trustLevel})` : c.zoneId} />
        <KV k="Region" v={region?.name} />
        <KV k="Exposure" v={c.exposure} />
        <KV k="Criticality" v={c.criticality} />
        <KV k="Stateful" v={c.stateful} />
        {c.rationale && <KV k="Why chosen" v={c.rationale} />}
        {c.alternatives?.length ? <KV k="Alternatives" v={c.alternatives.join(", ")} /> : null}
      </Section>
      <Section title="Scaling">
        <KV k="Model" v={c.scaling.model.replace(/_/g, " ")} />
        {c.scaling.minInstances !== undefined && <KV k="Instances" v={`${c.scaling.minInstances} min / ${c.scaling.currentInstances ?? "?"} now / ${c.scaling.maxInstances ?? "unbounded"} max`} />}
        {c.scaling.currentInstances !== undefined && c.scaling.minInstances === undefined && <KV k="Instances" v={`${c.scaling.currentInstances} (fixed)`} />}
        <KV k="Per instance" v={c.scaling.rpsPerInstance ? `${c.scaling.rpsPerInstance} rps` : c.scaling.jobsPerSecondPerInstance ? `${c.scaling.jobsPerSecondPerInstance} jobs/s` : undefined} />
        <KV k="Max connections" v={c.scaling.maxConnections} />
        <KV k="Pooler" v={c.scaling.connectionPooler} />
        <KV k="Read replicas" v={c.scaling.readReplicas} />
        <KV k="Rate limit" v={c.scaling.requestsPerMinuteLimit ? `${c.scaling.requestsPerMinuteLimit} rpm${c.scaling.tokensPerMinuteLimit ? ` / ${c.scaling.tokensPerMinuteLimit.toLocaleString()} tpm` : ""}` : undefined} />
      </Section>
      <Section title="Failure behaviour">
        <KV k="Replicas" v={`${c.redundancy.replicas}${c.redundancy.multiAz ? ", multi-AZ" : ""}${c.redundancy.multiRegion ? ", multi-region" : ""}`} />
        <KV k="Failover" v={c.redundancy.failover} />
        <KV k="On failure" v={failureBehaviour} />
        {c.backup && <KV k="Backup" v={c.backup.enabled ? `${c.backup.frequency ?? "enabled"}${c.backup.pointInTimeRecovery ? ", PITR" : ""}${c.backup.restoreTested === false ? ", restore never tested" : ""}` : "none"} />}
      </Section>
      <Section title="Security">
        <KV k="Auth" v={c.security.authentication} />
        <KV k="Secrets from" v={c.security.secretsSource?.replace(/_/g, " ")} />
        <KV k="IAM scope" v={c.security.iamScope?.replace(/_/g, " ")} />
        <KV k="Public endpoint" v={c.security.publicEndpoint} />
        <KV k="Encryption" v={c.security.encryptionAtRest !== undefined || c.security.encryptionInTransit !== undefined ? `at rest: ${fmt(c.security.encryptionAtRest)}, in transit: ${fmt(c.security.encryptionInTransit)}` : undefined} />
        <KV k="Data" v={c.security.dataClassification} />
        <KV k="TLS cert" v={c.security.tlsCertificate} />
      </Section>
      <Section title="Cost and operations">
        <KV k="Cost" v={`${c.cost.category.replace("_", " ")} (${c.cost.model})${c.cost.monthlyUsd ? ` ~ $${c.cost.monthlyUsd.min.toLocaleString()}-${c.cost.monthlyUsd.max.toLocaleString()}/mo` : ""}`} />
        {c.cost.notes && <KV k="Cost note" v={c.cost.notes} />}
        <KV k="Owner" v={c.operations.owner} />
        <KV k="Deploy" v={c.operations.deployMethod?.replace(/_/g, " ")} />
        <KV k="IaC" v={c.operations.iac} />
        <KV k="Runbook" v={c.operations.runbook} />
        <KV k="Rollback" v={c.operations.rollback} />
        <KV k="Migrations" v={c.operations.migrationStrategy} />
        <KV k="Observability" v={`${flag(c.observability.metrics, "metrics")} ${flag(c.observability.logs, "logs")} ${flag(c.observability.traces, "traces")} ${flag(c.observability.alerts, "alerts")}`} />
      </Section>
      {c.ai && (
        <Section title="AI profile">
          <KV k="Role" v={c.ai.role} />
          <KV k="Model" v={c.ai.model} />
          <KV k="Fallback" v={c.ai.fallbackProvider ?? c.ai.fallbackModel ?? "none"} />
          <KV k="Rate limits" v={c.ai.rateLimitHandling} />
          <KV k="PII redaction" v={c.ai.piiRedaction} />
          <KV k="Injection controls" v={c.ai.promptInjectionControls} />
          <KV k="Tool access" v={c.ai.toolAccess} />
          <KV k="Cost cap" v={c.ai.costCap} />
          <KV k="Tenant isolation" v={c.ai.tenantIsolation} />
          <KV k="Model pinned" v={c.ai.modelPinned} />
        </Section>
      )}
      <Section title={`Depends on (${deps.length})`}>
        {deps.length === 0 && <div className="text-xs text-ink-3">Nothing.</div>}
        {deps.map((e) => <EdgeRow key={e.id} label={name(e.target)} e={e} />)}
      </Section>
      <Section title={`Depended on by (${dependents.length})`}>
        {dependents.length === 0 && <div className="text-xs text-ink-3">Nothing.</div>}
        {dependents.map((e) => <EdgeRow key={e.id} label={name(e.source)} e={e} />)}
      </Section>
      {report && (
        <Section title={`Findings (${findings.length})`}>
          {findings.length === 0 && <div className="text-xs text-ok">No findings reference this component.</div>}
          {findings.map((f) => (
            <button key={f.id} onClick={() => selectFinding(f.id)} className="block w-full rounded border border-line bg-white px-2 py-1.5 text-left text-xs hover:border-terra">
              <SeverityBadge severity={f.severity} className="mr-2" />{f.title}
            </button>
          ))}
        </Section>
      )}
      {flows.length > 0 && (
        <Section title="Flows through here">
          <div className="flex flex-wrap gap-1.5">{flows.map((f) => <button key={f.id} onClick={() => runTrace(f.id)} className="rounded border border-line bg-white px-2 py-0.5 text-[11px] hover:border-terra">{f.name}</button>)}</div>
        </Section>
      )}
    </div>
  );
}

function EdgeRow({ label, e }: { label: string; e: { kind: string; sync: string; criticality: string; protocol?: string; encrypted?: boolean; authentication?: string } }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="flex-1 truncate">{label}</span>
      <span className="mono text-[10px] text-ink-3">{e.kind.replace(/_/g, " ")} / {e.protocol ?? "?"} / {e.sync} / {e.criticality}</span>
      {e.encrypted === false && <span className="mono rounded bg-bad-soft px-1 text-[9px] text-bad">plain</span>}
      {e.authentication === "none" && <span className="mono rounded bg-bad-soft px-1 text-[9px] text-bad">no auth</span>}
    </div>
  );
}

function FindingDetail({ finding: f }: { finding: Finding }) {
  const graph = useXRay((s) => s.graph)!;
  const simulate = useXRay((s) => s.simulate);
  const applyFix = useXRay((s) => s.applyFix);
  const selectFinding = useXRay((s) => s.selectFinding);
  const selectComponent = useXRay((s) => s.selectComponent);
  const appliedFixes = useXRay((s) => s.appliedFixes);
  const loading = useXRay((s) => s.loading);
  const [level, setLevel] = useState<"beginner" | "engineer" | "architect" | null>(null);
  const explanation = useMemo(() => explainFinding(f, graph), [f, graph]);
  const name = (id: string) => graph.components.find((x) => x.id === id)?.name ?? id;
  const primary = f.affectedComponentIds[0];
  const applied = appliedFixes.includes(f.id);
  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="flex items-center gap-2">
          <SeverityBadge severity={f.severity} />
          <span className="eyebrow">{f.engine} / {f.category.replace(/_/g, " ")}</span>
          <button className="ml-auto text-[11px] text-ink-3 hover:text-terra" onClick={() => selectFinding(null)}>close</button>
        </div>
        <div className="display mt-2 text-base leading-snug">{f.title}</div>
        <div className="mt-2"><ConfidenceChip confidence={f.confidence} /></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {primary && graph.components.find((c) => c.id === primary)?.type !== "client" && (
          <Button variant="danger" disabled={loading.simulation} onClick={() => simulate({ kind: "component", targetId: primary })}>Attack {name(primary)}</Button>
        )}
        {f.fix && (
          <Button variant="primary" disabled={loading.fix || applied} onClick={() => applyFix(f)} title={f.fix.description}>{applied ? "Fix applied" : "Apply fix and re-scan"}</Button>
        )}
      </div>
      <Section title="Evidence">
        <ul className="space-y-1.5">
          {f.evidence.map((e, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed">
              <EvidenceChip level={e.level} />
              <span className="text-ink-2">
                {e.statement}
                {(e.componentIds?.length || e.edgeIds?.length) ? (
                  <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                    {e.componentIds?.map((id) => <button key={id} onClick={() => selectComponent(id)} className="mono rounded border border-line px-1 text-[10px] text-terra hover:bg-terra-soft">{name(id)}</button>)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      {f.path && f.path.length > 1 && (
        <Section title="Attack path">
          <div className="mono flex flex-wrap items-center gap-1 text-[11px]">{f.path.map((id, i) => <span key={id} className="flex items-center gap-1"><button onClick={() => selectComponent(id)} className="rounded border border-line bg-white px-1.5 py-0.5 hover:border-terra">{name(id)}</button>{i < f.path!.length - 1 && <span className="text-ink-3">{"->"}</span>}</span>)}</div>
        </Section>
      )}
      <Section title="Failure mechanism"><p className="text-xs leading-relaxed text-ink-2">{f.mechanism}</p></Section>
      <Section title="Impact"><p className="text-xs leading-relaxed text-ink-2">{f.impact}</p></Section>
      <Section title="Recommendation"><p className="text-xs leading-relaxed text-ink">{f.recommendation}</p></Section>
      <Section title="Tradeoff"><p className="text-xs leading-relaxed text-ink-2">{f.tradeoff}</p></Section>
      <Section title="Affected components">
        <div className="flex flex-wrap gap-1.5">{f.affectedComponentIds.map((id) => <button key={id} onClick={() => selectComponent(id)} className="rounded border border-line bg-white px-2 py-0.5 text-[11px] hover:border-terra">{name(id)}</button>)}</div>
      </Section>
      <Section title="Explain this to me">
        <div className="flex gap-1">
          {(["beginner", "engineer", "architect"] as const).map((l) => (
            <button key={l} onClick={() => setLevel(level === l ? null : l)} className={clsx("rounded px-2 py-1 text-[11px] capitalize", level === l ? "bg-ink text-sand" : "border border-line bg-white hover:border-terra")}>{l}</button>
          ))}
        </div>
        {level && <div className="mt-2 whitespace-pre-line rounded border border-line bg-sand-2 p-3 text-xs leading-relaxed text-ink-2">{explanation[level]}</div>}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Eyebrow className="mb-1.5">{title}</Eyebrow>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function fmt(v: boolean | undefined) {
  return v === undefined ? "unknown" : v ? "yes" : "no";
}
function flag(v: boolean, label: string) {
  return `${v ? "+" : "-"}${label}`;
}
