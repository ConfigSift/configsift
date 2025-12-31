"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { normSeverity } from "./lib/configdiff";
import { useConfigDiffCompare } from "./lib/useConfigDiffCompare";
import { useConfigValidate } from "./lib/useConfigValidate";
import { decodeShareState, encodeShareState, ShareStateV1, EnvProfileId, FormatId } from "./lib/shareState";

import { ActionButton } from "./_components/configdiff-ui";
import { ConfigEditors } from "./_components/ConfigEditors";
import { ValidatePanel } from "./_components/ValidatePanel";
import { ComparePanel } from "./_components/ComparePanel";

import { useThemeMode } from "./lib/useThemeMode";
import { useEditorIO } from "./lib/useEditorIO";
import { useCompareDerived } from "./lib/useCompareDerived";

type Side = "left" | "right";
type SortMode = "key_asc" | "key_desc" | "severity_desc" | "none";

// Tool tabs (workspace nav)
type ToolId = "compare" | "format" | "minify" | "validate" | "bundle";

// ✅ jump-to-line payload (state lives INSIDE Home)
type JumpTo = { side: Side; line: number } | null;

type LineAnnotation = {
  lineStart: number;
  lineEnd: number;
  severity: "high" | "medium" | "low" | "info";
  label: string;
};

const LS_KEY = "configsift:draft:v1";
const MAX_SHARE_URL_LEN = 1900;

const SAMPLE_LEFT_ENV = `# Example prod
DATABASE_URL=postgres://prod
JWT_SECRET=abc123
DEBUG=false
CORS_ALLOW_ORIGINS=https://app.company.com,https://admin.company.com
`;

const SAMPLE_RIGHT_ENV = `# Example staging
DATABASE_URL=postgres://staging
JWT_SECRET=abc123
DEBUG=true
NEW_FLAG=1
CORS_ALLOW_ORIGINS=http://localhost:3000,https://staging.company.com
`;

const SAMPLE_LEFT_JSON = `{
  "db": { "host": "prod", "port": 5432 },
  "debug": false
}`;

const SAMPLE_RIGHT_JSON = `{
  "db": { "host": "staging", "port": 5432 },
  "debug": true,
  "newFlag": 1
}`;

const SAMPLE_LEFT_YAML = `db:
  host: prod
  port: 5432
debug: false
`;

const SAMPLE_RIGHT_YAML = `db:
  host: staging
  port: 5432
debug: true
newFlag: 1
`;

function timeAgo(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Try hard to extract `line X` or `line X-Y` from any issue object/message. */
function extractLineRange(issue: any): { lineStart?: number; lineEnd?: number } {
  if (!issue) return {};

  // 1) direct structured fields
  const direct =
    typeof issue.line === "number"
      ? { lineStart: issue.line, lineEnd: issue.line }
      : typeof issue?.loc?.line === "number"
      ? { lineStart: issue.loc.line, lineEnd: issue.loc.line }
      : typeof issue?.location?.line === "number"
      ? { lineStart: issue.location.line, lineEnd: issue.location.line }
      : typeof issue?.__lineStart === "number"
      ? { lineStart: issue.__lineStart, lineEnd: issue.__lineEnd ?? issue.__lineStart }
      : null;

  if (direct) return direct;

  // 2) try key/id/name/path fields (dotenv warnings often encode line here)
  const keyish = String(issue.key ?? issue.path ?? issue.name ?? issue.id ?? "");
  // matches "line 3-7", "line: 4", "Left:line:12"
  const mKeyRange = keyish.match(/line[:\s]+(\d+)\s*[-–]\s*(\d+)/i);
  if (mKeyRange) {
    const a = Number(mKeyRange[1]);
    const b = Number(mKeyRange[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { lineStart: a, lineEnd: b };
  }
  const mKeyLine = keyish.match(/line[:\s]+(\d+)/i);
  if (mKeyLine) {
    const a = Number(mKeyLine[1]);
    if (Number.isFinite(a)) return { lineStart: a, lineEnd: a };
  }
  const mKeyL = keyish.match(/\b[LR]?(\d+)\b/); // last-resort if key is just "L3" or "R4" or "3"
  if (mKeyL && /^[LR]?\d+$/.test(keyish.trim())) {
    const a = Number(mKeyL[1]);
    if (Number.isFinite(a)) return { lineStart: a, lineEnd: a };
  }

  // 3) message/error/details text
  const msg = String(issue.message ?? issue.error ?? issue.details ?? issue.msg ?? issue.text ?? "");

  // support ".env" style "line at 1" / "line at 3-7"
  const mAtRange = msg.match(/\bline\s+at\s+(\d+)\s*[-–]\s*(\d+)\b/i);
  if (mAtRange) {
    const a = Number(mAtRange[1]);
    const b = Number(mAtRange[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { lineStart: a, lineEnd: b };
  }

  // Allow both "line 3-7" and "line at 3-7"
  const mRange = msg.match(/line\s+(?:at\s+)?(\d+)\s*[-–]\s*(\d+)/i);
  if (mRange) {
    const a = Number(mRange[1]);
    const b = Number(mRange[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { lineStart: a, lineEnd: b };
  }

  // Allow both "line 3" and "line at 3"
  const m1 = msg.match(/line\s+(?:at\s+)?(\d+)/i);
  if (m1) {
    const a = Number(m1[1]);
    if (Number.isFinite(a)) return { lineStart: a, lineEnd: a };
  }

  const mLRange = msg.match(/\bL(\d+)\s*[-–]\s*(\d+)\b/i);
  if (mLRange) {
    const a = Number(mLRange[1]);
    const b = Number(mLRange[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { lineStart: a, lineEnd: b };
  }
  const mL = msg.match(/\bL(\d+)\b/i);
  if (mL) {
    const a = Number(mL[1]);
    if (Number.isFinite(a)) return { lineStart: a, lineEnd: a };
  }

  return {};
}

/** Escape string for safe RegExp construction */
function reEscape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** For dot-path keys, use leaf segment for YAML/JSON key matching. */
function leafOfKey(k: string) {
  const s = String(k ?? "");
  if (!s) return "";
  const noIndexes = s.replace(/\[\d+\]/g, "");
  const parts = noIndexes.split(".");
  return parts[parts.length - 1] ?? noIndexes;
}

/**
 * Best-effort "find line number for key" from raw text.
 * Used when engine messages don’t include a `line X`.
 */
function findLineForKey(opts: { key: string; text: string; format: FormatId; envProfile?: EnvProfileId }): number | null {
  const key = String(opts.key ?? "");
  const text = String(opts.text ?? "");
  if (!key || !text) return null;

  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  if (opts.format === "env") {
    // Allow optional "export " in dotenv mode
    const k = reEscape(key);
    const allowExport = opts.envProfile !== "compose";
    const re = allowExport
      ? new RegExp(`^\\s*(?!#)\\s*(?:export\\s+)?${k}\\s*=`, "i")
      : new RegExp(`^\\s*(?!#)\\s*${k}\\s*=`, "i");

    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i] ?? "")) return i + 1;
    }
    return null;
  }

  if (opts.format === "yaml") {
    const leaf = leafOfKey(key);
    if (!leaf) return null;
    const k = reEscape(leaf);
    const re = new RegExp(`^\\s*(?!#)\\s*${k}\\s*:`, "i");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i] ?? "")) return i + 1;
    }
    return null;
  }

  // json
  const leaf = leafOfKey(key);
  if (!leaf) return null;
  const k = reEscape(leaf);
  const re = new RegExp(`"\\s*${k}\\s*"\\s*:`, "i");
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i] ?? "")) return i + 1;
  }
  return null;
}

