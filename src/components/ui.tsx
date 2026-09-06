"use client";
import clsx from "clsx";
import type { ReactNode } from "react";
import type { Severity, Confidence } from "@/engine/analysis/types";
import type { EvidenceLevel } from "@/engine/graph/types";

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const map: Record<Severity, string> = {
    critical: "bg-bad text-white",
    high: "bg-bad-soft text-bad",
    medium: "bg-warn-soft text-warn",
    low: "bg-info-soft text-info",
    info: "bg-sand-3 text-ink-3",
  };
  return <span className={clsx("inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", map[severity], className)}>{severity}</span>;
}

export function EvidenceChip({ level }: { level: EvidenceLevel }) {
  const map: Record<EvidenceLevel, string> = {
    fact: "bg-ok-soft text-ok",
    inference: "bg-info-soft text-info",
    assumption: "bg-warn-soft text-warn",
    unknown: "bg-sand-3 text-ink-3",
  };
  return <span className={clsx("mono inline-block shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", map[level])}>{level}</span>;
}

export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return <span className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3">confidence: {confidence}</span>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("eyebrow", className)}>{children}</div>;
}

export function Button({ children, onClick, variant = "primary", disabled, className, title }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "danger" | "ghost"; disabled?: boolean; className?: string; title?: string }) {
  const v = {
    primary: "bg-ink text-sand hover:bg-terra",
    secondary: "border border-line-2 bg-white text-ink hover:border-terra hover:text-terra",
    danger: "bg-bad text-white hover:bg-[#8f1c13]",
    ghost: "text-ink-2 hover:text-terra",
  }[variant];
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={clsx("rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50", v, className)}>
      {children}
    </button>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "ok" | "warn" | "bad" | "neutral" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="panel rounded p-3">
      <div className="eyebrow">{label}</div>
      <div className={clsx("display mt-1 text-2xl font-semibold", color)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function ScoreBar({ label, score, confidence, reason, applicable = true, before }: { label: string; score: number; confidence?: Confidence; reason?: string; applicable?: boolean; before?: number }) {
  const tone = score >= 75 ? "bg-ok" : score >= 50 ? "bg-warn" : "bg-bad";
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium capitalize">{label}</span>
        <span className="mono text-xs">
          {applicable ? (
            <>
              {before !== undefined && before !== score && <span className="text-ink-3">{before} {"->"} </span>}
              <span className={score >= 75 ? "text-ok" : score >= 50 ? "text-warn" : "text-bad"}>{score}</span>/100
            </>
          ) : (
            <span className="text-ink-3">n/a</span>
          )}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded bg-sand-3">
        {applicable && <div className={clsx("h-1.5 rounded", tone)} style={{ width: `${score}%` }} />}
      </div>
      {reason && applicable && (
        <div className="mt-1 flex items-start gap-2 text-[11px] text-ink-2">
          <span className="flex-1">{reason}</span>
          {confidence && <span className="mono shrink-0 text-ink-3">{confidence}</span>}
        </div>
      )}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="display text-lg text-ink">{title}</div>
      {body && <div className="mt-1 max-w-md text-xs text-ink-3">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  if (v === undefined || v === null || v === "") return null;
  return (
    <div className="flex gap-2 py-0.5 text-xs">
      <span className="w-28 shrink-0 text-ink-3">{k}</span>
      <span className="min-w-0 flex-1 break-words text-ink">{typeof v === "boolean" ? (v ? "yes" : "no") : v}</span>
    </div>
  );
}

export function money(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}
