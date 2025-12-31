// apps/web/src/app/validate.worker.ts
import { parseYamlToFlatMap } from "./lib/parseYaml";

type EnvProfileId = "dotenv" | "compose";
type FormatId = "env" | "json" | "yaml";

type Severity = "high" | "medium" | "low";

type Issue = {
  side: "left" | "right";
  severity: Severity;
  key?: string;
  message: string;
};

type SideResult = {
  ok: boolean;
  issues: Issue[];
  meta: {
    format: FormatId;
    profile?: EnvProfileId;
    parsedKeys?: number;
  };
  error?: string;
};

type Req = {
  requestId: number;
  left: string;
  right: string;
  format: FormatId;
  profile?: EnvProfileId; // env only
  yamlStrict?: boolean; // yaml only
};

type Res =
  | {
      requestId: number;
      ok: true;
      result: { left: SideResult; right: SideResult; totals: { high: number; medium: number; low: number } };
      ms: number;
    }
  | { requestId: number; ok: false; error: string; ms: number };

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

function normSeverity(sev: any): Severity {
  const s = String(sev ?? "").trim().toLowerCase();
  if (s === "high" || s === "critical" || s === "crit") return "high";
  if (s === "medium" || s === "med" || s === "warn" || s === "warning") return "medium";
  if (s === "low" || s === "info" || s === "informational") return "low";
  return "low";
}

function leafKey(path: string): string {
  const s = String(path ?? "");
  const noIndexes = s.replace(/\[\d+\]/g, "");
  const parts = noIndexes.split(".");
  return parts[parts.length - 1] ?? noIndexes;
}

function isSensitiveKey(key: string): boolean {
  const k = String(key ?? "").toLowerCase();
  const leaf = leafKey(k).toLowerCase();
  const hay = `${k} ${leaf}`;

  if (
    hay.includes("secret") ||
    hay.includes("token") ||
    hay.includes("password") ||
    hay.includes("passwd") ||
    hay.includes("pwd") ||
    hay.includes("jwt") ||
    hay.includes("private") ||
    hay.includes("privatekey") ||
    hay.includes("private_key") ||
    hay.includes("client_secret") ||
    hay.includes("refresh_token") ||
    hay.includes("smtp_pass") ||
    hay.includes("api_key") ||
    hay.includes("x_api_key") ||
    hay.includes("apikey") ||
    hay.includes("access_key") ||
    hay.includes("accesskey") ||
    hay.includes("authorization") ||
    hay.includes("bearer") ||
    hay.includes("session") ||
    hay.includes("cookie") ||
    hay.includes("signature") ||
    hay.includes("sig") ||
    hay.includes("hmac") ||
    hay.includes("cert") ||
    hay.includes("certificate") ||
    hay.includes("dsn")
  ) {
    return true;
  }

  return (
    /(^|_)key($|_)/.test(hay) ||
    hay.endsWith("_key") ||
    hay.endsWith("_key_id") ||
    hay.endsWith("_access_key") ||
    hay.endsWith("_access_key_id")
  );
}

function pushIssue(out: Issue[], side: "left" | "right", severity: Severity, message: string, key?: string) {
  out.push({ side, severity: normSeverity(severity), message, key });
}

// ---------------------------
// ENV parsing (detailed)
// ---------------------------
function parseEnvDetailed(text: string, opts?: { allowExportPrefix?: boolean }) {
  const allowExportPrefix = opts?.allowExportPrefix ?? true;

  const map = new Map<string, string>();
  const lines = String(text ?? "").split(/\r?\n/);

  const duplicates: string[] = [];
  const invalidLines: Array<{ lineNo: number; raw: string; reason: string }> = [];

  const seen = new Set<string>();

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx] ?? "";
    const lineNo = idx + 1;

    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;

    const noExport = allowExportPrefix && trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;

    const eq = noExport.indexOf("=");
    if (eq <= 0) {
      invalidLines.push({ lineNo, raw, reason: "Missing '=' or key" });
      continue;
    }

    const key = noExport.slice(0, eq).trim();
    let value = noExport.slice(eq + 1);

    if (!key) {
      invalidLines.push({ lineNo, raw, reason: "Empty key" });
      continue;
    }

    const valueTrimmed = value.trim();

    let unquoted = valueTrimmed;
    if ((unquoted.startsWith('"') && unquoted.endsWith('"')) || (unquoted.startsWith("'") && unquoted.endsWith("'"))) {
      unquoted = unquoted.slice(1, -1);
    }

    if (seen.has(key)) duplicates.push(key);
    seen.add(key);

    map.set(key, unquoted);
  }

  return { map, duplicates, invalidLines };
}

