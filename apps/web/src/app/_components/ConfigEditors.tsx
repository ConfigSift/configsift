"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "./configdiff-ui";
import type { FormatId } from "../lib/shareState";

type Side = "left" | "right";

type LineAnnotation = {
  lineStart: number;
  lineEnd: number;
  severity: "high" | "medium" | "low" | "info";
  label: string;
};

type JumpTo = { side: Side; line: number } | null;

function buildLineIndex(annotations: LineAnnotation[]) {
  const byLine = new Map<number, LineAnnotation[]>();
  for (const a of annotations) {
    const start = Math.max(1, Number(a.lineStart) || 1);
    const end = Math.max(start, Number((a as any).lineEnd ?? a.lineStart) || start);
    for (let ln = start; ln <= end; ln++) {
      const arr = byLine.get(ln) ?? [];
      arr.push(a);
      byLine.set(ln, arr);
    }
  }
  return byLine;
}

function bestSeverity(list: LineAnnotation[] | undefined): LineAnnotation["severity"] | null {
  if (!list || list.length === 0) return null;
  const rank: Record<string, number> = { high: 3, medium: 2, low: 1, info: 0 };
  let best = list[0];
  for (const a of list) if ((rank[a.severity] ?? 0) > (rank[best.severity] ?? 0)) best = a;
  return best.severity;
}

