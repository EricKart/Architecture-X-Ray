import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { component, edge, graph } from "@/engine/graph/builder";
import { componentTypeSchema } from "@/engine/graph/schema";
import type { ArchitectureGraph } from "@/engine/graph/types";
import type { Finding } from "@/engine/analysis/types";
import type { Explanation } from "@/engine/teaching/explain";

/**
 * AI reasoning layer (optional). Used only for tasks the deterministic engine
 * cannot do: turning free text or a diagram image into a structured graph, and
 * enriching explanations. The analysis itself never depends on a model.
 *
 * Resolves credentials from ANTHROPIC_API_KEY (or an `ant auth login` profile).
 */

const MODEL = process.env.XRAY_AI_MODEL ?? "claude-opus-5";

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const extractionSchema = z.object({
  name: z.string(),
  summary: z.string(),
  cloud: z.enum(["azure", "aws", "gcp", "unknown"]),
  regions: z.array(z.object({ name: z.string(), role: z.enum(["primary", "secondary", "dr"]) })),
  components: z.array(
    z.object({
      id: z.string().describe("short kebab-case id"),
      name: z.string(),
      type: componentTypeSchema,
      service: z.string().nullable().describe("managed service or product name if visible"),
      technology: z.string().nullable(),
      zone: z.enum(["internet", "edge", "public_subnet", "private_subnet", "isolated_subnet", "managed_service", "external_saas", "ci_platform"]),
      exposure: z.enum(["public", "private", "internal"]),
      stateful: z.boolean(),
      replicas: z.number().nullable().describe("null when not stated"),
      multiAz: z.boolean().nullable(),
      backup: z.boolean().nullable(),
      publicEndpoint: z.boolean().nullable(),
      notes: z.string().nullable(),
      stated: z.boolean().describe("true if explicitly present in the input, false if inferred"),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      kind: z.enum(["calls", "reads", "writes", "publishes", "consumes", "authenticates_with", "fetches_secrets_from", "routes_to", "serves", "replicates_to", "backs_up_to", "monitors", "deploys_to", "egress_via", "resolves"]),
      sync: z.enum(["sync", "async"]),
      protocol: z.string().nullable(),
      encrypted: z.boolean().nullable(),
      stated: z.boolean(),
    }),
  ),
  assumptions: z.array(z.string()),
  unknowns: z.array(z.string()),
});

type Extraction = z.infer<typeof extractionSchema>;

const EXTRACTION_SYSTEM = `You convert software/cloud architecture inputs into a strict structured graph.
Rules:
- Edge direction: source NEEDS target (API -> database means the API depends on the database).
- Only mark stated=true for things explicitly present in the input. Mark inferred things stated=false.
- Use null for any profile fact that is not present. Never guess replicas, backups or encryption.
- List everything you could not determine in "unknowns" and everything you had to assume in "assumptions".
- Component ids must be unique kebab-case; edges must reference those ids.
- Include a "users" client component in the internet zone if end users exist.`;

const ZONE_TRUST = { internet: 0, edge: 1, external_saas: 1, ci_platform: 1, public_subnet: 2, private_subnet: 3, managed_service: 3, isolated_subnet: 4 } as const;

function toGraph(x: Extraction, source: ArchitectureGraph["source"]): ArchitectureGraph {
  const ids = new Set(x.components.map((c) => c.id));
  const zones = [...new Set(x.components.map((c) => c.zone))].map((z) => ({ id: z, name: z.replace(/_/g, " "), kind: z, trustLevel: ZONE_TRUST[z], regionId: ["public_subnet", "private_subnet", "isolated_subnet", "managed_service"].includes(z) ? "r1" : undefined }));
  const regions = (x.regions.length ? x.regions : [{ name: "Primary region (unspecified)", role: "primary" as const }]).map((r, i) => ({ id: `r${i + 1}`, name: r.name, role: r.role, provider: x.cloud === "unknown" ? undefined : x.cloud, availabilityZones: ["1", "2", "3"] }));
  const components = x.components.map((c) =>
    component({
      id: c.id,
      name: c.name,
      type: c.type,
      provider: x.cloud === "unknown" ? undefined : x.cloud,
      service: c.service ?? undefined,
      technology: c.technology ?? undefined,
      zoneId: c.zone,
      regionId: ["public_subnet", "private_subnet", "isolated_subnet", "managed_service"].includes(c.zone) ? "r1" : undefined,
      exposure: c.exposure,
      stateful: c.stateful,
      criticality: ["relational_db", "document_db", "service", "api_gateway", "load_balancer", "identity_provider", "cache"].includes(c.type) ? "critical" : "high",
      scaling: { model: c.zone === "managed_service" || c.zone === "external_saas" || c.zone === "edge" ? "managed" : "manual" },
      redundancy: { replicas: c.replicas ?? 1, multiAz: c.multiAz ?? false, multiRegion: false, failover: (c.replicas ?? 1) > 1 ? "automatic" : "none" },
      backup: c.backup === null ? undefined : { enabled: c.backup },
      security: { publicEndpoint: c.publicEndpoint ?? undefined },
      ai: c.type === "llm_provider" ? { role: "llm" } : c.type === "vector_db" ? { role: "vector_store" } : c.type === "embedding_service" ? { role: "embedding" } : undefined,
      evidence: c.stated ? "fact" : "inference",
      notes: c.notes ? [c.notes] : undefined,
    }),
  );
  const edges = x.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    .map((e) => edge({ source: e.source, target: e.target, kind: e.kind, sync: e.sync, protocol: (e.protocol ?? undefined) as never, encrypted: e.encrypted ?? undefined, criticality: e.kind === "monitors" || e.kind === "deploys_to" || e.kind === "replicates_to" || e.kind === "backs_up_to" ? "soft" : "hard", evidence: e.stated ? "fact" : "inference" }));
  return graph({ id: `${source}-${Date.now()}`, name: x.name, description: x.summary, source, regions, zones, components, edges, assumptions: x.assumptions, unknowns: x.unknowns });
}

export async function extractGraphWithAi(input: { text?: string; image?: { base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" } }): Promise<{ graph: ArchitectureGraph; raw: Extraction }> {
  const client = new Anthropic();
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) content.push({ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.base64 } });
  content.push({ type: "text", text: input.text ? `Architecture description:\n\n${input.text}` : "Extract the architecture shown in this diagram." });
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: EXTRACTION_SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(extractionSchema) },
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to process this input.");
  const raw = response.parsed_output;
  if (!raw) throw new Error("The model returned no structured output.");
  return { graph: toGraph(raw, input.image ? "image" : "description"), raw };
}

export async function explainWithAi(finding: Finding, graphSummary: string, base: Explanation): Promise<Explanation> {
  const client = new Anthropic();
  const schema = z.object({ beginner: z.string(), engineer: z.string(), architect: z.string() });
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: "You are a principal architect explaining one architectural finding at three levels. Beginner: plain language with a concrete analogy, no jargon. Engineer: precise technical mechanism, name the components and relationships. Architect: systemic tradeoffs, second-order consequences, what the fix costs; do not dumb it down. Distinguish facts from inferences and assumptions as given. 120-200 words per level.",
    messages: [{ role: "user", content: `Architecture: ${graphSummary}\n\nFinding: ${JSON.stringify({ title: finding.title, severity: finding.severity, confidence: finding.confidence, evidence: finding.evidence, mechanism: finding.mechanism, impact: finding.impact, recommendation: finding.recommendation, tradeoff: finding.tradeoff })}\n\nDraft explanations to improve:\n${JSON.stringify(base)}` }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return base;
  return { ...response.parsed_output, source: "ai" };
}
