import type { ArchitectureGraph } from "../graph/types";
import { SEVERITY_PENALTY, type Confidence, type DimensionScore, type Finding, type ScoreDimension, type ScoreReport } from "../analysis/types";

/**
 * Scoring. Each dimension starts at 100 and loses points per finding
 * (severity x dimension weight). Penalties within the same category are
 * damped so ten similar findings do not pile up linearly. Confidence comes
 * from the evidence mix behind the contributing findings, never invented.
 */
const DIMENSIONS: ScoreDimension[] = ["reliability", "security", "scalability", "performance", "cost", "operability", "maintainability", "ai"];

export function computeScores(graph: ArchitectureGraph, findings: Finding[], aiApplicable: boolean): ScoreReport {
  const dimensions: DimensionScore[] = DIMENSIONS.map((dim) => {
    if (dim === "ai" && !aiApplicable) {
      return { dimension: dim, score: 0, confidence: "high", reason: "No AI components in this architecture.", contributingFindingIds: [], applicable: false };
    }
    const contributing = findings.filter((f) => (f.dimensions[dim] ?? 0) > 0).sort((a, b) => penalty(b, dim) - penalty(a, dim));
    const perCategory = new Map<string, number>();
    let total = 0;
    for (const f of contributing) {
      const n = perCategory.get(f.category) ?? 0;
      perCategory.set(f.category, n + 1);
      total += penalty(f, dim) * Math.pow(0.6, n); // diminishing returns per category
    }
    if (dim === "maintainability") total += complexityPenalty(graph);
    // Exponential compression: 26 points of penalty -> ~71, 60 -> ~45, 100 -> ~26. Avoids every bad architecture flooring at zero.
    const score = Math.max(5, Math.round(100 * Math.exp(-total / 75)));
    const top = contributing[0];
    return {
      dimension: dim,
      score,
      confidence: confidenceFrom(contributing),
      reason: top ? top.title : dim === "maintainability" ? `Structural complexity only (${graph.components.length} components, ${graph.edges.length} edges).` : "No findings in this dimension.",
      contributingFindingIds: contributing.map((f) => f.id),
      applicable: true,
    };
  });

  const applicable = dimensions.filter((d) => d.applicable);
  const weights: Partial<Record<ScoreDimension, number>> = { reliability: 1.5, security: 1.5, scalability: 1, performance: 0.7, cost: 0.7, operability: 1, maintainability: 0.6, ai: 1 };
  const wsum = applicable.reduce((a, d) => a + (weights[d.dimension] ?? 1), 0);
  const overall = Math.round(applicable.reduce((a, d) => a + d.score * (weights[d.dimension] ?? 1), 0) / wsum);

  const counts = { facts: 0, inferences: 0, assumptions: 0, unknowns: 0 };
  for (const f of findings) for (const e of f.evidence) {
    if (e.level === "fact") counts.facts++;
    else if (e.level === "inference") counts.inferences++;
    else if (e.level === "assumption") counts.assumptions++;
    else counts.unknowns++;
  }
  return { overall, dimensions, evidenceSummary: counts };
}

function penalty(f: Finding, dim: ScoreDimension) {
  return SEVERITY_PENALTY[f.severity] * (f.dimensions[dim] ?? 0);
}

function complexityPenalty(graph: ArchitectureGraph) {
  const providers = new Set(graph.components.map((c) => c.provider).filter(Boolean)).size;
  const techs = new Set(graph.components.map((c) => c.technology).filter(Boolean)).size;
  const density = graph.components.length ? graph.edges.length / graph.components.length : 0;
  return Math.min(30, providers * 1.5 + techs * 0.8 + Math.max(0, density - 1.2) * 6);
}

function confidenceFrom(findings: Finding[]): Confidence {
  if (!findings.length) return "medium";
  const ev = findings.flatMap((f) => f.evidence);
  const facts = ev.filter((e) => e.level === "fact").length;
  const unknowns = ev.filter((e) => e.level === "unknown").length;
  const assumptions = ev.filter((e) => e.level === "assumption").length;
  const ratio = ev.length ? facts / ev.length : 0;
  if (ratio >= 0.5 && unknowns <= 1 && assumptions <= ev.length * 0.25) return "high";
  if (ratio >= 0.3) return "medium";
  return "low";
}

/** 0-100 structural complexity for the diff view. */
export function complexityScore(graph: ArchitectureGraph): number {
  const c = graph.components.length;
  const e = graph.edges.length;
  const z = graph.zones.length;
  const r = graph.regions.length;
  const providers = new Set(graph.components.map((x) => x.provider).filter(Boolean)).size;
  return Math.min(100, Math.round(c * 1.8 + e * 0.9 + z * 2 + r * 4 + providers * 2));
}
