"use client";

import React, { useMemo } from "react";
import { computeDiffParts, isSensitiveKey, normSeverity, sevRank } from "./configdiff";
import type { EnvProfileId, FormatId } from "./shareState";

type SortMode = "key_asc" | "key_desc" | "severity_desc" | "none";
type Finding = { key: string; severity?: string; message: string };
type FindingCountsUI = { critical: number; suggestions: number };
type FindingCountsAll = { critical: number; suggestions: number; total: number };

export function useCompareDerived(args: {
  result: any;
  compareBlank: boolean;
  hasCompared: boolean;

  format: FormatId;
  envProfile: EnvProfileId;

  THEME: any;

  query: string;

  sevHigh: boolean;
  sevMed: boolean;
  sevLow: boolean;

  secretsOnly: boolean;
  maskValues: boolean;

  rowLimit: number;
  sortMode: SortMode;
}) {
  const {
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
  } = args;

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

  const filtersHint = useMemo(() => {
    const bits: string[] = [];
    bits.push(`Format: ${format}`);
    if (format === "env") bits.push(`Parsing: ${envProfile}`);
    if (format === "json") bits.push(`Parsing: flattened dot-path keys`);
    if (format === "yaml") bits.push(`Parsing: flattened dot-path keys`);
    if (secretsOnly) bits.push("Secrets-only is ON (only sensitive keys are shown).");
    if (q) bits.push(`Search is active (“${query.trim()}”).`);
    if (!sevHigh || !sevMed || !sevLow) bits.push("Severity filter is restricting Findings.");
    if (rowLimit > 0) bits.push(`Row limit is ${rowLimit} (after filters).`);
    if (rowLimit <= 0) bits.push("Row limit is unlimited (may freeze on huge diffs).");
    if (!hasCompared) bits.push("Run Compare to see results.");
    return bits.join(" ");
  }, [format, envProfile, secretsOnly, q, query, sevHigh, sevMed, sevLow, rowLimit, hasCompared]);

  const isTruncated = (shown: number, total: number) => (rowLimit <= 0 ? false : total > shown);

  const anyTruncated =
    isTruncated(rendered.changedFiltered.length, filteredAll.changedFiltered.length) ||
    isTruncated(rendered.addedFiltered.length, filteredAll.addedFiltered.length) ||
    isTruncated(rendered.removedFiltered.length, filteredAll.removedFiltered.length) ||
    isTruncated(rendered.findingsFiltered.length, filteredAll.findingsFiltered.length);

  const showingText = (shown: number, total: number) => {
    if (rowLimit <= 0) return `Showing ${shown} (no limit)`;
    if (shown >= total) return `Showing ${shown}`;
    return `Showing ${shown} of ${total} (row limit ${rowLimit}, truncated)`;
  };

  return {
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
  };
}
