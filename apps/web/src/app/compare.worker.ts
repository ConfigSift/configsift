// apps/web/src/app/compare.worker.ts

import { isSensitiveKey, normSeverity } from "./lib/configdiff";

type EnvProfileId = "dotenv" | "compose";
type FormatId = "env" | "json";

type Req = {
  requestId: number;
  left: string;
  right: string;
  format: FormatId;
  profile?: EnvProfileId; // env only
};

type Res =
  | { requestId: number; ok: true; result: any; ms: number }
  | { requestId: number; ok: false; error: string; ms: number };

// ---------------------------
// Shared helpers (worker)
// ---------------------------
function lc(v: any) {
  return String(v ?? "").toLowerCase();
}

function isTruthy(v: string) {
  const x = lc(v).trim();
  return x === "1" || x === "true" || x === "yes" || x === "on";
}

function splitAllowlist(value: string) {
  return String(value ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function leafKey(path: string): string {
  const s = String(path ?? "");
  const noIndexes = s.replace(/\[\d+\]/g, "");
  const parts = noIndexes.split(".");
  return parts[parts.length - 1] ?? noIndexes;
}

function addFinding(
  out: any[],
  key: string,
  severity: "high" | "medium" | "low",
  title: string,
  recommendation: string
) {
  out.push({
    key,
    severity: normSeverity(severity),
    message: `${title}. Recommendation: ${recommendation}`,
  });
}

// ---------------------------
// ENV parsing (robust, old-behavior compatible)
// - last key wins
// - supports `export KEY=...` in dotenv mode
// - supports inline comments safely (doesn't break quoted values)
// - tracks duplicates
// ---------------------------
type EnvParseMeta = {
  duplicates: Record<string, number>; // key -> occurrences
  issues: Array<{ kind: "warn" | "error"; message: string; line: number }>;
};

function stripInlineCommentPreserveQuotes(rawValue: string) {
  // remove inline #... only when # is not inside quotes
  // examples:
  //   a=b # c      -> "b"
  //   a="b # c"    -> "b # c"
  const s = String(rawValue ?? "");
  let out = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;

    if (!inSingle && !inDouble && ch === "#") break;
    out += ch;
  }
  return out.trim();
}

function unquoteIfWrapped(v: string) {
  const s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseEnv(text: string, profile: EnvProfileId) {
  const allowExportPrefix = profile === "dotenv";

  const values: Record<string, string> = {};
  const meta: EnvParseMeta = { duplicates: {}, issues: [] };

  const lines = String(text ?? "").split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] ?? "";
    const lineNo = idx + 1;

    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;

    const noExport =
      allowExportPrefix && trimmed.startsWith("export ")
        ? trimmed.slice(7).trim()
        : trimmed;

    const eq = noExport.indexOf("=");
    if (eq <= 0) {
      // ignore junk lines, but surface a mild warning (helps users)
      meta.issues.push({
        kind: "warn",
        message: `Skipped non KEY=VALUE line`,
        line: lineNo,
      });
      continue;
    }

    const key = noExport.slice(0, eq).trim();
    let value = noExport.slice(eq + 1);

    if (!key) {
      meta.issues.push({
        kind: "warn",
        message: `Skipped empty key`,
        line: lineNo,
      });
      continue;
    }

    // Inline comment stripping (safe)
    value = stripInlineCommentPreserveQuotes(value);

    // Remove wrapping quotes
    value = unquoteIfWrapped(value);

    if (Object.prototype.hasOwnProperty.call(values, key)) {
      meta.duplicates[key] = (meta.duplicates[key] ?? 1) + 1;
    } else {
      meta.duplicates[key] = 1;
    }

    values[key] = value;
  }

  return { values, meta };
}

function duplicatesToFindings(meta: EnvParseMeta, sideLabel: string) {
  const findings: any[] = [];
  for (const [k, count] of Object.entries(meta.duplicates)) {
    if (count > 1) {
      addFinding(
        findings,
        k,
        "medium",
        `Duplicate key in ${sideLabel} (${count} occurrences)`,
        "Remove duplicates to avoid surprises (last value wins)"
      );
    }
  }
  return findings;
}

