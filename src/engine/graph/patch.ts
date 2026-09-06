import type { ArchitectureGraph, Component, Edge } from "./types";
import type { DeepPartial, GraphPatch } from "../analysis/types";
import { cloneGraph } from "./builder";

/**
 * Applies a GraphPatch (a finding's proposed fix) to a graph, returning a new
 * graph. Patches are additive/declarative so they can be replayed and diffed.
 */
export function applyPatch(graph: ArchitectureGraph, patch: GraphPatch): ArchitectureGraph {
  const g = cloneGraph(graph);

  if (patch.removeEdgeIds?.length) {
    const remove = new Set(patch.removeEdgeIds);
    g.edges = g.edges.filter((e) => !remove.has(e.id));
    for (const f of g.flows) for (const s of f.steps) if (s.edgeId && remove.has(s.edgeId)) delete s.edgeId;
  }
  if (patch.removeComponentIds?.length) {
    const remove = new Set(patch.removeComponentIds);
    g.components = g.components.filter((c) => !remove.has(c.id));
    g.edges = g.edges.filter((e) => !remove.has(e.source) && !remove.has(e.target));
    for (const f of g.flows) f.steps = f.steps.filter((s) => !remove.has(s.componentId));
  }
  for (const c of patch.upsertComponents ?? []) {
    const idx = g.components.findIndex((x) => x.id === c.id);
    if (idx >= 0) g.components[idx] = c;
    else g.components.push(c);
  }
  for (const u of patch.updateComponents ?? []) {
    const idx = g.components.findIndex((x) => x.id === u.id);
    if (idx >= 0) g.components[idx] = deepMerge(g.components[idx], u.patch);
  }
  for (const e of patch.upsertEdges ?? []) {
    const idx = g.edges.findIndex((x) => x.id === e.id);
    if (idx >= 0) g.edges[idx] = e;
    else g.edges.push(e);
  }
  for (const u of patch.updateEdges ?? []) {
    const idx = g.edges.findIndex((x) => x.id === u.id);
    if (idx >= 0) g.edges[idx] = { ...g.edges[idx], ...u.patch } as Edge;
  }
  if (patch.addAssumptions?.length) g.assumptions = [...g.assumptions, ...patch.addAssumptions];
  g.metadata = { ...(g.metadata ?? {}), lastPatch: patch.description };
  return g;
}

export function applyPatches(graph: ArchitectureGraph, patches: GraphPatch[]): ArchitectureGraph {
  return patches.reduce((g, p) => applyPatch(g, p), graph);
}

function deepMerge(base: Component, patch: DeepPartial<Component>): Component {
  const out: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = (base as unknown as Record<string, unknown>)[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      out[key] = { ...(existing as object), ...(value as object) };
    } else {
      out[key] = value;
    }
  }
  return out as unknown as Component;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