/**
 * Resolve issue line range:
 * 1) direct/parsed line info (line/Lxx)
 * 2) fallback: match by key against the input text
 */
function resolveIssueLineRange(opts: {
  issue: any;
  sideText: string;
  format: FormatId;
  envProfile: EnvProfileId;
}): { lineStart?: number; lineEnd?: number } {
  const { issue, sideText, format, envProfile } = opts;

  const direct = extractLineRange(issue);
  if (direct.lineStart) return direct;

  const key = String(issue?.key ?? issue?.path ?? issue?.name ?? "");
  if (!key) return {};

  const line = findLineForKey({ key, text: sideText, format, envProfile });
  if (!line) return {};
  return { lineStart: line, lineEnd: line };
}

/** Resolve compare finding line(s) on each side. */
function resolveFindingLines(opts: {
  finding: any;
  leftText: string;
  rightText: string;
  format: FormatId;
  envProfile: EnvProfileId;
}): { leftLine?: number; rightLine?: number } {
  const { finding, leftText, rightText, format, envProfile } = opts;

  const msg = String(finding?.message ?? "");
  const mentionsLeft = /\bleft\b/i.test(msg);
  const mentionsRight = /\bright\b/i.test(msg);

  // Try explicit line info in message/object
  const lr = extractLineRange(finding);
  if (lr.lineStart) {
    const line = lr.lineStart;
    if (mentionsLeft && !mentionsRight) return { leftLine: line };
    if (mentionsRight && !mentionsLeft) return { rightLine: line };
    // ambiguous → fall through to key matching, then decide
  }

  const key = String(finding?.key ?? "");
  const leftLine = key ? findLineForKey({ key, text: leftText, format, envProfile }) : null;
  const rightLine = key ? findLineForKey({ key, text: rightText, format, envProfile }) : null;

  // If message clearly indicates a side, prefer that side only (even if key exists on both)
  if (mentionsLeft && !mentionsRight) return { leftLine: leftLine ?? undefined };
  if (mentionsRight && !mentionsLeft) return { rightLine: rightLine ?? undefined };

  // If explicit line existed but we couldn't infer side, prefer side where key match exists; else both
  if (lr.lineStart) {
    const line = lr.lineStart;
    if (leftLine && !rightLine) return { leftLine: line };
    if (rightLine && !leftLine) return { rightLine: line };
    return { leftLine: line, rightLine: line };
  }

  return { leftLine: leftLine ?? undefined, rightLine: rightLine ?? undefined };
}

