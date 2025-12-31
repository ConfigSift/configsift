"use client";

import React, { useEffect, useMemo, useRef } from "react";

type Side = "left" | "right";

type ThemeLike = {
  card: string;
  card2: string;
  border: string;
  borderSoft: string;
  text: string;
  muted: string;
  blueSoft: string;
};

export function LineNumberPreview(props: {
  side: Side;
  title?: string;
  text: string;
  open: boolean;
  onToggle: () => void;
  highlightLine?: number | null;
  theme: ThemeLike;
}) {
  const { side, title = "Line numbers", text, open, onToggle, highlightLine, theme } = props;

  const lines = useMemo(() => String(text ?? "").replace(/\r\n/g, "\n").split("\n"), [text]);

  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!highlightLine) return;

    const el = boxRef.current?.querySelector(`[data-ln="${highlightLine}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: "center" });
  }, [open, highlightLine]);

  const headerBtnStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 12,
    border: `1px solid ${theme.borderSoft}`,
    background: theme.card2,
    color: theme.text,
    cursor: "pointer",
    userSelect: "none",
    fontSize: 13,
    fontWeight: 780,
    letterSpacing: "-0.01em",
  };

  const codeBoxStyle: React.CSSProperties = {
    marginTop: 8,
    borderRadius: 14,
    border: `1px solid ${theme.borderSoft}`,
    background: theme.card,
    overflow: "hidden",
  };

  const scrollerStyle: React.CSSProperties = {
    maxHeight: 220,
    overflow: "auto",
  };

  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "56px 1fr",
    gap: 10,
    padding: "4px 10px",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 12.5,
    lineHeight: 1.5,
    whiteSpace: "pre",
  };

  const lnStyle: React.CSSProperties = {
    color: theme.muted,
    opacity: 0.9,
    textAlign: "right",
    paddingRight: 6,
    borderRight: `1px solid ${theme.borderSoft}`,
  };

  const textStyle: React.CSSProperties = {
    color: theme.text,
    opacity: 0.92,
    paddingLeft: 6,
  };

  const hiRowStyle: React.CSSProperties = {
    background: theme.blueSoft,
    boxShadow: `inset 0 0 0 1px ${theme.borderSoft}`,
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={headerBtnStyle}
        title={open ? "Collapse" : "Expand"}
      >
        <span>
          {title} <span style={{ color: theme.muted, fontWeight: 650 }}>({side})</span>
        </span>
        <span style={{ color: theme.muted, fontWeight: 850 }}>{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <div style={codeBoxStyle}>
          <div ref={boxRef} style={scrollerStyle}>
            {lines.map((ln, i) => {
              const n = i + 1;
              const isHi = highlightLine === n;
              return (
                <div
                  key={`${side}-${n}`}
                  data-ln={n}
                  style={{
                    ...rowStyle,
                    ...(isHi ? hiRowStyle : null),
                  }}
                >
                  <div style={lnStyle}>{n}</div>
                  <div style={textStyle}>{ln.length ? ln : " "}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