function issuesToFindings(meta: EnvParseMeta, sideLabel: string) {
  const findings: any[] = [];
  for (const i of meta.issues) {
    addFinding(
      findings,
      `${sideLabel}:line:${i.line}`,
      i.kind === "error" ? "high" : "low",
      `${sideLabel} parse ${i.kind} on line ${i.line}`,
      i.message
    );
  }
  return findings;
}

// ---------------------------
// JSON parsing + flattening (same as your original worker)
// ---------------------------
function parseJson(text: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(String(text ?? "")) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Invalid JSON" };
  }
}

function flattenJson(
  value: any,
  opts?: { arrayMode?: "ordered" | "set_scalars" }
): Map<string, string> {
  const out = new Map<string, string>();
  const arrayMode = opts?.arrayMode ?? "ordered";

  const isScalar = (x: any) => x === null || ["string", "number", "boolean"].includes(typeof x);

  const visit = (node: any, path: string) => {
    if (isScalar(node)) {
      out.set(
        path || "$",
        node === null ? "null" : typeof node === "string" ? node : JSON.stringify(node)
      );
      return;
    }

    if (Array.isArray(node)) {
      if (arrayMode === "set_scalars" && node.every(isScalar)) {
        const normalized = node
          .map((x) => (x === null ? "null" : typeof x === "string" ? x : JSON.stringify(x)))
          .sort()
          .join(",");
        out.set(path || "$", normalized);
        return;
      }
      node.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }

    if (node && typeof node === "object") {
      const keys = Object.keys(node).sort();
      for (const k of keys) {
        const next = path ? `${path}.${k}` : k;
        visit(node[k], next);
      }
      return;
    }

    out.set(path || "$", String(node));
  };

  visit(value, "");
  return out;
}

// ---------------------------
// Core compare
// ---------------------------
function compareFlatMaps(leftMap: Map<string, string>, rightMap: Map<string, string>) {
  const keys = new Set<string>([...leftMap.keys(), ...rightMap.keys()]);
  const allKeys = [...keys].sort();

  const changed: any[] = [];
  const added: any[] = [];
  const removed: any[] = [];
  const findings: any[] = [];

  for (const key of allKeys) {
    const lHas = leftMap.has(key);
    const rHas = rightMap.has(key);
    const lVal = leftMap.get(key);
    const rVal = rightMap.get(key);

    if (lHas && rHas) {
      if (String(lVal ?? "") !== String(rVal ?? "")) {
        changed.push({ key, from: lVal ?? "", to: rVal ?? "" });
        if (isSensitiveKey(key)) {
          addFinding(findings, key, "high", "Sensitive value changed", "Rotate secrets and verify the new value is correct");
        }
      }
    } else if (!lHas && rHas) {
      added.push({ key, value: rVal ?? "" });
      if (isSensitiveKey(key)) {
        addFinding(findings, key, "high", "Sensitive value added", "Ensure this secret is intended and stored safely (rotate if exposed)");
      }
    } else if (lHas && !rHas) {
      removed.push({ key, value: lVal ?? "" });
      if (isSensitiveKey(key)) {
        addFinding(findings, key, "medium", "Sensitive value removed", "Confirm removal is intended and won't break authentication/integrations");
      }
    }
  }

  return { changed, added, removed, findings };
}

// ---------------------------
// Smart findings (ENV)
// ---------------------------
function looksLikeProdEnv(envMap: Map<string, string>) {
  const hints = [
    envMap.get("APP_ENV"),
    envMap.get("NODE_ENV"),
    envMap.get("ENV"),
    envMap.get("STAGE"),
    envMap.get("ENVIRONMENT"),
  ]
    .filter(Boolean)
    .map((x) => lc(x));

  return hints.some((h) => h.includes("prod") || h.includes("production"));
}

