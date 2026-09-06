"use client";
import { create } from "zustand";
import type { ArchitectureGraph } from "@/engine/graph/types";
import type { AnalysisReport, Finding, GraphPatch } from "@/engine/analysis/types";
import type { FailureResult, FailureScenario } from "@/engine/simulation/failure";
import type { RequestTrace } from "@/engine/simulation/trace";
import type { Requirements, InferredValue } from "@/engine/architect/requirements";
import { DEFAULT_REQUIREMENTS } from "@/engine/architect/requirements";
import type { ArchitectPackage } from "@/engine/architect";
import type { IngestInput } from "@/engine/ingestion";
import { api } from "./api";

export type Mode = "architect" | "destruction";
export type BottomTab = "findings" | "scenarios" | "traces" | "scalability" | "cost" | "operations" | "scores";
export type ArchitectTab = "inventory" | "flows" | "decisions" | "cost" | "analysis" | "scalability" | "operations" | "plans" | "compare";

interface ArchitectSlice {
  brief: string;
  requirements: Requirements;
  inferred: InferredValue[];
  pkg: ArchitectPackage | null;
  tab: ArchitectTab;
  loading: boolean;
  error: string | null;
}

interface XRayState {
  mode: Mode;
  aiAvailable: boolean | null;
  /** Destruction-mode graph (demo or ingested). */
  graph: ArchitectureGraph | null;
  originalGraph: ArchitectureGraph | null;
  originalReport: AnalysisReport | null;
  report: AnalysisReport | null;
  ingestInfo: { method: string; warnings: string[] } | null;
  appliedFixes: string[];
  selectedComponentId: string | null;
  selectedFindingId: string | null;
  simulation: FailureResult | null;
  trace: RequestTrace | null;
  traceStep: number;
  bottomTab: BottomTab;
  loading: { graph: boolean; analysis: boolean; simulation: boolean; trace: boolean; fix: boolean; ingest: boolean };
  error: string | null;
  scanProgress: string[];
  importOpen: boolean;
  architect: ArchitectSlice;

  setMode: (m: Mode) => void;
  checkHealth: () => Promise<void>;
  loadDemo: () => Promise<void>;
  setGraph: (g: ArchitectureGraph, opts?: { resetOriginal?: boolean; ingestInfo?: { method: string; warnings: string[] } | null }) => void;
  importGraph: (input: IngestInput) => Promise<boolean>;
  setImportOpen: (open: boolean) => void;
  scan: () => Promise<void>;
  selectComponent: (id: string | null) => void;
  selectFinding: (id: string | null) => void;
  simulate: (scenario: FailureScenario) => Promise<void>;
  clearSimulation: () => void;
  runTrace: (flowId: string) => Promise<void>;
  setTraceStep: (n: number) => void;
  clearTrace: () => void;
  setBottomTab: (t: BottomTab) => void;
  applyFix: (finding: Finding) => Promise<void>;
  resetToOriginal: () => void;

  setBrief: (brief: string) => void;
  setRequirements: (r: Requirements) => void;
  inferFromBrief: () => Promise<void>;
  generate: () => Promise<void>;
  setArchitectTab: (t: ArchitectTab) => void;
  sendProposalToDestruction: () => void;
}

const SCAN_STEPS = [
  "Indexing graph: components, edges, zones, flows",
  "Reliability attack: failing every critical component, zone, region, DNS, certificates, egress, providers",
  "Scalability attack: capacity model at 1x / 2x / 5x / 10x / 50x",
  "Security attack: trust boundaries, exposure, secrets, privileges, AI data paths",
  "Cost attack: estimating spend and hunting waste",
  "Operational attack: could a team run this at 3 AM?",
  "AI architecture attack: providers, rate limits, vector index, model pinning",
  "Scoring and ranking findings",
];

const emptyLoading = { graph: false, analysis: false, simulation: false, trace: false, fix: false, ingest: false };

