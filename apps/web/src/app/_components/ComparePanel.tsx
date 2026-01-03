"use client";

import React from "react";
import { ActionButton, Toggle, Badge, Section, Row, RowNode } from "./configdiff-ui";
import type { EnvProfileId, FormatId } from "../lib/shareState";
import { normSeverity } from "../lib/configdiff";
import { trackEvent } from "../lib/analytics";

type SortMode = "key_asc" | "key_desc" | "severity_desc" | "none";
type Side = "left" | "right";

type FindingItem = {
  id: string;
  idx: number;
  f: any;
  sev: string;
  leftLine?: number;
  rightLine?: number;
  side: "left" | "right" | "both" | "unmapped";
};

export type ComparePanelProps = {
  THEME: any;

  shareMsg: string | null;
  pasteErr: string | null;

  compareLabel: string;
  draftReady: boolean;
  hasCompared: boolean;

  result: any;

  // state + setters
  query: string;
  setQuery: (v: string) => void;

  showChanged: boolean;
  setShowChanged: (v: boolean) => void;
  showAdded: boolean;
  setShowAdded: (v: boolean) => void;
  showRemoved: boolean;
  setShowRemoved: (v: boolean) => void;
  showFindings: boolean;
  setShowFindings: (v: boolean) => void;

  sevHigh: boolean;
  setSevHigh: (v: boolean) => void;
  sevMed: boolean;
  setSevMed: (v: boolean) => void;
  sevLow: boolean;
  setSevLow: (v: boolean) => void;

  maskValues: boolean;
  setMaskValues: (v: boolean) => void;
  secretsOnly: boolean;
  setSecretsOnly: (v: boolean) => void;

  showMore: boolean;
  setShowMore: (v: boolean | ((x: boolean) => boolean)) => void;

  format: FormatId;
  envProfile: EnvProfileId;
  setEnvProfile: (v: EnvProfileId) => void;

  rowLimit: number;
  setRowLimit: (v: number) => void;

  sortMode: SortMode;
  setSortMode: (v: SortMode) => void;

  anyTruncated: boolean;
  filtersHint: string;

  applyPresetOnlyChanged: () => void;

  // export handlers
  onDownloadJSON: () => void;
  onDownloadMarkdown: () => void;
  onDownloadShareJSON: () => void;
  onTriggerImportShareJSON: () => void;
  onClearSavedDraft: () => void;

  // derived data for rendering
  filteredAll: any;
  rendered: any;

  findingCountsUI: { critical: number; suggestions: number };
  findingCountsAll: { critical: number; suggestions: number; total: number };

  showingText: (shown: number, total: number) => string;

  copyKeys: (keys: string[]) => void;

  renderChangedValue: (c: any) => React.ReactNode;
  displaySingle: (key: string, rawValue: any) => string;

  // line hints + jump handler
  getFindingLineHint: (id: string) => { leftLine?: number; rightLine?: number } | null;
  onJumpToLine: (side: Side, line: number) => void;
};

export type CompareSummaryBarProps = Pick<
  ComparePanelProps,
  | "THEME"
  | "shareMsg"
  | "pasteErr"
  | "compareLabel"
  | "draftReady"
  | "hasCompared"
  | "result"
  | "query"
  | "setQuery"
  | "showChanged"
  | "setShowChanged"
  | "showAdded"
  | "setShowAdded"
  | "showRemoved"
  | "setShowRemoved"
  | "showFindings"
  | "setShowFindings"
  | "sevHigh"
  | "setSevHigh"
  | "sevMed"
  | "setSevMed"
  | "sevLow"
  | "setSevLow"
  | "maskValues"
  | "setMaskValues"
  | "secretsOnly"
  | "setSecretsOnly"
  | "showMore"
  | "setShowMore"
  | "format"
  | "envProfile"
  | "setEnvProfile"
  | "rowLimit"
  | "setRowLimit"
  | "sortMode"
  | "setSortMode"
  | "anyTruncated"
  | "filtersHint"
  | "applyPresetOnlyChanged"
  | "onDownloadJSON"
  | "onDownloadMarkdown"
  | "onDownloadShareJSON"
  | "onTriggerImportShareJSON"
  | "onClearSavedDraft"
  | "filteredAll"
  | "findingCountsUI"
  | "findingCountsAll"
