"use client";
import { create } from "zustand";
import type { ArchitectureGraph } from "@/engine/graph/types";
import type { AnalysisReport, Finding, GraphPatch } from "@/engine/analysis/types";
import type { FailureResult, FailureScenario } from "@/engine/simulation/failure";
import type { RequestTrace } from "@/engine/simulation/trace";
import { api } from "./api";

export type Mode = "architect" | "destruction";
export type BottomTab = "findings" | "scenarios" | "traces" | "scalability" | "cost" | "scores" | "operations";

interface XRayState {
  mode: Mode;
  graph: ArchitectureGraph | null;
  originalGraph: ArchitectureGraph | null;
  originalReport: AnalysisReport | null;
  report: AnalysisReport | null;
  appliedFixes: string[];
  selectedComponentId: string | null;
  selectedFindingId: string | null;
  simulation: FailureResult | null;
  trace: RequestTrace | null;
  traceStep: number;
  bottomTab: BottomTab;
  loading: { graph: boolean; analysis: boolean; simulation: boolean; trace: boolean; fix: boolean };
  error: string | null;
  scanProgress: string[];

  setMode: (m: Mode) => void;
  loadDemo: () => Promise<void>;
  setGraph: (g: ArchitectureGraph, opts?: { resetOriginal?: boolean }) => void;
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

export const useXRay = create<XRayState>((set, get) => ({
  mode: "destruction",
  graph: null,
  originalGraph: null,
  originalReport: null,
  report: null,
  appliedFixes: [],
  selectedComponentId: null,
  selectedFindingId: null,
  simulation: null,
  trace: null,
  traceStep: 0,
  bottomTab: "findings",
  loading: { graph: false, analysis: false, simulation: false, trace: false, fix: false },
  error: null,
  scanProgress: [],

  setMode: (mode) => set({ mode }),

  loadDemo: async () => {
    set((s) => ({ loading: { ...s.loading, graph: true }, error: null }));
    try {
      const { graph } = await api.demo();
      get().setGraph(graph, { resetOriginal: true });
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
      appliedFixes: opts?.resetOriginal ? [] : s.appliedFixes,
      selectedComponentId: null,
      selectedFindingId: null,
      simulation: null,
      trace: null,
      scanProgress: [],
    })),

  scan: async () => {
    const graph = get().graph;
    if (!graph) return;
    set((s) => ({ loading: { ...s.loading, analysis: true }, error: null, scanProgress: [], report: null, simulation: null, trace: null }));
    // Progress ticker so the scan reads as a sequence of attacks; the engines themselves run server-side in one call.
    let i = 0;
    const ticker = setInterval(() => {
      if (i < SCAN_STEPS.length - 1) set((s) => ({ scanProgress: [...s.scanProgress, SCAN_STEPS[i++]] }));
    }, 220);
    try {
      const { report } = await api.analyze(graph);
      clearInterval(ticker);
      set((s) => ({ report, scanProgress: SCAN_STEPS, bottomTab: "findings", originalReport: s.originalReport ?? (s.appliedFixes.length ? s.originalReport : report) }));
    } catch (e) {
      clearInterval(ticker);
      set({ error: (e as Error).message });
    } finally {
      set((s) => ({ loading: { ...s.loading, analysis: false } }));
    }
  },

  selectComponent: (id) => set({ selectedComponentId: id, selectedFindingId: null }),
  selectFinding: (id) => {
    const f = get().report?.findings.find((x) => x.id === id);
    set({ selectedFindingId: id, selectedComponentId: f?.affectedComponentIds[0] ?? get().selectedComponentId, trace: null });
  },

  simulate: async (scenario) => {
    const graph = get().graph;
    if (!graph) return;
    set((s) => ({ loading: { ...s.loading, simulation: true }, error: null, trace: null }));
    try {
      const { result } = await api.simulate(graph, scenario);
      set({ simulation: result, bottomTab: "scenarios" });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set((s) => ({ loading: { ...s.loading, simulation: false } }));
    }
  },
  clearSimulation: () => set({ simulation: null }),

  runTrace: async (flowId) => {
    const graph = get().graph;
    if (!graph) return;
    set((s) => ({ loading: { ...s.loading, trace: true }, error: null, simulation: null }));
    try {
      const { trace } = await api.trace(graph, flowId);
      set({ trace, traceStep: 0, bottomTab: "traces", selectedFindingId: null });
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
    const graph = get().graph;
    if (!graph || !finding.fix) return;
    set((s) => ({ loading: { ...s.loading, fix: true }, error: null }));
    try {
      const patch: GraphPatch = finding.fix;
      const { graph: next, report } = await api.fix(graph, patch);
      set((s) => ({
        graph: next,
        report,
        originalReport: s.originalReport ?? s.report,
        appliedFixes: [...s.appliedFixes, finding.id],
        selectedFindingId: null,
        simulation: null,
        trace: null,
      }));
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
}));