export const useXRay = create<XRayState>((set, get) => {
  /** The graph the canvas and panels are showing right now (mode-aware). */
  const active = () => {
    const s = get();
    return s.mode === "architect" ? s.architect.pkg?.graph ?? null : s.graph;
  };
  const setActiveGraphAndReport = (graph: ArchitectureGraph, report: AnalysisReport) => {
    const s = get();
    if (s.mode === "architect" && s.architect.pkg) set({ architect: { ...s.architect, pkg: { ...s.architect.pkg, graph, report } } });
    else set({ graph, report });
  };

  return {
    mode: "destruction",
    aiAvailable: null,
    graph: null,
    originalGraph: null,
    originalReport: null,
    report: null,
    ingestInfo: null,
    appliedFixes: [],
    selectedComponentId: null,
    selectedFindingId: null,
    simulation: null,
    trace: null,
    traceStep: 0,
    bottomTab: "findings",
    loading: emptyLoading,
    error: null,
    scanProgress: [],
    importOpen: false,
    architect: { brief: "", requirements: DEFAULT_REQUIREMENTS, inferred: [], pkg: null, tab: "inventory", loading: false, error: null },

    setMode: (mode) => set({ mode, selectedComponentId: null, selectedFindingId: null, simulation: null, trace: null, error: null }),

    checkHealth: async () => {
      try {
        const h = await api.health();
        set({ aiAvailable: h.ai });
      } catch {
        set({ aiAvailable: false });
      }
    },

    loadDemo: async () => {
      set((s) => ({ loading: { ...s.loading, graph: true }, error: null }));
      try {
        const { graph } = await api.demo();
        get().setGraph(graph, { resetOriginal: true, ingestInfo: null });
      } catch (e) {
        set({ error: (e as Error).message });
      } finally {
        set((s) => ({ loading: { ...s.loading, graph: false } }));
      }
    },

    setGraph: (graph, opts) =>
      set((s) => ({
        graph,
        originalGraph: opts?.resetOriginal ? graph : s.originalGraph ?? graph,
        originalReport: opts?.resetOriginal ? null : s.originalReport,
        report: null,
        ingestInfo: opts?.ingestInfo === undefined ? s.ingestInfo : opts.ingestInfo,
        appliedFixes: opts?.resetOriginal ? [] : s.appliedFixes,
        selectedComponentId: null,
        selectedFindingId: null,
        simulation: null,
        trace: null,
        scanProgress: [],
        mode: "destruction",
      })),

    importGraph: async (input) => {
      set((s) => ({ loading: { ...s.loading, ingest: true }, error: null }));
      try {
        const r = await api.ingest(input);
        get().setGraph(r.graph, { resetOriginal: true, ingestInfo: { method: r.method, warnings: r.warnings } });
        set({ importOpen: false });
        return true;
      } catch (e) {
        set({ error: (e as Error).message });
        return false;
      } finally {
        set((s) => ({ loading: { ...s.loading, ingest: false } }));
      }
    },
    setImportOpen: (importOpen) => set({ importOpen }),

    scan: async () => {
      const graph = active();
      if (!graph) return;
      set((s) => ({ loading: { ...s.loading, analysis: true }, error: null, scanProgress: [], simulation: null, trace: null, ...(s.mode === "destruction" ? { report: null } : {}) }));
      let i = 0;
      const ticker = setInterval(() => {
        if (i < SCAN_STEPS.length - 1) set((s) => ({ scanProgress: [...s.scanProgress, SCAN_STEPS[i++]] }));
      }, 220);
      try {
        const { report } = await api.analyze(graph);
        clearInterval(ticker);
        setActiveGraphAndReport(graph, report);
        set({ scanProgress: SCAN_STEPS, bottomTab: "findings" });
      } catch (e) {
        clearInterval(ticker);
        set({ error: (e as Error).message });
      } finally {
        set((s) => ({ loading: { ...s.loading, analysis: false } }));
      }
    },

    selectComponent: (id) => set({ selectedComponentId: id, selectedFindingId: null }),
    selectFinding: (id) => {
      const s = get();
      const report = s.mode === "architect" ? s.architect.pkg?.report : s.report;
      const f = report?.findings.find((x) => x.id === id);
      set({ selectedFindingId: id, selectedComponentId: f?.affectedComponentIds[0] ?? s.selectedComponentId, trace: null });
    },

    simulate: async (scenario) => {
      const graph = active();
      if (!graph) return;
      set((s) => ({ loading: { ...s.loading, simulation: true }, error: null, trace: null }));
      try {
        const { result } = await api.simulate(graph, scenario);
        set((s) => ({ simulation: result, bottomTab: "scenarios", architect: { ...s.architect, tab: "analysis" } }));
      } catch (e) {
        set({ error: (e as Error).message });
      } finally {
        set((s) => ({ loading: { ...s.loading, simulation: false } }));
      }
    },
    clearSimulation: () => set({ simulation: null }),

    runTrace: async (flowId) => {
      const graph = active();
      if (!graph) return;
      set((s) => ({ loading: { ...s.loading, trace: true }, error: null, simulation: null }));
      try {
        const { trace } = await api.trace(graph, flowId);
        set((s) => ({ trace, traceStep: 0, bottomTab: "traces", selectedFindingId: null, architect: { ...s.architect, tab: "flows" } }));
      } catch (e) {
        set({ error: (e as Error).message });
      } finally {
        set((s) => ({ loading: { ...s.loading, trace: false } }));
      }
    },
    setTraceStep: (n) => set({ traceStep: n }),
    clearTrace: () => set({ trace: null }),
    setBottomTab: (bottomTab) => set({ bottomTab }),

    applyFix: async (finding) => {
      const graph = active();
      if (!graph || !finding.fix) return;
      set((s) => ({ loading: { ...s.loading, fix: true }, error: null }));
      try {
        const patch: GraphPatch = finding.fix;
        const { graph: next, report } = await api.fix(graph, patch);
        const s = get();
        if (s.mode === "destruction") set({ originalReport: s.originalReport ?? s.report });
        setActiveGraphAndReport(next, report);
        set((st) => ({ appliedFixes: [...st.appliedFixes, finding.id], selectedFindingId: null, simulation: null, trace: null }));
      } catch (e) {
        set({ error: (e as Error).message });
      } finally {
        set((s) => ({ loading: { ...s.loading, fix: false } }));
      }
    },

    resetToOriginal: () => {
      const g = get().originalGraph;
      if (!g) return;
      set({ graph: g, report: null, originalReport: null, appliedFixes: [], simulation: null, trace: null, selectedFindingId: null });
    },

    setBrief: (brief) => set((s) => ({ architect: { ...s.architect, brief } })),
    setRequirements: (requirements) => set((s) => ({ architect: { ...s.architect, requirements } })),
    inferFromBrief: async () => {
      const { brief, requirements } = get().architect;
      set((s) => ({ architect: { ...s.architect, loading: true, error: null } }));
      try {
        const r = await api.infer(brief, requirements);
        set((s) => ({ architect: { ...s.architect, requirements: r.requirements, inferred: r.inferred } }));
      } catch (e) {
        set((s) => ({ architect: { ...s.architect, error: (e as Error).message } }));
      } finally {
        set((s) => ({ architect: { ...s.architect, loading: false } }));
      }
    },
    generate: async () => {
      const { requirements } = get().architect;
      set((s) => ({ architect: { ...s.architect, loading: true, error: null, pkg: null }, selectedComponentId: null, selectedFindingId: null, simulation: null, trace: null }));
      try {
        const r = await api.generate(requirements);
        set((s) => ({ architect: { ...s.architect, pkg: r.package, tab: "inventory" } }));
      } catch (e) {
        set((s) => ({ architect: { ...s.architect, error: (e as Error).message } }));
      } finally {
        set((s) => ({ architect: { ...s.architect, loading: false } }));
      }
    },
    setArchitectTab: (tab) => set((s) => ({ architect: { ...s.architect, tab } })),
    sendProposalToDestruction: () => {
      const pkg = get().architect.pkg;
      if (!pkg) return;
      get().setGraph(pkg.graph, { resetOriginal: true, ingestInfo: { method: "architect", warnings: [] } });
    },
  };
});

/** Graph currently shown on the canvas (mode-aware). */
export const useActiveGraph = () => useXRay((s) => (s.mode === "architect" ? s.architect.pkg?.graph ?? null : s.graph));
/** Analysis report for the graph currently shown (mode-aware). */
export const useActiveReport = () => useXRay((s) => (s.mode === "architect" ? s.architect.pkg?.report ?? null : s.report));
