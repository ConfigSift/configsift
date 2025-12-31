"use client";

import React, { useMemo } from "react";
import { ActionButton, Toggle, SevChip } from "./configdiff-ui";
import { normSeverity } from "../lib/configdiff";
import type { FormatId } from "../lib/shareState";

type Side = "left" | "right";

/**
 * Extract the most useful "jump-to" line number from a validation issue.
 * Handles cases where .env validator encodes line info in key/id (e.g. "Left:line:1")
 * or only in the message (e.g. "WARNING on line 5 ...").
 *
 * Strategy:
 * 1) Prefer structured numeric fields: line, __lineStart, loc.line, location.line
 * 2) Then scan key-ish fields: key/id/path/name for patterns
 * 3) Then scan message-ish fields: message/error/details/text
 * 4) If multiple "line N" matches exist, use the LAST one (often the real parse failure)
 */
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

    const mLineAtRange = s.match(/\bline\s+at\s+(\d+)\s*[-–]\s*(\d+)\b/i);
    if (mLineAtRange) {
      const n = Number(mLineAtRange[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const mLineAt = s.match(/\bline\s+at\s+(\d+)\b/i);
    if (mLineAt) {
      const n = Number(mLineAt[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }

    const mRange = s.match(/line\s*[:\s]+(\d+)\s*[-–]\s*(\d+)/i);
    if (mRange) {
      const n = Number(mRange[1]);
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

export function ValidatePanel(props: {
  format: FormatId;
  THEME: any;

  shareMsg: string | null;
  pasteErr: string | null;

  hasAnyDraft: boolean;

  validateStatus: string;
  runValidate: () => void;
  validateHasRun: boolean;
  validateIsStale: boolean;

  hasValidateError: boolean;
  validateErrorText: string | null;

  yamlStrict: boolean;
  setYamlStrict: (v: boolean) => void;

  validateTotals: { high?: number; medium?: number; low?: number };

  vSevHigh: boolean;
  vSevMed: boolean;
  vSevLow: boolean;
  setVSevHigh: (v: boolean) => void;
  setVSevMed: (v: boolean) => void;
  setVSevLow: (v: boolean) => void;

  leftIssuesAll: any[];
  rightIssuesAll: any[];
  leftIssues: any[];
  rightIssues: any[];

  onJumpToLine?: (side: Side, line: number) => void;
}) {
  const fmtLabel = props.format === "env" ? ".env" : props.format === "json" ? "JSON" : "YAML";

  const leftWithLine = useMemo(() => props.leftIssues.map((it) => ({ it, line: extractLineStart(it) })), [props.leftIssues]);
  const rightWithLine = useMemo(() => props.rightIssues.map((it) => ({ it, line: extractLineStart(it) })), [props.rightIssues]);

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      {props.shareMsg && (
        <div className="callout callout-info" style={{ marginTop: 12 }}>
          {props.shareMsg}
        </div>
      )}

      {props.pasteErr && (
        <div className="callout callout-danger" style={{ marginTop: 12 }}>
          <strong>Paste error:</strong> {props.pasteErr}
        </div>
      )}

      <div className="cd-card" style={{ marginTop: 14 }}>
        <div className="cd-cardTitle" style={{ fontSize: 16 }}>
          Validate ({fmtLabel})
        </div>

        <div className="cd-cardHint" style={{ marginTop: 6 }}>
          Checks syntax + common deploy risks (required keys, localhost/unsafe URLs, wildcard CORS, debug flags, secret hygiene).
          Runs locally in a worker.
        </div>

        {!props.hasAnyDraft ? (
          <div className="callout callout-info" style={{ marginTop: 12 }}>
            <strong>Paste or upload a config first.</strong> Validate runs on your current editor drafts (you don’t need to run Compare).
          </div>
        ) : !props.validateHasRun ? (
          <div className="callout callout-info" style={{ marginTop: 12 }}>
            <strong>Not validated yet.</strong> Click <strong>Run Validate</strong> below.
          </div>
        ) : props.validateIsStale ? (
          <div className="callout callout-info" style={{ marginTop: 12 }}>
            <strong>Edited since last validation.</strong> Click <strong>Run Validate</strong> to refresh results.
          </div>
        ) : null}

        {props.hasValidateError ? (
          <div className="callout callout-danger" style={{ marginTop: 10 }}>
            <strong>Error:</strong> {props.validateErrorText ?? "Validation failed."}
          </div>
        ) : null}

        <div className="controlRow" style={{ marginTop: 12, alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <ActionButton
              variant="primary"
              onClick={props.runValidate}
              disabled={!props.hasAnyDraft as any}
              title={!props.hasAnyDraft ? "Paste/upload at least one config draft first" : "Run validation now"}
            >
              {props.validateStatus === "Idle" ? "Run Validate" : "Validating…"}
            </ActionButton>

            {props.format === "yaml" ? <Toggle label="Strict YAML mode" checked={props.yamlStrict} onChange={props.setYamlStrict} /> : null}

            <span className="pill" title="Validation status">
              {props.validateStatus !== "Idle" ? "Validating…" : props.validateHasRun ? "Validated" : "Not validated"}
            </span>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <SevChip sev="high" count={props.validateTotals.high ?? 0} checked={props.vSevHigh} onChange={props.setVSevHigh} />
            <SevChip sev="medium" count={props.validateTotals.medium ?? 0} checked={props.vSevMed} onChange={props.setVSevMed} />
            <SevChip sev="low" count={props.validateTotals.low ?? 0} checked={props.vSevLow} onChange={props.setVSevLow} />
          </div>
        </div>
      </div>

      <div className="twoCol" style={{ marginTop: 14 }}>
        {/* LEFT */}
        <div className="cd-card">
          <div className="cd-cardHeader">
            <div>
              <div className="cd-cardTitle">Environment 1</div>
              <div className="cd-cardHint">
                Issues found: {props.leftIssues.length}
                {props.leftIssues.length !== props.leftIssuesAll.length ? ` (filtered from ${props.leftIssuesAll.length})` : ""}
              </div>
            </div>
          </div>

          <div style={{ padding: 12 }}>
            {!props.hasAnyDraft ? (
              <div className="mutedSm">Paste/upload a config to validate.</div>
            ) : props.leftIssuesAll.length === 0 ? (
              <div className="mutedSm">No issues detected.</div>
            ) : props.leftIssues.length === 0 ? (
              <div className="mutedSm">No issues at the selected severities.</div>
            ) : (
              <div className="findingList">
                {leftWithLine.map(({ it, line }, idx) => {
                  const sev = normSeverity(it?.severity);
                  const canJump = typeof line === "number" && Number.isFinite(line) && line > 0 && !!props.onJumpToLine;

                  return (
                    <div
                      key={`l-${idx}`}
                      className="finding"
                      data-sev={sev}
                      role={canJump ? "button" : undefined}
                      tabIndex={canJump ? 0 : -1}
                      onClick={() => {
                        if (!canJump) return;
                        props.onJumpToLine?.("left", line!);
                      }}
                      onKeyDown={(e) => {
                        if (!canJump) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          props.onJumpToLine?.("left", line!);
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
                                props.onJumpToLine?.("left", line!);
                              }}
                              title={`Jump to Left L${line}`}
                            >
                              L{line}
                            </button>
                          ) : null}
                          <span className={`sev sev-${sev}`}>{sev}</span>
                        </div>
                      </div>
                      <div className="findingMsg">{String(it?.message ?? it?.details ?? it?.error ?? "")}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div className="cd-card">
          <div className="cd-cardHeader">
            <div>
              <div className="cd-cardTitle">Environment 2</div>
              <div className="cd-cardHint">
                Issues found: {props.rightIssues.length}
                {props.rightIssues.length !== props.rightIssuesAll.length ? ` (filtered from ${props.rightIssuesAll.length})` : ""}
              </div>
            </div>
          </div>

          <div style={{ padding: 12 }}>
            {!props.hasAnyDraft ? (
              <div className="mutedSm">Paste/upload a config to validate.</div>
            ) : props.rightIssuesAll.length === 0 ? (
              <div className="mutedSm">No issues detected.</div>
            ) : props.rightIssues.length === 0 ? (
              <div className="mutedSm">No issues at the selected severities.</div>
            ) : (
              <div className="findingList">
                {rightWithLine.map(({ it, line }, idx) => {
                  const sev = normSeverity(it?.severity);
                  const canJump = typeof line === "number" && Number.isFinite(line) && line > 0 && !!props.onJumpToLine;

                  return (
                    <div
                      key={`r-${idx}`}
                      className="finding"
                      data-sev={sev}
                      role={canJump ? "button" : undefined}
                      tabIndex={canJump ? 0 : -1}
                      onClick={() => {
                        if (!canJump) return;
                        props.onJumpToLine?.("right", line!);
                      }}
                      onKeyDown={(e) => {
                        if (!canJump) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          props.onJumpToLine?.("right", line!);
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
                                props.onJumpToLine?.("right", line!);
                              }}
                              title={`Jump to Right R${line}`}
                            >
                              R{line}
                            </button>
                          ) : null}
                          <span className={`sev sev-${sev}`}>{sev}</span>
                        </div>
                      </div>
                      <div className="findingMsg">{String(it?.message ?? it?.details ?? it?.error ?? "")}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "18px 4px 30px", color: props.THEME.muted, fontSize: 12, textAlign: "center" }}>
        © {new Date().getFullYear()} ConfigSift • All processing in your browser — nothing uploaded.
      </div>
    </>
  );
}
