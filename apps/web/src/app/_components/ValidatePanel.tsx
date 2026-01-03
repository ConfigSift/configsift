"use client";

import React from "react";
import { ActionButton, Toggle, SevChip } from "./configdiff-ui";
import { trackEvent } from "../lib/analytics";

type Side = "left" | "right";

type Theme = {
  card2?: string;
  text?: string;
  borderSoft?: string;
  blueSoft?: string;
  blueSoft2?: string;
  shadowSm?: string;
};

type ValidateTotals = { high?: number; medium?: number; low?: number };

type ValidatePanelProps = {
  THEME: Theme;

  /** control which part renders */
  section?: "summary" | "findings" | "both";

  /** Optional: customize headings in the findings columns */
  leftLabel?: string;
  rightLabel?: string;

  hasAnyDraft: boolean;
  validateIsStale: boolean;
  validateHasRun: boolean;
  validateRunning: boolean;
  runValidate: () => void;

  hasValidateError: boolean;
  validateErrorMsg?: string;

  validateTotals: ValidateTotals;

  yamlStrict: boolean;
  setYamlStrict: (v: boolean) => void;

  vSevHigh: boolean;
  setVSevHigh: (v: boolean) => void;
  vSevMed: boolean;
  setVSevMed: (v: boolean) => void;
  vSevLow: boolean;
  setVSevLow: (v: boolean) => void;

  // filtered issues
  leftIssues?: any[];
  rightIssues?: any[];

  // all issues (support both prop names)
  leftIssuesAll?: any[];
  rightIssuesAll?: any[];
  leftIssuesAllRaw?: any[];
  rightIssuesAllRaw?: any[];

  onJumpToLine?: (side: Side, line: number) => void;
};

function normSev(sev: any): "high" | "medium" | "low" | "info" {
  const s = String(sev ?? "").toLowerCase();
  if (s.includes("high") || s.includes("crit") || s.includes("error")) return "high";
  if (s.includes("med") || s.includes("warn")) return "medium";
  if (s.includes("low")) return "low";
  return "info";
}

