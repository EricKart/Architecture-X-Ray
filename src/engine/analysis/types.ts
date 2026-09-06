import type { ArchitectureGraph, Component, Edge, EvidenceLevel } from "../graph/types";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";
export type Engine = "reliability" | "scalability" | "security" | "cost" | "operations" | "ai";

export type ScoreDimension =
  | "reliability"
  | "security"
  | "scalability"
  | "performance"
  | "cost"
  | "operability"
  | "maintainability"
  | "ai";

/**
 * A single piece of evidence backing a finding. `level` says whether it is a
 * FACT (directly in the graph), an INFERENCE (derived), an ASSUMPTION (we had
 * to assume it) or an UNKNOWN (cannot be determined from supplied evidence).
 */
export interface Evidence {
  level: EvidenceLevel;
  statement: string;
  componentIds?: string[];
  edgeIds?: string[];
}

/** A patch that, when applied to the graph, remediates the finding. Enables the before/after diff. */
export interface GraphPatch {
  description: string;
  upsertComponents?: Component[];
  removeComponentIds?: string[];
  updateComponents?: Array<{ id: string; patch: DeepPartial<Component> }>;
  upsertEdges?: Edge[];
  removeEdgeIds?: string[];
  updateEdges?: Array<{ id: string; patch: Partial<Edge> }>;
  addAssumptions?: string[];
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface Finding {
  id: string;
  engine: Engine;
  category: string;
  severity: Severity;
  confidence: Confidence;
  title: string;
  evidence: Evidence[];
  mechanism: string;
  impact: string;
  recommendation: string;
  tradeoff: string;
  affectedComponentIds: string[];
  affectedEdgeIds: string[];
  /** Ordered component ids describing how an attacker/failure reaches the component. */
  path?: string[];
  /** Which score dimensions this finding penalises and how strongly (0..1). */
  dimensions: Partial<Record<ScoreDimension, number>>;
  fix?: GraphPatch;
  /** Free-form structured details (numbers used in the reasoning). */
  details?: Record<string, string | number | boolean>;
}

export interface DimensionScore {
  dimension: ScoreDimension;
  score: number;
  confidence: Confidence;
  reason: string;
  contributingFindingIds: string[];
  applicable: boolean;
}

export interface ScoreReport {
  overall: number;
  dimensions: DimensionScore[];
  evidenceSummary: { facts: number; inferences: number; assumptions: number; unknowns: number };
}

export interface CostLine {
  componentId: string;
  name: string;
  category: CostCategory;
  min: number;
  max: number;
  model: string;
  evidence: EvidenceLevel;
  assumption?: string;
}

export type CostCategory =
  | "compute"
  | "database"
  | "storage"
  | "networking"
  | "ai"
  | "observability"
  | "security"
  | "caching"
  | "queues"
  | "other";

export interface CostOptimization {
  id: string;
  title: string;
  componentIds: string[];
  savingsMin: number;
  savingsMax: number;
  assumption: string;
  findingId?: string;
}

export interface CostReport {
  currency: "USD";
  monthly: { min: number; max: number };
  annual: { min: number; max: number };
  byCategory: Array<{ category: CostCategory; min: number; max: number }>;
  lines: CostLine[];
  optimizations: CostOptimization[];
  optimizedMonthly: { min: number; max: number };
  assumptions: string[];
}

export interface CapacityPoint {
  componentId: string;
  name: string;
  /** Which constraint is binding. */
  constraint: string;
  demand: number;
  capacity: number;
  unit: string;
  utilization: number;
  status: "ok" | "warning" | "saturated";
  mechanism: string;
  evidence: EvidenceLevel;
}

export interface ScalabilityTier {
  multiplier: number;
  demandRps: number;
  points: CapacityPoint[];
  firstFailure?: CapacityPoint;
  saturated: CapacityPoint[];
}

export interface ScalabilityReport {
  baselineRps: number;
  baselineEvidence: EvidenceLevel;
  tiers: ScalabilityTier[];
  /** Ordered: what breaks first, second, ... */
  breakOrder: Array<{ componentId: string; name: string; multiplier: number; mechanism: string }>;
  statefulComponentIds: string[];
  narrative: string[];
  assumptions: string[];
}

export interface OperationsReport {
  threeAmVerdict: "yes" | "with_difficulty" | "no";
  verdictReason: string;
  checklist: Array<{ item: string; status: "pass" | "warn" | "fail"; detail: string }>;
}

export interface SecurityReport {
  trustBoundaries: Array<{ from: string; to: string; edgeIds: string[]; encrypted: boolean | "unknown"; authenticated: boolean | "unknown" }>;
  attackSurface: Array<{ componentId: string; name: string; reason: string }>;
  identityFlows: string[];
}

export interface AnalysisReport {
  graphId: string;
  graphName: string;
  generatedAt: string;
  findings: Finding[];
  criticalFindings: Finding[];
  scores: ScoreReport;
  cost: CostReport;
  scalability: ScalabilityReport;
  operations: OperationsReport;
  security: SecurityReport;
  /** Precomputed standard failure scenarios (ids reference scenario catalogue). */
  scenarioSummaries: ScenarioSummary[];
  assumptions: string[];
  unknowns: string[];
  aiApplicable: boolean;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  kind: string;
  targetId?: string;
  userImpact: UserImpact;
  blastRadiusPct: number;
  isSpof: boolean;
  recovery: "automatic" | "manual" | "none";
  affectedCount: number;
}

export type UserImpact = "total_outage" | "high" | "partial" | "low" | "none";

export interface EngineContext {
  graph: ArchitectureGraph;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 26,
  high: 15,
  medium: 7,
  low: 3,
  info: 0,
};
