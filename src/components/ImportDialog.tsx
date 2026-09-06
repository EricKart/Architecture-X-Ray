"use client";
import { useState } from "react";
import clsx from "clsx";
import { useXRay } from "@/lib/store";
import { Button, Eyebrow } from "@/components/ui";
import { component, edge, graph } from "@/engine/graph/builder";
import { api } from "@/lib/api";

const SAMPLE = `A B2C fitness app for 250k users on AWS. React frontend behind CloudFront and a WAF. Node.js API on ECS Fargate with autoscaling. Single RDS PostgreSQL instance with daily backups. Redis on ElastiCache for sessions. S3 for photos. SQS queue with background workers for video processing. Cognito for authentication. OpenAI for workout recommendations. CloudWatch for monitoring and GitHub Actions for CI/CD.`;

/** A minimal, hand-editable graph that satisfies every required field - built with the app's own
 * builder helpers so it is guaranteed to match the schema exactly (never hand-duplicated). */
const STARTER_GRAPH = graph({
  id: "my-architecture",
  name: "My architecture",
  description: "A minimal starting point: client -> API -> database. Duplicate the component/edge blocks to add more.",
  source: "structured",
  zones: [
    { id: "internet", name: "Internet", kind: "internet", trustLevel: 0 },
    { id: "private", name: "Private network", kind: "private_subnet", trustLevel: 3 },
  ],
  components: [
    component({ id: "users", name: "Users", type: "client", zoneId: "internet", exposure: "public", criticality: "medium", scaling: { model: "none" }, cost: { model: "free", category: "low" } }),
    component({ id: "api", name: "API service", type: "service", zoneId: "private", exposure: "private", criticality: "critical", scaling: { model: "horizontal_auto", minInstances: 2, maxInstances: 6, rpsPerInstance: 100 }, redundancy: { replicas: 2, multiAz: true, multiRegion: false, failover: "automatic", failoverSeconds: 30 }, observability: { metrics: true, logs: true, traces: false, alerts: true }, security: { authentication: "jwt", encryptionInTransit: true }, cost: { model: "provisioned", category: "medium", monthlyUsd: { min: 100, max: 300 } }, operations: { owner: "backend", iac: true, deployMethod: "ci_cd" } }),
    component({ id: "db", name: "Database", type: "relational_db", zoneId: "private", exposure: "private", criticality: "critical", stateful: true, scaling: { model: "vertical", maxConnections: 100 }, redundancy: { replicas: 1, multiAz: false, multiRegion: false, failover: "none" }, backup: { enabled: true, frequency: "daily" }, observability: { metrics: true, logs: true, traces: false, alerts: false }, security: { encryptionAtRest: true, encryptionInTransit: true, authentication: "password" }, cost: { model: "provisioned", category: "medium", monthlyUsd: { min: 80, max: 200 } }, operations: { owner: "backend" } }),
  ],
  edges: [
    edge({ source: "users", target: "api", kind: "calls", protocol: "https", encrypted: true, authentication: "jwt" }),
    edge({ source: "api", target: "db", kind: "writes", protocol: "postgres", encrypted: true, authentication: "password", connectionsPerInstance: 10 }),
  ],
  flows: [{ id: "f1", name: "Request", kind: "normal_request", description: "A request from the client to the database.", steps: [{ componentId: "users", action: "Call the API" }, { componentId: "api", edgeId: "users->api:calls", action: "Handle the request" }, { componentId: "db", edgeId: "api->db:writes", action: "Read or write data" }] }],
  assumptions: [],
  unknowns: [],
});

type Tab = "describe" | "json" | "image";

