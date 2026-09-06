"use client";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { useXRay, type ArchitectTab } from "@/lib/store";
import { FIELD_SPECS, getPath, setPath, type Requirements } from "@/engine/architect/requirements";
import { complexityScore } from "@/engine/scoring/scores";
import { Button, Empty, EvidenceChip, Eyebrow, ScoreBar, SeverityBadge, Stat, money } from "@/components/ui";
import { ArchitectureCanvas } from "@/components/canvas/ArchitectureCanvas";
import { RightPanel } from "@/components/panels/RightPanel";
import { BottomPanel } from "@/components/panels/BottomPanel";
import { Divider, useResizablePanel } from "@/components/Resizable";

const TABS: Array<{ id: ArchitectTab; label: string }> = [
  { id: "inventory", label: "Component inventory" },
  { id: "flows", label: "Request flows" },
  { id: "decisions", label: "Decisions (ADRs)" },
  { id: "cost", label: "Cost model" },
  { id: "analysis", label: "Reliability & security" },
  { id: "scalability", label: "Scalability" },
  { id: "operations", label: "Observability & ops" },
  { id: "plans", label: "Deployment" },
  { id: "compare", label: "Compare" },
];

export function ArchitectView() {
  const pkg = useXRay((s) => s.architect.pkg);
  const [formOpen, setFormOpen] = useState(true);
  const [formWidth, setFormWidth] = useResizablePanel("xray:architect:formWidth", 400, 280, 640);
  const [rightWidth, setRightWidth] = useResizablePanel("xray:architect:rightWidth", 360, 280, 640);
  const [bottomHeight, setBottomHeight] = useResizablePanel("xray:architect:bottomHeight", 300, 160, 640);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {formOpen && (
          <>
            <aside style={{ width: formWidth }} className="min-h-0 shrink-0 overflow-auto border-r border-line bg-white"><RequirementsForm /></aside>
            <Divider axis="x" onDelta={(d) => setFormWidth((w) => w + d)} title="Drag to resize the requirements panel" />
          </>
        )}
        <main className="relative min-h-0 min-w-0 flex-1">
          <button onClick={() => setFormOpen((v) => !v)} className="absolute left-2 top-2 z-10 rounded border border-line bg-white px-2 py-1 text-[11px] text-ink-2 hover:border-terra">{formOpen ? "Hide requirements" : "Show requirements"}</button>
          {pkg ? <ArchitectureCanvas /> : <Empty title="Requirements to architecture" body="Describe the system on the left, adjust the inferred requirements, and generate. The proposal is a full graph: every component is inspectable, every request traceable, and the same destruction engine scans it for residual risk." />}
          {pkg?.warnings.length ? <div className="pointer-events-none absolute bottom-3 left-3 max-w-md rounded border border-warn/40 bg-warn-soft/90 px-3 py-2 text-[11px] text-warn">{pkg.warnings.map((w, i) => <div key={i}>{w}</div>)}</div> : null}
        </main>
        <Divider axis="x" onDelta={(d) => setRightWidth((w) => w - d)} title="Drag to resize the inspector panel" />
        <aside style={{ width: rightWidth }} className="min-h-0 shrink-0 overflow-auto border-l border-line bg-white"><RightPanel /></aside>
      </div>
      <Divider axis="y" onDelta={(d) => setBottomHeight((h) => h - d)} title="Drag to resize the bottom panel" />
      <section style={{ height: bottomHeight }} className="min-h-0 shrink-0 border-t border-line bg-white"><ArchitectBottom /></section>
    </div>
  );
}

