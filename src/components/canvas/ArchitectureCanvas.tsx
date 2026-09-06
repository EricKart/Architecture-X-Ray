"use client";
import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MarkerType, Position, Handle, type Node, type Edge as RFEdge, type NodeProps, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import clsx from "clsx";
import {
  Globe, Server, Database, HardDrive, Cpu, Shield, Lock, KeyRound, Layers, MessageSquare, Boxes, Brain, Activity, GitBranch, Waypoints, Network, Cloud, Users, Zap, Search, Mail, CreditCard, Timer, Radio,
} from "lucide-react";
import type { ArchitectureGraph, Component, ComponentType } from "@/engine/graph/types";
import { useXRay, useActiveGraph, useActiveReport } from "@/lib/store";

const ICONS: Partial<Record<ComponentType, React.ComponentType<{ size?: number; className?: string }>>> = {
  client: Users, dns: Globe, cdn: Cloud, waf: Shield, load_balancer: Waypoints, api_gateway: Waypoints, identity_provider: KeyRound, web_frontend: Layers,
  service: Server, worker: Cpu, serverless_function: Zap, container_platform: Boxes, queue: MessageSquare, stream: Radio, cache: HardDrive, relational_db: Database,
  document_db: Database, vector_db: Brain, search: Search, object_storage: HardDrive, llm_provider: Brain, embedding_service: Brain, ml_inference: Brain, llm_gateway: Brain,
  monitoring: Activity, logging: Activity, tracing: Activity, secrets_manager: Lock, kms: Lock, ci_cd: GitBranch, external_api: Cloud, payment_provider: CreditCard,
  email_service: Mail, nat_gateway: Network, vpn: Network, bastion: Shield, private_link: Network, scheduler: Timer,
};

type NodeState = "ok" | "degraded" | "down" | "dim";

interface ComponentNodeData extends Record<string, unknown> {
  component: Component;
  selected: boolean;
  state: NodeState;
  findingCount: number;
  worstSeverity?: string;
  isSpof: boolean;
  traceActive: boolean;
  tracePast: boolean;
  affectedByFinding: boolean;
}

