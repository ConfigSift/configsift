"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { computeDiffParts, isSensitiveKey, normSeverity, sevRank } from "./lib/configdiff";
import { useConfigDiffCompare } from "./lib/useConfigDiffCompare";
import { useConfigValidate } from "./lib/useConfigValidate";
import { decodeShareState, encodeShareState, ShareStateV1, EnvProfileId, FormatId } from "./lib/shareState";

import { ActionButton, Toggle, Pill, Badge, SevChip, Section, Row, RowNode } from "./_components/configdiff-ui";

type Side = "left" | "right";
type SortMode = "key_asc" | "key_desc" | "severity_desc" | "none";

// Tool tabs (workspace nav)
type ToolId = "compare" | "format" | "minify" | "validate" | "bundle";

type Finding = { key: string; severity?: string; message: string };
type FindingCountsUI = { critical: number; suggestions: number };
type FindingCountsAll = { critical: number; suggestions: number; total: number };

// THEME
type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const LS_KEY = "configsift:draft:v1";
const LS_THEME_KEY = "configsift:theme:v1";
const MAX_SHARE_URL_LEN = 1900;

const LIGHT_THEME = {
  bgTop: "#F6F8FF",
  bgMid: "#F0F4FF",
  bgBottom: "#F8F9FB",
  card: "#FFFFFF",
  card2: "rgba(255,255,255,0.86)",
  border: "rgba(53,56,83,0.14)",
  borderSoft: "rgba(53,56,83,0.10)",
  text: "#121528",
  muted: "#5B5F77",
  blue: "#4A7FEB",
  blue2: "#5693D8",
  blueSoft: "rgba(74,127,235,0.14)",
  blueSoft2: "rgba(86,147,216,0.12)",
  shadow: "0 12px 34px rgba(16, 21, 40, 0.08)",
  shadowSm: "0 6px 18px rgba(16, 21, 40, 0.06)",
};

const DARK_THEME = {
  bgTop: "#0B0F14",
  bgMid: "#0C121B",
  bgBottom: "#0A0E13",
  card: "rgba(255,255,255,0.05)",
  card2: "rgba(255,255,255,0.03)",
  border: "rgba(231,236,255,0.14)",
  borderSoft: "rgba(231,236,255,0.10)",
  text: "#E8EEF9",
  muted: "rgba(232,238,249,0.70)",
  blue: "#4DA3FF",
  blue2: "#66B6FF",
  blueSoft: "rgba(77,163,255,0.18)",
  blueSoft2: "rgba(102,182,255,0.14)",
  shadow: "0 18px 52px rgba(0,0,0,0.55)",
  shadowSm: "0 10px 28px rgba(0,0,0,0.42)",
};

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

