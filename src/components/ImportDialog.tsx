"use client";
import { useState } from "react";
import clsx from "clsx";
import { useXRay } from "@/lib/store";
import { Button, Eyebrow } from "@/components/ui";

const SAMPLE = `A B2C fitness app for 250k users on AWS. React frontend behind CloudFront and a WAF. Node.js API on ECS Fargate with autoscaling. Single RDS PostgreSQL instance with daily backups. Redis on ElastiCache for sessions. S3 for photos. SQS queue with background workers for video processing. Cognito for authentication. OpenAI for workout recommendations. CloudWatch for monitoring and GitHub Actions for CI/CD.`;

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
            <div className="space-y-2">
              <p className="text-xs text-ink-2">Paste an ArchitectureGraph JSON document (the format used by this tool; export one from the demo via <span className="mono">GET /api/demo</span>, or from Architect mode). It is validated before analysis.</p>
              <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={12} placeholder='{ "id": "...", "name": "...", "version": 1, "components": [...], "edges": [...] }' className="mono w-full rounded border border-line bg-sand p-2 text-[11px] focus:border-terra" />
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