export function ImportDialog() {
  const open = useXRay((s) => s.importOpen);
  const setOpen = useXRay((s) => s.setImportOpen);
  const importGraph = useXRay((s) => s.importGraph);
  const loading = useXRay((s) => s.loading.ingest);
  const error = useXRay((s) => s.error);
  const ai = useXRay((s) => s.aiAvailable);
  const [tab, setTab] = useState<Tab>("describe");
  const [text, setText] = useState("");
  const [json, setJson] = useState("");
  const [image, setImage] = useState<{ base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; name: string } | null>(null);
  const [imageNote, setImageNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  if (!open) return null;

  const submit = async () => {
    setLocalError(null);
    if (tab === "describe") {
      await importGraph({ kind: "description", text });
    } else if (tab === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        setLocalError("Not valid JSON.");
        return;
      }
      await importGraph({ kind: "structured", json: parsed });
    } else if (image) {
      await importGraph({ kind: "image", image: { base64: image.base64, mediaType: image.mediaType }, text: imageNote || undefined });
    }
  };

  const loadDemoJson = async () => {
    setDemoLoading(true);
    setLocalError(null);
    try {
      const { graph: g } = await api.demo();
      setJson(JSON.stringify(g, null, 2));
    } catch {
      setLocalError("Could not load the demo graph.");
    } finally {
      setDemoLoading(false);
    }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) {
      setLocalError("Use a PNG, JPEG, WebP or GIF image.");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setLocalError("Image must be under 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setImage({ base64: dataUrl.split(",")[1], mediaType: f.type as "image/png", name: f.name });
      setLocalError(null);
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => !loading && setOpen(false)}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-line bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div>
            <Eyebrow>Destruction mode</Eyebrow>
            <div className="display text-lg">Bring your own architecture</div>
          </div>
          <button className="ml-auto text-xs text-ink-3 hover:text-terra" onClick={() => setOpen(false)}>close</button>
        </div>
        <div className="flex gap-1 border-b border-line px-4 pt-2">
          {([["describe", "Describe it"], ["json", "Paste structured JSON"], ["image", "Upload a diagram"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={clsx("relative px-3 py-2 text-xs font-medium", tab === id ? "text-ink" : "text-ink-3 hover:text-ink")}>
              {label}
              {tab === id && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-terra" />}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "describe" && (
            <div className="space-y-2">
              <p className="text-xs text-ink-2">Name the components and how they connect. Mention what is single-instance, public, backed up or autoscaled if you know it.
                {ai === false && <span className="text-warn"> No AI key configured: extraction is heuristic (vocabulary + typical layering) and every relationship is labelled as an inference.</span>}
                {ai && <span className="text-ok"> AI extraction enabled.</span>}
              </p>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder={SAMPLE} className="w-full rounded border border-line bg-sand p-2 text-xs leading-relaxed focus:border-terra" />
              <button className="text-[11px] text-terra hover:underline" onClick={() => setText(SAMPLE)}>Use the sample description</button>
            </div>
          )}
          {tab === "json" && (
            <div className="space-y-3">
              <p className="text-xs text-ink-2">This is the tool&apos;s own graph format - a full architecture, not a diagram. Everything below is required by the schema before a scan can run; use one of the templates rather than typing it from scratch.</p>
              <details className="rounded border border-line bg-sand-2 open:pb-2" open>
                <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-medium text-ink">What the JSON needs to contain</summary>
                <div className="space-y-2 px-2 text-[11px] leading-relaxed text-ink-2">
                  <div><span className="font-medium text-ink">Top level:</span> <span className="mono">id, name, description, version: 1, source, regions[], zones[], components[], edges[]</span>. <span className="mono">flows, traffic, targets, assumptions, unknowns</span> are allowed to be empty arrays/omitted.</div>
                  <div><span className="font-medium text-ink">Every zone:</span> <span className="mono">id, name, kind</span> (one of: internet, edge, public_subnet, private_subnet, isolated_subnet, managed_service, external_saas, ci_platform), <span className="mono">trustLevel</span> (0 = internet, higher = more trusted).</div>
                  <div><span className="font-medium text-ink">Every component:</span> <span className="mono">id, name, type</span> (e.g. client, service, relational_db, cache, load_balancer, queue, llm_provider - see <span className="mono">src/engine/graph/types.ts</span> for the full list), <span className="mono">layer, zoneId</span> (must match a zone above), <span className="mono">exposure</span> (public/private/internal), <span className="mono">stateful</span> (true/false), <span className="mono">criticality</span> (critical/high/medium/low), and four required objects - <span className="mono">scaling</span> (needs <span className="mono">model</span>), <span className="mono">redundancy</span> (needs <span className="mono">replicas, multiAz, multiRegion, failover</span>), <span className="mono">observability</span> (needs the four booleans <span className="mono">metrics, logs, traces, alerts</span>), <span className="mono">cost</span> (needs <span className="mono">model, category</span>) - plus <span className="mono">security: {`{}`}</span> and <span className="mono">operations: {`{}`}</span> (an empty object is valid) and an <span className="mono">evidence</span> level (fact/inference/assumption/unknown).</div>
                  <div><span className="font-medium text-ink">Every edge:</span> <span className="mono">id, source, target</span> (component ids above), <span className="mono">kind</span> (calls/reads/writes/publishes/consumes/authenticates_with/routes_to/...), <span className="mono">sync</span> (sync/async), <span className="mono">criticality</span> (hard/soft), <span className="mono">evidence</span>.</div>
                  <div>Every id must be unique, and every edge&apos;s <span className="mono">source</span>/<span className="mono">target</span> must reference a component id that exists. The dialog validates all of this and shows exactly what&apos;s wrong before importing.</div>
                </div>
              </details>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setJson(JSON.stringify(STARTER_GRAPH, null, 2))}>Load a 3-component starter</Button>
                <Button variant="secondary" onClick={loadDemoJson} disabled={demoLoading}>{demoLoading ? "Loading..." : "Load the full demo as a reference"}</Button>
              </div>
              <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={14} placeholder='{ "id": "...", "name": "...", "version": 1, "components": [...], "edges": [...] }' className="mono w-full rounded border border-line bg-sand p-2 text-[11px] focus:border-terra" />
            </div>
          )}
          {tab === "image" && (
            <div className="space-y-3">
              <p className="text-xs text-ink-2">Upload an architecture diagram (PNG/JPEG/WebP). The AI layer reads it into the structured graph, marking explicit elements as facts and everything else as inference or unknown.
                {ai === false && <span className="text-bad"> Diagram ingestion needs ANTHROPIC_API_KEY; it is not configured on this server.</span>}
              </p>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => onFile(e.target.files?.[0])} className="block text-xs" disabled={ai === false} />
              {image && <div className="mono text-[11px] text-ink-3">{image.name}</div>}
              <input value={imageNote} onChange={(e) => setImageNote(e.target.value)} placeholder="Optional notes about the diagram (region, scale, what is not shown)" className="w-full rounded border border-line bg-sand p-2 text-xs" />
            </div>
          )}
          {(localError || error) && <div className="mt-3 rounded border border-bad/30 bg-bad-soft p-2 text-xs text-bad">{localError ?? error}</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <span className="text-[11px] text-ink-3">Nothing is stored; the graph lives in your browser session.</span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button onClick={submit} disabled={loading || (tab === "describe" && text.trim().length < 20) || (tab === "json" && !json.trim()) || (tab === "image" && (!image || ai === false))}>{loading ? "Extracting..." : "Import and open"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
