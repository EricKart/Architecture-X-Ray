import {
  ArchitectureGraph,
  Component,
  Edge,
  NetworkZone,
  RUNTIME_DEPENDENCY_KINDS,
} from "./types";

/**
 * Indexed view over an ArchitectureGraph. Built once per analysis run so the
 * engines can ask structural questions cheaply.
 */
export class GraphIndex {
  readonly graph: ArchitectureGraph;
  readonly components = new Map<string, Component>();
  readonly edges = new Map<string, Edge>();
  readonly zones = new Map<string, NetworkZone>();
  /** edges where component is the source (component NEEDS target). */
  readonly outgoing = new Map<string, Edge[]>();
  /** edges where component is the target (source NEEDS component). */
  readonly incoming = new Map<string, Edge[]>();

  constructor(graph: ArchitectureGraph) {
    this.graph = graph;
    for (const c of graph.components) this.components.set(c.id, c);
    for (const z of graph.zones) this.zones.set(z.id, z);
    for (const e of graph.edges) {
      this.edges.set(e.id, e);
      push(this.outgoing, e.source, e);
      push(this.incoming, e.target, e);
    }
  }

  component(id: string): Component {
    const c = this.components.get(id);
    if (!c) throw new Error(`Unknown component: ${id}`);
    return c;
  }

  zoneOf(componentId: string): NetworkZone | undefined {
    const c = this.components.get(componentId);
    return c ? this.zones.get(c.zoneId) : undefined;
  }

  /** Components this component depends on at runtime. */
  dependencies(id: string): Edge[] {
    return (this.outgoing.get(id) ?? []).filter((e) => RUNTIME_DEPENDENCY_KINDS.has(e.kind));
  }

  /** Components that depend on this component at runtime. */
  dependents(id: string): Edge[] {
    return (this.incoming.get(id) ?? []).filter((e) => RUNTIME_DEPENDENCY_KINDS.has(e.kind));
  }

  byType(...types: Component["type"][]): Component[] {
    const set = new Set(types);
    return this.graph.components.filter((c) => set.has(c.type));
  }

  byLayer(...layers: Component["layer"][]): Component[] {
    const set = new Set(layers);
    return this.graph.components.filter((c) => set.has(c.layer));
  }

  clients(): Component[] {
    return this.byType("client");
  }

  /** True when the edge crosses between zones of different trust levels. */
  crossesTrustBoundary(edge: Edge): boolean {
    const a = this.zoneOf(edge.source);
    const b = this.zoneOf(edge.target);
    if (!a || !b) return false;
    return a.id !== b.id && a.trustLevel !== b.trustLevel;
  }

  crossesZone(edge: Edge): boolean {
    const a = this.zoneOf(edge.source);
    const b = this.zoneOf(edge.target);
    return !!a && !!b && a.id !== b.id;
  }

  /** Whether the target is external SaaS relative to the source. */
  leavesOrganisation(edge: Edge): boolean {
    const b = this.zoneOf(edge.target);
    return b?.kind === "external_saas";
  }

  /**
   * Shortest path from any client (or any component in an internet zone) to
   * `targetId`, following edge direction (attacker moves along request flow).
   */
  attackPath(targetId: string): string[] | null {
    const starts = this.graph.components
      .filter((c) => c.type === "client" || this.zones.get(c.zoneId)?.kind === "internet")
      .map((c) => c.id);
    return this.shortestPath(starts, targetId, (e) => RUNTIME_DEPENDENCY_KINDS.has(e.kind));
  }

  shortestPath(starts: string[], goal: string, allow: (e: Edge) => boolean): string[] | null {
    const prev = new Map<string, string | null>();
    const queue: string[] = [];
    for (const s of starts) {
      prev.set(s, null);
      queue.push(s);
    }
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === goal) return this.unwind(prev, goal);
      for (const e of this.outgoing.get(cur) ?? []) {
        if (!allow(e) || prev.has(e.target)) continue;
        prev.set(e.target, cur);
        queue.push(e.target);
      }
    }
    return null;
  }

  private unwind(prev: Map<string, string | null>, goal: string): string[] {
    const out: string[] = [];
    let cur: string | null | undefined = goal;
    while (cur) {
      out.unshift(cur);
      cur = prev.get(cur) ?? null;
    }
    return out;
  }

  /** Is the component reachable from the public internet along request edges? */
  publiclyReachable(id: string): boolean {
    const c = this.components.get(id);
    if (!c) return false;
    if (c.exposure === "public" || c.security.publicEndpoint) return true;
    return this.attackPath(id) !== null;
  }

  /** All components upstream of `id` on the request path (i.e. that call it, transitively). */
  transitiveDependents(id: string): Set<string> {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of this.dependents(cur)) {
        if (!seen.has(e.source)) {
          seen.add(e.source);
          stack.push(e.source);
        }
      }
    }
    return seen;
  }

  transitiveDependencies(id: string): Set<string> {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of this.dependencies(cur)) {
        if (!seen.has(e.target)) {
          seen.add(e.target);
          stack.push(e.target);
        }
      }
    }
    return seen;
  }

  /** Flows that pass through the component. */
  flowsThrough(id: string) {
    return this.graph.flows.filter((f) => f.steps.some((s) => s.componentId === id));
  }

  /** Whether a component of the given type sits upstream of `id` on any client path. */
  hasUpstreamOfType(id: string, type: Component["type"]): boolean {
    const upstream = this.transitiveDependents(id);
    for (const u of upstream) if (this.components.get(u)?.type === type) return true;
    return false;
  }

  hasAi(): boolean {
    return this.graph.components.some(
      (c) => c.ai || ["llm_provider", "embedding_service", "vector_db", "ml_inference", "llm_gateway"].includes(c.type),
    );
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

export function indexGraph(graph: ArchitectureGraph): GraphIndex {
  return new GraphIndex(graph);
}

export function componentNames(graph: ArchitectureGraph, ids: string[]): string[] {
  const map = new Map(graph.components.map((c) => [c.id, c.name]));
  return ids.map((id) => map.get(id) ?? id);
}