export default function Home() {
  const [leftDraft, setLeftDraft] = useState("");
  const [rightDraft, setRightDraft] = useState("");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");

  // format (env/json)
  const [format, setFormat] = useState<FormatId>("env");

  // env profile (env only)
  const [envProfile, setEnvProfile] = useState<EnvProfileId>("dotenv");

  // advanced controls
  const [showMore, setShowMore] = useState(false);

  // workspace tabs
  const [tool, setTool] = useState<ToolId>("compare");

  // theme
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  const leftInputRef = useRef<HTMLInputElement | null>(null);
  const rightInputRef = useRef<HTMLInputElement | null>(null);
  const shareImportRef = useRef<HTMLInputElement | null>(null);

  const [dragOver, setDragOver] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  const draftBlank = leftDraft.trim().length === 0 && rightDraft.trim().length === 0;
  const draftReady = leftDraft.trim().length > 0 && rightDraft.trim().length > 0;
  const compareBlank = left.trim().length === 0 && right.trim().length === 0;
  const hasCompared = !compareBlank;

  const hasAnyDraft = leftDraft.trim().length > 0 || rightDraft.trim().length > 0;

  // Validate severity filters (default ON)
  const [vSevHigh, setVSevHigh] = useState(true);
  const [vSevMed, setVSevMed] = useState(true);
  const [vSevLow, setVSevLow] = useState(true);

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
  // ✅ Validate UX controls
  // -----------------------
  const [validateLive, setValidateLive] = useState(false); // default OFF (feels intentional with Run + auto-run on open)

  const [lastEditedAt, setLastEditedAt] = useState<number | null>(null);
  useEffect(() => {
    // edits in either textarea (or changing format/profile) should mark validation as potentially stale
    setLastEditedAt(Date.now());
  }, [leftDraft, rightDraft, format, envProfile]);

  // validate only auto-runs while on Validate tab and Live is ON
  const validateAutoEnabled = tool === "validate" && validateLive;

  const {
    result: validateResult,
    engineMs: validateMs,
    status: validateStatus,
    run: runValidate,
    hasRun: validateHasRun,
    lastValidatedAt,
  } = useConfigValidate(leftDraft, rightDraft, {
    debounceMs: 250,
    profile: envProfile,
    format,
    enabled: validateAutoEnabled,
  });

  // ✅ Auto-run once when the user opens the Validate tab
  useEffect(() => {
    if (tool !== "validate") return;
    if (!hasAnyDraft) return;
    runValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]); // run on tab-open only

  const validateIsStale =
    !validateLive &&
    validateHasRun &&
    lastValidatedAt != null &&
    lastEditedAt != null &&
    lastEditedAt > lastValidatedAt;

  // THEME: load + apply + persist
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_THEME_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") setThemeMode(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_THEME_KEY, themeMode);
    } catch {}

    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    const isDark = themeMode === "dark" || (themeMode === "system" && prefersDark);
    const next: ResolvedTheme = isDark ? "dark" : "light";

    setResolvedTheme(next);

    if (typeof document !== "undefined") document.documentElement.dataset.theme = next;
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const next: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolvedTheme(next);
      document.documentElement.dataset.theme = next;
    };

    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, [themeMode]);

  const THEME = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME;

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
  const [pasteErr, setPasteErr] = useState<string | null>(null);

  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);

  const q = query.trim().toLowerCase();

  const matchesQ = (key: string, preview?: string) => {
    if (!q) return true;
    const k = key.toLowerCase();
    const p = (preview ?? "").toLowerCase();
    return k.includes(q) || p.includes(q);
  };

  const severityEnabled = (sev?: string) => {
    const s = normSeverity(sev);
    if (s === "high") return sevHigh;
    if (s === "medium") return sevMed;
    if (s === "low") return sevLow;
    return true;
  };

  const getChangedStrings = (c: any) => {
    if (maskValues) {
      const from = (result as any)?.redactedValues?.[c.key]?.from?.redacted ?? (c.from != null ? "••••" : "");
      const to = (result as any)?.redactedValues?.[c.key]?.to?.redacted ?? (c.to != null ? "••••" : "");
      return { from: String(from ?? ""), to: String(to ?? "") };
    }
    return { from: String(c.from ?? ""), to: String(c.to ?? "") };
  };

  const displayChanged = (c: any) => {
    const { from, to } = getChangedStrings(c);
    return `${from}  →  ${to}`;
  };

  const displaySingle = (key: string, rawValue: any) => {
    if (maskValues) return (result as any)?.redactedValues?.[key]?.value?.redacted ?? "••••";
    return String(rawValue ?? "");
  };

  const renderChangedValue = (c: any) => {
    const { from, to } = getChangedStrings(c);
    const parts = computeDiffParts(from, to);

    const isEffectivelySame = parts.fromMid === "" && parts.toMid === "" && parts.suffix === "";

    const faint = { opacity: 0.86 };
    const hi = {
      fontWeight: 750,
      background: THEME.blueSoft,
      border: `1px solid ${THEME.borderSoft}`,
      borderRadius: 8,
      padding: "1px 6px",
    } as React.CSSProperties;

    if (isEffectivelySame) {
      return (
        <span className="mono" style={{ opacity: 0.92 }}>
          {from} <span style={{ opacity: 0.7 }}>→</span> {to}
        </span>
      );
    }

    return (
      <span className="mono" style={{ opacity: 0.96 }}>
        <span style={faint}>{parts.prefix}</span>
        {parts.fromMid ? <span style={hi}>{parts.fromMid}</span> : null}
        <span style={faint}>{parts.suffix}</span>

        <span style={{ opacity: 0.7, padding: "0 10px" }}>→</span>

        <span style={faint}>{parts.prefix}</span>
        {parts.toMid ? <span style={hi}>{parts.toMid}</span> : null}
        <span style={faint}>{parts.suffix}</span>
      </span>
    );
  };

  const filtersHint = useMemo(() => {
    const bits: string[] = [];
    bits.push(`Format: ${format}`);
    if (format === "env") bits.push(`Parsing: ${envProfile}`);
    if (secretsOnly) bits.push("Secrets-only is ON (only sensitive keys are shown).");
    if (q) bits.push(`Search is active (“${query.trim()}”).`);
    if (!sevHigh || !sevMed || !sevLow) bits.push("Severity filter is restricting Findings.");
    if (rowLimit > 0) bits.push(`Row limit is ${rowLimit} (after filters).`);
    if (rowLimit <= 0) bits.push("Row limit is unlimited (may freeze on huge diffs).");
    if (!hasCompared) bits.push("Run Compare to see results.");
    return bits.join(" ");
  }, [format, envProfile, secretsOnly, q, query, sevHigh, sevMed, sevLow, rowLimit, hasCompared]);

  const pasteFromClipboard = async (side: Side) => {
    setPasteErr(null);
    try {
      if (!navigator.clipboard?.readText) {
        setPasteErr("Clipboard API not available (requires HTTPS or localhost).");
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text) {
        setPasteErr("Clipboard is empty.");
        return;
      }
      if (side === "left") setLeftDraft(text);
      else setRightDraft(text);
    } catch (e: any) {
      setPasteErr(e?.message ?? "Paste failed (clipboard permission).");
    }
  };

  const readFile = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(file);
    });
  };

  const onPickFile = async (side: Side, file?: File | null) => {
    if (!file) return;
    const text = await readFile(file);
    if (side === "left") setLeftDraft(text);
    else setRightDraft(text);
  };

  const onDrop = async (side: Side, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver((d) => ({ ...d, [side]: false }));

    const file = e.dataTransfer.files?.[0];
    await onPickFile(side, file);
  };

  const onDragOver = (side: Side, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver[side]) setDragOver((d) => ({ ...d, [side]: true }));
  };

  const onDragLeave = (side: Side, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver((d) => ({ ...d, [side]: false }));
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

  const sortList = <T extends { key: string }>(arr: T[]): T[] => {
    if (sortMode === "none") return arr;
    const copy = [...arr];
    copy.sort((a, b) => {
      if (sortMode === "key_asc") return a.key.localeCompare(b.key);
      if (sortMode === "key_desc") return b.key.localeCompare(a.key);
      if (sortMode === "severity_desc") return a.key.localeCompare(b.key);
      return 0;
    });
    return copy;
  };

  const sortFindings = <T extends { key: string; severity?: string }>(arr: T[]): T[] => {
    if (sortMode === "none") return arr;

    const copy = [...arr];
    copy.sort((a, b) => {
      if (sortMode === "severity_desc") {
        const d = sevRank(b.severity) - sevRank(a.severity);
        if (d !== 0) return d;
        return a.key.localeCompare(b.key);
      }
      if (sortMode === "key_asc") return a.key.localeCompare(b.key);
      if (sortMode === "key_desc") return b.key.localeCompare(a.key);
      return 0;
    });
    return copy;
  };

  const { filteredAll, rendered, uiMs, findingCountsUI, findingCountsAll } = useMemo(() => {
    const t0 = performance.now();

    const empty = {
      changedFiltered: [] as any[],
      addedFiltered: [] as any[],
      removedFiltered: [] as any[],
      findingsFiltered: [] as any[],
    };

    const emptyCountsUI: FindingCountsUI = { critical: 0, suggestions: 0 };
    const emptyCountsAll: FindingCountsAll = { critical: 0, suggestions: 0, total: 0 };

    if (compareBlank) {
      const t1 = performance.now();
      return {
        filteredAll: empty,
        rendered: empty,
        uiMs: +(t1 - t0).toFixed(1),
        findingCountsUI: emptyCountsUI,
        findingCountsAll: emptyCountsAll,
      };
    }

    if ("error" in result) {
      const t1 = performance.now();
      return {
        filteredAll: empty,
        rendered: empty,
        uiMs: +(t1 - t0).toFixed(1),
        findingCountsUI: emptyCountsUI,
        findingCountsAll: emptyCountsAll,
      };
    }

    const baseFindings: Finding[] = Array.isArray((result as any).findings) ? (result as any).findings : [];
    const findingsAllArr: Finding[] = [...baseFindings];

    const crit = findingsAllArr.filter((f) => normSeverity(f?.severity) === "high").length;
    const tot = findingsAllArr.length;
    const countsAll: FindingCountsAll = { critical: crit, suggestions: tot - crit, total: tot };

    const changedFilteredRaw = (Array.isArray((result as any).changed) ? (result as any).changed : [])
      .filter((c: any) => (secretsOnly ? isSensitiveKey(c.key) : true))
      .filter((c: any) => {
        const preview = maskValues ? displayChanged(c) : `${c.from ?? ""} ${c.to ?? ""}`;
        return matchesQ(c.key, preview);
      });

    const addedFilteredRaw = (Array.isArray((result as any).added) ? (result as any).added : [])
      .filter((a: any) => (secretsOnly ? isSensitiveKey(a.key) : true))
      .filter((a: any) => {
        const preview = maskValues ? displaySingle(a.key, a.value) : String(a.value ?? "");
        return matchesQ(a.key, preview);
      });

    const removedFilteredRaw = (Array.isArray((result as any).removed) ? (result as any).removed : [])
      .filter((r: any) => (secretsOnly ? isSensitiveKey(r.key) : true))
      .filter((r: any) => {
        const preview = maskValues ? displaySingle(r.key, r.value) : String(r.value ?? "");
        return matchesQ(r.key, preview);
      });

    const findingsFilteredRaw = findingsAllArr
      .filter((f: any) => (secretsOnly ? isSensitiveKey(f.key) : true))
      .filter((f: any) => matchesQ(f.key, f.message) && severityEnabled(f.severity));

    const changedFiltered = sortList(changedFilteredRaw);
    const addedFiltered = sortList(addedFilteredRaw);
    const removedFiltered = sortList(removedFilteredRaw);
    const findingsFiltered = sortFindings(findingsFilteredRaw);

    const filteredAll = { changedFiltered, addedFiltered, removedFiltered, findingsFiltered };

    const criticalFiltered = findingsFiltered.filter((f: any) => normSeverity(f.severity) === "high").length;
    const suggestionsFiltered = findingsFiltered.length - criticalFiltered;
    const findingCountsUI: FindingCountsUI = { critical: criticalFiltered, suggestions: suggestionsFiltered };

    const limitRaw = Number.isFinite(rowLimit) ? rowLimit : 500;
    const limit = Math.max(0, Math.min(limitRaw, 50_000));
    const applyLimit = <T,>(arr: T[]) => (limit <= 0 ? arr : arr.slice(0, limit));

    const rendered = {
      changedFiltered: applyLimit(changedFiltered),
      addedFiltered: applyLimit(addedFiltered),
      removedFiltered: applyLimit(removedFiltered),
      findingsFiltered: applyLimit(findingsFiltered),
    };

    const t1 = performance.now();
    return { filteredAll, rendered, uiMs: +(t1 - t0).toFixed(1), findingCountsUI, findingCountsAll: countsAll };
  }, [compareBlank, result, q, sevHigh, sevMed, sevLow, secretsOnly, maskValues, rowLimit, sortMode]);

  const isTruncated = (shown: number, total: number) => (rowLimit <= 0 ? false : total > shown);

  const anyTruncated =
    isTruncated(rendered.changedFiltered.length, filteredAll.changedFiltered.length) ||
    isTruncated(rendered.addedFiltered.length, filteredAll.addedFiltered.length) ||
    isTruncated(rendered.removedFiltered.length, filteredAll.removedFiltered.length) ||
    isTruncated(rendered.findingsFiltered.length, filteredAll.findingsFiltered.length);

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
    if ("error" in result) return null;

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
    const l = format === "json" ? SAMPLE_LEFT_JSON : SAMPLE_LEFT_ENV;
    const r = format === "json" ? SAMPLE_RIGHT_JSON : SAMPLE_RIGHT_ENV;

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
  const compareLabel = format === "json" ? "Compare JSON" : "Compare Environments";

  const TOOL_TABS: Array<{
    id: ToolId;
    label: string;
    supported: (fmt: FormatId) => boolean;
    implemented: boolean;
  }> = [
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

  const showingText = (shown: number, total: number) => {
    if (rowLimit <= 0) return `Showing ${shown} (no limit)`;
    if (shown >= total) return `Showing ${shown}`;
    return `Showing ${shown} of ${total} (row limit ${rowLimit}, truncated)`;
  };

  const applyPresetOnlyChanged = () => {
    setShowChanged(true);
    setShowAdded(false);
    setShowRemoved(false);
    setShowFindings(false);
  };

  // IMPORTANT: make --seg a STRING so React definitely sets the custom property correctly.
  const segValue = themeMode === "system" ? "0" : themeMode === "light" ? "1" : "2";

  // -----------------------------
  // ✅ Validate (filtered) helpers
  // -----------------------------
  const validateObj: any = validateResult as any;
  const hasValidateError = !!(validateObj && typeof validateObj === "object" && "error" in validateObj && validateObj.error);

  const validateTotals = validateObj?.totals ?? { high: 0, medium: 0, low: 0 };

  const leftIssuesAll: any[] = Array.isArray(validateObj?.left?.issues) ? validateObj.left.issues : [];
  const rightIssuesAll: any[] = Array.isArray(validateObj?.right?.issues) ? validateObj.right.issues : [];

  const leftIssues = leftIssuesAll.filter((it: any) => validateSeverityEnabled(it?.severity));
  const rightIssues = rightIssuesAll.filter((it: any) => validateSeverityEnabled(it?.severity));

  // -----------------------------
  // ✅ Shared: Env editors (shown on Compare + Validate)
  // -----------------------------
  const envEditors =
    tool === "compare" || tool === "validate" ? (
      <div className="twoCol" style={{ marginTop: 14 }}>
        <div className="cd-card">
          <div className="cd-cardHeader">
            <div>
              <div className="cd-cardTitle">Environment 1</div>
              <div className="cd-cardHint">e.g., production</div>
            </div>
            <div className="cd-actions">
              <ActionButton onClick={() => pasteFromClipboard("left")} title="Paste from clipboard into Left">
                Paste
              </ActionButton>
              <ActionButton variant="primary" onClick={() => leftInputRef.current?.click()}>
                Upload
              </ActionButton>
              <ActionButton
                variant="subtle"
                onClick={() => {
                  setLeftDraft("");
                  setLeft("");
                }}
              >
                Clear
              </ActionButton>
            </div>
          </div>

          <div
            className="dropZone"
            data-active={dragOver.left ? "true" : "false"}
            onDrop={(e) => onDrop("left", e)}
            onDragOver={(e) => onDragOver("left", e)}
            onDragLeave={(e) => onDragLeave("left", e)}
            title="Drop a .env or .json file here"
          >
            <textarea
              value={leftDraft}
              onChange={(e) => setLeftDraft(e.target.value)}
              placeholder={format === "json" ? "Paste or drop JSON here…" : "Paste or drop a .env here…"}
              className="cd-textarea"
            />
            <div className="cd-tip">Tip: drag & drop a {format === "json" ? ".json" : ".env"} file here</div>
          </div>
        </div>

        <div className="cd-card">
          <div className="cd-cardHeader">
            <div>
              <div className="cd-cardTitle">Environment 2</div>
              <div className="cd-cardHint">e.g., staging</div>
            </div>
            <div className="cd-actions">
              <ActionButton onClick={() => pasteFromClipboard("right")} title="Paste from clipboard into Right">
                Paste
              </ActionButton>
              <ActionButton variant="primary" onClick={() => rightInputRef.current?.click()}>
                Upload
              </ActionButton>
              <ActionButton
                variant="subtle"
                onClick={() => {
                  setRightDraft("");
                  setRight("");
                }}
              >
                Clear
              </ActionButton>
            </div>
          </div>

          <div
            className="dropZone"
            data-active={dragOver.right ? "true" : "false"}
            onDrop={(e) => onDrop("right", e)}
            onDragOver={(e) => onDragOver("right", e)}
            onDragLeave={(e) => onDragLeave("right", e)}
            title="Drop a .env or .json file here"
          >
            <textarea
              value={rightDraft}
              onChange={(e) => setRightDraft(e.target.value)}
              placeholder={format === "json" ? "Paste or drop JSON here…" : "Paste or drop a .env here…"}
              className="cd-textarea"
            />
            <div className="cd-tip">Tip: drag & drop a {format === "json" ? ".json" : ".env"} file here</div>
          </div>
        </div>
      </div>
    ) : null;

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
              <div className="cd-subtitle">Compare .env / JSON configs in your browser — nothing is uploaded.</div>
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
          accept=".env,.txt,.json,application/json,*/*"
          style={{ display: "none" }}
          onChange={(e) => onPickFile("left", e.target.files?.[0])}
        />
        <input
          ref={rightInputRef}
          type="file"
          accept=".env,.txt,.json,application/json,*/*"
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

        {/* Tool Content */}
        {tool === "validate" ? (
          <>
            {shareMsg && (
              <div className="callout callout-info" style={{ marginTop: 12 }}>
                {shareMsg}
              </div>
            )}

            {/* ✅ Inputs now visible on Validate */}
            {envEditors}

            {pasteErr && (
              <div className="callout callout-danger" style={{ marginTop: 12 }}>
                <strong>Paste error:</strong> {pasteErr}
              </div>
            )}

            <div className="cd-card" style={{ marginTop: 14 }}>
              <div className="cd-cardTitle" style={{ fontSize: 16 }}>
                Validate ({format === "env" ? ".env" : "JSON"})
              </div>
              <div className="cd-cardHint" style={{ marginTop: 6 }}>
                Checks syntax + common deploy risks (required keys, localhost/unsafe URLs, wildcard CORS, debug flags, secret hygiene). Runs locally in a worker.
              </div>

              {!hasAnyDraft ? (
                <div className="callout callout-info" style={{ marginTop: 12 }}>
                  <strong>Paste or upload a config first.</strong> Validate runs on your current editor drafts (you don’t need to run Compare).
                </div>
              ) : !validateHasRun ? (
                <div className="callout callout-info" style={{ marginTop: 12 }}>
                  <strong>Not validated yet.</strong> Click <strong>Run Validate</strong> below (or enable Live validation).
                </div>
              ) : validateIsStale ? (
                <div className="callout callout-info" style={{ marginTop: 12 }}>
                  <strong>Edited since last validation.</strong> Click <strong>Run Validate</strong> to refresh results.
                </div>
              ) : null}

              {hasValidateError ? (
                <div className="callout callout-danger" style={{ marginTop: 10 }}>
                  <strong>Error:</strong> {String((validateObj as any).error)}
                </div>
              ) : null}

              <div className="controlRow" style={{ marginTop: 12, alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <ActionButton
                  variant="primary"
                  onClick={runValidate}
                  disabled={!hasAnyDraft as any}
                  title={!hasAnyDraft ? "Paste/upload at least one config draft first" : "Run validation now"}
                >
                  {validateStatus === "Idle" ? "Run Validate" : "Validating…"}
                </ActionButton>

                <Toggle label="Live validation" checked={validateLive} onChange={setValidateLive} />

                <span style={{ width: 10 }} />

                <span className="pill" title="Validation status">
                  {validateStatus !== "Idle"
                    ? "Validating…"
                    : validateHasRun
                    ? `Validated${validateMs != null ? ` in ${validateMs}ms` : ""}`
                    : "Not validated"}
                </span>

                {validateHasRun && lastValidatedAt != null ? (
                  <span className="pill" title="Last validated time">
                    Last validated {timeAgo(Date.now() - lastValidatedAt)}
                  </span>
                ) : null}

                {/* ✅ Clickable severity filters */}
                <SevChip sev="high" count={validateTotals.high ?? 0} checked={vSevHigh} onChange={setVSevHigh} />
                <SevChip sev="medium" count={validateTotals.medium ?? 0} checked={vSevMed} onChange={setVSevMed} />
                <SevChip sev="low" count={validateTotals.low ?? 0} checked={vSevLow} onChange={setVSevLow} />
              </div>
            </div>

            <div className="twoCol" style={{ marginTop: 14 }}>
              <div className="cd-card">
                <div className="cd-cardHeader">
                  <div>
                    <div className="cd-cardTitle">Environment 1</div>
                    <div className="cd-cardHint">
                      Issues found: {leftIssues.length}
                      {leftIssues.length !== leftIssuesAll.length ? ` (filtered from ${leftIssuesAll.length})` : ""}
                    </div>
                  </div>
                </div>

                <div style={{ padding: 12 }}>
                  {!hasAnyDraft ? (
                    <div className="mutedSm">Paste/upload a config to validate.</div>
                  ) : leftIssuesAll.length === 0 ? (
                    <div className="mutedSm">No issues detected.</div>
                  ) : leftIssues.length === 0 ? (
                    <div className="mutedSm">No issues at the selected severities.</div>
                  ) : (
                    <div className="findingList">
                      {leftIssues.map((it: any, idx: number) => {
                        const sev = normSeverity(it?.severity);
                        return (
                          <div key={`l-${idx}`} className="finding" data-sev={sev}>
                            <div className="findingTop">
                              <div className="mono findingKey">{it?.key ? String(it.key) : "Syntax"}</div>
                              <span className={`sev sev-${sev}`}>{sev}</span>
                            </div>
                            <div className="findingMsg">{String(it?.message ?? "")}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="cd-card">
                <div className="cd-cardHeader">
                  <div>
                    <div className="cd-cardTitle">Environment 2</div>
                    <div className="cd-cardHint">
                      Issues found: {rightIssues.length}
                      {rightIssues.length !== rightIssuesAll.length ? ` (filtered from ${rightIssuesAll.length})` : ""}
                    </div>
                  </div>
                </div>

                <div style={{ padding: 12 }}>
                  {!hasAnyDraft ? (
                    <div className="mutedSm">Paste/upload a config to validate.</div>
                  ) : rightIssuesAll.length === 0 ? (
                    <div className="mutedSm">No issues detected.</div>
                  ) : rightIssues.length === 0 ? (
                    <div className="mutedSm">No issues at the selected severities.</div>
                  ) : (
                    <div className="findingList">
                      {rightIssues.map((it: any, idx: number) => {
                        const sev = normSeverity(it?.severity);
                        return (
                          <div key={`r-${idx}`} className="finding" data-sev={sev}>
                            <div className="findingTop">
                              <div className="mono findingKey">{it?.key ? String(it.key) : "Syntax"}</div>
                              <span className={`sev sev-${sev}`}>{sev}</span>
                            </div>
                            <div className="findingMsg">{String(it?.message ?? "")}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ padding: "18px 4px 30px", color: THEME.muted, fontSize: 12, textAlign: "center" }}>
              © {new Date().getFullYear()} ConfigSift • All processing in your browser — nothing uploaded.
            </div>
          </>
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
          <>
            {shareMsg && (
              <div className="callout callout-info" style={{ marginTop: 12 }}>
                {shareMsg}
              </div>
            )}

            {/* ✅ Inputs (Compare) */}
            {envEditors}

            {pasteErr && (
              <div className="callout callout-danger" style={{ marginTop: 12 }}>
                <strong>Paste error:</strong> {pasteErr}
              </div>
            )}

            <section style={{ marginTop: 18 }}>
              <div className="sectionTitleRow">
                <h2 className="sectionTitle">Summary</h2>
                <div className="sectionTitleRight">
                  <span className="pill" title="Everything runs locally">
                    Browser-only · No uploads
                  </span>
                </div>
              </div>

              <div className="cd-card" style={{ marginTop: 10 }}>
                <div className="cd-controls">
                  {!draftReady ? (
                    <div className="callout callout-info" style={{ marginBottom: 10 }}>
                      <strong>Next step:</strong> Paste/upload both configs, then click <strong>{compareLabel}</strong>.
                    </div>
                  ) : !hasCompared ? (
                    <div className="callout callout-info" style={{ marginBottom: 10 }}>
                      <strong>Ready:</strong> Click <strong>{compareLabel}</strong> to generate diffs and findings.
                    </div>
                  ) : null}

                  {"error" in (result as any) ? (
                    <div className="callout callout-danger" style={{ marginBottom: 10 }}>
                      <strong>Error:</strong> {(result as any).error}
                    </div>
                  ) : null}

                  <div className="controlRow">
                    <div className="controlLabel">Search</div>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter keys/values (e.g., S3, JWT, DATABASE, DEBUG)…"
                      className="cd-input"
                    />
                    <ActionButton variant="subtle" onClick={() => setQuery("")}>
                      Clear
                    </ActionButton>
                  </div>

                  <div className="controlRow" style={{ alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                    <div className="controlLabel">Show</div>
                    <Toggle label="Changed" checked={showChanged} onChange={setShowChanged} />
                    <Toggle label="Added" checked={showAdded} onChange={setShowAdded} />
                    <Toggle label="Removed" checked={showRemoved} onChange={setShowRemoved} />
                    <Toggle label="Findings" checked={showFindings} onChange={setShowFindings} />
                    <ActionButton variant="subtle" onClick={applyPresetOnlyChanged} title="Quick preset: show only Changed">
                      Only Changed
                    </ActionButton>

                    <span style={{ width: 10 }} />

                    <div className="controlLabel">Privacy</div>
                    <Toggle label="Mask values" checked={maskValues} onChange={setMaskValues} />
                    <Toggle label="Secrets only" checked={secretsOnly} onChange={setSecretsOnly} />

                    <ActionButton
                      variant={showMore ? "primary" : "subtle"}
                      onClick={() => setShowMore((v) => !v)}
                      title="Advanced controls"
                    >
                      {showMore ? "More ▴" : "More ▾"}
                    </ActionButton>
                  </div>

                  {showMore && (
                    <div className="cd-card" style={{ marginTop: 10, padding: 12, background: THEME.card2 }}>
                      {format === "env" ? (
                        <div className="controlRow">
                          <div className="controlLabel">Parsing</div>
                          <div className="controlHelp">Mode</div>
                          <select
                            value={envProfile}
                            onChange={(e) => setEnvProfile(e.target.value as EnvProfileId)}
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
                          <span className="mutedSm">JSON is flattened into dot-path keys (e.g., db.host).</span>
                          <span className="mutedSm" style={{ opacity: 0.7 }}>
                            (Array mode options coming soon)
                          </span>
                        </div>
                      )}

                      <div className="controlRow">
                        <div className="controlLabel">Severity</div>
                        <Toggle label="High" checked={sevHigh} onChange={setSevHigh} />
                        <Toggle label="Medium" checked={sevMed} onChange={setSevMed} />
                        <Toggle label="Low" checked={sevLow} onChange={setSevLow} />
                        <span className="mutedSm">(applies to Risk Findings)</span>
                      </div>

                      <div className="controlRow">
                        <div className="controlLabel">Sort</div>
                        <div className="controlHelp">Mode</div>
                        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="cd-select">
                          <option value="none">None (input order)</option>
                          <option value="key_asc">Key A → Z</option>
                          <option value="key_desc">Key Z → A</option>
                          <option value="severity_desc" disabled={!showFindings}>
                            Severity (Findings only)
                          </option>
                        </select>
                      </div>

                      <div className="controlRow">
                        <div className="controlLabel">Render</div>
                        <div className="controlHelp">Row limit</div>
                        <input
                          type="number"
                          value={rowLimit}
                          min={0}
                          step={50}
                          onChange={(e) => setRowLimit(parseInt(e.target.value || "0", 10))}
                          className="cd-number"
                        />
                        <span className="mutedSm">(applies after filters; prevents UI freezes on huge diffs)</span>

                        {anyTruncated && (
                          <span className="inlineCluster">
                            <span className="pill" title="Some sections are truncated by the row limit.">
                              Truncated
                            </span>
                            <ActionButton variant="subtle" onClick={() => setRowLimit(0)} title="Show all rows (may slow UI on huge diffs)">
                              Show all (may slow)
                            </ActionButton>
                            <ActionButton variant="subtle" onClick={() => setRowLimit(500)} title="Reset row limit to 500">
                              Reset
                            </ActionButton>
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {(secretsOnly || q || rowLimit > 0 || (!sevHigh || !sevMed || !sevLow) || !hasCompared) && (
                    <div className="callout callout-info">
                      <strong>Note:</strong> {filtersHint}
                    </div>
                  )}

                  <div className="exportRow">
                    <ActionButton
                      onClick={() => {
                        const report = buildReport();
                        if (!report) return;
                        downloadText(`configsift-report-${Date.now()}.json`, JSON.stringify(report, null, 2), "application/json");
                      }}
                      disabled={!hasCompared || "error" in (result as any)}
                      title={!hasCompared ? "Run Compare first" : undefined}
                    >
                      Download JSON
                    </ActionButton>

                    <ActionButton
                      onClick={() => {
                        const report = buildReport();
                        if (!report) return;
                        downloadText(`configsift-report-${Date.now()}.md`, reportToMarkdown(report), "text/markdown");
                      }}
                      disabled={!hasCompared || "error" in (result as any)}
                      title={!hasCompared ? "Run Compare first" : undefined}
                    >
                      Download Markdown
                    </ActionButton>

                    <ActionButton variant="subtle" onClick={downloadShareJSON} title="Export inputs + UI settings (for sharing large configs)">
                      Share JSON
                    </ActionButton>
                    <ActionButton variant="subtle" onClick={() => shareImportRef.current?.click()} title="Import inputs + UI settings from Share JSON">
                      Import Share JSON
                    </ActionButton>

                    <ActionButton variant="subtle" onClick={clearSavedDraft} title="Clear saved draft from this browser">
                      Clear saved
                    </ActionButton>
                  </div>
                </div>
              </div>

              <div className="badgeRow">
                <Badge label={`Changed: ${filteredAll.changedFiltered.length}`} variant="changed" />
                <Badge label={`Added: ${filteredAll.addedFiltered.length}`} variant="added" />
                <Badge label={`Removed: ${filteredAll.removedFiltered.length}`} variant="removed" />
                <Badge label={`Critical: ${findingCountsUI.critical} / ${findingCountsAll.critical}`} variant="critical" />
                <Badge label={`Suggestions: ${findingCountsUI.suggestions} / ${findingCountsAll.suggestions}`} variant="suggestions" />
                <Badge label={`Findings: ${filteredAll.findingsFiltered.length} / ${findingCountsAll.total}`} variant="findings" />
              </div>
            </section>

            {hasCompared && !("error" in (result as any)) ? (
              <>
                {showChanged && (
                  <Section
                    title={`Changed — ${showingText(rendered.changedFiltered.length, filteredAll.changedFiltered.length)}`}
                    rightSlot={<ActionButton onClick={() => copyKeys(filteredAll.changedFiltered.map((x: any) => x.key))}>Copy keys</ActionButton>}
                  >
                    <div className="rows">
                      {rendered.changedFiltered.map((c: any) => (
                        <RowNode key={c.key} k={c.key} vNode={renderChangedValue(c)} />
                      ))}
                    </div>
                  </Section>
                )}

                {showAdded && (
                  <Section
                    title={`Added — ${showingText(rendered.addedFiltered.length, filteredAll.addedFiltered.length)}`}
                    rightSlot={<ActionButton onClick={() => copyKeys(filteredAll.addedFiltered.map((x: any) => x.key))}>Copy keys</ActionButton>}
                  >
                    <div className="rows">
                      {rendered.addedFiltered.map((a: any) => (
                        <Row key={a.key} k={a.key} v={displaySingle(a.key, a.value)} />
                      ))}
                    </div>
                  </Section>
                )}

                {showRemoved && (
                  <Section
                    title={`Removed — ${showingText(rendered.removedFiltered.length, filteredAll.removedFiltered.length)}`}
                    rightSlot={<ActionButton onClick={() => copyKeys(filteredAll.removedFiltered.map((x: any) => x.key))}>Copy keys</ActionButton>}
                  >
                    <div className="rows">
                      {rendered.removedFiltered.map((r: any) => (
                        <Row key={r.key} k={r.key} v={displaySingle(r.key, r.value)} />
                      ))}
                    </div>
                  </Section>
                )}

                {showFindings && (
                  <Section
                    title={`Risk Findings — ${showingText(rendered.findingsFiltered.length, filteredAll.findingsFiltered.length)}`}
                    rightSlot={<ActionButton onClick={() => copyKeys(filteredAll.findingsFiltered.map((x: any) => x.key))}>Copy keys</ActionButton>}
                  >
                    {rendered.findingsFiltered.length === 0 ? (
                      <div className="mutedSm" style={{ padding: "6px 2px" }}>
                        No findings.
                      </div>
                    ) : (
                      <div className="findingList">
                        {rendered.findingsFiltered.map((f: any, idx: number) => {
                          const sev = normSeverity(f.severity);
                          return (
                            <div key={`${f.key}-${idx}`} className="finding" data-sev={sev}>
                              <div className="findingTop">
                                <div className="mono findingKey">{f.key}</div>
                                <span className={`sev sev-${sev}`}>{sev}</span>
                              </div>
                              <div className="findingMsg">{f.message}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Section>
                )}

                <div style={{ padding: "18px 4px 30px", color: THEME.muted, fontSize: 12, textAlign: "center" }}>
                  © {new Date().getFullYear()} ConfigSift • All processing in your browser — nothing uploaded.
                </div>
              </>
            ) : (
              <div style={{ padding: "18px 4px 30px", color: THEME.muted, fontSize: 12, textAlign: "center" }}>
                © {new Date().getFullYear()} ConfigSift • All processing in your browser — nothing uploaded.
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