// ---------------------------
// Shared rules for flattened maps (JSON + YAML + ENV map)
// ---------------------------
function looksLikeProdFlat(map: Map<string, string>) {
  const envNeedles = new Set(["APP_ENV", "NODE_ENV", "ENV", "STAGE", "ENVIRONMENT"]);

  for (const [k, v] of map.entries()) {
    const leaf = leafKey(k).toLowerCase();
    const val = lc(v);

    const isProdVal = val.includes("prod") || val.includes("production");
    if (!isProdVal) continue;

    if (envNeedles.has(leaf.toUpperCase())) return true;
    if (leaf === "env" || leaf === "environment" || leaf === "stage") return true;
    if (leaf === "app_env" || leaf === "appenv" || leaf === "app_environment") return true;
  }
  return false;
}

function isUrlLikeKey(key: string) {
  const keyL = lc(key);
  return (
    keyL.includes("url") ||
    keyL.includes("uri") ||
    keyL.includes("origin") ||
    keyL.includes("host") ||
    keyL.includes("endpoint") ||
    keyL.includes("cors") ||
    keyL.includes("connectionstring") ||
    keyL.includes("connection_string")
  );
}

function looksLikeSecretValue(raw: string): { strength: "strong" | "weak"; label: string } | null {
  const s = String(raw ?? "");

  if (/-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/.test(s)) return { strength: "strong", label: "private key block" };
  if (/\bsk_(?:live|test)_[0-9a-zA-Z]{10,}\b/.test(s)) return { strength: "strong", label: "Stripe-like key" };
  if (/\bAKIA[0-9A-Z]{16}\b/.test(s)) return { strength: "strong", label: "AWS access key id" };
  if (/\bAIza[0-9A-Za-z\-_]{20,}\b/.test(s)) return { strength: "strong", label: "Google API key" };

  if (/\b(?:postgres|postgresql|mysql|mariadb|mongodb|redis|amqp|http|https):\/\/[^/\s:@]+:[^/\s@]+@/i.test(s)) {
    return { strength: "strong", label: "credentials embedded in URL" };
  }

  if (/^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(s) && s.length >= 40) {
    return { strength: "weak", label: "JWT-like token" };
  }

  const compact = s.replace(/\s+/g, "");
  if (/^[0-9a-f]{32,}$/i.test(compact)) return { strength: "weak", label: "hex-like secret" };
  if (/^[A-Za-z0-9+/_-]{32,}={0,2}$/.test(compact)) return { strength: "weak", label: "base64-like secret" };

  return null;
}

