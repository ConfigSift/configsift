"use client";

import React, { useEffect, useMemo, useRef } from "react";

export type MarkerSeverity = "high" | "medium" | "low";

export type GutterMarker = {
  startLine: number; // 1-based
  endLine?: number; // inclusive, 1-based
  severity: MarkerSeverity;
  label?: string;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function iconForSeverity(sev: MarkerSeverity) {
  if (sev === "high") return "🔴";
  if (sev === "medium") return "⚠️";
  return "⚠️";
}

function maxSev(a: MarkerSeverity, b: MarkerSeverity): MarkerSeverity {
  const rank = (s: MarkerSeverity) => (s === "high" ? 3 : s === "medium" ? 2 : 1);
  return rank(a) >= rank(b) ? a : b;
}

export function CodeWithGutter(props: {
  text: string;
  markers?: GutterMarker[];
  focusLine?: number | null; // 1-based
  onDidFocusLine?: () => void;
  maxHeight?: number;
}) {
  const { text, markers = [], focusLine, onDidFocusLine, maxHeight = 260 } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => {
    // preserve last empty line if text ends with \n
    const raw = text.replace(/\r\n/g, "\n");
    const arr = raw.split("\n");
    return arr;
  }, [text]);

  const markerMap = useMemo(() => {
    // line -> best severity + list of labels
    const map = new Map<number, { severity: MarkerSeverity; labels: string[]; isInRange: boolean }>();

    const safeMarkers = (markers ?? []).filter((m) => Number.isFinite(m.startLine) && m.startLine >= 1);
    for (const m of safeMarkers) {
      const start = Math.max(1, Math.floor(m.startLine));
      const end = Math.max(start, Math.floor(m.endLine ?? m.startLine));
      for (let ln = start; ln <= end; ln++) {
        const prev = map.get(ln);
        const labels = prev?.labels ?? [];
        if (m.label) labels.push(m.label);
        map.set(ln, {
          severity: prev ? maxSev(prev.severity, m.severity) : m.severity,
          labels,
          isInRange: end > start ? true : prev?.isInRange ?? false,
        });
      }
    }
    return map;
  }, [markers]);

  useEffect(() => {
    if (!focusLine || !wrapRef.current) return;

    const ln = clamp(Math.floor(focusLine), 1, Math.max(1, lines.length));
    const el = wrapRef.current.querySelector(`[data-line="${ln}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("cd-codeRowFlash");
      window.setTimeout(() => el.classList.remove("cd-codeRowFlash"), 900);
      onDidFocusLine?.();
    }
  }, [focusLine, lines.length, onDidFocusLine]);

  return (
    <div
      ref={wrapRef}
      className="cd-codeWrap"
      style={{ maxHeight, overflow: "auto" }}
      role="region"
      aria-label="Preview with line numbers"
    >
      <div className="cd-code">
        {lines.map((line, idx) => {
          const ln = idx + 1;
          const info = markerMap.get(ln);
          const sev = info?.severity;
          const hasMark = !!sev;
          const icon = hasMark ? iconForSeverity(sev!) : "";

          return (
            <div
              key={ln}
              className="cd-codeRow"
              data-line={ln}
              data-sev={sev ?? ""}
              data-range={info?.isInRange ? "true" : "false"}
              title={info?.labels?.length ? info.labels.join("\n") : undefined}
            >
              <div className="cd-codeGutter">
                <span className="cd-codeLineNo">{ln}</span>
                <span className="cd-codeMarker" aria-hidden="true">
                  {icon}
                </span>
              </div>

              <pre className="cd-codeText">
                <code>{line.length ? line : "\u00A0"}</code>
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