function buildSmartFindingsEnv(leftMap: Map<string, string>, rightMap: Map<string, string>) {
  const leftIsProd = looksLikeProdEnv(leftMap);
  const rightIsProd = looksLikeProdEnv(rightMap);

  // If ambiguous, default to left as "prod-ish" because UI labels it Environment 1
  const prodMap =
    leftIsProd && !rightIsProd ? leftMap :
    rightIsProd && !leftIsProd ? rightMap :
    leftMap;

  const otherMap = prodMap === leftMap ? rightMap : leftMap;

  const findings: any[] = [];

  // Same secret used in both envs (HIGH)
  for (const [key, prodVal] of prodMap.entries()) {
    if (!isSensitiveKey(key)) continue;
    if (!otherMap.has(key)) continue;

    const otherVal = otherMap.get(key) ?? "";
    const a = String(prodVal ?? "");
    const b = String(otherVal ?? "");

    if (!a || !b) continue;
    if (a === b) {
      addFinding(findings, key, "high", "Same secret used in both environments", "Use different secrets for each environment");
    }
  }

  // Localhost in URL-ish fields (HIGH)
  const localhostNeedles = ["localhost", "127.0.0.1", "0.0.0.0"];
  for (const [key, val] of prodMap.entries()) {
    const v = String(val ?? "");
    if (!v) continue;

    const keyL = key.toLowerCase();
    const isUrlLike =
      keyL.includes("url") ||
      keyL.includes("uri") ||
      keyL.includes("origin") ||
      keyL.includes("host") ||
      keyL.includes("endpoint") ||
      keyL.includes("cors");

    if (!isUrlLike) continue;

    const hay = v.toLowerCase();
    if (localhostNeedles.some((n) => hay.includes(n))) {
      addFinding(findings, key, "high", "Localhost URL in Environment 1 (prod-ish)", "Use production URLs/hostnames (remove localhost/127.0.0.1)");
    }
  }

  // Wildcard CORS (HIGH)
  for (const corsKey of ["CORS_ALLOW_ORIGINS", "CORS_ORIGINS", "ALLOWED_ORIGINS"]) {
    const v = prodMap.get(corsKey);
    if (!v) continue;
    const items = splitAllowlist(v);
    if (items.includes("*")) {
      addFinding(findings, corsKey, "high", "Wildcard CORS origins in Environment 1 (prod-ish)", "Restrict CORS origins to specific trusted domains");
    }
  }

  // Debug enabled (MEDIUM)
  for (const debugKey of ["DEBUG", "APP_DEBUG"]) {
    const v = prodMap.get(debugKey);
    if (v && isTruthy(v)) {
      addFinding(findings, debugKey, "medium", "Debug mode enabled in Environment 1 (prod-ish)", "Disable debug/logging flags in production");
    }
  }

  // Required keys missing (HIGH)
  const requiredInProd = ["DATABASE_URL", "JWT_SECRET", "CSRF_SECRET", "SECRET_KEY", "API_TOKEN"];
  for (const reqKey of requiredInProd) {
    const v = prodMap.get(reqKey);
    if (!v) {
      addFinding(findings, reqKey, "high", "Missing required configuration in Environment 1 (prod-ish)", `Set ${reqKey} in production environment`);
    }
  }

  return findings;
}

// ---------------------------
// Smart findings (JSON)
// ---------------------------
function looksLikeProdFlat(map: Map<string, string>) {
  const needles = ["APP_ENV", "NODE_ENV", "ENV", "STAGE", "ENVIRONMENT"];
  for (const [k, v] of map.entries()) {
    const leaf = leafKey(k).toUpperCase();
    if (!needles.includes(leaf)) continue;
    const h = lc(v);
    if (h.includes("prod") || h.includes("production")) return true;
  }
  return false;
}