function ComponentNode({ data }: NodeProps<Node<ComponentNodeData>>) {
  const c = data.component;
  const Icon = ICONS[c.type] ?? Server;
  const border = data.state === "down" ? "border-bad" : data.state === "degraded" ? "border-warn" : data.traceActive ? "border-info" : data.selected ? "border-terra" : data.affectedByFinding ? "border-terra/60" : "border-line-2";
  const bg = data.state === "down" ? "bg-bad-soft" : data.state === "degraded" ? "bg-warn-soft" : data.traceActive ? "bg-info-soft" : "bg-white";
  return (
    <div className={clsx("relative h-[64px] w-[190px] rounded-md border-2 px-2.5 py-2 shadow-sm transition-colors", border, bg, data.state === "dim" && "opacity-35", data.state === "down" && "node-down", data.tracePast && "ring-2 ring-info/30")}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-start gap-2">
        <Icon size={15} className={clsx("mt-0.5 shrink-0", data.state === "down" ? "text-bad" : data.state === "degraded" ? "text-warn" : "text-ink-3")} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold leading-tight text-ink">{c.name}</div>
          <div className="mono truncate text-[10px] text-ink-3">{c.service ?? c.technology ?? c.type.replace(/_/g, " ")}</div>
        </div>
      </div>
      <div className="absolute bottom-1 right-1.5 flex items-center gap-1">
        {data.isSpof && <span className="mono rounded bg-bad px-1 text-[9px] font-semibold text-white" title="Single point of failure">SPOF</span>}
        {c.exposure === "public" && c.type !== "client" && <span className="mono rounded border border-line px-1 text-[9px] text-ink-3" title="Public exposure">pub</span>}
        {data.findingCount > 0 && (
          <span className={clsx("mono rounded px-1 text-[9px] font-semibold text-white", data.worstSeverity === "critical" || data.worstSeverity === "high" ? "bg-bad" : data.worstSeverity === "medium" ? "bg-warn" : "bg-info")} title={`${data.findingCount} findings`}>
            {data.findingCount}
          </span>
        )}
      </div>
      {data.state === "down" && <div className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-bad text-[11px] font-bold text-white">x</div>}
    </div>
  );
}

interface ZoneNodeData extends Record<string, unknown> {
  name: string;
  kind: string;
  trust: number;
}

function ZoneNode({ data }: NodeProps<Node<ZoneNodeData>>) {
  const tint = data.kind === "internet" ? "bg-sand-3/60" : data.kind === "external_saas" || data.kind === "ci_platform" ? "bg-warn-soft/40" : data.kind === "public_subnet" ? "bg-terra-soft/35" : data.kind === "private_subnet" || data.kind === "isolated_subnet" ? "bg-ok-soft/40" : data.kind === "managed_service" ? "bg-info-soft/35" : "bg-sand-2/80";
  return (
    <div className={clsx("h-full w-full rounded-lg border border-dashed border-line-2", tint)}>
      <div className="flex items-center gap-2 px-3 pt-2">
        <span className="eyebrow !text-[10px]">{data.name}</span>
        <span className="mono text-[9px] text-ink-3">trust {data.trust}</span>
      </div>
    </div>
  );
}

const nodeTypes = { component: ComponentNode, zone: ZoneNode };

async function layout(graph: ArchitectureGraph): Promise<{ nodes: Node[]; edges: RFEdge[] }> {
  const elk = new ELK();
  const zonesWithComponents = graph.zones.filter((z) => graph.components.some((c) => c.zoneId === z.id));
  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.spacing.nodeNode": "28",
      "elk.spacing.componentComponent": "40",
      "elk.layered.crossingMinimization.semiInteractive": "true",
      "elk.edgeRouting": "SPLINES",
    },
    children: zonesWithComponents.map((z) => ({
      id: `zone:${z.id}`,
      layoutOptions: { "elk.padding": "[top=40,left=18,bottom=18,right=18]", "elk.spacing.nodeNode": "24" },
      children: graph.components.filter((c) => c.zoneId === z.id).map((c) => ({ id: c.id, width: 190, height: 64 })),
    })),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const res = await elk.layout(elkGraph);
  const nodes: Node[] = [];
  for (const z of res.children ?? []) {
    const zone = zonesWithComponents.find((x) => `zone:${x.id}` === z.id)!;
    nodes.push({ id: z.id, type: "zone", position: { x: z.x ?? 0, y: z.y ?? 0 }, data: { name: zone.name, kind: zone.kind, trust: zone.trustLevel }, style: { width: z.width, height: z.height }, selectable: false, draggable: false, zIndex: -1 });
    for (const ch of z.children ?? []) {
      const c = graph.components.find((x) => x.id === ch.id)!;
      nodes.push({ id: c.id, type: "component", parentId: z.id, extent: "parent", position: { x: ch.x ?? 0, y: ch.y ?? 0 }, data: { component: c }, zIndex: 1 });
    }
  }
  const edges: RFEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label ?? e.kind.replace(/_/g, " "),
    type: "default",
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#b9b6ab" },
    data: { sync: e.sync, kind: e.kind },
  }));
  return { nodes, edges };
}

