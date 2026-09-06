import type { ArchitectureGraph, Component, Edge } from "../graph/types";
import { GraphIndex, indexGraph } from "../graph/queries";
import type { UserImpact } from "../analysis/types";

/**
 * Failure simulation ("Attack this component").
 *
 * Marks seed components as down and propagates along runtime dependency
 * edges (source NEEDS target):
 *   target DOWN + hard/sync edge, no fallback  -> source DOWN
 *   target DOWN + hard/async, soft, or fallback -> source DEGRADED
 *   target DEGRADED + hard edge                 -> source DEGRADED
 * Flows are then evaluated to estimate user impact.
 */

export type ScenarioKind =
  | "component"
  | "availability_zone"
  | "region"
  | "dns"
  | "certificate"
  | "network_egress"
  | "identity_provider"
  | "ai_provider";

export interface FailureScenario {
  kind: ScenarioKind;
  /** component id, AZ id, or region id depending on kind. */
  targetId?: string;
}

export type ComponentState = "ok" | "degraded" | "down";

export interface AffectedComponent {
  componentId: string;
  name: string;
  state: ComponentState;
  reason: string;
  depth: number;
  viaEdgeId?: string;
  viaComponentId?: string;
}

export interface FlowImpact {
  flowId: string;
  name: string;
  state: ComponentState;
  brokenAt?: string;
}

export interface FailureResult {
  scenario: FailureScenario;
  title: string;
  seedIds: string[];
  affected: AffectedComponent[];
  flows: FlowImpact[];
  /** Percentage of components (criticality-weighted) that are down or degraded. */
  blastRadiusPct: number;
  userImpact: UserImpact;
  recovery: "automatic" | "manual" | "none";
  recoveryPath: string;
  estimatedRecovery: string;
  dataLoss: string;
  isSpof: boolean;
  /** Ordered chain for the visualisation: seed -> dependents. */
  chain: Array<{ componentId: string; depth: number; state: ComponentState }>;
  notes: string[];
}

const CRIT_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 } as const;

export function simulateFailure(graph: ArchitectureGraph, scenario: FailureScenario): FailureResult {
  const idx = indexGraph(graph);
  const states = new Map<string, AffectedComponent>();
  const notes: string[] = [];

  const seeds = seedsFor(idx, scenario, states, notes);
  propagate(idx, states, seeds);

  const affected = [...states.values()].sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
  const flows = evaluateFlows(idx, states);
  const blastRadiusPct = blastRadius(graph, states);
  const userImpact = userImpactFrom(flows, idx, states);
  const seedComponents = seeds.map((id) => idx.components.get(id)).filter(Boolean) as Component[];
  const primary = seedComponents[0];
  const { recovery, recoveryPath, estimatedRecovery, dataLoss } = recoveryFor(scenario, seedComponents);
  const isSpof =
    scenario.kind === "component" && !!primary && primary.redundancy.replicas <= 1 &&
    primary.redundancy.failover !== "automatic" && flows.some((f) => f.state === "down");

  return {
    scenario,
    title: titleFor(scenario, idx),
    seedIds: seeds,
    affected,
    flows,
    blastRadiusPct,
    userImpact,
    recovery,
    recoveryPath,
    estimatedRecovery,
    dataLoss,
    isSpof,
    chain: affected.map((a) => ({ componentId: a.componentId, depth: a.depth, state: a.state })),
    notes,
  };
}

function setState(states: Map<string, AffectedComponent>, c: Component, state: ComponentState, reason: string, depth: number, via?: Edge) {
  const existing = states.get(c.id);
  if (existing && rank(existing.state) >= rank(state)) return false;
  states.set(c.id, {
    componentId: c.id,
    name: c.name,
    state,
    reason,
    depth,
    viaEdgeId: via?.id,
    viaComponentId: via?.target,
  });
  return true;
}

function rank(s: ComponentState) {
  return s === "down" ? 2 : s === "degraded" ? 1 : 0;
}

