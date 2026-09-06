"use client";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useXRay, type BottomTab } from "@/lib/store";
import { Button, ConfidenceChip, Empty, EvidenceChip, Eyebrow, ScoreBar, SeverityBadge, Stat, money } from "@/components/ui";
import { complexityScore } from "@/engine/scoring/scores";
import type { Engine, Severity } from "@/engine/analysis/types";

const TABS: Array<{ id: BottomTab; label: string }> = [
  { id: "findings", label: "Findings" },
  { id: "scenarios", label: "Attack scenarios" },
  { id: "traces", label: "Request traces" },
  { id: "scalability", label: "Scalability" },
  { id: "cost", label: "Cost" },
  { id: "operations", label: "Operations" },
  { id: "scores", label: "Scores & diff" },
];

export function BottomPanel() {
  const tab = useXRay((s) => s.bottomTab);
  const setTab = useXRay((s) => s.setBottomTab);
  const report = useXRay((s) => s.report);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line bg-sand-2 px-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={clsx("relative px-3 py-2 text-xs font-medium", tab === t.id ? "text-ink" : "text-ink-3 hover:text-ink")}>
            {t.label}
            {t.id === "findings" && report && <span className="mono ml-1.5 rounded bg-ink px-1 text-[9px] text-sand">{report.findings.length}</span>}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-terra" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "findings" && <FindingsTab />}
        {tab === "scenarios" && <ScenariosTab />}
        {tab === "traces" && <TracesTab />}
        {tab === "scalability" && <ScalabilityTab />}
        {tab === "cost" && <CostTab />}
        {tab === "operations" && <OperationsTab />}
        {tab === "scores" && <ScoresTab />}
      </div>
    </div>
  );
}

function NeedScan() {
  const scan = useXRay((s) => s.scan);
  const loading = useXRay((s) => s.loading.analysis);
  return <Empty title="No scan yet" body="Run the destruction engine to populate this view." action={<Button onClick={scan} disabled={loading}>Scan architecture</Button>} />;
}