function RequirementsForm() {
  const a = useXRay((s) => s.architect);
  const setBrief = useXRay((s) => s.setBrief);
  const setRequirements = useXRay((s) => s.setRequirements);
  const infer = useXRay((s) => s.inferFromBrief);
  const generate = useXRay((s) => s.generate);
  const inferredPaths = useMemo(() => new Map(a.inferred.map((i) => [i.path, i.reason])), [a.inferred]);
  const sections = useMemo(() => [...new Set(FIELD_SPECS.map((f) => f.section))], []);
  const update = (path: string, value: unknown) => {
    const next = JSON.parse(JSON.stringify(a.requirements)) as Requirements;
    setPath(next as unknown as Record<string, unknown>, path, value);
    setRequirements(next);
  };
  return (
    <div className="space-y-4 p-4">
      <div>
        <Eyebrow>1. Describe the system</Eyebrow>
        <textarea value={a.brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder="Build an AI-powered SaaS platform for 100,000 users with document Q&A, enterprise SSO and 99.9% availability on Azure." className="mt-1 w-full rounded border border-line bg-sand p-2 text-xs leading-relaxed focus:border-terra" />
        <div className="mt-1 flex items-center gap-2">
          <Button variant="secondary" onClick={infer} disabled={a.loading || a.brief.trim().length < 10}>Infer requirements</Button>
          {a.inferred.length > 0 && <span className="text-[11px] text-ink-3">{a.inferred.length} values inferred (highlighted)</span>}
        </div>
      </div>
      <div>
        <Eyebrow>2. Confirm requirements</Eyebrow>
        {sections.map((section) => (
          <details key={section} open={section === "Business" || section === "Reliability"} className="mt-2 rounded border border-line">
            <summary className="cursor-pointer bg-sand-2 px-2 py-1 text-xs font-medium">{section}</summary>
            <div className="space-y-1.5 p-2">
              {FIELD_SPECS.filter((f) => f.section === section && (!f.aiOnly || a.requirements.ai.enabled)).map((f) => {
                const value = getPath(a.requirements, f.path);
                const reason = inferredPaths.get(f.path);
                return (
                  <label key={f.path} className="block" title={reason ? `Inferred: ${reason}` : undefined}>
                    <div className="flex items-center gap-1 text-[10px] text-ink-3"><span>{f.label}</span>{reason && <EvidenceChip level="inference" />}</div>
                    {f.type === "number" && <input type="number" value={Number(value ?? 0)} onChange={(e) => update(f.path, Number(e.target.value))} className={clsx("w-full rounded border bg-white px-2 py-1 text-xs", reason ? "border-info/50" : "border-line")} />}
                    {f.type === "select" && (
                      <select value={String(value)} onChange={(e) => { const o = f.options!.find((x) => String(x.value) === e.target.value); update(f.path, o ? o.value : e.target.value); }} className={clsx("w-full rounded border bg-white px-2 py-1 text-xs", reason ? "border-info/50" : "border-line")}>
                        {f.options!.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                      </select>
                    )}
                    {f.type === "boolean" && (
                      <button type="button" onClick={() => update(f.path, !value)} className={clsx("rounded border px-2 py-1 text-xs", value ? "border-ink bg-ink text-sand" : "border-line bg-white text-ink-3")}>{value ? "Yes" : "No"}</button>
                    )}
                    {f.type === "multiselect" && (
                      <div className="flex flex-wrap gap-1">
                        {f.options!.map((o) => {
                          const arr = (value as string[]) ?? [];
                          const on = arr.includes(String(o.value));
                          return <button type="button" key={String(o.value)} onClick={() => update(f.path, on ? arr.filter((x) => x !== o.value) : [...arr, o.value])} className={clsx("rounded border px-2 py-0.5 text-[11px]", on ? "border-ink bg-ink text-sand" : "border-line bg-white text-ink-3")}>{o.label}</button>;
                        })}
                      </div>
                    )}
                  </label>
                );
              })}
            </div>
          </details>
        ))}
      </div>
      <div className="sticky bottom-0 border-t border-line bg-white pt-3">
        <Button onClick={generate} disabled={a.loading} className="w-full">{a.loading ? "Generating..." : "3. Generate architecture"}</Button>
        {a.error && <div className="mt-2 text-xs text-bad">{a.error}</div>}
      </div>
    </div>
  );
}

function ArchitectBottom() {
  const a = useXRay((s) => s.architect);
  const setTab = useXRay((s) => s.setArchitectTab);
  const pkg = a.pkg;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-sand-2 px-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={clsx("relative shrink-0 px-3 py-2 text-xs font-medium", a.tab === t.id ? "text-ink" : "text-ink-3 hover:text-ink")}>
            {t.label}
            {a.tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-terra" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!pkg && <Empty title="No architecture yet" body="Generate one from the requirements panel." />}
        {pkg && a.tab === "inventory" && <InventoryTab />}
        {pkg && a.tab === "flows" && <BottomPanelTab tab="traces" />}
        {pkg && a.tab === "decisions" && <DecisionsTab />}
        {pkg && a.tab === "cost" && <BottomPanelTab tab="cost" />}
        {pkg && a.tab === "analysis" && <AnalysisTab />}
        {pkg && a.tab === "scalability" && <BottomPanelTab tab="scalability" />}
        {pkg && a.tab === "operations" && <OpsTab />}
        {pkg && a.tab === "plans" && <PlansTab />}
        {pkg && a.tab === "compare" && <CompareTab />}
      </div>
    </div>
  );
}

/** Reuses the destruction-mode bottom panel tabs against the active (architect) graph. */
function BottomPanelTab({ tab }: { tab: "traces" | "cost" | "scalability" | "scenarios" | "findings" }) {
  return <BottomPanel tab={tab} hideTabs />;
}

function InventoryTab() {
  const pkg = useXRay((s) => s.architect.pkg)!;
  const select = useXRay((s) => s.selectComponent);
  const selected = useXRay((s) => s.selectedComponentId);
  return (
    <div className="p-3">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-[10px] uppercase tracking-wider text-ink-3"><th className="py-1">Component</th><th>Purpose / technology</th><th>Why</th><th>Scaling</th><th>Failure behaviour</th><th>Cost</th></tr></thead>
        <tbody>
          {pkg.inventory.map((i) => (
            <tr key={i.componentId} onClick={() => select(i.componentId)} className={clsx("cursor-pointer border-t border-line align-top hover:bg-sand-2", selected === i.componentId && "bg-terra-soft/40")}>
              <td className="py-1.5 pr-2 font-medium">{i.name}<div className="mono text-[10px] font-normal text-ink-3">{i.alternatives.length ? `alt: ${i.alternatives.slice(0, 2).join(", ")}` : ""}</div></td>
              <td className="py-1.5 pr-2 text-ink-2">{i.purpose}<div className="mono text-[10px] text-ink-3">{i.technology}</div></td>
              <td className="py-1.5 pr-2 text-ink-2">{i.reason}</td>
              <td className="py-1.5 pr-2 text-ink-2">{i.scalingModel}</td>
              <td className="py-1.5 pr-2 text-ink-2">{i.failureBehaviour}</td>
              <td className="py-1.5 text-ink-2">{i.costCategory}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DecisionsTab() {
  const pkg = useXRay((s) => s.architect.pkg)!;
  const select = useXRay((s) => s.selectComponent);
  return (
    <div className="grid grid-cols-2 gap-3 p-3">
      {pkg.adrs.map((d) => (
        <div key={d.id} className="rounded border border-line bg-white p-3 text-xs">
          <div className="flex items-center gap-2"><span className="mono text-[10px] text-ink-3">{d.id.toUpperCase()}</span><span className="font-medium">{d.title}</span></div>
          <Row k="Decision" v={d.decision} />
          <Row k="Context" v={d.context} />
          <Row k="Alternatives" v={d.alternatives.join("; ")} />
          <Row k="Tradeoffs" v={d.tradeoffs} />
          <Row k="Consequences" v={d.consequences} />
          <Row k="Why" v={d.reason} />
          <div className="mt-1 flex flex-wrap gap-1">{d.componentIds.map((id) => <button key={id} onClick={() => select(id)} className="rounded border border-line px-1.5 py-0.5 text-[10px] hover:border-terra">{pkg.graph.components.find((c) => c.id === id)?.name ?? id}</button>)}</div>
        </div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="mt-1 flex gap-2"><span className="w-24 shrink-0 text-ink-3">{k}</span><span className="text-ink-2">{v}</span></div>;
}

function AnalysisTab() {
  const pkg = useXRay((s) => s.architect.pkg)!;
  const selectFinding = useXRay((s) => s.selectFinding);
  const simulate = useXRay((s) => s.simulate);
  const r = pkg.report;
  const sim = useXRay((s) => s.simulation);
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 p-3">
      <div>
        <Eyebrow className="mb-1">Residual findings on the proposal ({r.findings.length})</Eyebrow>
        <p className="mb-2 text-[11px] text-ink-3">The same destruction engine scanned the generated architecture. What remains is what the requirements did not pay to remove.</p>
        {r.findings.length === 0 && <div className="text-xs text-ok">No findings.</div>}
        {r.findings.map((f) => (
          <button key={f.id} onClick={() => selectFinding(f.id)} className="mb-1 flex w-full items-start gap-2 rounded border border-line bg-white px-2 py-1.5 text-left text-xs hover:border-terra"><SeverityBadge severity={f.severity} /><span>{f.title}</span></button>
        ))}
        <Eyebrow className="mb-1 mt-3">Failure domains</Eyebrow>
        {r.scenarioSummaries.map((s) => (
          <button key={s.id} onClick={() => simulate({ kind: s.kind as never, targetId: s.targetId })} className={clsx("mb-1 flex w-full items-center gap-2 rounded border bg-white px-2 py-1 text-left text-xs hover:border-terra", sim?.title === s.name ? "border-terra" : "border-line")}>
            <span className="flex-1">{s.name}</span>{s.isSpof && <span className="mono rounded bg-bad px-1 text-[9px] text-white">SPOF</span>}
            <span className={clsx("mono text-[10px]", s.userImpact === "none" || s.userImpact === "low" ? "text-ok" : s.userImpact === "partial" ? "text-warn" : "text-bad")}>{s.userImpact.replace("_", " ")}</span>
            <span className="mono w-10 text-right text-[10px] text-ink-3">{s.blastRadiusPct}%</span>
          </button>
        ))}
      </div>
      <div>
        <Stat label="Score of the proposal" value={`${r.scores.overall}/100`} tone={r.scores.overall >= 75 ? "ok" : r.scores.overall >= 50 ? "warn" : "bad"} />
        <div className="mt-2 divide-y divide-line">{r.scores.dimensions.map((d) => <ScoreBar key={d.dimension} label={d.dimension === "ai" ? "AI architecture" : d.dimension} score={d.score} confidence={d.confidence} reason={d.reason} applicable={d.applicable} />)}</div>
        <Eyebrow className="mb-1 mt-3">Trust boundaries</Eyebrow>
        {r.security.trustBoundaries.map((b) => <div key={b.from + b.to} className="flex gap-2 py-0.5 text-xs"><span className="flex-1">{b.from} {"->"} {b.to}</span><span className={clsx("mono text-[10px]", b.encrypted === true ? "text-ok" : "text-warn")}>enc:{String(b.encrypted)}</span><span className={clsx("mono text-[10px]", b.authenticated === true ? "text-ok" : "text-warn")}>auth:{String(b.authenticated)}</span></div>)}
        <Eyebrow className="mb-1 mt-3">Attack surface</Eyebrow>
        {r.security.attackSurface.map((s) => <div key={s.componentId} className="flex gap-2 py-0.5 text-xs"><span className="flex-1">{s.name}</span><span className="mono text-[10px] text-ink-3">{s.reason}</span></div>)}
        {sim && <div className="mt-3 rounded border border-line bg-sand-2 p-2 text-xs"><div className="font-medium">{sim.title}</div><div className="text-ink-2">Impact {sim.userImpact.replace("_", " ")}, blast radius {sim.blastRadiusPct}%, recovery {sim.recovery} ({sim.estimatedRecovery}). {sim.recoveryPath}</div></div>}
      </div>
    </div>
  );
}

function OpsTab() {
  const pkg = useXRay((s) => s.architect.pkg)!;
  const o = pkg.observability;
  const ops = pkg.report.operations;
  const list = (title: string, items: string[]) => (
    <div><Eyebrow className="mb-1">{title}</Eyebrow><ul className="space-y-0.5 text-xs text-ink-2">{items.map((i, k) => <li key={k}>- {i}</li>)}</ul></div>
  );
  return (
    <div className="grid grid-cols-3 gap-4 p-3">
      <div className="space-y-3">{list("Metrics", o.metrics)}{list("Logs", o.logs)}{list("Traces", o.traces)}</div>
      <div className="space-y-3">{list("Alerts", o.alerts)}{list("SLOs", o.slos)}{list("Dashboards", o.dashboards)}</div>
      <div className="space-y-3">
        {list("Hard to diagnose", o.hardToDiagnose)}
        <div>
          <Eyebrow className="mb-1">3 AM verdict: {ops.threeAmVerdict.replace(/_/g, " ")}</Eyebrow>
          <p className="text-xs text-ink-2">{ops.verdictReason}</p>
          {ops.checklist.map((c) => <div key={c.item} className="flex gap-2 py-0.5 text-xs"><span className={clsx("mono w-10 text-[10px] uppercase", c.status === "pass" ? "text-ok" : c.status === "warn" ? "text-warn" : "text-bad")}>{c.status}</span><span>{c.item}</span></div>)}
        </div>
      </div>
    </div>
  );
}

function PlansTab() {
  const pkg = useXRay((s) => s.architect.pkg)!;
  const d = pkg.deployment;
  const rows: Array<[string, string]> = [["CI/CD", d.cicd], ["Environments", d.environments.join(" -> ")], ["Artifacts", d.artifactStrategy], ["Deployment strategy", d.deploymentStrategy], ["Rollback", d.rollback], ["Database migrations", d.migrations], ["Secrets and configuration", d.secretsAndConfig], ["Infrastructure as code", d.infrastructureAsCode]];
  return (
    <div className="p-3">
      <table className="w-full text-xs">
        <tbody>{rows.map(([k, v]) => <tr key={k} className="border-t border-line"><td className="w-48 py-1.5 pr-3 font-medium align-top">{k}</td><td className="py-1.5 text-ink-2">{v}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function CompareTab() {
  const pkg = useXRay((s) => s.architect.pkg)!;
  const original = useXRay((s) => s.graph);
  const originalReport = useXRay((s) => s.report);
  const send = useXRay((s) => s.sendProposalToDestruction);
  if (!original || !originalReport) {
    return <Empty title="Nothing to compare yet" body="Scan an architecture in Destruction mode first (the demo or your own). Then this tab shows the as-built architecture against the proposal." />;
  }
  const a = originalReport;
  const b = pkg.report;
  const dim = (r: typeof a, d: string) => r.scores.dimensions.find((x) => x.dimension === d);
  const namesA = new Set(original.components.map((c) => c.name));
  const namesB = new Set(pkg.graph.components.map((c) => c.name));
  const added = pkg.graph.components.filter((c) => !namesA.has(c.name)).map((c) => c.name);
  const removed = original.components.filter((c) => !namesB.has(c.name)).map((c) => c.name);
  const row = (label: string, x: number, y: number, invert = false, fmt: (n: number) => string = String) => {
    const delta = y - x;
    const good = invert ? delta < 0 : delta > 0;
    return <tr key={label} className="border-t border-line"><td className="py-1 capitalize">{label}</td><td className="mono text-right">{fmt(x)}</td><td className="mono text-right">{fmt(y)}</td><td className={clsx("mono text-right", delta === 0 ? "text-ink-3" : good ? "text-ok" : "text-bad")}>{delta > 0 ? "+" : ""}{fmt(delta)}</td></tr>;
  };
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-4 p-3">
      <div>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider text-ink-3"><th className="py-1">Metric</th><th className="text-right">Before ({original.name.slice(0, 24)})</th><th className="text-right">After (proposal)</th><th className="text-right">Delta</th></tr></thead>
          <tbody>
            {row("overall", a.scores.overall, b.scores.overall)}
            {b.scores.dimensions.filter((d) => d.applicable).map((d) => row(d.dimension, dim(a, d.dimension)?.score ?? 0, d.score))}
            {row("findings", a.findings.length, b.findings.length, true)}
            {row("critical + high", a.findings.filter((f) => f.severity === "critical" || f.severity === "high").length, b.findings.filter((f) => f.severity === "critical" || f.severity === "high").length, true)}
            {row("monthly cost (min)", a.cost.monthly.min, b.cost.monthly.min, true, money)}
            {row("monthly cost (max)", a.cost.monthly.max, b.cost.monthly.max, true, money)}
            {row("complexity", complexityScore(original), complexityScore(pkg.graph), true)}
            {row("components", original.components.length, pkg.graph.components.length, true)}
          </tbody>
        </table>
        <div className="mt-3 flex gap-2"><Button variant="secondary" onClick={send}>Open proposal in Destruction mode</Button></div>
      </div>
      <div className="space-y-3 text-xs">
        <div><Eyebrow className="mb-1">Added</Eyebrow><div className="flex flex-wrap gap-1">{added.map((n) => <span key={n} className="rounded border border-ok/40 bg-ok-soft px-1.5 py-0.5 text-[11px] text-ok">{n}</span>)}{!added.length && <span className="text-ink-3">none</span>}</div></div>
        <div><Eyebrow className="mb-1">Removed</Eyebrow><div className="flex flex-wrap gap-1">{removed.map((n) => <span key={n} className="rounded border border-bad/40 bg-bad-soft px-1.5 py-0.5 text-[11px] text-bad">{n}</span>)}{!removed.length && <span className="text-ink-3">none</span>}</div></div>
        <div className="rounded border border-line bg-sand-2 p-3 text-ink-2">
          <div className="mb-1 font-medium text-ink">The tradeoff</div>
          {b.cost.monthly.max > a.cost.monthly.max
            ? `The proposal spends roughly ${money(b.cost.monthly.max - a.cost.monthly.max)} more per month at the top of the range and adds ${Math.max(0, pkg.graph.components.length - original.components.length)} components. In exchange, reliability moves from ${dim(a, "reliability")?.score} to ${dim(b, "reliability")?.score} and security from ${dim(a, "security")?.score} to ${dim(b, "security")?.score}: redundancy, private networking and a model gateway are bought, not free.`
            : `The proposal is not more expensive at the top of the range: most of the improvement comes from configuration (redundancy tiers, private endpoints, pooling, budgets) rather than from more capacity. Complexity ${complexityScore(pkg.graph) > complexityScore(original) ? "rises" : "falls"} because ${complexityScore(pkg.graph) > complexityScore(original) ? "a gateway, a second region and platform services are added" : "hand-built components are replaced by managed ones"}.`}
        </div>
      </div>
    </div>
  );
}
