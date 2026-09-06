import type { ArchitectureGraph } from "../graph/types";
import { analyzeReliability } from "./reliability";
import { analyzeScalability } from "./scalability";
import { analyzeSecurity } from "./security";
import { analyzeCost } from "./cost";
import { analyzeOperations } from "./operations";
import { analyzeAi } from "./ai";
import { computeScores } from "../scoring/scores";
import { SEVERITY_ORDER, type AnalysisReport, type Finding } from "./types";

/**
 * Destruction engine orchestrator: runs every independent analysis pass over
 * the same graph, merges findings, ranks them and computes scores.
 */
export function analyzeArchitecture(graph: ArchitectureGraph): AnalysisReport {
  const reliability = analyzeReliability(graph);
  const scalability = analyzeScalability(graph);
  const security = analyzeSecurity(graph);
  const cost = analyzeCost(graph);
  const operations = analyzeOperations(graph);
  const ai = analyzeAi(graph);

  const findings = rank([
    ...reliability.findings,
    ...scalability.findings,
    ...security.findings,
    ...cost.findings,
    ...operations.findings,
    ...ai.findings,
  ]);

  const scores = computeScores(graph, findings, ai.applicable);

  return {
    graphId: graph.id,
    graphName: graph.name,
    generatedAt: new Date().toISOString(),
    findings,
    criticalFindings: pickCritical(findings),
    scores,
    cost: cost.report,
    scalability: scalability.report,
    operations: operations.report,
    security: security.report,
    scenarioSummaries: reliability.scenarios,
    assumptions: [...graph.assumptions, ...scalability.report.assumptions, ...cost.report.assumptions],
    unknowns: graph.unknowns,
    aiApplicable: ai.applicable,
  };
}

function rank(findings: Finding[]): Finding[] {
  const confidenceRank = { high: 0, medium: 1, low: 2 };
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || confidenceRank[a.confidence] - confidenceRank[b.confidence] || a.engine.localeCompare(b.engine));
}

/** Top three most dangerous findings, preferring diversity across engines. */
function pickCritical(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  const engines = new Set<string>();
  for (const f of findings) {
    if (out.length >= 3) break;
    if (engines.has(f.engine) && findings.some((g) => !engines.has(g.engine) && SEVERITY_ORDER[g.severity] <= SEVERITY_ORDER[f.severity] + 1 && !out.includes(g))) continue;
    out.push(f);
    engines.add(f.engine);
  }
  for (const f of findings) {
    if (out.length >= 3) break;
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

export { analyzeReliability, analyzeScalability, analyzeSecurity, analyzeCost, analyzeOperations, analyzeAi };