> & {
  /** NEW: lets Summary show a Compare button in the top-right (like Validate) */
  onRunCompare?: () => void;
  /** Optional: if you wire status from Home later */
  compareRunning?: boolean;
};

export function CompareSummaryBar(props: CompareSummaryBarProps) {
  const hasError = "error" in (props.result as any);

  const statusPill = props.compareRunning
    ? "Comparing…"
    : !props.draftReady
    ? "Waiting for both configs"
    : props.hasCompared
    ? "Compared"
    : "Ready";

  const helperText = !props.draftReady
    ? "Paste or upload both configs to enable comparison."
    : props.hasCompared
    ? "Up to date"
    : `Next step: Click ${props.compareLabel}`;

  const trackCompareClick = () => {
    trackEvent("compare_click", {
      format: props.format,
      ready: !!props.draftReady,
      hadCompared: !!props.hasCompared,
    });
    props.onRunCompare?.();
  };

  const trackDownload = (kind: "json" | "markdown" | "share_json" | "import_share_json" | "clear_saved") => {
    trackEvent("compare_export_click", {
      format: props.format,
      kind,
      hasCompared: !!props.hasCompared,
    });
  };

  const trackCopyKeys = (scope: string) => {
    trackEvent("compare_copy_keys", { format: props.format, scope });
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

      <section style={{ marginTop: 18 }}>
        <div className="cd-card" style={{ marginTop: 10 }}>
          <div className="cd-cardHeader" style={{ alignItems: "center" }}>
            <div>
              <div className="cd-cardTitle">Summary</div>
              <div className="cd-cardHint">Search, filter, and export results — nothing is uploaded.</div>
            </div>

            <div className="cd-actions" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mutedSm" style={{ opacity: 0.9 }}>
                {helperText}
              </span>

              <span className="pill" title="Compare status">
                {statusPill}
              </span>

              <ActionButton
                variant="primary"
                onClick={trackCompareClick}
                disabled={!props.draftReady || !props.onRunCompare || !!props.compareRunning}
                title={!props.draftReady ? "Paste/upload both sides first" : "Run comparison"}
              >
                {props.compareLabel}
              </ActionButton>
            </div>
          </div>

          <div className="cd-controls" style={{ paddingTop: 10 }}>
            {!props.draftReady ? (
              <div className="callout callout-info" style={{ marginBottom: 10 }}>
                <strong>Next step:</strong> Paste/upload both configs, then click <strong>{props.compareLabel}</strong>.
              </div>
            ) : !props.hasCompared ? (
              <div className="callout callout-info" style={{ marginBottom: 10 }}>
                <strong>Ready:</strong> Click <strong>{props.compareLabel}</strong> to generate diffs and findings.
              </div>
            ) : null}

            {hasError ? (
              <div className="callout callout-danger" style={{ marginBottom: 10 }}>
                <strong>Error:</strong> {(props.result as any).error}
              </div>
            ) : null}

            <div className="controlRow">
              <div className="controlLabel">Search</div>
              <input
                value={props.query}
                onChange={(e) => {
                  props.setQuery(e.target.value);
                }}
                onBlur={() => {
                  if (props.query.trim()) trackEvent("compare_search_used", { format: props.format });
                }}
                placeholder="Filter keys/values (e.g., S3, JWT, DATABASE, DEBUG)…"
                className="cd-input"
              />
              <ActionButton
                variant="subtle"
                onClick={() => {
                  if (props.query.trim()) trackEvent("compare_search_clear", { format: props.format });
                  props.setQuery("");
                }}
              >
                Clear
              </ActionButton>
            </div>

            <div className="controlRow" style={{ alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div className="controlLabel">Show</div>

              <Toggle
                label="Findings"
                checked={props.showFindings}
                onChange={(v) => {
                  trackEvent("compare_filter_toggle", { format: props.format, filter: "findings", on: v });
                  props.setShowFindings(v);
                }}
              />
              <Toggle
                label="Changed"
                checked={props.showChanged}
                onChange={(v) => {
                  trackEvent("compare_filter_toggle", { format: props.format, filter: "changed", on: v });
                  props.setShowChanged(v);
                }}
              />
              <Toggle
                label="Added"
                checked={props.showAdded}
                onChange={(v) => {
                  trackEvent("compare_filter_toggle", { format: props.format, filter: "added", on: v });
                  props.setShowAdded(v);
                }}
              />
              <Toggle
                label="Removed"
                checked={props.showRemoved}
                onChange={(v) => {
                  trackEvent("compare_filter_toggle", { format: props.format, filter: "removed", on: v });
                  props.setShowRemoved(v);
                }}
              />

              <ActionButton
                variant="subtle"
                onClick={() => {
                  trackEvent("compare_preset_only_changed", { format: props.format });
                  props.applyPresetOnlyChanged();
                }}
                title="Quick preset: show only Changed"
              >
                Only Changed
              </ActionButton>

              <span style={{ width: 10 }} />

              <div className="controlLabel">Privacy</div>
              <Toggle
                label="Mask values"
                checked={props.maskValues}
                onChange={(v) => {
                  trackEvent("compare_privacy_toggle", { format: props.format, privacy: "mask_values", on: v });
                  props.setMaskValues(v);
                }}
              />
              <Toggle
                label="Secrets only"
                checked={props.secretsOnly}
                onChange={(v) => {
                  trackEvent("compare_privacy_toggle", { format: props.format, privacy: "secrets_only", on: v });
                  props.setSecretsOnly(v);
                }}
              />

              <ActionButton
                variant={props.showMore ? "primary" : "subtle"}
                onClick={() => {
                  trackEvent("compare_advanced_toggle", { format: props.format, on: !props.showMore });
                  props.setShowMore((vv: boolean) => !vv);
                }}
                title="Advanced controls"
              >
                {props.showMore ? "More ▴" : "More ▾"}
              </ActionButton>
            </div>

            {props.showMore && (
              <div className="cd-card" style={{ marginTop: 10, padding: 12, background: props.THEME.card2 }}>
                {props.format === "env" ? (
                  <div className="controlRow">
                    <div className="controlLabel">Parsing</div>
                    <div className="controlHelp">Mode</div>
                    <select
                      value={props.envProfile}
                      onChange={(e) => {
                        const next = e.target.value as EnvProfileId;
                        trackEvent("compare_env_profile_change", { format: props.format, envProfile: next });
                        props.setEnvProfile(next);
                      }}
                      className="cd-select"
                      title="Choose how .env lines are interpreted"
                    >
                      <option value="dotenv">Dotenv (.env) — allow export KEY=VALUE</option>
                      <option value="compose">Docker Compose env_file — KEY=VALUE only</option>
                    </select>
                    <span className="mutedSm">(changes how “export KEY=…” is handled)</span>
                  </div>
                ) : (
                  <div className="controlRow">
                    <div className="controlLabel">Parsing</div>
                    <span className="mutedSm">
                      {props.format === "json"
                        ? "JSON is flattened into dot-path keys (e.g., db.host)."
                        : "YAML is flattened into dot-path keys (e.g., db.host)."}
                    </span>
                    <span className="mutedSm" style={{ opacity: 0.7 }}>
                      (Array mode options coming soon)
                    </span>
                  </div>
                )}

                <div className="controlRow">
                  <div className="controlLabel">Severity</div>
                  <Toggle
                    label="High"
                    checked={props.sevHigh}
                    onChange={(v) => {
                      trackEvent("compare_severity_toggle", { format: props.format, sev: "high", on: v });
                      props.setSevHigh(v);
                    }}
                  />
                  <Toggle
                    label="Medium"
                    checked={props.sevMed}
                    onChange={(v) => {
                      trackEvent("compare_severity_toggle", { format: props.format, sev: "medium", on: v });
                      props.setSevMed(v);
                    }}
                  />
                  <Toggle
                    label="Low"
                    checked={props.sevLow}
                    onChange={(v) => {
                      trackEvent("compare_severity_toggle", { format: props.format, sev: "low", on: v });
                      props.setSevLow(v);
                    }}
                  />
                  <span className="mutedSm">(applies to Risk Findings)</span>
                </div>

                <div className="controlRow">
                  <div className="controlLabel">Sort</div>
                  <div className="controlHelp">Mode</div>
                  <select
                    value={props.sortMode}
                    onChange={(e) => {
                      const next = e.target.value as SortMode;
                      trackEvent("compare_sort_change", { format: props.format, mode: next });
                      props.setSortMode(next);
                    }}
                    className="cd-select"
                  >
                    <option value="none">None (input order)</option>
                    <option value="key_asc">Key A → Z</option>
                    <option value="key_desc">Key Z → A</option>
                    <option value="severity_desc" disabled={!props.showFindings}>
                      Severity (Findings only)
                    </option>
                  </select>
                </div>

                <div className="controlRow">
                  <div className="controlLabel">Render</div>
                  <div className="controlHelp">Row limit</div>
                  <input
                    type="number"
                    value={props.rowLimit}
                    min={0}
                    step={50}
                    onChange={(e) => {
                      const next = parseInt(e.target.value || "0", 10);
                      trackEvent("compare_row_limit_change", { format: props.format, rowLimit: next });
                      props.setRowLimit(next);
                    }}
                    className="cd-number"
                  />
                  <span className="mutedSm">(applies after filters; prevents UI freezes on huge diffs)</span>

                  {props.anyTruncated && (
                    <span className="inlineCluster">
                      <span className="pill" title="Some sections are truncated by the row limit.">
                        Truncated
                      </span>
                      <ActionButton
                        variant="subtle"
                        onClick={() => {
                          trackEvent("compare_row_limit_action", { format: props.format, action: "show_all" });
                          props.setRowLimit(0);
                        }}
                        title="Show all rows (may slow UI on huge diffs)"
                      >
                        Show all (may slow)
                      </ActionButton>
                      <ActionButton
                        variant="subtle"
                        onClick={() => {
                          trackEvent("compare_row_limit_action", { format: props.format, action: "reset_500" });
                          props.setRowLimit(500);
                        }}
                        title="Reset row limit to 500"
                      >
                        Reset
                      </ActionButton>
                    </span>
                  )}
                </div>
              </div>
            )}

            {(props.secretsOnly ||
              props.query.trim().length > 0 ||
              props.rowLimit > 0 ||
              (!props.sevHigh || !props.sevMed || !props.sevLow) ||
              !props.hasCompared) && (
              <div className="callout callout-info">
                <strong>Note:</strong> {props.filtersHint}
              </div>
            )}

            <div className="exportRow">
              <ActionButton
                onClick={() => {
                  trackDownload("json");
                  props.onDownloadJSON();
                }}
                disabled={!props.hasCompared || hasError}
                title={!props.hasCompared ? "Run Compare first" : undefined}
              >
                Download JSON
              </ActionButton>

              <ActionButton
                onClick={() => {
                  trackDownload("markdown");
                  props.onDownloadMarkdown();
                }}
                disabled={!props.hasCompared || hasError}
                title={!props.hasCompared ? "Run Compare first" : undefined}
              >
                Download Markdown
              </ActionButton>

              <ActionButton
                variant="subtle"
                onClick={() => {
                  trackDownload("share_json");
                  props.onDownloadShareJSON();
                }}
                title="Export inputs + UI settings (for sharing large configs)"
              >
                Share JSON
              </ActionButton>

              <ActionButton
                variant="subtle"
                onClick={() => {
                  trackDownload("import_share_json");
                  props.onTriggerImportShareJSON();
                }}
                title="Import inputs + UI settings from Share JSON"
              >
                Import Share JSON
              </ActionButton>

              <ActionButton
                variant="subtle"
                onClick={() => {
                  trackDownload("clear_saved");
                  props.onClearSavedDraft();
                }}
                title="Clear saved draft from this browser"
              >
                Clear saved
              </ActionButton>
            </div>
          </div>
        </div>

        <div className="badgeRow">
          <Badge
            label={`Findings: ${props.filteredAll.findingsFiltered.length} / ${props.findingCountsAll.total}`}
            variant="findings"
          />
          <Badge
            label={`Critical: ${props.findingCountsUI.critical} / ${props.findingCountsAll.critical}`}
            variant="critical"
          />
          <Badge
            label={`Suggestions: ${props.findingCountsUI.suggestions} / ${props.findingCountsAll.suggestions}`}
            variant="suggestions"
          />
          <Badge label={`Changed: ${props.filteredAll.changedFiltered.length}`} variant="changed" />
          <Badge label={`Added: ${props.filteredAll.addedFiltered.length}`} variant="added" />
          <Badge label={`Removed: ${props.filteredAll.removedFiltered.length}`} variant="removed" />
        </div>
      </section>
    </>
  );
}

export function ComparePanel(props: ComparePanelProps) {
  const trackCopyKeys = (scope: string, count: number) => {
    trackEvent("compare_copy_keys", { format: props.format, scope, count });
  };

  const trackJump = (from: string, side: Side, line: number) => {
    trackEvent("compare_jump_to_line", { format: props.format, from, side, line });
  };

  const renderFindingCard = (item: FindingItem, forcedSide?: Side) => {
    const { f, sev, leftLine, rightLine } = item;

    const preferredSide: Side | null = forcedSide ?? (leftLine ? "left" : rightLine ? "right" : null);
    const preferredLine = preferredSide === "left" ? leftLine : preferredSide === "right" ? rightLine : undefined;
    const clickable = !!preferredSide && !!preferredLine;

    return (
      <div
        key={item.id}
        className="finding"
        data-sev={sev}
        style={clickable ? { cursor: "pointer" } : undefined}
        title={clickable ? "Click to jump to line in preview" : undefined}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : -1}
        onClick={() => {
          if (!clickable) return;
          trackJump("finding_card", preferredSide!, preferredLine!);
          props.onJumpToLine(preferredSide!, preferredLine!);
        }}
        onKeyDown={(e) => {
          if (!clickable) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            trackJump("finding_card_kbd", preferredSide!, preferredLine!);
            props.onJumpToLine(preferredSide!, preferredLine!);
          }
        }}
      >
        <div className="findingTop">
          <div className="mono findingKey">{f.key}</div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {forcedSide === "left" && leftLine ? (
              <button
                type="button"
                className="cd-linePill"
                title={`Jump to Left L${leftLine}`}
                onClick={(e) => {
                  e.stopPropagation();
                  trackJump("finding_pill", "left", leftLine);
                  props.onJumpToLine("left", leftLine);
                }}
              >
                L{leftLine}
              </button>
            ) : null}

            {forcedSide === "right" && rightLine ? (
              <button
                type="button"
                className="cd-linePill"
                title={`Jump to Right R${rightLine}`}
                onClick={(e) => {
                  e.stopPropagation();
                  trackJump("finding_pill", "right", rightLine);
                  props.onJumpToLine("right", rightLine);
                }}
              >
                R{rightLine}
              </button>
            ) : null}

            {!forcedSide && leftLine ? (
              <button
                type="button"
                className="cd-linePill"
                title={`Jump to Left L${leftLine}`}
                onClick={(e) => {
                  e.stopPropagation();
                  trackJump("finding_pill", "left", leftLine);
                  props.onJumpToLine("left", leftLine);
                }}
              >
                L{leftLine}
              </button>
            ) : null}

            {!forcedSide && rightLine ? (
              <button
                type="button"
                className="cd-linePill"
                title={`Jump to Right R${rightLine}`}
                onClick={(e) => {
                  e.stopPropagation();
                  trackJump("finding_pill", "right", rightLine);
                  props.onJumpToLine("right", rightLine);
                }}
              >
                R{rightLine}
              </button>
            ) : null}

            <span className={`sev sev-${sev}`}>{sev}</span>
          </div>
        </div>

        <div className="findingMsg">{f.message}</div>
      </div>
    );
  };

  const findings: FindingItem[] = (Array.isArray(props.rendered?.findingsFiltered) ? props.rendered.findingsFiltered : []).map(
    (f: any, idx: number) => {
      const sev = normSeverity(f.severity);
      const id = `${String(f.key ?? "")}-${idx}`;
      const hint = props.getFindingLineHint(id);
      const leftLine = hint?.leftLine;
      const rightLine = hint?.rightLine;

      let side: FindingItem["side"] = "unmapped";
      if (leftLine && rightLine) side = "both";
      else if (leftLine) side = "left";
      else if (rightLine) side = "right";
      else {
        const msg = String(f?.message ?? "");
        if (/\bleft\b/i.test(msg) && !/\bright\b/i.test(msg)) side = "left";
        else if (/\bright\b/i.test(msg) && !/\bleft\b/i.test(msg)) side = "right";
      }

      return { id, idx, f, sev, leftLine, rightLine, side };
    }
  );

  const leftFindings = findings.filter((x) => x.side === "left" || x.side === "both");
  const rightFindings = findings.filter((x) => x.side === "right" || x.side === "both");
  const unmappedFindings = findings.filter((x) => x.side === "unmapped");

  const hasError = "error" in (props.result as any);

  return (
    <>
      {props.hasCompared && !hasError ? (
        <>
          {props.showFindings && (
            <Section
              title={`Risk Findings — ${props.showingText(
                props.rendered.findingsFiltered.length,
                props.filteredAll.findingsFiltered.length
              )}`}
              rightSlot={
                <ActionButton
                  onClick={() => {
                    const keys = props.filteredAll.findingsFiltered.map((x: any) => x.key);
                    trackCopyKeys("findings_all", keys.length);
                    props.copyKeys(keys);
                  }}
                >
                  Copy keys
                </ActionButton>
              }
            >
              {props.rendered.findingsFiltered.length === 0 ? (
                <div className="mutedSm" style={{ padding: "6px 2px" }}>
                  No findings.
                </div>
              ) : (
                <>
                  <div className="twoCol" style={{ marginTop: 6 }}>
                    <div className="cd-card" style={{ padding: 12, background: props.THEME.card2 }}>
                      <div className="cd-cardHeader">
                        <div>
                          <div className="cd-cardTitle">Environment 1 (Left)</div>
                          <div className="cd-cardHint">{leftFindings.length} finding(s)</div>
                        </div>
                        <div className="cd-actions">
                          <ActionButton
                            onClick={() => {
                              const keys = leftFindings.map((x) => x.f.key);
                              trackCopyKeys("findings_left", keys.length);
                              props.copyKeys(keys);
                            }}
                            title="Copy keys from Left findings"
                          >
                            Copy keys
                          </ActionButton>
                        </div>
                      </div>

                      {leftFindings.length === 0 ? (
                        <div className="mutedSm" style={{ padding: "8px 2px" }}>
                          No left-side findings.
                        </div>
                      ) : (
                        <div className="findingList" style={{ marginTop: 10 }}>
                          {leftFindings.map((item) => renderFindingCard(item, "left"))}
                        </div>
                      )}
                    </div>

                    <div className="cd-card" style={{ padding: 12, background: props.THEME.card2 }}>
                      <div className="cd-cardHeader">
                        <div>
                          <div className="cd-cardTitle">Environment 2 (Right)</div>
                          <div className="cd-cardHint">{rightFindings.length} finding(s)</div>
                        </div>
                        <div className="cd-actions">
                          <ActionButton
                            onClick={() => {
                              const keys = rightFindings.map((x) => x.f.key);
                              trackCopyKeys("findings_right", keys.length);
                              props.copyKeys(keys);
                            }}
                            title="Copy keys from Right findings"
                          >
                            Copy keys
                          </ActionButton>
                        </div>
                      </div>

                      {rightFindings.length === 0 ? (
                        <div className="mutedSm" style={{ padding: "8px 2px" }}>
                          No right-side findings.
                        </div>
                      ) : (
                        <div className="findingList" style={{ marginTop: 10 }}>
                          {rightFindings.map((item) => renderFindingCard(item, "right"))}
                        </div>
                      )}
                    </div>
                  </div>

                  {unmappedFindings.length > 0 && (
                    <div className="cd-card" style={{ marginTop: 12, padding: 12, background: props.THEME.card2 }}>
                      <div className="cd-cardHeader">
                        <div>
                          <div className="cd-cardTitle">Unmapped</div>
                          <div className="cd-cardHint">
                            {unmappedFindings.length} finding(s) couldn’t be mapped to a specific side/line.
                          </div>
                        </div>
                        <div className="cd-actions">
                          <ActionButton
                            onClick={() => {
                              const keys = unmappedFindings.map((x) => x.f.key);
                              trackCopyKeys("findings_unmapped", keys.length);
                              props.copyKeys(keys);
                            }}
                            title="Copy keys from Unmapped findings"
                          >
                            Copy keys
                          </ActionButton>
                        </div>
                      </div>

                      <div className="findingList" style={{ marginTop: 10 }}>
                        {unmappedFindings.map((item) => renderFindingCard(item))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </Section>
          )}

          {props.showChanged && (
            <Section
              title={`Changed — ${props.showingText(props.rendered.changedFiltered.length, props.filteredAll.changedFiltered.length)}`}
              rightSlot={
                <ActionButton
                  onClick={() => {
                    const keys = props.filteredAll.changedFiltered.map((x: any) => x.key);
                    trackCopyKeys("changed", keys.length);
                    props.copyKeys(keys);
                  }}
                >
                  Copy keys
                </ActionButton>
              }
            >
              <div className="rows">
                {props.rendered.changedFiltered.map((c: any) => (
                  <RowNode key={c.key} k={c.key} vNode={props.renderChangedValue(c)} />
                ))}
              </div>
            </Section>
          )}

          {props.showAdded && (
            <Section
              title={`Added — ${props.showingText(props.rendered.addedFiltered.length, props.filteredAll.addedFiltered.length)}`}
              rightSlot={
                <ActionButton
                  onClick={() => {
                    const keys = props.filteredAll.addedFiltered.map((x: any) => x.key);
                    trackCopyKeys("added", keys.length);
                    props.copyKeys(keys);
                  }}
                >
                  Copy keys
                </ActionButton>
              }
            >
              <div className="rows">
                {props.rendered.addedFiltered.map((a: any) => (
                  <Row key={a.key} k={a.key} v={props.displaySingle(a.key, a.value)} />
                ))}
              </div>
            </Section>
          )}

          {props.showRemoved && (
            <Section
              title={`Removed — ${props.showingText(props.rendered.removedFiltered.length, props.filteredAll.removedFiltered.length)}`}
              rightSlot={
                <ActionButton
                  onClick={() => {
                    const keys = props.filteredAll.removedFiltered.map((x: any) => x.key);
                    trackCopyKeys("removed", keys.length);
                    props.copyKeys(keys);
                  }}
                >
                  Copy keys
                </ActionButton>
              }
            >
              <div className="rows">
                {props.rendered.removedFiltered.map((r: any) => (
                  <Row key={r.key} k={r.key} v={props.displaySingle(r.key, r.value)} />
                ))}
              </div>
            </Section>
          )}

          <div style={{ padding: "18px 4px 30px", color: props.THEME.muted, fontSize: 12, textAlign: "center" }}>
            © {new Date().getFullYear()} ConfigSift • All processing in your browser.
          </div>
        </>
      ) : (
        <div style={{ padding: "18px 4px 30px", color: props.THEME.muted, fontSize: 12, textAlign: "center" }}>
          © {new Date().getFullYear()} ConfigSift • All processing in your browser.
        </div>
      )}
    </>
  );
}