function CanvasInner() {
  const graph = useActiveGraph();
  const report = useActiveReport();
  const selectedComponentId = useXRay((s) => s.selectedComponentId);
  const selectedFindingId = useXRay((s) => s.selectedFindingId);
  const simulation = useXRay((s) => s.simulation);
  const trace = useXRay((s) => s.trace);
  const traceStep = useXRay((s) => s.traceStep);
  const selectComponent = useXRay((s) => s.selectComponent);
  const { fitView } = useReactFlow();
  const [base, setBase] = useState<{ nodes: Node[]; edges: RFEdge[]; key: string } | null>(null);

  const layoutKey = graph ? `${graph.id}:${graph.components.map((c) => c.id + c.zoneId).join(",")}:${graph.edges.map((e) => e.id).join(",")}` : "";
  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    layout(graph).then((r) => {
      if (!cancelled) {
        setBase({ ...r, key: layoutKey });
        setTimeout(() => fitView({ padding: 0.08, duration: 300 }), 30);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const finding = useMemo(() => report?.findings.find((f) => f.id === selectedFindingId), [report, selectedFindingId]);

  const { nodes, edges } = useMemo(() => {
    if (!base || !graph) return { nodes: [], edges: [] };
    const findingCount = new Map<string, { n: number; worst: string }>();
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    for (const f of report?.findings ?? []) for (const id of f.affectedComponentIds.slice(0, 1)) {
      const cur = findingCount.get(id) ?? { n: 0, worst: "info" };
      cur.n += 1;
      if (rank[f.severity] < rank[cur.worst]) cur.worst = f.severity;
      findingCount.set(id, cur);
    }
    const spof = new Set((report?.scenarioSummaries ?? []).filter((s) => s.isSpof && s.targetId).map((s) => s.targetId!));
    const simState = new Map(simulation?.affected.map((a) => [a.componentId, a.state]) ?? []);
    const simEdges = new Set(simulation?.affected.map((a) => a.viaEdgeId).filter(Boolean) ?? []);
    const findingComps = new Set(finding?.affectedComponentIds ?? []);
    const findingEdges = new Set(finding?.affectedEdgeIds ?? []);
    const traceSteps = trace?.steps ?? [];
    const activeStep = traceSteps[traceStep];
    const pastComps = new Set(traceSteps.slice(0, traceStep).map((s) => s.componentId));
    const traceEdges = new Set(traceSteps.slice(0, traceStep + 1).map((s) => s.edge?.id).filter(Boolean));

    const nodes = base.nodes.map((n) => {
      if (n.type !== "component") return n;
      const c = graph.components.find((x) => x.id === n.id)!;
      let state: NodeState = "ok";
      if (simulation) state = (simState.get(c.id) as NodeState) ?? "dim";
      else if (finding) state = findingComps.has(c.id) ? "ok" : "dim";
      else if (trace) state = activeStep?.componentId === c.id || pastComps.has(c.id) ? "ok" : "dim";
      const fc = findingCount.get(c.id);
      const data: ComponentNodeData = {
        component: c,
        selected: selectedComponentId === c.id,
        state,
        findingCount: fc?.n ?? 0,
        worstSeverity: fc?.worst,
        isSpof: spof.has(c.id),
        traceActive: !!trace && activeStep?.componentId === c.id,
        tracePast: !!trace && pastComps.has(c.id),
        affectedByFinding: findingComps.has(c.id),
      };
      return { ...n, data };
    });
    const edges = base.edges.map((e) => {
      const cls: string[] = [];
      const sync = (e.data as { sync?: string })?.sync;
      if (sync === "async") cls.push("async");
      if (simulation) cls.push(simEdges.has(e.id) ? (simState.get(e.source) === "down" ? "down" : "degraded") : "dim");
      else if (finding) cls.push(findingEdges.has(e.id) ? "hot" : "dim");
      else if (trace) cls.push(traceEdges.has(e.id) ? "trace" : "dim");
      else if (selectedComponentId) cls.push(e.source === selectedComponentId || e.target === selectedComponentId ? "hot" : "");
      return { ...e, className: cls.join(" "), animated: false };
    });
    return { nodes, edges };
  }, [base, graph, report, selectedComponentId, simulation, finding, trace, traceStep]);

  if (!graph) return null;
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => n.type === "component" && selectComponent(n.id)}
      onPaneClick={() => selectComponent(null)}
      nodesDraggable
      nodesConnectable={false}
      minZoom={0.2}
      maxZoom={1.6}
      fitView
    >
      <Background color="#e6e3db" gap={22} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

export function ArchitectureCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