function seedsFor(idx: GraphIndex, scenario: FailureScenario, states: Map<string, AffectedComponent>, notes: string[]): string[] {
  const g = idx.graph;
  const seeds: string[] = [];
  switch (scenario.kind) {
    case "component": {
      const c = idx.component(scenario.targetId!);
      setState(states, c, "down", "Scenario: component removed", 0);
      seeds.push(c.id);
      if (c.redundancy.replicas > 1) notes.push(`${c.name} has ${c.redundancy.replicas} replicas; this scenario assumes all replicas are lost (e.g. bad deploy, config error, quota).`);
      break;
    }
    case "availability_zone": {
      const az = scenario.targetId ?? g.regions[0]?.availabilityZones[0];
      for (const c of g.components) {
        if (!c.regionId || c.type === "client") continue;
        const zone = idx.zones.get(c.zoneId);
        if (zone?.kind === "external_saas" || zone?.kind === "edge" || zone?.kind === "ci_platform") continue;
        if (c.redundancy.multiAz && c.redundancy.replicas > 1) {
          setState(states, c, "degraded", `Zone ${az} lost; remaining replicas absorb load (capacity reduced)`, 0);
        } else if (c.redundancy.multiAz) {
          setState(states, c, "degraded", `Zone ${az} lost; zone-redundant service fails over automatically`, 0);
        } else {
          setState(states, c, "down", `Single-zone deployment in the failed zone ${az} (assumed placement)`, 0);
          seeds.push(c.id);
        }
      }
      notes.push("Zone placement of single-zone resources is not recorded; the simulation assumes they sit in the failed zone (worst case).");
      break;
    }
    case "region": {
      const region = scenario.targetId ?? g.regions.find((r) => r.role === "primary")?.id;
      for (const c of g.components) {
        if (c.regionId !== region) continue;
        if (c.redundancy.multiRegion && c.redundancy.failover === "automatic") {
          setState(states, c, "degraded", `Region ${region} lost; automatic failover to secondary region (${c.redundancy.failoverSeconds ?? "unknown"} s)`, 0);
        } else if (c.redundancy.multiRegion) {
          setState(states, c, "down", `Region ${region} lost; secondary exists but failover is manual`, 0);
          seeds.push(c.id);
        } else {
          setState(states, c, "down", `Region ${region} lost; no deployment elsewhere`, 0);
          seeds.push(c.id);
        }
      }
      break;
    }
    case "dns": {
      const dns = idx.byType("dns");
      if (dns.length) {
        for (const c of dns) {
          setState(states, c, "down", "Scenario: DNS provider outage", 0);
          seeds.push(c.id);
        }
      } else {
        for (const c of idx.clients()) {
          setState(states, c, "down", "No DNS component modelled; assuming a single external DNS provider whose outage makes every public hostname unresolvable", 0);
          seeds.push(c.id);
        }
        notes.push("DNS is not modelled explicitly - this is an ASSUMPTION about a shared provider.");
      }
      break;
    }
    case "certificate": {
      for (const c of g.components) {
        if (!(c.exposure === "public" || c.security.publicEndpoint)) continue;
        if (c.type === "client") continue;
        if (c.security.tlsCertificate === "manual") {
          setState(states, c, "down", "TLS certificate is manually managed and has expired; browsers and clients reject the endpoint", 0);
          seeds.push(c.id);
        } else if (c.security.tlsCertificate === undefined || c.security.tlsCertificate === "unknown") {
          setState(states, c, "degraded", "Certificate management is UNKNOWN; if manual, expiry would take this endpoint down", 0);
        }
      }
      if (!seeds.length) notes.push("No manually managed certificates found on public endpoints.");
      break;
    }
    case "network_egress": {
      const nat = idx.byType("nat_gateway");
      if (nat.length) {
        for (const c of nat) {
          setState(states, c, "down", "Scenario: outbound internet path (NAT / egress) fails", 0);
          seeds.push(c.id);
        }
      }
      for (const e of g.edges) {
        if (!idx.leavesOrganisation(e)) continue;
        const src = idx.components.get(e.source);
        if (src && !nat.length) {
          setState(states, src, "degraded", `Cannot reach external dependency ${idx.components.get(e.target)?.name}`, 0);
        }
      }
      break;
    }
    case "identity_provider": {
      for (const c of idx.byType("identity_provider")) {
        setState(states, c, "down", "Scenario: identity provider outage", 0);
        seeds.push(c.id);
      }
      break;
    }
    case "ai_provider": {
      for (const c of idx.byType("llm_provider", "embedding_service", "ml_inference")) {
        setState(states, c, "down", "Scenario: model provider outage / hard rate limiting", 0);
        seeds.push(c.id);
      }
      break;
    }
  }
  return seeds;
}

