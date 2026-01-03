"use client";

import React, { useState } from "react";

export function ActionButton({
  children,
  onClick,
  title,
  variant = "default",
  type = "button",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  variant?: "default" | "primary" | "subtle";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const cls = ["btn"];
  if (variant === "primary") cls.push("primary");
  if (variant === "subtle") cls.push("subtle");

  return (
    <button
      type={type}
      onClick={onClick}
      className={cls.join(" ")}
      title={title}
      disabled={disabled}
      aria-disabled={disabled ? "true" : "false"}
    >
      {children}
    </button>
  );
}

export function Pill({ text }: { text: string }) {
  return (
    <span className="pill" title={text}>
      {text}
    </span>
  );
}

/** ✅ Badge colors should be colorful in BOTH light + dark */
type BadgeVariant = "changed" | "added" | "removed" | "findings" | "critical" | "suggestions";

const BADGE_COLORS: Record<BadgeVariant, string> = {
  findings: "#8B5CF6", // violet
  critical: "#EF4444", // red
  suggestions: "#F59E0B", // amber
  changed: "#3B82F6", // blue
  added: "#10B981", // green
  removed: "#F97316", // orange
};

export function Badge({ label, variant }: { label: string; variant: BadgeVariant }) {
  const c = BADGE_COLORS[variant] ?? "#64748B";

  // We pass a single color token to CSS; CSS can tint bg/border consistently in light/dark.
  return (
    <span className="badge" data-variant={variant} style={{ ["--dot" as any]: c }}>
      <span className="dot" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Severity filter chip for Validate tab.
 * Click to toggle showing that severity in the issues list.
 */
export function SevChip({
  sev,
  count,
  checked,
  onChange,
  title,
}: {
  sev: "high" | "medium" | "low";
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  const label = sev === "high" ? "High" : sev === "medium" ? "Medium" : "Low";

  return (
    <button
      type="button"
      className="sevChip"
      data-sev={sev}
      data-on={checked ? "true" : "false"}
      aria-pressed={checked}
      title={title ?? `Toggle ${label} issues`}
      onClick={() => onChange(!checked)}
    >
      <span className="dot" aria-hidden />
      <span className="mono" style={{ fontSize: 12, opacity: checked ? 0.95 : 0.7 }}>
        {checked ? "✓" : " "}
      </span>
      {label}: {count}
    </button>
  );
}

export function Section({
  title,
  children,
  rightSlot,
  collapsible = true,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  /** If true, header toggles open/closed (default: true) */
  collapsible?: boolean;
  /** Initial open state when collapsible (default: true) */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  const showBody = !collapsible || open;

  return (
    <section style={{ marginTop: 18 }}>
      <div className="sectionTitleRow">
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 900,
            letterSpacing: "-0.01em",
          }}
        >
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              title={open ? "Collapse" : "Expand"}
              style={{
                all: "unset",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span aria-hidden style={{ width: 14, display: "inline-block", opacity: 0.9 }}>
                {open ? "▾" : "▸"}
              </span>
              <span>{title}</span>
            </button>
          ) : (
            title
          )}
        </h2>

        {rightSlot ? (
          // Prevent clicks on the rightSlot (e.g., "Copy keys") from toggling the section
          <div
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {rightSlot}
          </div>
        ) : null}
      </div>

      {showBody ? (
        <div className="cd-card" style={{ marginTop: 10 }}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <div className="mono" style={{ fontSize: 13 }}>
        {k}
      </div>
      <div className="mono" style={{ opacity: 0.92, fontSize: 13 }}>
        {v}
      </div>
    </div>
  );
}

export function RowNode({ k, vNode }: { k: string; vNode: React.ReactNode }) {
  return (
    <div className="row">
      <div className="mono" style={{ fontSize: 13 }}>
        {k}
      </div>
      <div style={{ opacity: 0.98, fontSize: 13 }}>{vNode}</div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  // Match CSS expectations: .btn.toggle[data-on="true|false"]
  const cls = ["btn", "toggle"];

  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cls.join(" ")}
      data-on={checked ? "true" : "false"}
      aria-pressed={checked}
      title={checked ? "On" : "Off"}
    >
      {checked ? "✓ " : ""}
      {label}
    </button>
  );
}