function buildSmartFindingsJson(leftMap: Map<string, string>, rightMap: Map<string, string>) {
  const leftIsProd = looksLikeProdFlat(leftMap);
  const rightIsProd = looksLikeProdFlat(rightMap);

  const prodMap =
    leftIsProd && !rightIsProd ? leftMap :
    rightIsProd && !leftIsProd ? rightMap :
    leftMap;

  const otherMap = prodMap === leftMap ? rightMap : leftMap;

  const findings: any[] = [];

  // Same secret on both sides (HIGH)
  for (const [key, prodVal] of prodMap.entries()) {
    if (!isSensitiveKey(key)) continue;
    if (!otherMap.has(key)) continue;
    const otherVal = otherMap.get(key) ?? "";
    if (prodVal && otherVal && prodVal === otherVal) {
      addFinding(findings, key, "high", "Same secret used in both configs", "Use different secrets per environment");
    }
  }

  // Localhost in URL-ish fields (HIGH)
  const localhostNeedles = ["localhost", "127.0.0.1", "0.0.0.0"];
  for (const [key, val] of prodMap.entries()) {
    const keyL = lc(key);
    const isUrlLike =
      keyL.includes("url") ||
      keyL.includes("uri") ||
      keyL.includes("origin") ||
      keyL.includes("host") ||
      keyL.includes("endpoint") ||
      keyL.includes("cors");

    if (!isUrlLike) continue;

    const hay = lc(val);
    if (localhostNeedles.some((n) => hay.includes(n))) {
      addFinding(findings, key, "high", "Localhost URL in prod-ish config", "Use real hostnames/URLs (remove localhost/127.0.0.1)");
    }
  }

  // Wildcard CORS (HIGH) – match leaf key
  for (const corsKey of ["CORS_ALLOW_ORIGINS", "CORS_ORIGINS", "ALLOWED_ORIGINS"]) {
    for (const [k, v] of prodMap.entries()) {
      const leaf = leafKey(k).toUpperCase();
      if (leaf !== corsKey) continue;
      const items = splitAllowlist(v);
      if (items.includes("*")) {
        addFinding(findings, k, "high", "Wildcard CORS origins in prod-ish config", "Restrict CORS origins to trusted domains");
      }
    }
  }

  // Debug enabled (MEDIUM)
  for (const debugKey of ["DEBUG", "APP_DEBUG"]) {
    for (const [k, v] of prodMap.entries()) {
      const leaf = leafKey(k).toUpperCase();
      if (leaf !== debugKey) continue;
      if (v && isTruthy(v)) {
        addFinding(findings, k, "medium", "Debug mode enabled", "Disable debug flags in production");
      }
    }
  }

  return findings;
}

// ---------------------------
// Worker entry
// ---------------------------
self.onmessage = (e: MessageEvent<Req>) => {
  const { requestId, left, right, format } = e.data;
  const profile: EnvProfileId = e.data.profile ?? "dotenv";
  const t0 = performance.now();

  try {
    let base: { changed: any[]; added: any[]; removed: any[]; findings: any[] };
    let extraFindings: any[] = [];
    let parseFindings: any[] = [];

    if (format === "env") {
      const lp = parseEnv(left, profile);
      const rp = parseEnv(right, profile);

      const leftMap = new Map<string, string>(Object.entries(lp.values));
      const rightMap = new Map<string, string>(Object.entries(rp.values));

      base = compareFlatMaps(leftMap, rightMap);
      extraFindings = buildSmartFindingsEnv(leftMap, rightMap);

      parseFindings = [
        ...duplicatesToFindings(lp.meta, "Left .env"),
        ...duplicatesToFindings(rp.meta, "Right .env"),
        ...issuesToFindings(lp.meta, "Left .env"),
        ...issuesToFindings(rp.meta, "Right .env"),
      ];
    } else if (format === "json") {
      const l = parseJson(left);
      if (!l.ok) throw new Error(l.error);
      const r = parseJson(right);
      if (!r.ok) throw new Error(r.error);

      const leftMap = flattenJson(l.value, { arrayMode: "ordered" });
      const rightMap = flattenJson(r.value, { arrayMode: "ordered" });

      base = compareFlatMaps(leftMap, rightMap);
      extraFindings = buildSmartFindingsJson(leftMap, rightMap);
    } else {
      throw new Error(`Unsupported format: ${String(format)}`);
    }

    // Merge findings with dedupe
    const merged: any[] = [];
    const seen = new Set<string>();

    const push = (f: any) => {
      const sig = `${String(f?.key ?? "")}::${String(f?.message ?? "")}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      merged.push({ ...f, severity: normSeverity(f?.severity) });
    };

    for (const f of base.findings ?? []) push(f);
    for (const f of parseFindings ?? []) push(f);
    for (const f of extraFindings ?? []) push(f);

    const critical = merged.filter((f) => normSeverity(f?.severity) === "high").length;
    const total = merged.length;
    const suggestions = total - critical;

    const out = {
      changed: base.changed,
      added: base.added,
      removed: base.removed,
      findings: merged,
      findingCounts: { critical, suggestions, total },
      profile,
      format,
    };

    const ms = Math.round(performance.now() - t0);
    (self as any).postMessage({ requestId, ok: true, result: out, ms } satisfies Res);
  } catch (err: any) {
    const ms = Math.round(performance.now() - t0);
    (self as any).postMessage(
      {
        requestId,
        ok: false,
        error: err?.message ?? "Unknown error",
        ms,
      } satisfies Res
    );
  }
};
