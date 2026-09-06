"use client";
import { useEffect } from "react";
import clsx from "clsx";
import { useXRay } from "@/lib/store";
import { ArchitectureCanvas } from "@/components/canvas/ArchitectureCanvas";
import { RightPanel } from "@/components/panels/RightPanel";
import { BottomPanel } from "@/components/panels/BottomPanel";
import { Button } from "@/components/ui";

export function AppShell() {
  const mode = useXRay((s) => s.mode);
  const setMode = useXRay((s) => s.setMode);
  const graph = useXRay((s) => s.graph);
  const report = useXRay((s) => s.report);
  const loadDemo = useXRay((s) => s.loadDemo);
  const scan = useXRay((s) => s.scan);
  const loading = useXRay((s) => s.loading);
  const error = useXRay((s) => s.error);
  const scanProgress = useXRay((s) => s.scanProgress);
  const appliedFixes = useXRay((s) => s.appliedFixes);
  const simulation = useXRay((s) => s.simulation);
  const trace = useXRay((s) => s.trace);
  const clearSimulation = useXRay((s) => s.clearSimulation);
  const clearTrace = useXRay((s) => s.clearTrace);

  useEffect(() => {
    if (!graph) void loadDemo();
  }, [graph, loadDemo]);

  return (
    <div className="flex h-screen flex-col bg-sand">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-white px-4">
        <div className="flex items-baseline gap-2">
          <span className="display text-base font-semibold tracking-tight">Architecture X-Ray</span>
          <span className="eyebrow hidden sm:inline">by Aryan Tripathi</span>
        </div>
        <nav className="ml-4 flex rounded border border-line p-0.5">
          {(["architect", "destruction"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={clsx("rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors", mode === m ? "bg-ink text-sand" : "text-ink-3 hover:text-ink")}>
              {m}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {graph && <span className="mono hidden text-[11px] text-ink-3 lg:inline">{graph.name}{appliedFixes.length ? ` (+${appliedFixes.length} fix${appliedFixes.length > 1 ? "es" : ""})` : ""}</span>}
          {(simulation || trace) && <Button variant="ghost" onClick={() => { clearSimulation(); clearTrace(); }}>Clear overlay</Button>}
          <Button variant="secondary" onClick={loadDemo} disabled={loading.graph}>Load demo</Button>
          {mode === "destruction" && (
            <Button onClick={scan} disabled={!graph || loading.analysis}>{loading.analysis ? "Scanning..." : report ? "Re-scan" : "Scan demo architecture"}</Button>
          )}
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-3 border-b border-bad/30 bg-bad-soft px-4 py-1.5 text-xs text-bad">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {mode === "architect" ? (
        <ArchitectPlaceholder />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_380px] grid-rows-[minmax(0,1fr)_300px]">
          <main className="relative min-h-0 border-r border-line">
            {!graph && (
              <div className="flex h-full items-center justify-center text-xs text-ink-3">{loading.graph ? "Loading demo architecture..." : "No architecture loaded."}</div>
            )}
            {graph && <ArchitectureCanvas />}
            {loading.analysis && (
              <div className="absolute inset-x-0 bottom-0 border-t border-line bg-white/95 p-3 backdrop-blur">
                <div className="eyebrow mb-1">Destruction engine</div>
                <ol className="mono space-y-0.5 text-[11px]">
                  {scanProgress.map((s, i) => <li key={i} className="text-ink-2">{i + 1}. {s}</li>)}
                  <li className="text-terra">{scanProgress.length + 1}. ...</li>
                </ol>
              </div>
            )}
            {graph && !report && !loading.analysis && (
              <div className="pointer-events-none absolute left-3 top-3 rounded border border-line bg-white/90 px-3 py-2 text-xs text-ink-2 shadow-sm">
                <span className="font-medium text-ink">Destruction mode.</span> Press <span className="font-medium">Scan demo architecture</span> to find what breaks, or click any component and attack it.
              </div>
            )}
            <Legend />
          </main>
          <aside className="min-h-0 overflow-auto bg-white"><RightPanel /></aside>
          <section className="col-span-2 min-h-0 border-t border-line bg-white"><BottomPanel /></section>
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 flex gap-3 rounded border border-line bg-white/90 px-2 py-1 text-[10px] text-ink-3">
      <span><span className="mr-1 inline-block h-2 w-4 border-t-2 border-line-2 align-middle" />sync</span>
      <span><span className="mr-1 inline-block h-2 w-4 border-t-2 border-dashed border-line-2 align-middle" />async</span>
      <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-bad align-middle" />down</span>
      <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-warn align-middle" />degraded</span>
      <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-info align-middle" />trace</span>
    </div>
  );
}

function ArchitectPlaceholder() {
  const setMode = useXRay((s) => s.setMode);
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-lg text-center">
        <div className="eyebrow">Architect mode</div>
        <div className="display mt-2 text-2xl">Requirements to architecture</div>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Architect mode collects business, traffic, reliability, data, security, AI and operations requirements and generates a complete architecture with a component inventory, request flows, decision records, cost model and the same destruction analysis. It is the next slice of this build and is not wired yet.
        </p>
        <div className="mt-4"><Button onClick={() => setMode("destruction")}>Go to Destruction mode</Button></div>
      </div>
    </div>
  );
}