function toFiniteLine(n: any): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(1, Math.floor(x));
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function ConfigEditors(props: {
  format: FormatId;

  leftDraft: string;
  rightDraft: string;

  setLeftDraft: (v: string) => void;
  setRightDraft: (v: string) => void;

  dragOver: { left: boolean; right: boolean };
  onDrop: (side: Side, e: React.DragEvent) => void;
  onDragOver: (side: Side, e: React.DragEvent) => void;
  onDragLeave: (side: Side, e: React.DragEvent) => void;

  onPaste: (side: Side) => void;
  onUpload: (side: Side) => void;
  onClear: (side: Side) => void;

  leftAnnotations?: LineAnnotation[];
  rightAnnotations?: LineAnnotation[];
  jumpTo?: JumpTo;

  onConsumeJumpTo?: () => void;
}) {
  const { format } = props;

  const placeholder =
    format === "json"
      ? "Paste or drop JSON here…"
      : format === "yaml"
      ? "Paste or drop YAML here…"
      : "Paste or drop a .env here…";

  const tip = `Tip: drag & drop a ${format === "json" ? ".json" : format === "yaml" ? ".yml/.yaml" : ".env"} file here`;
  const title = "Drop a .env, .json, or .yml/.yaml file here";

  const [open, setOpen] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const [flash, setFlash] = useState<{ side: Side; line: number } | null>(null);

  // Optional notice when clamped (EOF / cap)
  const [jumpNotice, setJumpNotice] = useState<{ left?: string; right?: string }>({});
  const jumpNoticeTimerRef = useRef<{ left?: number; right?: number }>({});

  const leftAnn = props.leftAnnotations ?? [];
  const rightAnn = props.rightAnnotations ?? [];

  const leftIndex = useMemo(() => buildLineIndex(leftAnn), [leftAnn]);
  const rightIndex = useMemo(() => buildLineIndex(rightAnn), [rightAnn]);

  const leftPreviewRef = useRef<HTMLDivElement | null>(null);
  const rightPreviewRef = useRef<HTMLDivElement | null>(null);

  const MAX_LINES = 2000;

  const leftLines = useMemo(() => props.leftDraft.split("\n"), [props.leftDraft]);
  const rightLines = useMemo(() => props.rightDraft.split("\n"), [props.rightDraft]);

  const leftLinesForRender = leftLines.slice(0, MAX_LINES);
  const rightLinesForRender = rightLines.slice(0, MAX_LINES);

  /**
   * 🔒 Scroll lock:
   * Keep desired scrollTop alive long enough to survive subsequent renders
   * (including flash on/off which happens at ~900ms).
   */
  const scrollLockRef = useRef<{
    left?: { top: number; until: number };
    right?: { top: number; until: number };
  }>({});

  const rafKeepAliveRef = useRef<number | null>(null);
  const tKeepAliveRef = useRef<number | null>(null);

  const getBoxRef = (side: Side) => (side === "left" ? leftPreviewRef : rightPreviewRef);

  const applyLockIfActive = (side: Side) => {
    const lock = scrollLockRef.current[side];
    const boxEl = getBoxRef(side).current;
    if (!lock || !boxEl) return;

    const now = Date.now();
    if (now > lock.until) return;

    if (Math.abs(boxEl.scrollTop - lock.top) > 1) {
      boxEl.scrollTop = lock.top;
    }
  };

  // Re-apply locked scroll after *any* render (layout phase, before paint)
  useLayoutEffect(() => {
    applyLockIfActive("left");
    applyLockIfActive("right");
    // intentionally no deps
  });

  const cleanupKeepAlive = () => {
    if (rafKeepAliveRef.current) cancelAnimationFrame(rafKeepAliveRef.current);
    rafKeepAliveRef.current = null;
    if (tKeepAliveRef.current) window.clearTimeout(tKeepAliveRef.current);
    tKeepAliveRef.current = null;
  };

  // ✅ Extended keepalive to survive flash clear + other state updates
  const startKeepAlive = (side: Side, top: number, ms = 2200) => {
    cleanupKeepAlive();

    const until = Date.now() + ms;
    scrollLockRef.current[side] = { top, until };

    const tick = () => {
      applyLockIfActive(side);
      const lock = scrollLockRef.current[side];
      if (lock && Date.now() <= lock.until) {
        rafKeepAliveRef.current = requestAnimationFrame(tick);
      } else {
        rafKeepAliveRef.current = null;
      }
    };

    rafKeepAliveRef.current = requestAnimationFrame(tick);

    // hard stop slightly after lock window
    tKeepAliveRef.current = window.setTimeout(() => {
      const lock = scrollLockRef.current[side];
      if (lock) scrollLockRef.current[side] = { ...lock, until: 0 };
      cleanupKeepAlive();
    }, ms + 100);
  };

  const animateScrollTo = (side: Side, el: HTMLDivElement, targetTop: number) => {
    const startTop = el.scrollTop;
    const delta = targetTop - startTop;
    const duration = 220;

    // Lock immediately; we will keep updating lock.top as we animate
    startKeepAlive(side, startTop);

    const startTime = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - startTime) / duration);
      const eased = easeInOutQuad(p);
      const cur = startTop + delta * eased;

      el.scrollTop = cur;

      // keep lock aligned with the animation position
      const lock = scrollLockRef.current[side];
      if (lock && Date.now() <= lock.until) {
        scrollLockRef.current[side] = { ...lock, top: cur };
      }

      if (p < 1) requestAnimationFrame(step);
      else {
        // ✅ Re-pin at the final position and refresh lock window
        el.scrollTop = targetTop;
        startKeepAlive(side, targetTop);

        // Extra “pins” after paint to defeat late snapping
        window.setTimeout(() => {
          el.scrollTop = targetTop;
          startKeepAlive(side, targetTop);
        }, 0);
        window.setTimeout(() => {
          el.scrollTop = targetTop;
          startKeepAlive(side, targetTop);
        }, 250);
        window.setTimeout(() => {
          el.scrollTop = targetTop;
          startKeepAlive(side, targetTop);
        }, 800);
      }
    };

    requestAnimationFrame(step);
  };

  const setNotice = (side: Side, msg: string) => {
    const prev = jumpNoticeTimerRef.current[side];
    if (prev) window.clearTimeout(prev);

    setJumpNotice((p) => ({ ...p, [side]: msg }));

    jumpNoticeTimerRef.current[side] = window.setTimeout(() => {
      setJumpNotice((p) => ({ ...p, [side]: undefined }));
    }, 2200);
  };

  // ✅ Jump-to-line: open preview, scroll container to row, flash highlight
  useEffect(() => {
    const j = props.jumpTo ?? null;
    if (!j) return;

    const side = j.side;
    const requested = toFiniteLine(j.line);

    if (!requested) {
      props.onConsumeJumpTo?.();
      return;
    }

    setOpen((prev) => ({ ...prev, [side]: true }));

    const boxRef = getBoxRef(side);

    let raf = 0;
    let tries = 0;

    const tryScroll = () => {
      tries++;

      const boxEl = boxRef.current;
      const total = side === "left" ? leftLines.length : rightLines.length;
      const renderedMax = Math.min(MAX_LINES, total === 0 ? 1 : total);

      let targetLine = requested;
      let clampedReason: "cap" | "eof" | null = null;

      if (requested > MAX_LINES) {
        targetLine = renderedMax;
        clampedReason = "cap";
      }
      if (requested > total && total > 0) {
        targetLine = renderedMax;
        clampedReason = "eof";
      }
      targetLine = clamp(targetLine, 1, renderedMax);

      const id = `cd-prev-${side}-L${targetLine}`;
      const row = document.getElementById(id) as HTMLElement | null;

      if (row && boxEl) {
        const boxRect = boxEl.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();

        const rowTopInBox = rowRect.top - boxRect.top + boxEl.scrollTop;
        const maxTop = Math.max(0, boxEl.scrollHeight - boxEl.clientHeight);
        const targetTop = clamp(rowTopInBox - Math.floor(boxEl.clientHeight / 2), 0, maxTop);

        animateScrollTo(side, boxEl, targetTop);

        setFlash({ side, line: targetLine });
        window.setTimeout(() => setFlash(null), 900);

        if (clampedReason === "cap") {
          setNotice(
            side,
            `Requested L${requested}. Preview is capped at ${MAX_LINES} lines (file has ${total}). Jumped to L${targetLine}.`
          );
        } else if (clampedReason === "eof") {
          setNotice(side, `Requested L${requested}, but file has ${total} lines. Jumped to L${targetLine}.`);
        }

        props.onConsumeJumpTo?.();
        return;
      }

      if (tries < 30) raf = window.requestAnimationFrame(tryScroll);
      else props.onConsumeJumpTo?.();
    };

    raf = window.requestAnimationFrame(tryScroll);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.jumpTo, leftLines.length, rightLines.length]);

  const PreviewFooter = ({ side }: { side: Side }) => {
    const isOpen = open[side];
    const hasText = (side === "left" ? props.leftDraft : props.rightDraft).trim().length > 0;

    return (
      <div className="cd-editorFooter">
        <div className="mutedSm">{tip}</div>

        <div className="cd-editorFooterRight">
          <ActionButton
            variant="subtle"
            onClick={() => setOpen((p) => ({ ...p, [side]: !p[side] }))}
            title="Show a line-numbered preview (used for jumping to findings)"
            disabled={!hasText}
          >
            {isOpen ? "Preview ▾" : "Preview ▸"}
          </ActionButton>
          <span className="mutedSm" style={{ opacity: 0.9 }}>
            Line preview
          </span>
        </div>
      </div>
    );
  };

  const PreviewBox = ({ side }: { side: Side }) => {
    const isOpen = open[side];
    if (!isOpen) return null;

    const lines = side === "left" ? leftLinesForRender : rightLinesForRender;
    const total = side === "left" ? leftLines.length : rightLines.length;
    const idx = side === "left" ? leftIndex : rightIndex;
    const boxRef = side === "left" ? leftPreviewRef : rightPreviewRef;

    const truncated = total > MAX_LINES;
    const notice = (side === "left" ? jumpNotice.left : jumpNotice.right) ?? null;

    return (
      <div className="cd-previewWrap">
        {notice ? (
          <div className="callout callout-info" style={{ marginTop: 10, marginBottom: 10 }}>
            {notice}
          </div>
        ) : null}

        <div ref={boxRef} className="cd-previewBox" role="region" aria-label={`${side} preview`}>
          {lines.map((txt, i) => {
            const lineNo = i + 1;
            const hits = idx.get(lineNo);
            const sev = bestSeverity(hits);
            const hit = !!sev;

            const isFlash = flash?.side === side && flash?.line === lineNo;

            return (
              <div
                key={`${side}-${lineNo}`}
                id={`cd-prev-${side}-L${lineNo}`}
                className={`cd-lineRow${isFlash ? " flash" : ""}`}
                data-hit={hit ? "true" : "false"}
                data-sev={sev ?? ""}
                title={hits?.[0]?.label ? String(hits[0].label) : undefined}
              >
                <div className="cd-gutter">
                  <span className="cd-ln">{lineNo}</span>
                  <span className="cd-gutterMark" aria-hidden="true" />
                </div>
                <pre className="cd-lineText">{txt.length ? txt : " "}</pre>
              </div>
            );
          })}
        </div>

        {truncated ? (
          <div className="mutedSm" style={{ marginTop: 8 }}>
            Preview capped at {MAX_LINES} lines (file has {total}). Jump will go to the nearest available line.
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="twoCol" style={{ marginTop: 14 }}>
      {/* LEFT */}
      <div className="cd-card">
        <div className="cd-cardHeader">
          <div>
            <div className="cd-cardTitle">Environment 1</div>
            <div className="cd-cardHint">e.g., production</div>
          </div>

          <div className="cd-actions">
            <ActionButton onClick={() => props.onPaste("left")} title="Paste from clipboard into Left">
              Paste
            </ActionButton>
            <ActionButton variant="primary" onClick={() => props.onUpload("left")}>
              Upload
            </ActionButton>
            <ActionButton variant="subtle" onClick={() => props.onClear("left")}>
              Clear
            </ActionButton>
          </div>
        </div>

        <div
          className="dropZone"
          data-active={props.dragOver.left ? "true" : "false"}
          onDrop={(e) => props.onDrop("left", e)}
          onDragOver={(e) => props.onDragOver("left", e)}
          onDragLeave={(e) => props.onDragLeave("left", e)}
          title={title}
        >
          <textarea
            value={props.leftDraft}
            onChange={(e) => props.setLeftDraft(e.target.value)}
            placeholder={placeholder}
            className="cd-textarea"
          />

          <PreviewFooter side="left" />
          <PreviewBox side="left" />
        </div>
      </div>

      {/* RIGHT */}
      <div className="cd-card">
        <div className="cd-cardHeader">
          <div>
            <div className="cd-cardTitle">Environment 2</div>
            <div className="cd-cardHint">e.g., staging</div>
          </div>

          <div className="cd-actions">
            <ActionButton onClick={() => props.onPaste("right")} title="Paste from clipboard into Right">
              Paste
            </ActionButton>
            <ActionButton variant="primary" onClick={() => props.onUpload("right")}>
              Upload
            </ActionButton>
            <ActionButton variant="subtle" onClick={() => props.onClear("right")}>
              Clear
            </ActionButton>
          </div>
        </div>

        <div
          className="dropZone"
          data-active={props.dragOver.right ? "true" : "false"}
          onDrop={(e) => props.onDrop("right", e)}
          onDragOver={(e) => props.onDragOver("right", e)}
          onDragLeave={(e) => props.onDragLeave("right", e)}
          title={title}
        >
          <textarea
            value={props.rightDraft}
            onChange={(e) => props.setRightDraft(e.target.value)}
            placeholder={placeholder}
            className="cd-textarea"
          />

          <PreviewFooter side="right" />
          <PreviewBox side="right" />
        </div>
      </div>
    </div>
  );
}