function FindingsTab() {
  const report = useXRay((s) => s.report);
  const selectFinding = useXRay((s) => s.selectFinding);
  const selected = useXRay((s) => s.selectedFindingId);
  const [engine, setEngine] = useState<Engine | "all">("all");
  if (!report) return <NeedScan />;
  const list = report.findings.filter((f) => engine === "all" || f.engine === engine);
  const counts = (s: Severity) => report.findings.filter((f) => f.severity === s).length;
  return (
    <div className="p-3">
      <div className="mb-3 grid grid-cols-3 gap-3">
        {report.criticalFindings.map((f, i) => (
          <button key={f.id} onClick={() => selectFinding(f.id)} className={clsx("rounded border bg-white p-3 text-left transition-colors hover:border-terra", selected === f.id ? "border-terra" : "border-line")}>
            <div className="flex items-center gap-2"><span className="mono text-[10px] text-ink-3">#{i + 1} most dangerous</span><SeverityBadge severity={f.severity} /><span className="mono ml-auto text-[10px] text-ink-3">{f.engine}</span></div>
            <div className="mt-1.5 text-xs font-medium leading-snug">{f.title}</div>
          </button>
        ))}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <span className="mono text-[11px] text-ink-3">{counts("critical")} critical / {counts("high")} high / {counts("medium")} medium / {counts("low")} low</span>
        <div className="ml-auto flex gap-1">
          {(["all", "reliability", "scalability", "security", "cost", "operations", "ai"] as const).map((e) => (
            <button key={e} onClick={() => setEngine(e)} className={clsx("rounded px-2 py-0.5 text-[11px] capitalize", engine === e ? "bg-ink text-sand" : "text-ink-3 hover:text-ink")}>{e}</button>
          ))}
        </div>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {list.map((f) => (
            <tr key={f.id} onClick={() => selectFinding(f.id)} className={clsx("cursor-pointer border-t border-line hover:bg-sand-2", selected === f.id && "bg-terra-soft/40")}>
              <td className="w-20 py-2 pr-2 align-top"><SeverityBadge severity={f.severity} /></td>
              <td className="w-24 py-2 pr-2 align-top"><span className="mono text-[10px] text-ink-3">{f.engine}</span></td>
              <td className="py-2 pr-2 align-top">{f.title}</td>
              <td className="w-24 py-2 align-top text-right"><span className="mono text-[10px] text-ink-3">{f.confidence}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScenariosTab() {
  const report = useXRay((s) => s.report);
  const sim = useXRay((s) => s.simulation);
  const simulate = useXRay((s) => s.simulate);
  const clear = useXRay((s) => s.clearSimulation);
  const graph = useXRay((s) => s.graph);
  const loading = useXRay((s) => s.loading.simulation);
  if (!graph) return null;
  const name = (id: string) => graph.components.find((c) => c.id === id)?.name ?? id;
  const impactTone = (i: string) => (i === "total_outage" || i === "high" ? "text-bad" : i === "partial" ? "text-warn" : "text-ok");
  return (
    <div className="grid h-full grid-cols-[minmax(280px,1fr)_2fr]">
      <div className="overflow-auto border-r border-line p-3">
        <Eyebrow className="mb-2">Scenario catalogue</Eyebrow>
        {!report && <div className="text-xs text-ink-3">Scan first to pre-compute every scenario, or click a component and choose Attack.</div>}
        {report?.scenarioSummaries.map((s) => (
          <button key={s.id} onClick={() => simulate({ kind: s.kind as never, targetId: s.targetId })} disabled={loading} className={clsx("mb-1 flex w-full items-center gap-2 rounded border bg-white px-2 py-1.5 text-left text-xs hover:border-terra", sim && sim.title === s.name ? "border-terra" : "border-line")}>
            <span className="flex-1 truncate">{s.name}</span>
            {s.isSpof && <span className="mono rounded bg-bad px-1 text-[9px] text-white">SPOF</span>}
            <span className={clsx("mono w-24 text-right text-[10px]", impactTone(s.userImpact))}>{s.userImpact.replace("_", " ")}</span>
            <span className="mono w-10 text-right text-[10px] text-ink-3">{s.blastRadiusPct}%</span>
          </button>
        ))}
      </div>
      <div className="overflow-auto p-3">
        {!sim && <Empty title="Attack this component" body="Pick a scenario on the left or click a component on the canvas and press Attack. The dependency chain and blast radius will be highlighted." />}
        {sim && (
          <div>
            <div className="flex items-center gap-3">
              <div className="display text-lg">{sim.title}</div>
              <button className="ml-auto text-[11px] text-ink-3 hover:text-terra" onClick={clear}>clear</button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <Stat label="User impact" value={sim.userImpact.replace("_", " ")} tone={sim.userImpact === "none" || sim.userImpact === "low" ? "ok" : sim.userImpact === "partial" ? "warn" : "bad"} />
              <Stat label="Blast radius" value={`${sim.blastRadiusPct}%`} sub={`${sim.affected.length} components affected`} tone={sim.blastRadiusPct > 50 ? "bad" : sim.blastRadiusPct > 20 ? "warn" : "ok"} />
              <Stat label="Recovery" value={sim.recovery} sub={sim.estimatedRecovery} tone={sim.recovery === "automatic" ? "ok" : sim.recovery === "manual" ? "warn" : "bad"} />
              <Stat label="Single point of failure" value={sim.isSpof ? "yes" : "no"} tone={sim.isSpof ? "bad" : "ok"} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Eyebrow className="mb-1">Dependency chain</Eyebrow>
                <pre className="mono rounded border border-line bg-white p-3 text-[11px] leading-relaxed">{renderChain(sim, name)}</pre>
              </div>
              <div className="space-y-3">
                <div>
                  <Eyebrow className="mb-1">Flows</Eyebrow>
                  {sim.flows.map((f) => (
                    <div key={f.flowId} className="flex items-center gap-2 py-0.5 text-xs">
                      <span className={clsx("mono w-16 text-[10px] uppercase", f.state === "down" ? "text-bad" : f.state === "degraded" ? "text-warn" : "text-ok")}>{f.state}</span>
                      <span className="flex-1">{f.name}</span>
                      {f.brokenAt && <span className="mono text-[10px] text-ink-3">at {f.brokenAt}</span>}
                    </div>
                  ))}
                </div>
                <div>
                  <Eyebrow className="mb-1">Recovery path</Eyebrow>
                  <p className="text-xs text-ink-2">{sim.recoveryPath}</p>
                </div>
                <div>
                  <Eyebrow className="mb-1">Data loss</Eyebrow>
                  <p className="text-xs text-ink-2">{sim.dataLoss}</p>
                </div>
                {sim.notes.length > 0 && (
                  <div>
                    <Eyebrow className="mb-1">Notes</Eyebrow>
                    {sim.notes.map((n, i) => <p key={i} className="flex gap-2 text-xs text-ink-2"><EvidenceChip level="assumption" /><span>{n}</span></p>)}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3">
              <Eyebrow className="mb-1">Affected components</Eyebrow>
              <table className="w-full text-xs">
                <tbody>
                  {sim.affected.map((a) => (
                    <tr key={a.componentId} className="border-t border-line">
                      <td className={clsx("mono w-20 py-1 text-[10px] uppercase", a.state === "down" ? "text-bad" : "text-warn")}>{a.state}</td>
                      <td className="w-44 py-1 font-medium">{a.name}</td>
                      <td className="py-1 text-ink-2">{a.reason}</td>
                      <td className="mono w-12 py-1 text-right text-[10px] text-ink-3">d{a.depth}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function renderChain(sim: { seedIds: string[]; affected: Array<{ componentId: string; state: string; depth: number; viaComponentId?: string }>; userImpact: string; recovery: string; dataLoss: string }, name: (id: string) => string) {
  const lines: string[] = [];
  const byParent = new Map<string, typeof sim.affected>();
  for (const a of sim.affected) {
    if (a.depth === 0) continue;
    const arr = byParent.get(a.viaComponentId ?? "") ?? [];
    arr.push(a);
    byParent.set(a.viaComponentId ?? "", arr);
  }
  const walk = (id: string, indent: string, state: string) => {
    lines.push(`${indent}${name(id)}${state === "down" ? "   X" : state === "degraded" ? "   ~" : ""}`);
    for (const ch of byParent.get(id) ?? []) {
      lines.push(`${indent}   |`);
      walk(ch.componentId, indent + "   ", ch.state);
    }
  };
  for (const seed of sim.seedIds.slice(0, 6)) walk(seed, "", "down");
  if (sim.seedIds.length > 6) lines.push(`... and ${sim.seedIds.length - 6} more seeds`);
  lines.push("", `Affected users: ${sim.userImpact.replace("_", " ").toUpperCase()}`, `Recovery: ${sim.recovery}`, `Data loss: ${sim.dataLoss}`);
  return lines.join("\n");
}

function TracesTab() {
  const graph = useXRay((s) => s.graph);
  const trace = useXRay((s) => s.trace);
  const runTrace = useXRay((s) => s.runTrace);
  const step = useXRay((s) => s.traceStep);
  const setStep = useXRay((s) => s.setTraceStep);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (!auto || !trace || step >= trace.steps.length - 1) return;
    const last = trace.steps.length - 1;
    const t = setTimeout(() => {
      setStep(step + 1);
      if (step + 1 >= last) setAuto(false);
    }, 900);
    return () => clearTimeout(t);
  }, [auto, step, trace, setStep]);
  if (!graph) return null;
  return (
    <div className="grid h-full grid-cols-[minmax(260px,1fr)_2fr]">
      <div className="overflow-auto border-r border-line p-3">
        <Eyebrow className="mb-2">Follow a request</Eyebrow>
        {graph.flows.map((f) => (
          <button key={f.id} onClick={() => { runTrace(f.id); setAuto(true); }} className={clsx("mb-1 block w-full rounded border bg-white px-2 py-1.5 text-left text-xs hover:border-terra", trace?.flowId === f.id ? "border-terra" : "border-line")}>
            <div className="font-medium">{f.name}</div>
            <div className="mono text-[10px] text-ink-3">{f.kind.replace(/_/g, " ")} {f.trafficShare !== undefined && `/ ${Math.round(f.trafficShare * 100)}% of traffic`}</div>
          </button>
        ))}
      </div>
      <div className="overflow-auto p-3">
        {!trace && <Empty title="Follow a request" body="Choose a flow to trace it hop by hop through the architecture. Each step explains what happens, the protocol, boundaries crossed and warnings." />}
        {trace && (
          <div>
            <div className="flex items-center gap-2">
              <div className="display text-lg">{trace.name}</div>
              <span className="mono ml-2 text-[11px] text-ink-3">~{trace.estimatedTotalLatencyMs} ms est. / {trace.syncHops} sync / {trace.asyncHops} async hops</span>
              <div className="ml-auto flex gap-1">
                <Button variant="secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Prev</Button>
                <Button variant="secondary" onClick={() => setStep(Math.min(trace.steps.length - 1, step + 1))} disabled={step >= trace.steps.length - 1}>Next</Button>
                <Button variant="secondary" onClick={() => { setStep(0); setAuto(true); }}>Replay</Button>
              </div>
            </div>
            <p className="mt-1 text-xs text-ink-2">{trace.description}</p>
            <ol className="mt-3 space-y-1">
              {trace.steps.map((s) => (
                <li key={s.index} onClick={() => setStep(s.index)} className={clsx("cursor-pointer rounded border p-2 text-xs transition-colors", s.index === step ? "border-info bg-info-soft" : s.index < step ? "border-line bg-white" : "border-line bg-sand-2 opacity-70")}>
                  <div className="flex items-center gap-2">
                    <span className="mono w-5 text-[10px] text-ink-3">{s.index + 1}</span>
                    <span className="font-medium">{s.componentName}</span>
                    <span className="mono text-[10px] text-ink-3">{s.zoneName}</span>
                    {s.edge && <span className="mono ml-auto text-[10px] text-ink-3">{s.edge.kind.replace(/_/g, " ")} / {s.edge.protocol ?? "?"} / {s.edge.sync}{s.edge.crossesTrustBoundary ? " / crosses trust boundary" : ""}{s.edge.leavesOrganisation ? " / leaves org" : ""}</span>}
                    <span className="mono text-[10px] text-ink-3">~{s.estimatedLatencyMs}ms</span>
                  </div>
                  <div className="mt-1 pl-7 text-ink-2">{s.action}{s.detail ? ` - ${s.detail}` : ""}</div>
                  {s.warnings.length > 0 && <ul className="mt-1 space-y-0.5 pl-7">{s.warnings.map((w, i) => <li key={i} className="text-[11px] text-bad">! {w}</li>)}</ul>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

function ScalabilityTab() {
  const report = useXRay((s) => s.report);
  const selectComponent = useXRay((s) => s.selectComponent);
  if (!report) return <NeedScan />;
  const r = report.scalability;
  return (
    <div className="p-3">
      <div className="flex items-center gap-2">
        <Eyebrow>Baseline {r.baselineRps} rps</Eyebrow>
        <EvidenceChip level={r.baselineEvidence} />
      </div>
      <div className="mt-2 grid grid-cols-5 gap-2">
        {r.tiers.map((t) => (
          <div key={t.multiplier} className={clsx("rounded border p-2", t.saturated.length ? "border-bad/40 bg-bad-soft/40" : "border-line bg-white")}>
            <div className="display text-lg">{t.multiplier}x <span className="mono text-[10px] text-ink-3">{Math.round(t.demandRps)} rps</span></div>
            {t.firstFailure ? (
              <button onClick={() => selectComponent(t.firstFailure!.componentId)} className="mt-1 text-left text-[11px] text-bad hover:underline">fails first: {t.firstFailure.name} ({t.firstFailure.constraint}, {Math.round(t.firstFailure.utilization * 100)}%)</button>
            ) : (
              <div className="mt-1 text-[11px] text-ok">within capacity</div>
            )}
            {t.saturated.length > 1 && <div className="mt-0.5 text-[10px] text-ink-3">+{t.saturated.length - 1} more saturated</div>}
            {(() => {
              const warn = t.points.filter((p) => p.status === "warning").slice(0, 2);
              return warn.length ? <div className="mt-0.5 text-[10px] text-warn">near limit: {warn.map((w) => w.name).join(", ")}</div> : null;
            })()}
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Eyebrow className="mb-1">What breaks first</Eyebrow>
        <ol className="space-y-1">
          {r.breakOrder.map((b, i) => (
            <li key={b.componentId + b.name} className="flex gap-2 text-xs">
              <span className="mono w-5 text-ink-3">{i + 1}</span>
              <span className="mono w-8 text-bad">{b.multiplier}x</span>
              <button onClick={() => selectComponent(b.componentId)} className="w-56 shrink-0 text-left font-medium hover:text-terra">{b.name}</button>
              <span className="text-ink-2">{b.mechanism}</span>
            </li>
          ))}
          {!r.breakOrder.length && <li className="text-xs text-ok">Nothing saturates up to 50x in the model.</li>}
        </ol>
      </div>
      <div className="mt-3">
        <Eyebrow className="mb-1">Capacity table at 10x</Eyebrow>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider text-ink-3"><th className="py-1">Component</th><th>Constraint</th><th className="text-right">Demand</th><th className="text-right">Capacity</th><th className="text-right">Util</th><th>Evidence</th></tr></thead>
          <tbody>
            {r.tiers.find((t) => t.multiplier === 10)?.points.map((p) => (
              <tr key={p.componentId + p.constraint} className="border-t border-line">
                <td className="py-1"><button onClick={() => selectComponent(p.componentId)} className="hover:text-terra">{p.name}</button></td>
                <td className="text-ink-2">{p.constraint}</td>
                <td className="mono text-right">{p.demand.toLocaleString()} {p.unit}</td>
                <td className="mono text-right">{p.capacity.toLocaleString()}</td>
                <td className={clsx("mono text-right", p.status === "saturated" ? "text-bad" : p.status === "warning" ? "text-warn" : "text-ok")}>{Math.round(p.utilization * 100)}%</td>
                <td><EvidenceChip level={p.evidence} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.assumptions.length > 0 && (
        <div className="mt-3">
          <Eyebrow className="mb-1">Assumptions</Eyebrow>
          <ul className="space-y-0.5 text-[11px] text-ink-2">{r.assumptions.map((a, i) => <li key={i}>- {a}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function CostTab() {
  const report = useXRay((s) => s.report);
  const selectFinding = useXRay((s) => s.selectFinding);
  if (!report) return <NeedScan />;
  const c = report.cost;
  const max = Math.max(...c.byCategory.map((x) => x.max), 1);
  return (
    <div className="p-3">
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Monthly (current)" value={`${money(c.monthly.min)} - ${money(c.monthly.max)}`} />
        <Stat label="Annual (current)" value={`${money(c.annual.min)} - ${money(c.annual.max)}`} />
        <Stat label="Monthly (optimised)" value={`${money(c.optimizedMonthly.min)} - ${money(c.optimizedMonthly.max)}`} tone="ok" />
        <Stat label="Identified waste / month" value={`${money(c.optimizations.reduce((a, o) => a + o.savingsMin, 0))} - ${money(c.optimizations.reduce((a, o) => a + o.savingsMax, 0))}`} tone="warn" sub={`${c.optimizations.length} optimisations`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <Eyebrow className="mb-1">By category (max of range)</Eyebrow>
          {c.byCategory.map((b) => (
            <div key={b.category} className="py-0.5 text-xs">
              <div className="flex justify-between"><span className="capitalize">{b.category}</span><span className="mono text-ink-3">{money(b.min)} - {money(b.max)}</span></div>
              <div className="h-1.5 w-full rounded bg-sand-3"><div className="h-1.5 rounded bg-terra" style={{ width: `${(b.max / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <div>
          <Eyebrow className="mb-1">Optimisations</Eyebrow>
          {c.optimizations.map((o) => (
            <button key={o.id} onClick={() => o.findingId && selectFinding(o.findingId)} className="mb-1 block w-full rounded border border-line bg-white p-2 text-left text-xs hover:border-terra">
              <div className="flex justify-between gap-2"><span>{o.title}</span><span className="mono shrink-0 text-ok">-{money(o.savingsMin)} to -{money(o.savingsMax)}</span></div>
              <div className="mt-0.5 text-[10px] text-ink-3">{o.assumption}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <Eyebrow className="mb-1">Line items</Eyebrow>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider text-ink-3"><th className="py-1">Component</th><th>Category</th><th>Model</th><th className="text-right">Monthly</th><th>Basis</th></tr></thead>
          <tbody>
            {c.lines.map((l) => (
              <tr key={l.componentId} className="border-t border-line">
                <td className="py-1">{l.name}</td>
                <td className="capitalize text-ink-2">{l.category}</td>
                <td className="text-ink-2">{l.model}</td>
                <td className="mono text-right">{money(l.min)} - {money(l.max)}</td>
                <td className="flex items-center gap-1"><EvidenceChip level={l.evidence} /><span className="text-[10px] text-ink-3">{l.assumption}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-2 text-[11px] text-ink-3">{c.assumptions.map((a, i) => <li key={i}>- {a}</li>)}</ul>
      </div>
    </div>
  );
}

function OperationsTab() {
  const report = useXRay((s) => s.report);
  if (!report) return <NeedScan />;
  const o = report.operations;
  const tone = o.threeAmVerdict === "yes" ? "ok" : o.threeAmVerdict === "with_difficulty" ? "warn" : "bad";
  return (
    <div className="p-3">
      <div className="grid grid-cols-[260px_1fr] gap-4">
        <Stat label="Can a team operate this at 3 AM?" value={o.threeAmVerdict.replace(/_/g, " ")} tone={tone} />
        <p className="self-center text-xs leading-relaxed text-ink-2">{o.verdictReason}</p>
      </div>
      <div className="mt-3">
        <Eyebrow className="mb-1">Checklist</Eyebrow>
        {o.checklist.map((c) => (
          <div key={c.item} className="flex items-start gap-2 border-t border-line py-1.5 text-xs">
            <span className={clsx("mono w-12 text-[10px] uppercase", c.status === "pass" ? "text-ok" : c.status === "warn" ? "text-warn" : "text-bad")}>{c.status}</span>
            <span className="w-56 font-medium">{c.item}</span>
            <span className="text-ink-2">{c.detail}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div>
          <Eyebrow className="mb-1">Trust boundaries crossed</Eyebrow>
          {report.security.trustBoundaries.map((b) => (
            <div key={b.from + b.to} className="flex items-center gap-2 py-0.5 text-xs">
              <span className="flex-1">{b.from} {"->"} {b.to}</span>
              <span className="mono text-[10px] text-ink-3">{b.edgeIds.length} edges</span>
              <span className={clsx("mono text-[10px]", b.encrypted === true ? "text-ok" : b.encrypted === false ? "text-bad" : "text-ink-3")}>enc:{String(b.encrypted)}</span>
              <span className={clsx("mono text-[10px]", b.authenticated === true ? "text-ok" : b.authenticated === false ? "text-bad" : "text-ink-3")}>auth:{String(b.authenticated)}</span>
            </div>
          ))}
        </div>
        <div>
          <Eyebrow className="mb-1">Attack surface</Eyebrow>
          {report.security.attackSurface.map((a) => (
            <div key={a.componentId} className="flex items-center gap-2 py-0.5 text-xs"><span className="flex-1">{a.name}</span><span className="mono text-[10px] text-ink-3">{a.reason}</span></div>
          ))}
          <Eyebrow className="mb-1 mt-3">Identity flows</Eyebrow>
          {report.security.identityFlows.map((f, i) => <div key={i} className="py-0.5 text-xs text-ink-2">{f}</div>)}
        </div>
      </div>
    </div>
  );
}

function ScoresTab() {
  const report = useXRay((s) => s.report);
  const original = useXRay((s) => s.originalReport);
  const graph = useXRay((s) => s.graph);
  const originalGraph = useXRay((s) => s.originalGraph);
  const applied = useXRay((s) => s.appliedFixes);
  const reset = useXRay((s) => s.resetToOriginal);
  const scan = useXRay((s) => s.scan);
  const before = useMemo(() => (original && applied.length ? original : null), [original, applied]);
  if (!report) return <NeedScan />;
  const beforeDim = (d: string) => before?.scores.dimensions.find((x) => x.dimension === d)?.score;
  const complexityNow = graph ? complexityScore(graph) : 0;
  const complexityBefore = originalGraph ? complexityScore(originalGraph) : complexityNow;
  return (
    <div className="grid h-full grid-cols-[1fr_1fr] gap-4 p-3">
      <div>
        <div className="flex items-center gap-3">
          <Stat label="Destruction score" value={`${report.scores.overall}/100`} tone={report.scores.overall >= 75 ? "ok" : report.scores.overall >= 50 ? "warn" : "bad"} sub={`${report.scores.evidenceSummary.facts} facts / ${report.scores.evidenceSummary.inferences} inferences / ${report.scores.evidenceSummary.assumptions} assumptions / ${report.scores.evidenceSummary.unknowns} unknowns`} />
        </div>
        <div className="mt-2 divide-y divide-line">
          {report.scores.dimensions.map((d) => (
            <ScoreBar key={d.dimension} label={d.dimension === "ai" ? "AI architecture" : d.dimension} score={d.score} confidence={d.confidence} reason={d.reason} applicable={d.applicable} before={beforeDim(d.dimension)} />
          ))}
        </div>
      </div>
      <div>
        <Eyebrow className="mb-2">Before vs after</Eyebrow>
        {!before && (
          <div className="rounded border border-line bg-white p-3 text-xs text-ink-2">
            Open a finding and press <span className="font-medium">Apply fix and re-scan</span>. The engine patches the graph, re-runs every attack and shows the delta here.
          </div>
        )}
        {before && (
          <div>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[10px] uppercase tracking-wider text-ink-3"><th className="py-1">Metric</th><th className="text-right">Before</th><th className="text-right">After</th><th className="text-right">Delta</th></tr></thead>
              <tbody>
                <DiffRow label="Overall" a={before.scores.overall} b={report.scores.overall} />
                {report.scores.dimensions.filter((d) => d.applicable).map((d) => <DiffRow key={d.dimension} label={d.dimension} a={beforeDim(d.dimension) ?? 0} b={d.score} />)}
                <DiffRow label="Findings" a={before.findings.length} b={report.findings.length} invert />
                <DiffRow label="Monthly cost (max)" a={before.cost.monthly.max} b={report.cost.monthly.max} money invert />
                <DiffRow label="Complexity" a={complexityBefore} b={complexityNow} invert />
              </tbody>
            </table>
            <div className="mt-2 text-[11px] text-ink-2">
              Applied: {applied.join(", ")}. {report.cost.monthly.max > before.cost.monthly.max ? "Reliability and security improved at the price of a higher bill and more moving parts - the classic tradeoff." : "Cost did not rise; the fixes were configuration rather than capacity."}
            </div>
            <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={reset}>Reset to original</Button><Button variant="secondary" onClick={scan}>Re-scan</Button></div>
          </div>
        )}
        <div className="mt-4 rounded border border-line bg-sand-2 p-3 text-[11px] text-ink-2">
          <div className="mb-1 font-medium text-ink">How scores are computed</div>
          Each dimension starts at 100 and loses points per finding (severity x relevance), with diminishing penalties for repeated categories. Confidence reflects the share of FACT evidence behind the contributing findings. AI is scored only when AI components exist.
          <div className="mt-1"><ConfidenceChip confidence={report.scores.dimensions[0].confidence} /></div>
        </div>
      </div>
    </div>
  );
}

function DiffRow({ label, a, b, invert, money: isMoney }: { label: string; a: number; b: number; invert?: boolean; money?: boolean }) {
  const delta = b - a;
  const good = invert ? delta < 0 : delta > 0;
  const fmt = (n: number) => (isMoney ? money(n) : String(n));
  return (
    <tr className="border-t border-line">
      <td className="py-1 capitalize">{label}</td>
      <td className="mono text-right">{fmt(a)}</td>
      <td className="mono text-right">{fmt(b)}</td>
      <td className={clsx("mono text-right", delta === 0 ? "text-ink-3" : good ? "text-ok" : "text-bad")}>{delta > 0 ? "+" : ""}{fmt(delta)}</td>
    </tr>
  );
}