export default function Home() {
  const [leftDraft, setLeftDraft] = useState("");
  const [rightDraft, setRightDraft] = useState("");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");

  // format (env/json/yaml)
  const [format, setFormat] = useState<FormatId>("env");

  // env profile (env only)
  const [envProfile, setEnvProfile] = useState<EnvProfileId>("dotenv");

  // advanced controls
  const [showMore, setShowMore] = useState(false);

  // workspace tabs
  const [tool, setTool] = useState<ToolId>("compare");

  // ✅ Jump-to-line wiring (hooks MUST be inside Home)
  const [jumpTo, setJumpTo] = useState<JumpTo>(null);

  // theme (moved to hook)
  const { themeMode, setThemeMode, THEME, segValue } = useThemeMode();

  const leftInputRef = useRef<HTMLInputElement | null>(null);
  const rightInputRef = useRef<HTMLInputElement | null>(null);
  const shareImportRef = useRef<HTMLInputElement | null>(null);

  // editor IO (moved to hook)
  const { pasteErr, dragOver, pasteFromClipboard, readFile, onPickFile, onDrop, onDragOver, onDragLeave } = useEditorIO({
    setLeftDraft,
    setRightDraft,
  });

  const draftBlank = leftDraft.trim().length === 0 && rightDraft.trim().length === 0;
  const draftReady = leftDraft.trim().length > 0 && rightDraft.trim().length > 0;
  const compareBlank = left.trim().length === 0 && right.trim().length === 0;
  const hasCompared = !compareBlank;

  const hasAnyDraft = leftDraft.trim().length > 0 || rightDraft.trim().length > 0;

  // Validate severity filters (default ON)
  const [vSevHigh, setVSevHigh] = useState(true);
  const [vSevMed, setVSevMed] = useState(true);
  const [vSevLow, setVSevLow] = useState(true);

  // ✅ Strict YAML mode (Validate only)
  const [yamlStrict, setYamlStrict] = useState(false);

  const validateSeverityEnabled = (sev: any) => {
    const s = normSeverity(sev);
    if (s === "high") return vSevHigh;
    if (s === "medium") return vSevMed;
    if (s === "low") return vSevLow;
    return true;
  };

  const { result, engineMs, status } = useConfigDiffCompare(left, right, {
    debounceMs: 300,
    profile: envProfile,
    format,
  });

  // -----------------------
  // ✅ Validate UX controls (NO live validation)
  // -----------------------
  const [lastEditedAt, setLastEditedAt] = useState<number | null>(null);
  useEffect(() => {
    setLastEditedAt(Date.now());
  }, [leftDraft, rightDraft, format, envProfile, yamlStrict]);

  const {
    result: validateResult,
    status: validateStatus,
    run: runValidate,
    hasRun: validateHasRun,
    lastValidatedAt,
  } = useConfigValidate(leftDraft, rightDraft, {
    debounceMs: 250,
    profile: envProfile,
    format,
    enabled: false, // ✅ disable auto validation entirely
    yamlStrict,
  });

  // ✅ Auto-run once when the user opens the Validate tab
  useEffect(() => {
    if (tool !== "validate") return;
    if (!hasAnyDraft) return;
    runValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]); // run on tab-open only

  const validateIsStale =
    validateHasRun && lastValidatedAt != null && lastEditedAt != null && lastEditedAt > lastValidatedAt;

  const [query, setQuery] = useState("");
  const [showChanged, setShowChanged] = useState(true);
  const [showAdded, setShowAdded] = useState(true);
  const [showRemoved, setShowRemoved] = useState(true);
  const [showFindings, setShowFindings] = useState(true);

  const [sevHigh, setSevHigh] = useState(true);
  const [sevMed, setSevMed] = useState(true);
  const [sevLow, setSevLow] = useState(true);

  const [maskValues, setMaskValues] = useState(true);
  const [secretsOnly, setSecretsOnly] = useState(false);

  const [rowLimit, setRowLimit] = useState<number>(500);
  const [sortMode, setSortMode] = useState<SortMode>("none");

  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);

  // derived compare logic (moved to hook)
  const {
    filteredAll,
    rendered,
    uiMs,
    findingCountsUI,
    findingCountsAll,
    filtersHint,
    anyTruncated,
    showingText,
    displaySingle,
    renderChangedValue,
  } = useCompareDerived({
    result,
    compareBlank,
    hasCompared,
    format,
    envProfile,
    THEME,
    query,
    sevHigh,
    sevMed,
    sevLow,
    secretsOnly,
    maskValues,
    rowLimit,
    sortMode,
  });

  const downloadText = (filename: string, text: string, mime = "text/plain") => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildReport = () => {
    if (!hasCompared) return null;
    if ("error" in (result as any)) return null;

    const generatedAt = new Date().toISOString();

    return {
      generatedAt,
      perf: { engineMs, uiMs },
      format,
      profile: envProfile,
      filters: {
        query,
        show: { changed: showChanged, added: showAdded, removed: showRemoved, findings: showFindings },
        severity: { high: sevHigh, medium: sevMed, low: sevLow },
        privacy: { maskValues, secretsOnly },
        render: { rowLimit },
        sort: { sortMode },
        showMore,
      },
      counts: {
        changed: filteredAll.changedFiltered.length,
        added: filteredAll.addedFiltered.length,
        removed: filteredAll.removedFiltered.length,
        findings_filtered: filteredAll.findingsFiltered.length,
        critical_filtered: findingCountsUI.critical,
        suggestions_filtered: findingCountsUI.suggestions,
        findings_total: findingCountsAll.total,
        critical_total: findingCountsAll.critical,
        suggestions_total: findingCountsAll.suggestions,
      },
      changed: filteredAll.changedFiltered.map((c: any) => ({ key: c.key, display: `${c.key}: ${c.from} → ${c.to}` })),
      added: filteredAll.addedFiltered.map((a: any) => ({ key: a.key, value: displaySingle(a.key, a.value) })),
      removed: filteredAll.removedFiltered.map((r: any) => ({ key: r.key, value: displaySingle(r.key, r.value) })),
      findings: filteredAll.findingsFiltered.map((f: any) => ({
        key: f.key,
        severity: normSeverity(f.severity),
        message: f.message,
      })),
    };
  };

  const reportToMarkdown = (report: any) => {
    const lines: string[] = [];
    lines.push(`# ConfigSift Report`);
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Format: ${report.format ?? "env"}`);
    if (report.format === "env") lines.push(`Parsing: ${report.profile ?? "dotenv"}`);
    lines.push(`UI time: ${report.perf.uiMs ?? "?"} ms`);
    lines.push(`Engine time: ${report.perf.engineMs ?? "?"} ms`);
    lines.push("");

    lines.push(`## Filters`);
    lines.push(`- Query: \`${report.filters.query ?? ""}\``);
    lines.push(`- Privacy: maskValues=${report.filters.privacy.maskValues}, secretsOnly=${report.filters.privacy.secretsOnly}`);
    lines.push(`- Render: rowLimit=${report.filters.render.rowLimit}`);
    lines.push(`- Sort: sortMode=${report.filters.sort.sortMode}`);
    lines.push("");

    const sec = (title: string) => {
      lines.push(`## ${title}`);
    };

    sec("Changed");
    if (!report.changed.length) lines.push("_None_");
    for (const c of report.changed) lines.push(`- \`${c.key}\`: ${c.display}`);

    lines.push("");
    sec("Added");
    if (!report.added.length) lines.push("_None_");
    for (const a of report.added) lines.push(`- \`${a.key}\`: \`${a.value}\``);

    lines.push("");
    sec("Removed");
    if (!report.removed.length) lines.push("_None_");
    for (const r of report.removed) lines.push(`- \`${r.key}\`: \`${r.value}\``);

    lines.push("");
    sec("Risk Findings");
    if (!report.findings.length) lines.push("_None_");
    for (const f of report.findings) lines.push(`- \`${f.key}\` **(${f.severity})** — ${f.message}`);

    lines.push("");
    return lines.join("\n");
  };

  const buildShareState = (): ShareStateV1 => ({
    v: 1,
    left: leftDraft,
    right: rightDraft,
    ui: {
      format,
      envProfile,
      query,
      showChanged,
      showAdded,
      showRemoved,
      showFindings,
      sevHigh,
      sevMed,
      sevLow,
      maskValues,
      secretsOnly,
      rowLimit,
      sortMode,
      showMore,
    },
  });

  const applyShareState = (s: ShareStateV1, opts?: { commit?: boolean }) => {
    const l = s.left ?? "";
    const r = s.right ?? "";
    setLeftDraft(l);
    setRightDraft(r);

    if (opts?.commit) {
      setLeft(l);
      setRight(r);
    } else {
      setLeft("");
      setRight("");
    }

    setFormat(s.ui?.format ?? "env");
    setEnvProfile(s.ui?.envProfile ?? "dotenv");
    setShowMore(!!s.ui?.showMore);

    setQuery(s.ui?.query ?? "");
    setShowChanged(!!s.ui?.showChanged);
    setShowAdded(!!s.ui?.showAdded);
    setShowRemoved(!!s.ui?.showRemoved);
    setShowFindings(!!s.ui?.showFindings);
    setSevHigh(!!s.ui?.sevHigh);
    setSevMed(!!s.ui?.sevMed);
    setSevLow(!!s.ui?.sevLow);
    setMaskValues(!!s.ui?.maskValues);
    setSecretsOnly(!!s.ui?.secretsOnly);
    setRowLimit(Number.isFinite(s.ui?.rowLimit) ? Number(s.ui?.rowLimit) : 500);
    setSortMode((s.ui?.sortMode as SortMode) ?? "none");
  };

  const downloadShareJSON = () => {
    const share = buildShareState();
    const snapshot = { kind: "configsift-snapshot", createdAt: new Date().toISOString(), share };
    downloadText(`configsift-snapshot-${Date.now()}.json`, JSON.stringify(snapshot, null, 2), "application/json");
  };

  const looksLikeReportJson = (x: any) => {
    return x && typeof x === "object" && typeof x.generatedAt === "string" && x.filters && Array.isArray(x.changed);
  };

  const onImportShareJSON = async (file?: File | null) => {
    if (!file) return;
    try {
      const text = await readFile(file);
      const parsed = JSON.parse(text);

      if (looksLikeReportJson(parsed)) {
        throw new Error(
          'That file is a JSON REPORT (from "Download JSON"). Reports are not importable because they don’t contain your full inputs/UI state. Use "Share JSON" / snapshot instead.'
        );
      }

      const share: ShareStateV1 | null =
        parsed?.kind === "configsift-snapshot" && parsed?.share?.v === 1
          ? (parsed.share as ShareStateV1)
          : parsed?.v === 1
          ? (parsed as ShareStateV1)
          : null;

      if (!share) throw new Error("Invalid share file (version mismatch).");

      applyShareState(share, { commit: true });
      setShareMsg("Imported Share JSON.");
      window.location.hash = "";
    } catch (e: any) {
      setShareMsg(e?.message ?? "Failed to import Share JSON.");
    } finally {
      if (shareImportRef.current) shareImportRef.current.value = "";
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const copyKeys = async (keys: string[]) => {
    const ok = await copyText(keys.join("\n"));
    if (!ok) alert("Copy failed (clipboard permissions).");
  };

  const copyShareLink = async () => {
    setShareMsg(null);
    setShareBusy(true);

    try {
      const token = await encodeShareState(buildShareState());
      const url = `${window.location.origin}${window.location.pathname}#s=${token}`;

      if (url.length > MAX_SHARE_URL_LEN) {
        downloadShareJSON();
        setShareMsg("Share link too large → downloaded snapshot JSON instead (importable).");
        return;
      }

      window.location.hash = `s=${token}`;

      const ok = await copyText(url);
      setShareMsg(ok ? "Share link copied to clipboard." : "Could not copy link (clipboard permission).");
    } catch (e: any) {
      setShareMsg(e?.message ?? "Failed to create share link.");
    } finally {
      setShareBusy(false);
    }
  };

  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (typeof window === "undefined") return;

      const hash = window.location.hash?.replace(/^#/, "") ?? "";
      const params = new URLSearchParams(hash);
      const token = params.get("s");
      if (token) {
        const decoded = await decodeShareState(token);
        if (decoded) {
          applyShareState(decoded, { commit: true });
          setShareMsg("Loaded from share link.");
          setHydrated(true);
          return;
        }
      }

      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.v === 1) {
            applyShareState(parsed as ShareStateV1, { commit: false });
            setShareMsg("Restored last session.");
          }
        }
      } catch {
      } finally {
        setHydrated(true);
      }
    };

    run();
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const t = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(buildShareState()));
      } catch {}
    }, 500);

    return () => clearTimeout(t);
  }, [
    hydrated,
    leftDraft,
    rightDraft,
    format,
    envProfile,
    showMore,
    query,
    showChanged,
    showAdded,
    showRemoved,
    showFindings,
    sevHigh,
    sevMed,
    sevLow,
    maskValues,
    secretsOnly,
    rowLimit,
    sortMode,
  ]);

  const clearSavedDraft = () => {
    try {
      localStorage.removeItem(LS_KEY);
      setShareMsg("Cleared saved draft.");
    } catch {
      setShareMsg("Could not clear saved draft.");
    }
  };

  const loadSample = () => {
    const l = format === "json" ? SAMPLE_LEFT_JSON : format === "yaml" ? SAMPLE_LEFT_YAML : SAMPLE_LEFT_ENV;
    const r = format === "json" ? SAMPLE_RIGHT_JSON : format === "yaml" ? SAMPLE_RIGHT_YAML : SAMPLE_RIGHT_ENV;

    setLeftDraft(l);
    setRightDraft(r);
    setLeft(l);
    setRight(r);
    setShareMsg(null);
  };

  const runCompare = () => {
    if (!draftReady) {
      setShareMsg("Paste/upload both Left and Right before comparing.");
      return;
    }
    setLeft(leftDraft);
    setRight(rightDraft);
    setShareMsg(null);
  };

  useEffect(() => {
    if (!showFindings) {
      setSortMode((prev) => (prev === "severity_desc" ? "key_asc" : prev));
    }
  }, [showFindings]);

  const statusTone =
    status === "Idle"
      ? { bg: THEME.blueSoft, border: THEME.borderSoft }
      : { bg: THEME.blueSoft2, border: THEME.borderSoft };

  const shareVariant = hasCompared ? "primary" : "subtle";
  const compareLabel = format === "json" ? "Compare JSON" : format === "yaml" ? "Compare YAML" : "Compare Environments";

  const TOOL_TABS: Array<{ id: ToolId; label: string; supported: (fmt: FormatId) => boolean; implemented: boolean }> = [
    { id: "compare", label: "Compare", supported: () => true, implemented: true },
    { id: "format", label: "Format", supported: (f) => f === "json", implemented: false },
    { id: "minify", label: "Minify", supported: (f) => f === "json", implemented: false },
    { id: "validate", label: "Validate", supported: () => true, implemented: true },
    { id: "bundle", label: "Bundle", supported: () => true, implemented: false },
  ];

  const tabState = (t: (typeof TOOL_TABS)[number]) => {
    const supported = t.supported(format);
    const implemented = t.implemented;
    const disabled = !supported || !implemented;

    let title = "";
    if (!supported) title = format === "env" ? "JSON-only" : "Not available for this format";
    else if (!implemented) title = "Coming soon";
    else title = t.label;

    return { disabled, title };
  };

  const applyPresetOnlyChanged = () => {
    setShowChanged(true);
    setShowAdded(false);
    setShowRemoved(false);
    setShowFindings(false);
  };

  // -----------------------------
  // ✅ Validate (filtered) helpers
  // -----------------------------
  const validateObj: any = validateResult as any;
  const hasValidateError = !!(validateObj && typeof validateObj === "object" && "error" in validateObj && validateObj.error);

  const validateTotals = validateObj?.totals ?? { high: 0, medium: 0, low: 0 };

  const leftIssuesAllRaw: any[] = Array.isArray(validateObj?.left?.issues) ? validateObj.left.issues : [];
  const rightIssuesAllRaw: any[] = Array.isArray(validateObj?.right?.issues) ? validateObj.right.issues : [];

  // ✅ Enrich issues with resolved lineStart/lineEnd (so Env 1 also gets L## + click)
  const leftIssuesAll: any[] = useMemo(() => {
    return leftIssuesAllRaw.map((it) => {
      const lr = resolveIssueLineRange({ issue: it, sideText: leftDraft, format, envProfile });
      const lineStart = lr.lineStart;
      const lineEnd = lr.lineEnd ?? lr.lineStart;
      return {
        ...it,
        __lineStart: lineStart,
        __lineEnd: lineEnd,
        line: typeof it?.line === "number" ? it.line : lineStart,
      };
    });
  }, [leftIssuesAllRaw, leftDraft, format, envProfile]);

  const rightIssuesAll: any[] = useMemo(() => {
    return rightIssuesAllRaw.map((it) => {
      const lr = resolveIssueLineRange({ issue: it, sideText: rightDraft, format, envProfile });
      const lineStart = lr.lineStart;
      const lineEnd = lr.lineEnd ?? lr.lineStart;
      return {
        ...it,
        __lineStart: lineStart,
        __lineEnd: lineEnd,
        line: typeof it?.line === "number" ? it.line : lineStart,
      };
    });
  }, [rightIssuesAllRaw, rightDraft, format, envProfile]);

  const leftIssues = leftIssuesAll.filter((it: any) => validateSeverityEnabled(it?.severity));
  const rightIssues = rightIssuesAll.filter((it: any) => validateSeverityEnabled(it?.severity));

  // ✅ Build annotations for line preview (for gutter markers + highlights)
  const validateLeftAnnotations: LineAnnotation[] = useMemo(() => {
    return leftIssuesAll
      .map((it: any) => {
        const sev = normSeverity(it?.severity) as any;
        const s: "high" | "medium" | "low" | "info" = sev === "high" || sev === "medium" || sev === "low" ? sev : "info";

        const lineStart = typeof it?.__lineStart === "number" ? it.__lineStart : extractLineRange(it).lineStart;
        const lineEnd = typeof it?.__lineEnd === "number" ? it.__lineEnd : extractLineRange(it).lineEnd;

        if (!lineStart) return null;
        const label = String(it?.message ?? it?.key ?? "Issue");
        return { lineStart, lineEnd: lineEnd ?? lineStart, severity: s, label };
      })
      .filter(Boolean) as LineAnnotation[];
  }, [leftIssuesAll]);

  const validateRightAnnotations: LineAnnotation[] = useMemo(() => {
    return rightIssuesAll
      .map((it: any) => {
        const sev = normSeverity(it?.severity) as any;
        const s: "high" | "medium" | "low" | "info" = sev === "high" || sev === "medium" || sev === "low" ? sev : "info";

        const lineStart = typeof it?.__lineStart === "number" ? it.__lineStart : extractLineRange(it).lineStart;
        const lineEnd = typeof it?.__lineEnd === "number" ? it.__lineEnd : extractLineRange(it).lineEnd;

        if (!lineStart) return null;
        const label = String(it?.message ?? it?.key ?? "Issue");
        return { lineStart, lineEnd: lineEnd ?? lineStart, severity: s, label };
      })
      .filter(Boolean) as LineAnnotation[];
  }, [rightIssuesAll]);

  // -----------------------------
  // ✅ Compare annotations + line hints (for Compare tab preview + clickable findings)
  // -----------------------------
  const compareLineHints = useMemo(() => {
    const m = new Map<string, { leftLine?: number; rightLine?: number }>();
    if (!hasCompared) return m;
    if ("error" in (result as any)) return m;

    const list = Array.isArray(rendered?.findingsFiltered) ? rendered.findingsFiltered : [];
    for (let idx = 0; idx < list.length; idx++) {
      const f = list[idx];
      const id = `${String(f?.key ?? "")}-${idx}`;
      const lr = resolveFindingLines({ finding: f, leftText: leftDraft, rightText: rightDraft, format, envProfile });
      m.set(id, lr);
    }
    return m;
  }, [hasCompared, result, rendered, leftDraft, rightDraft, format, envProfile]);

  const compareLeftAnnotations: LineAnnotation[] = useMemo(() => {
    if (!hasCompared) return [];
    if ("error" in (result as any)) return [];
    const list = Array.isArray(rendered?.findingsFiltered) ? rendered.findingsFiltered : [];
    const out: LineAnnotation[] = [];
    for (let idx = 0; idx < list.length; idx++) {
      const f = list[idx];
      const id = `${String(f?.key ?? "")}-${idx}`;
      const hint = compareLineHints.get(id);
      const line = hint?.leftLine;
      if (!line) continue;
      const sev = normSeverity(f?.severity) as any;
      const s: "high" | "medium" | "low" | "info" = sev === "high" || sev === "medium" || sev === "low" ? sev : "info";
      out.push({ lineStart: line, lineEnd: line, severity: s, label: String(f?.key ?? "Finding") });
    }
    return out;
  }, [hasCompared, result, rendered, compareLineHints]);

  const compareRightAnnotations: LineAnnotation[] = useMemo(() => {
    if (!hasCompared) return [];
    if ("error" in (result as any)) return [];
    const list = Array.isArray(rendered?.findingsFiltered) ? rendered.findingsFiltered : [];
    const out: LineAnnotation[] = [];
    for (let idx = 0; idx < list.length; idx++) {
      const f = list[idx];
      const id = `${String(f?.key ?? "")}-${idx}`;
      const hint = compareLineHints.get(id);
      const line = hint?.rightLine;
      if (!line) continue;
      const sev = normSeverity(f?.severity) as any;
      const s: "high" | "medium" | "low" | "info" = sev === "high" || sev === "medium" || sev === "low" ? sev : "info";
      out.push({ lineStart: line, lineEnd: line, severity: s, label: String(f?.key ?? "Finding") });
    }
    return out;
  }, [hasCompared, result, rendered, compareLineHints]);

  const onClearSide = (side: Side) => {
    if (side === "left") {
      setLeftDraft("");
      setLeft("");
    } else {
      setRightDraft("");
      setRight("");
    }
  };

  return (
    <main
      className="cd-page"
      style={{
        minHeight: "100vh",
        color: THEME.text,
        background: `linear-gradient(180deg, ${THEME.bgTop} 0%, ${THEME.bgMid} 55%, ${THEME.bgBottom} 100%)`,
      }}
    >
      <div className="cd-container">
        {/* Header */}
        <header className="cd-topbar">
          <div className="cd-brand" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img
              src="/configsift_icon.png"
              alt="ConfigSift"
              width={38}
              height={38}
              style={{ borderRadius: 10, boxShadow: THEME.shadowSm }}
            />
            <div>
              <h1 className="cd-title">ConfigSift</h1>
              <div className="cd-subtitle">Compare .env / JSON / YAML configs in your browser — nothing is uploaded.</div>
            </div>
          </div>

          <div className="cd-topbarRight">
            {/* Theme segmented control */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="mutedSm" style={{ opacity: 0.9 }}>
                Theme
              </span>

              <div className="cd-seg" role="group" aria-label="Theme" style={{ ["--seg" as any]: segValue }}>
                <span className="cd-segIndicator" aria-hidden="true" />

                <button
                  type="button"
                  className="cd-segBtn"
                  data-on={themeMode === "system" ? "true" : "false"}
                  aria-pressed={themeMode === "system"}
                  onClick={() => setThemeMode("system")}
                  title="Theme: System"
                >
                  System
                </button>

                <button
                  type="button"
                  className="cd-segBtn"
                  data-on={themeMode === "light" ? "true" : "false"}
                  aria-pressed={themeMode === "light"}
                  onClick={() => setThemeMode("light")}
                  title="Theme: Light"
                >
                  Light
                </button>

                <button
                  type="button"
                  className="cd-segBtn"
                  data-on={themeMode === "dark" ? "true" : "false"}
                  aria-pressed={themeMode === "dark"}
                  onClick={() => setThemeMode("dark")}
                  title="Theme: Dark"
                >
                  Dark
                </button>
              </div>
            </div>

            {draftBlank ? (
              <ActionButton variant="subtle" onClick={loadSample} title="Load a small sample config for this format">
                Load sample
              </ActionButton>
            ) : null}

            <ActionButton
              variant={shareVariant as any}
              onClick={copyShareLink}
              title="Create a shareable link (falls back to snapshot JSON if too large)"
              disabled={shareBusy as any}
            >
              {shareBusy ? "Sharing…" : "Share link"}
            </ActionButton>

            <span
              className="pill"
              style={{ background: statusTone.bg, borderColor: statusTone.border, color: THEME.text }}
              title="Debounced + worker compare status"
            >
              {status === "Idle" ? "Ready" : "Comparing…"}
            </span>

            {process.env.NODE_ENV !== "production" && hydrated && (
              <span className="pill" title="Performance (UI + worker)">
                UI {uiMs}ms · Engine {engineMs ?? "…"}ms
              </span>
            )}
          </div>
        </header>

        {/* Hero */}
        <section className="cd-hero" style={{ position: "relative", zIndex: 2, marginBottom: 14 }}>
          <div className="cd-heroRow">
            <div>
              <h2 className="cd-heroTitle">Compare configs instantly</h2>
              <div className="cd-heroTagline">
                Spot missing keys, risky secrets, and unsafe URLs before they hit production — all locally in your browser.
              </div>

              <div className="cd-heroPills">
                <span className="pill">⚡ Instant diff</span>
                <span className="pill">🔒 Secret detection</span>
                <span className="pill">🚦 Deployment safety</span>
              </div>
            </div>

            <div className="cd-heroCta">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="mutedSm" style={{ opacity: 0.9 }}>
                  Format
                </span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as FormatId)}
                  className="cd-select"
                  title="Choose config format"
                  style={{ height: 34 }}
                >
                  <option value="env">.env</option>
                  <option value="json">JSON</option>
                  <option value="yaml">YAML</option>
                </select>
              </div>

              <ActionButton
                variant="primary"
                onClick={() => {
                  setTool("compare");
                  runCompare();
                }}
                disabled={!draftReady as any}
                title={draftReady ? "Run comparison" : "Paste/upload both configs to enable compare"}
              >
                {compareLabel}
              </ActionButton>
            </div>
          </div>
        </section>

        {/* Tool tabs */}
        <nav className="cd-toolTabs" aria-label="Workspace tools" style={{ position: "relative", zIndex: 1 }}>
          {TOOL_TABS.map((t) => {
            const st = tabState(t);
            const active = tool === t.id;

            return (
              <button
                key={t.id}
                type="button"
                className="cd-tab"
                data-active={active ? "true" : "false"}
                aria-current={active ? "page" : undefined}
                aria-disabled={st.disabled ? "true" : "false"}
                disabled={st.disabled}
                title={st.title}
                onClick={() => {
                  if (st.disabled) return;
                  setTool(t.id);
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Hidden inputs */}
        <input
          ref={leftInputRef}
          type="file"
          accept=".env,.txt,.json,.yml,.yaml,application/json,text/yaml,application/x-yaml,*/*"
          style={{ display: "none" }}
          onChange={(e) => onPickFile("left", e.target.files?.[0])}
        />
        <input
          ref={rightInputRef}
          type="file"
          accept=".env,.txt,.json,.yml,.yaml,application/json,text/yaml,application/x-yaml,*/*"
          style={{ display: "none" }}
          onChange={(e) => onPickFile("right", e.target.files?.[0])}
        />
        <input
          ref={shareImportRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => onImportShareJSON(e.target.files?.[0])}
        />

        {/* Editors shown on Compare + Validate */}
        {tool === "compare" || tool === "validate" ? (
          <ConfigEditors
            format={format}
            leftDraft={leftDraft}
            rightDraft={rightDraft}
            setLeftDraft={setLeftDraft}
            setRightDraft={setRightDraft}
            dragOver={dragOver}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onPaste={pasteFromClipboard}
            onUpload={(side) => (side === "left" ? leftInputRef.current?.click() : rightInputRef.current?.click())}
            onClear={(side) => onClearSide(side)}
            // ✅ line preview annotations + jump wiring
            leftAnnotations={tool === "validate" ? validateLeftAnnotations : tool === "compare" ? compareLeftAnnotations : []}
            rightAnnotations={tool === "validate" ? validateRightAnnotations : tool === "compare" ? compareRightAnnotations : []}
			jumpTo={jumpTo}
			onConsumeJumpTo={() => setJumpTo(null)}
          />
        ) : null}

        {/* Tool Content */}
        {tool === "validate" ? (
          <ValidatePanel
            format={format}
            THEME={THEME}
            shareMsg={shareMsg}
            pasteErr={pasteErr}
            hasAnyDraft={hasAnyDraft}
            validateStatus={validateStatus}
            runValidate={runValidate}
            validateHasRun={validateHasRun}
            validateIsStale={validateIsStale}
            hasValidateError={hasValidateError}
            validateErrorText={hasValidateError ? String((validateObj as any).error ?? "") : null}
            yamlStrict={yamlStrict}
            setYamlStrict={setYamlStrict}
            validateTotals={validateTotals}
            vSevHigh={vSevHigh}
            vSevMed={vSevMed}
            vSevLow={vSevLow}
            setVSevHigh={setVSevHigh}
            setVSevMed={setVSevMed}
            setVSevLow={setVSevLow}
            leftIssuesAll={leftIssuesAll}
            rightIssuesAll={rightIssuesAll}
            leftIssues={leftIssues}
            rightIssues={rightIssues}
            // ✅ click issue → jump preview
            onJumpToLine={(side, line) => {
              setTool("validate");
              setJumpTo({ side, line });
            }}
          />
        ) : tool !== "compare" ? (
          <div className="cd-card" style={{ marginTop: 14 }}>
            <div className="cd-cardTitle" style={{ fontSize: 16 }}>
              {TOOL_TABS.find((x) => x.id === tool)?.label}
            </div>
            <div className="cd-cardHint" style={{ marginTop: 6 }}>
              Coming soon.
            </div>
          </div>
        ) : (
          <ComparePanel
            THEME={THEME}
            shareMsg={shareMsg}
            pasteErr={pasteErr}
            compareLabel={compareLabel}
            draftReady={draftReady}
            hasCompared={hasCompared}
            result={result}
            query={query}
            setQuery={setQuery}
            showChanged={showChanged}
            setShowChanged={setShowChanged}
            showAdded={showAdded}
            setShowAdded={setShowAdded}
            showRemoved={showRemoved}
            setShowRemoved={setShowRemoved}
            showFindings={showFindings}
            setShowFindings={setShowFindings}
            sevHigh={sevHigh}
            setSevHigh={setSevHigh}
            sevMed={sevMed}
            setSevMed={setSevMed}
            sevLow={sevLow}
            setSevLow={setSevLow}
            maskValues={maskValues}
            setMaskValues={setMaskValues}
            secretsOnly={secretsOnly}
            setSecretsOnly={setSecretsOnly}
            showMore={showMore}
            setShowMore={setShowMore as any}
            format={format}
            envProfile={envProfile}
            setEnvProfile={setEnvProfile}
            rowLimit={rowLimit}
            setRowLimit={setRowLimit}
            sortMode={sortMode}
            setSortMode={setSortMode}
            anyTruncated={anyTruncated}
            filtersHint={filtersHint}
            applyPresetOnlyChanged={applyPresetOnlyChanged}
            onDownloadJSON={() => {
              const report = buildReport();
              if (!report) return;
              downloadText(`configsift-report-${Date.now()}.json`, JSON.stringify(report, null, 2), "application/json");
            }}
            onDownloadMarkdown={() => {
              const report = buildReport();
              if (!report) return;
              downloadText(`configsift-report-${Date.now()}.md`, reportToMarkdown(report), "text/markdown");
            }}
            onDownloadShareJSON={downloadShareJSON}
            onTriggerImportShareJSON={() => shareImportRef.current?.click()}
            onClearSavedDraft={clearSavedDraft}
            filteredAll={filteredAll}
            rendered={rendered}
            findingCountsUI={findingCountsUI}
            findingCountsAll={findingCountsAll}
            showingText={showingText}
            copyKeys={copyKeys}
            renderChangedValue={renderChangedValue}
            displaySingle={displaySingle}
            // ✅ Compare click → jump
            getFindingLineHint={(id) => compareLineHints.get(id) ?? null}
            onJumpToLine={(side, line) => setJumpTo({ side, line })}
          />
        )}
      </div>
    </main>
  );
}