function extractLineStart(issue: any): number | null {
  if (!issue) return null;

  const direct =
    typeof issue.line === "number"
      ? issue.line
      : typeof issue?.__lineStart === "number"
      ? issue.__lineStart
      : typeof issue?.loc?.line === "number"
      ? issue.loc.line
      : typeof issue?.location?.line === "number"
      ? issue.location.line
      : null;

  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;

  const tryParse = (s: string): number | null => {
    if (!s) return null;

    const mSide = s.match(/\b(?:left|right)\s*[:\-]?\s*line\s*[:\s]+(\d+)\b/i);
    if (mSide) {
      const n = Number(mSide[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }

    const mAt = s.match(/\bat\s+line\s+(\d+)\b/i);
    if (mAt) {
      const n = Number(mAt[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }

    const matches = [...s.matchAll(/line\s*[:\s]+(\d+)/gi)];
    if (matches.length) {
      const n = Number(matches[matches.length - 1][1]);
      if (Number.isFinite(n) && n > 0) return n;
    }

    const mLR = s.match(/\b[LR](\d+)\b/i);
    if (mLR) {
      const n = Number(mLR[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }

    return null;
  };

  const keyish = String(issue.key ?? issue.id ?? issue.path ?? issue.name ?? "");
  const fromKeyish = tryParse(keyish);
  if (fromKeyish) return fromKeyish;

  const msg = String(issue.message ?? issue.error ?? issue.details ?? issue.msg ?? issue.text ?? "");
  const fromMsg = tryParse(msg);
  if (fromMsg) return fromMsg;

  return null;
}

export function ValidatePanel(props: ValidatePanelProps) {
  const THEME = props.THEME ?? {};
  const section = props.section ?? "both";

  // ✅ If both envs are cleared, force findings to clear in the UI even if parent still has stale arrays
  const hasDraft = !!props.hasAnyDraft;

  const leftIssues = hasDraft && Array.isArray(props.leftIssues) ? props.leftIssues : [];
  const rightIssues = hasDraft && Array.isArray(props.rightIssues) ? props.rightIssues : [];

  const leftAll = hasDraft
    ? (Array.isArray(props.leftIssuesAll) && props.leftIssuesAll) ||
      (Array.isArray(props.leftIssuesAllRaw) && props.leftIssuesAllRaw) ||
      []
    : [];

  const rightAll = hasDraft
    ? (Array.isArray(props.rightIssuesAll) && props.rightIssuesAll) ||
      (Array.isArray(props.rightIssuesAllRaw) && props.rightIssuesAllRaw) ||
      []
    : [];

  const totalFiltered = leftIssues.length + rightIssues.length;
  const totalAll = leftAll.length + rightAll.length;

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const trackJump = (from: string, side: Side, line: number) => {
    trackEvent("validate_jump_to_line", { from, side, line });
  };

  const renderIssue = (side: Side, it: any, idx: number) => {
    const sev = normSev(it?.severity);
    const line = extractLineStart(it);
    const canJump = typeof line === "number" && Number.isFinite(line) && line > 0 && !!props.onJumpToLine;

    return (
      <div
        key={`${side}-${idx}-${String(it?.key ?? "Syntax")}`}
        className="finding"
        data-sev={sev}
        role={canJump ? "button" : undefined}
        tabIndex={canJump ? 0 : -1}
        onClick={() => {
          if (!canJump) return;
          trackJump("issue_card", side, line!);
          props.onJumpToLine?.(side, line!);
        }}
        onKeyDown={(e) => {
          if (!canJump) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            trackJump("issue_card_kbd", side, line!);
            props.onJumpToLine?.(side, line!);
          }
        }}
        style={canJump ? { cursor: "pointer" } : undefined}
        title={canJump ? "Click to jump to the corresponding line in the preview" : undefined}
      >
        <div className="findingTop">
          <div className="mono findingKey">{it?.key ? String(it.key) : "Syntax"}</div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canJump ? (
              <button
                type="button"
                className="cd-linePill"
                onMouseDown={(e) => stop(e)}
                onClick={(e) => {
                  stop(e);
                  trackJump("issue_pill", side, line!);
                  props.onJumpToLine?.(side, line!);
                }}
                title={`Jump to ${side === "left" ? "Left" : "Right"} ${side === "left" ? "L" : "R"}${line}`}
              >
                {side === "left" ? "L" : "R"}
                {line}
              </button>
            ) : null}

            <span className={`sev sev-${sev}`}>{sev}</span>
          </div>
        </div>

        <div className="findingMsg">{String(it?.message ?? it?.details ?? it?.error ?? "")}</div>
      </div>
    );
  };

  const Summary = () => {
    const statusPill =
      props.validateRunning
        ? "Validating…"
        : !props.hasAnyDraft
        ? "Not ready"
        : props.validateHasRun
        ? props.validateIsStale
          ? "Edited"
          : "Validated"
        : "Not validated";

    const helperText =
      !props.hasAnyDraft
        ? "Paste/upload Env 1 + Env 2 to validate"
        : props.validateIsStale
        ? "Draft changed — run Validate again"
        : props.validateHasRun
        ? "Up to date"
        : "Not run yet";

    return (
      <div className="cd-card" style={{ marginTop: 14 }}>
        <div className="cd-cardHeader" style={{ alignItems: "center" }}>
          <div>
            <div className="cd-cardTitle">Validate</div>
            <div className="cd-cardHint">
              Run validation against both environments. Fix issues before deploy — nothing is uploaded.
            </div>
          </div>

          <div className="cd-actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="mutedSm" style={{ opacity: 0.9 }}>
              {helperText}
            </span>

            <span className="pill" title="Validation status">
              {statusPill}
            </span>

            <ActionButton
              variant="primary"
              onClick={() => {
                trackEvent("validate_click", {
                  ready: !!props.hasAnyDraft,
                  stale: !!props.validateIsStale,
                  yamlStrict: !!props.yamlStrict,
                });
                props.runValidate();
              }}
              disabled={!props.hasAnyDraft || props.validateRunning}
              title={!props.hasAnyDraft ? "Paste/upload both sides first" : "Run validation"}
            >
              {props.validateRunning ? "Validating…" : "Run Validate"}
            </ActionButton>
          </div>
        </div>

        {props.hasValidateError ? (
          <div className="callout callout-danger" style={{ marginTop: 10 }}>
            {String(props.validateErrorMsg ?? "Validation error")}
          </div>
        ) : null}

        <div
          className="controlRow"
          style={{
            marginTop: 12,
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Toggle
              label="Strict YAML"
              checked={!!props.yamlStrict}
              onChange={(v) => {
                trackEvent("validate_toggle", { toggle: "yaml_strict", on: v });
                props.setYamlStrict(v);
              }}
            />
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="mutedSm" style={{ opacity: 0.9 }}>
              Severity filter:
            </span>

            <SevChip
              sev="high"
              count={Number(props.validateTotals?.high ?? 0)}
              checked={!!props.vSevHigh}
              onChange={(v) => {
                trackEvent("validate_severity_toggle", { sev: "high", on: v });
                props.setVSevHigh(v);
              }}
            />
            <SevChip
              sev="medium"
              count={Number(props.validateTotals?.medium ?? 0)}
              checked={!!props.vSevMed}
              onChange={(v) => {
                trackEvent("validate_severity_toggle", { sev: "medium", on: v });
                props.setVSevMed(v);
              }}
            />
            <SevChip
              sev="low"
              count={Number(props.validateTotals?.low ?? 0)}
              checked={!!props.vSevLow}
              onChange={(v) => {
                trackEvent("validate_severity_toggle", { sev: "low", on: v });
                props.setVSevLow(v);
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  const Findings = () => (
    <div className="cd-card" style={{ marginTop: 14 }}>
      <div className="cd-cardHeader">
        <div>
          <div className="cd-cardTitle">Risk Findings</div>
          <div className="cd-cardHint">
            {totalFiltered} / {totalAll}
          </div>
        </div>
      </div>

      {totalFiltered === 0 ? (
        <div style={{ padding: 12 }} className="mutedSm">
          No findings.
        </div>
      ) : (
        <div className="twoCol" style={{ marginTop: 8, padding: 12 }}>
          <div className="cd-card" style={{ padding: 12, background: THEME.card2 }}>
            <div className="cd-cardHeader">
              <div>
                <div className="cd-cardTitle">{props.leftLabel ?? "Production"} (Left)</div>
                <div className="cd-cardHint">{leftIssues.length} finding(s)</div>
              </div>
            </div>

            {leftIssues.length === 0 ? (
              <div className="mutedSm" style={{ padding: "8px 2px" }}>
                No left-side findings.
              </div>
            ) : (
              <div className="findingList" style={{ marginTop: 10 }}>
                {leftIssues.map((it, idx) => renderIssue("left", it, idx))}
              </div>
            )}
          </div>

          <div className="cd-card" style={{ padding: 12, background: THEME.card2 }}>
            <div className="cd-cardHeader">
              <div>
                <div className="cd-cardTitle">{props.rightLabel ?? "Staging"} (Right)</div>
                <div className="cd-cardHint">{rightIssues.length} finding(s)</div>
              </div>
            </div>

            {rightIssues.length === 0 ? (
              <div className="mutedSm" style={{ padding: "8px 2px" }}>
                No right-side findings.
              </div>
            ) : (
              <div className="findingList" style={{ marginTop: 10 }}>
                {rightIssues.map((it, idx) => renderIssue("right", it, idx))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {section === "summary" || section === "both" ? <Summary /> : null}
      {section === "findings" || section === "both" ? <Findings /> : null}
    </>
  );
}