function runFlatRules(side: "left" | "right", flat: Map<string, string>, issues: Issue[]) {
  const isProd = looksLikeProdFlat(flat);

  // Always: empty sensitive values
  for (const [k, v] of flat.entries()) {
    const val = String(v ?? "");
    if (!val && isSensitiveKey(k)) pushIssue(issues, side, "high", "Sensitive key is present but empty", k);
  }

  // Always: lightweight hygiene (DEV too)
  for (const [key, val] of flat.entries()) {
    const v = String(val ?? "");
    if (!v) continue;
    if (!isUrlLikeKey(key)) continue;

    const hay = lc(v);
    if (hay.includes("localhost") || hay.includes("127.0.0.1") || hay.includes("0.0.0.0")) {
      pushIssue(issues, side, "medium", "Localhost/loopback URL found (dev-only value?)", key);
    }
    if (/^http:\/\//i.test(v.trim())) {
      pushIssue(issues, side, "medium", "Non-HTTPS (http://) URL found", key);
    }
  }

  for (const [k, v] of flat.entries()) {
    const leaf = leafKey(k).toLowerCase();
    const keyL = lc(k);

    const isCorsEnvStyle = leaf === "cors_allow_origins" || leaf === "cors_origins" || leaf === "allowed_origins";
    const isCorsYamlStyle = (leaf === "origin" || leaf === "origins") && keyL.includes("cors");
    if (!isCorsEnvStyle && !isCorsYamlStyle) continue;

    const items = splitAllowlist(String(v ?? ""));
    if (items.includes("*")) pushIssue(issues, side, "medium", "Wildcard CORS origins (be careful even in staging)", k);
  }

  // Always: secret detection (key/value)
  for (const [k, v] of flat.entries()) {
    const val = String(v ?? "");
    if (!val) continue;

    if (isSensitiveKey(k)) {
      const hinted = looksLikeSecretValue(val);
      pushIssue(
        issues,
        side,
        "high",
        hinted ? `Secret-like value present for sensitive key (${hinted.label})` : "Secret present for sensitive key (consider using a secret manager)",
        k
      );
      continue;
    }

    const detected = looksLikeSecretValue(val);
    if (detected) {
      pushIssue(
        issues,
        side,
        detected.strength === "strong" ? "high" : "medium",
        `Secret-like value found in config value (${detected.label})`,
        k
      );
    }
  }

  // Prod-only escalations
  if (!isProd) return;

  for (const debugKey of ["DEBUG", "APP_DEBUG"]) {
    for (const [k, v] of flat.entries()) {
      const leaf = leafKey(k).toUpperCase();
      if (leaf !== debugKey) continue;
      if (v && isTruthy(v)) pushIssue(issues, side, "medium", "Debug mode enabled in production-ish config", k);
    }
  }

  for (const [key, val] of flat.entries()) {
    const v = String(val ?? "");
    if (!v) continue;
    if (!isUrlLikeKey(key)) continue;

    const hay = lc(v);
    if (hay.includes("localhost") || hay.includes("127.0.0.1") || hay.includes("0.0.0.0")) {
      pushIssue(issues, side, "high", "Localhost/loopback URL found in production-ish config", key);
    }
    if (/^http:\/\//i.test(v.trim())) {
      pushIssue(issues, side, "high", "Non-HTTPS (http://) URL found in production-ish config", key);
    }
  }

  for (const [k, v] of flat.entries()) {
    const leaf = leafKey(k).toLowerCase();
    const keyL = lc(k);

    const isCorsEnvStyle = leaf === "cors_allow_origins" || leaf === "cors_origins" || leaf === "allowed_origins";
    const isCorsYamlStyle = (leaf === "origin" || leaf === "origins") && keyL.includes("cors");
    if (!isCorsEnvStyle && !isCorsYamlStyle) continue;

    const items = splitAllowlist(String(v ?? ""));
    if (items.includes("*")) pushIssue(issues, side, "high", "Wildcard CORS origins in production-ish config", k);
  }
}

// ---------------------------
// JSON adapter
// ---------------------------
function parseJson(text: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(String(text ?? "")) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Invalid JSON" };
  }
}

