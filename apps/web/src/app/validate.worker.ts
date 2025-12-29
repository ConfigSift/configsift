// apps/web/src/app/validate.worker.ts

type EnvProfileId = "dotenv" | "compose";
type FormatId = "env" | "json";

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
};

type Res =
  | { requestId: number; ok: true; result: { left: SideResult; right: SideResult; totals: { high: number; medium: number; low: number } }; ms: number }
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

    const noExport =
      allowExportPrefix && trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;

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

    // preserve intentional spaces inside quotes; but detect accidental leading/trailing spaces
    const valueTrimmed = value.trim();

    // strip wrapping quotes
    let unquoted = valueTrimmed;
    if (
      (unquoted.startsWith('"') && unquoted.endsWith('"')) ||
      (unquoted.startsWith("'") && unquoted.endsWith("'"))
    ) {
      unquoted = unquoted.slice(1, -1);
    }

    if (seen.has(key)) duplicates.push(key);
    seen.add(key);

    map.set(key, unquoted);
  }

  return { map, duplicates, invalidLines };
}

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

function runEnvRules(side: "left" | "right", map: Map<string, string>, issues: Issue[]) {
  // empty sensitive values
  for (const [k, v] of map.entries()) {
    const val = String(v ?? "");
    if (!val && isSensitiveKey(k)) {
      pushIssue(issues, side, "high", "Sensitive key is present but empty", k);
    }
  }

  const isProd = looksLikeProdEnv(map);

  // Debug enabled in prod (MED)
  if (isProd) {
    for (const debugKey of ["DEBUG", "APP_DEBUG"]) {
      const v = map.get(debugKey);
      if (v && isTruthy(v)) pushIssue(issues, side, "medium", "Debug mode enabled in production", debugKey);
    }
  }

  // Localhost in URL-ish keys (HIGH) when prod-ish
  if (isProd) {
    const localhostNeedles = ["localhost", "127.0.0.1", "0.0.0.0"];
    for (const [key, val] of map.entries()) {
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
        pushIssue(issues, side, "high", "Localhost/loopback URL found in production environment", key);
      }
    }
  }

  // Wildcard CORS in prod (HIGH)
  if (isProd) {
    for (const corsKey of ["CORS_ALLOW_ORIGINS", "CORS_ORIGINS", "ALLOWED_ORIGINS"]) {
      const v = map.get(corsKey);
      if (!v) continue;
      const items = splitAllowlist(v);
      if (items.includes("*")) pushIssue(issues, side, "high", "Wildcard CORS origins in production", corsKey);
    }
  }

  // Required keys missing in prod (HIGH)
  if (isProd) {
    const requiredInProd = ["DATABASE_URL", "JWT_SECRET", "CSRF_SECRET", "SECRET_KEY", "API_TOKEN"];
    for (const reqKey of requiredInProd) {
      const v = map.get(reqKey);
      if (!v) pushIssue(issues, side, "high", "Missing required configuration in production", reqKey);
    }
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

function runJsonRules(side: "left" | "right", flat: Map<string, string>, issues: Issue[]) {
  // empty sensitive values
  for (const [k, v] of flat.entries()) {
    const val = String(v ?? "");
    if (!val && isSensitiveKey(k)) pushIssue(issues, side, "high", "Sensitive key is present but empty", k);
  }

  const isProd = looksLikeProdFlat(flat);

  // Debug enabled in prod (MED)
  if (isProd) {
    for (const debugKey of ["DEBUG", "APP_DEBUG"]) {
      for (const [k, v] of flat.entries()) {
        const leaf = leafKey(k).toUpperCase();
        if (leaf !== debugKey) continue;
        if (v && isTruthy(v)) pushIssue(issues, side, "medium", "Debug mode enabled in production-ish config", k);
      }
    }
  }

  // Localhost in URL-ish fields (HIGH) when prod-ish
  if (isProd) {
    const localhostNeedles = ["localhost", "127.0.0.1", "0.0.0.0"];
    for (const [key, val] of flat.entries()) {
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
        pushIssue(issues, side, "high", "Localhost/loopback URL found in production-ish config", key);
      }
    }
  }

  // Wildcard CORS (HIGH) – match leaf key
  if (isProd) {
    for (const corsKey of ["CORS_ALLOW_ORIGINS", "CORS_ORIGINS", "ALLOWED_ORIGINS"]) {
      for (const [k, v] of flat.entries()) {
        const leaf = leafKey(k).toUpperCase();
        if (leaf !== corsKey) continue;
        const items = splitAllowlist(v);
        if (items.includes("*")) pushIssue(issues, side, "high", "Wildcard CORS origins in production-ish config", k);
      }
    }
  }
}

// ---------------------------
// Validate one side
// ---------------------------
function validateOne(
  side: "left" | "right",
  text: string,
  format: FormatId,
  profile: EnvProfileId
): SideResult {
  const issues: Issue[] = [];

  if (!String(text ?? "").trim()) {
    return {
      ok: true,
      issues: [],
      meta: { format, profile, parsedKeys: 0 },
    };
  }

  if (format === "env") {
    const allowExportPrefix = profile === "dotenv";
    const { map, duplicates, invalidLines } = parseEnvDetailed(text, { allowExportPrefix });

    for (const d of duplicates) pushIssue(issues, side, "low", "Duplicate key found (later value overrides earlier)", d);

    for (const bad of invalidLines) {
      pushIssue(
        issues,
        side,
        "medium",
        `Invalid .env line at ${bad.lineNo}: ${bad.reason}`,
        undefined
      );
    }

    runEnvRules(side, map, issues);

    return {
      ok: true,
      issues,
      meta: { format, profile, parsedKeys: map.size },
    };
  }

  // JSON
  const parsed = parseJson(text);
  if (!parsed.ok) {
    pushIssue(issues, side, "high", `Invalid JSON: ${parsed.error}`);
    return {
      ok: false,
      issues,
      meta: { format },
      error: parsed.error,
    };
  }

  const root = parsed.value;
  const rootType = Array.isArray(root) ? "array" : root === null ? "null" : typeof root;
  if (rootType !== "object" && rootType !== "array") {
    pushIssue(issues, side, "medium", `JSON root is a ${rootType} (usually you want an object)`);
  }

  const flat = flattenJson(root, { arrayMode: "ordered" });
  runJsonRules(side, flat, issues);

  return {
    ok: true,
    issues,
    meta: { format, parsedKeys: flat.size },
  };
}

// ---------------------------
// Worker entry
// ---------------------------
self.onmessage = (e: MessageEvent<Req>) => {
  const { requestId, left, right, format } = e.data;
  const profile: EnvProfileId = e.data.profile ?? "dotenv";
  const t0 = performance.now();

  try {
    const leftRes = validateOne("left", left, format, profile);
    const rightRes = validateOne("right", right, format, profile);

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
