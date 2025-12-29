"use client";

import React from "react";

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

export function Badge({
  label,
  variant,
}: {
  label: string;
  variant: "changed" | "added" | "removed" | "findings" | "critical" | "suggestions";
}) {
  // ✅ Use theme-aware CSS variables you already defined in configdiff.css
  const dot = (() => {
    if (variant === "added") return "var(--badge-dot-added)";
    if (variant === "removed") return "var(--badge-dot-removed)";
    if (variant === "changed") return "var(--badge-dot-changed)";
    if (variant === "critical") return "var(--badge-dot-critical)";
    if (variant === "suggestions") return "var(--badge-dot-suggestions)";
    return "var(--badge-dot-findings)";
  })();

  return (
    <span className="badge" style={{ ["--dot" as any]: dot }}>
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
}: {
  title: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
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
          {title}
        </h2>
        {rightSlot ?? null}
      </div>
      <div className="cd-card" style={{ marginTop: 10 }}>
        {children}
      </div>
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