function flattenJson(value: any, opts?: { arrayMode?: "ordered" | "set_scalars" }): Map<string, string> {
  const out = new Map<string, string>();
  const arrayMode = opts?.arrayMode ?? "ordered";

  const isScalar = (x: any) => x === null || ["string", "number", "boolean"].includes(typeof x);

  const visit = (node: any, path: string) => {
    if (isScalar(node)) {
      out.set(path || "$", node === null ? "null" : typeof node === "string" ? node : JSON.stringify(node));
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
// Validate one side
// ---------------------------
function validateOne(
  side: "left" | "right",
  text: string,
  format: FormatId,
  profile: EnvProfileId,
  yamlStrict: boolean
): SideResult {
  const issues: Issue[] = [];

  if (!String(text ?? "").trim()) {
    return { ok: true, issues: [], meta: { format, profile, parsedKeys: 0 } };
  }

  if (format === "env") {
    const allowExportPrefix = profile === "dotenv";
    const { map, duplicates, invalidLines } = parseEnvDetailed(text, { allowExportPrefix });

    for (const d of duplicates) pushIssue(issues, side, "low", "Duplicate key found (later value overrides earlier)", d);

    for (const bad of invalidLines) {
      pushIssue(issues, side, "medium", `Invalid .env line at ${bad.lineNo}: ${bad.reason}`);
    }

    runFlatRules(side, map, issues);
    return { ok: true, issues, meta: { format, profile, parsedKeys: map.size } };
  }

  if (format === "yaml") {
    const parsed = parseYamlToFlatMap(text, { arrayMode: "index" });

    // parseYaml meta issues (syntax + duplicate warnings etc.)
    for (const it of parsed.meta.issues) {
      if (it.kind === "error") pushIssue(issues, side, "high", it.message);
      else pushIssue(issues, side, "low", it.message);
    }

    const hasError = parsed.meta.issues.some((x) => x.kind === "error");
    if (hasError) {
      return { ok: false, issues, meta: { format, parsedKeys: 0 }, error: "Invalid YAML" };
    }

    const dupEntries = Object.entries(parsed.meta.duplicates ?? {});
    const hasDupes = dupEntries.length > 0;

    // ✅ NEW: line lookup for duplicates (from parseYaml meta)
    const dupLines = (parsed.meta as any).duplicateLines as Record<string, number> | undefined;

    if (yamlStrict && hasDupes) {
      for (const [k, n] of dupEntries) {
        const count = Number(n) || 2;
        const line = dupLines?.[k];
        const lineMsg = typeof line === "number" && Number.isFinite(line) && line > 0 ? ` line at ${line}` : "";
        pushIssue(
          issues,
          side,
          "high",
          `Duplicate key '${k}' (${count} occurrences) — strict YAML mode requires unique keys${lineMsg}`,
          k
        );
      }

      return {
        ok: false,
        issues,
        meta: { format, parsedKeys: 0 },
        error: "Duplicate keys are not allowed in strict YAML mode",
      };
    }

    if (!yamlStrict && hasDupes) {
      for (const [k, n] of dupEntries) {
        const count = Number(n) || 2;
        const line = dupLines?.[k];
        const lineMsg = typeof line === "number" && Number.isFinite(line) && line > 0 ? ` line at ${line}` : "";
        pushIssue(issues, side, "low", `Duplicate key '${k}' (${count} occurrences) — last value overrides earlier${lineMsg}`, k);
      }
    }

    const flat = new Map<string, string>(Object.entries(parsed.values));
    runFlatRules(side, flat, issues);

    return { ok: true, issues, meta: { format, parsedKeys: flat.size } };
  }

  // JSON
  const parsed = parseJson(text);
  if (!parsed.ok) {
    pushIssue(issues, side, "high", `Invalid JSON: ${parsed.error}`);
    return { ok: false, issues, meta: { format }, error: parsed.error };
  }

  const root = parsed.value;
  const rootType = Array.isArray(root) ? "array" : root === null ? "null" : typeof root;
  if (rootType !== "object" && rootType !== "array") {
    pushIssue(issues, side, "medium", `JSON root is a ${rootType} (usually you want an object)`);
  }

  const flat = flattenJson(root, { arrayMode: "ordered" });
  runFlatRules(side, flat, issues);

  return { ok: true, issues, meta: { format, parsedKeys: flat.size } };
}

// ---------------------------
// Worker entry
// ---------------------------
self.onmessage = (e: MessageEvent<Req>) => {
  const { requestId, left, right, format } = e.data;
  const profile: EnvProfileId = e.data.profile ?? "dotenv";
  const yamlStrict = !!e.data.yamlStrict;
  const t0 = performance.now();

  try {
    const leftRes = validateOne("left", left, format, profile, yamlStrict);
    const rightRes = validateOne("right", right, format, profile, yamlStrict);

    const all = [...leftRes.issues, ...rightRes.issues];
    const totals = {
      high: all.filter((x) => normSeverity(x.severity) === "high").length,
      medium: all.filter((x) => normSeverity(x.severity) === "medium").length,
      low: all.filter((x) => normSeverity(x.severity) === "low").length,
    };

    const ms = Math.round(performance.now() - t0);
    (self as any).postMessage({ requestId, ok: true, result: { left: leftRes, right: rightRes, totals }, ms } satisfies Res);
  } catch (err: any) {
    const ms = Math.round(performance.now() - t0);
    (self as any).postMessage({ requestId, ok: false, error: err?.message ?? "Unknown error", ms } satisfies Res);
  }
};