function propagate(idx: GraphIndex, states: Map<string, AffectedComponent>, seeds: string[]) {
  const queue: string[] = [...states.keys()];
  const visited = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    const curState = states.get(cur);
    if (!curState || visited.has(cur + ":" + curState.state)) continue;
    visited.add(cur + ":" + curState.state);
    const target = idx.components.get(cur);
    if (!target) continue;
    for (const e of idx.dependents(cur)) {
      const src = idx.components.get(e.source);
      if (!src) continue;
      let next: ComponentState;
      let reason: string;
      if (curState.state === "down") {
        if (e.criticality === "hard" && e.sync === "sync" && !e.fallback) {
          next = "down";
          reason = `Hard synchronous dependency on ${target.name} (${e.kind}); no fallback`;
        } else if (e.criticality === "hard" && e.fallback) {
          next = "degraded";
          reason = `Depends on ${target.name}; fallback: ${e.fallback}`;
        } else if (e.criticality === "hard") {
          next = "degraded";
          reason = `Asynchronous dependency on ${target.name}; work is delayed or dropped`;
        } else {
          next = "degraded";
          reason = `Soft dependency on ${target.name}; feature degraded`;
        }
      } else if (curState.state === "degraded") {
        if (e.criticality !== "hard") continue;
        next = "degraded";
        reason = `Upstream ${target.name} is degraded`;
      } else continue;
      if (setState(states, src, next, reason, curState.depth + 1, e)) queue.push(src.id);
    }
  }
  void seeds;
}

function evaluateFlows(idx: GraphIndex, states: Map<string, AffectedComponent>): FlowImpact[] {
  return idx.graph.flows.map((f) => {
    let state: ComponentState = "ok";
    let brokenAt: string | undefined;
    for (const s of f.steps) {
      const st = states.get(s.componentId);
      if (!st) continue;
      if (st.state === "down") {
        state = "down";
        brokenAt = st.name;
        break;
      }
      if (st.state === "degraded") {
        state = "degraded";
        brokenAt = brokenAt ?? st.name;
      }
    }
    return { flowId: f.id, name: f.name, state, brokenAt };
  });
}

function blastRadius(graph: ArchitectureGraph, states: Map<string, AffectedComponent>): number {
  let total = 0;
  let hit = 0;
  for (const c of graph.components) {
    if (c.type === "client") continue;
    const w = CRIT_WEIGHT[c.criticality];
    total += w;
    const st = states.get(c.id);
    if (st?.state === "down") hit += w;
    else if (st?.state === "degraded") hit += w * 0.5;
  }
  return total ? Math.round((hit / total) * 100) : 0;
}

function userImpactFrom(flows: FlowImpact[], idx: GraphIndex, states: Map<string, AffectedComponent>): UserImpact {
  if (!flows.length) {
    const client = idx.clients()[0];
    const st = client ? states.get(client.id) : undefined;
    return st?.state === "down" ? "total_outage" : st?.state === "degraded" ? "partial" : "none";
  }
  const userFlows = flows.filter((f) => idx.graph.flows.find((x) => x.id === f.flowId)?.kind !== "async_job" && idx.graph.flows.find((x) => x.id === f.flowId)?.kind !== "deployment");
  const pool = userFlows.length ? userFlows : flows;
  const down = pool.filter((f) => f.state === "down").length;
  const degraded = pool.filter((f) => f.state === "degraded").length;
  const share = (f: FlowImpact) => idx.graph.flows.find((x) => x.id === f.flowId)?.trafficShare ?? 1 / pool.length;
  const downShare = pool.filter((f) => f.state === "down").reduce((a, f) => a + share(f), 0);
  if (down === pool.length) return "total_outage";
  if (downShare >= 0.5 || down >= pool.length * 0.6) return "high";
  if (down > 0 || degraded >= pool.length / 2) return "partial";
  if (degraded > 0) return "low";
  return "none";
}

function recoveryFor(scenario: FailureScenario, seeds: Component[]) {
  const c = seeds[0];
  if (!c) return { recovery: "none" as const, recoveryPath: "Nothing failed.", estimatedRecovery: "n/a", dataLoss: "None" };
  if (scenario.kind === "region") {
    const any = seeds.some((s) => s.redundancy.multiRegion);
    return {
      recovery: any ? ("manual" as const) : ("none" as const),
      recoveryPath: any
        ? "Promote secondary-region resources and repoint DNS; components without a secondary must be rebuilt from backups."
        : "No secondary region exists. Rebuild infrastructure from IaC (where present) and restore data from the latest backup.",
      estimatedRecovery: any ? "Hours (manual failover)" : "Many hours to days (rebuild + restore)",
      dataLoss: describeDataLoss(seeds),
    };
  }
  if (scenario.kind === "availability_zone") {
    return {
      recovery: "manual" as const,
      recoveryPath: "Zone-redundant components self-heal; single-zone components must be re-created in a healthy zone (compute) or restored from backup (stateful).",
      estimatedRecovery: "Minutes for zone-redundant components; hours for single-zone stateful components",
      dataLoss: describeDataLoss(seeds),
    };
  }
  if (scenario.kind === "dns" || scenario.kind === "certificate" || scenario.kind === "identity_provider" || scenario.kind === "ai_provider" || scenario.kind === "network_egress") {
    const external = seeds.some((s) => s.zoneId && s.exposure === "public");
    return {
      recovery: "manual" as const,
      recoveryPath: scenario.kind === "certificate"
        ? "Issue and deploy a new certificate on every affected endpoint; automate renewal afterwards."
        : "Wait for the provider to recover, or activate a secondary provider if one is configured.",
      estimatedRecovery: external ? "Provider-dependent (typically 30 min to several hours)" : "Provider-dependent",
      dataLoss: "None expected (availability incident)",
    };
  }
  const r = c.redundancy;
  if (r.failover === "automatic" && r.replicas > 1) {
    return {
      recovery: "automatic" as const,
      recoveryPath: `Remaining replicas continue serving; orchestrator replaces the failed instance (${r.failoverSeconds ?? "~60"} s).`,
      estimatedRecovery: `${r.failoverSeconds ?? 60} s`,
      dataLoss: c.stateful ? describeDataLoss([c]) : "None (stateless)",
    };
  }
  if (r.failover === "manual") {
    return {
      recovery: "manual" as const,
      recoveryPath: `On-call engineer promotes the standby for ${c.name} and updates connection strings.`,
      estimatedRecovery: c.operations.runbook ? "15-60 min (runbook exists)" : "1-3 h (no runbook)",
      dataLoss: describeDataLoss([c]),
    };
  }
  if (c.backup?.enabled) {
    return {
      recovery: "manual" as const,
      recoveryPath: `Provision a replacement ${c.name} and restore from backup (${c.backup.frequency ?? "unknown cadence"}).`,
      estimatedRecovery: c.backup.restoreTested ? "1-2 h (restore rehearsed)" : "2-8 h (restore never rehearsed)",
      dataLoss: describeDataLoss([c]),
    };
  }
  return {
    recovery: c.stateful ? ("none" as const) : ("manual" as const),
    recoveryPath: c.stateful
      ? `No replica and no backup for ${c.name}: state is unrecoverable; rebuild and re-derive data if possible.`
      : `Redeploy ${c.name} from the last known-good artifact.`,
    estimatedRecovery: c.stateful ? "Unbounded" : "10-30 min",
    dataLoss: describeDataLoss([c]),
  };
}

function describeDataLoss(seeds: Component[]): string {
  const stateful = seeds.filter((s) => s.stateful);
  if (!stateful.length) return "None (stateless components only)";
  const parts = stateful.map((s) => {
    if (s.redundancy.replicas > 1 && s.redundancy.failover === "automatic") return `${s.name}: none expected (synchronous replica)`;
    if (s.backup?.enabled && s.backup.pointInTimeRecovery) return `${s.name}: up to a few minutes (PITR)`;
    if (s.backup?.enabled) return `${s.name}: up to ${s.backup.frequency ?? "one backup interval"}`;
    return `${s.name}: potentially total (no backup)`;
  });
  return parts.join("; ");
}

function titleFor(s: FailureScenario, idx: GraphIndex): string {
  switch (s.kind) {
    case "component": return `${idx.components.get(s.targetId!)?.name ?? s.targetId} failure`;
    case "availability_zone": return `Availability zone ${s.targetId ?? "1"} failure`;
    case "region": return `Region ${s.targetId ?? "primary"} failure`;
    case "dns": return "DNS provider failure";
    case "certificate": return "TLS certificate expiry";
    case "network_egress": return "Outbound network / NAT failure";
    case "identity_provider": return "Identity provider outage";
    case "ai_provider": return "AI model provider outage";
  }
}

/** Standard catalogue used by the destruction engine. */
export function standardScenarios(graph: ArchitectureGraph): FailureScenario[] {
  const idx = indexGraph(graph);
  const out: FailureScenario[] = [];
  const interesting = graph.components.filter((c) => c.type !== "client" && c.criticality !== "low");
  for (const c of interesting) out.push({ kind: "component", targetId: c.id });
  if (graph.regions.length) {
    const primary = graph.regions.find((r) => r.role === "primary") ?? graph.regions[0];
    out.push({ kind: "region", targetId: primary.id });
    if (primary.availabilityZones.length) out.push({ kind: "availability_zone", targetId: primary.availabilityZones[0] });
  }
  out.push({ kind: "dns" }, { kind: "certificate" }, { kind: "network_egress" });
  if (idx.byType("identity_provider").length) out.push({ kind: "identity_provider" });
  if (idx.byType("llm_provider", "embedding_service", "ml_inference").length) out.push({ kind: "ai_provider" });
  return out;
}
