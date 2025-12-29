// apps/web/src/app/lib/configdiff.ts

export type Severity = "high" | "medium" | "low";

export type DiffParts = {
  prefix: string;
  fromMid: string;
  toMid: string;
  suffix: string;
};

/**
 * Normalize any severity string coming from engine/rules/UI into
 * "high" | "medium" | "low" so CSS + filters always behave.
 */
export function normSeverity(sev?: string): Severity {
  const s = String(sev ?? "").trim().toLowerCase();

  if (s === "high" || s === "critical" || s === "crit") return "high";
  if (s === "medium" || s === "med" || s === "warn" || s === "warning") return "medium";
  if (s === "low" || s === "info" || s === "informational") return "low";

  return "low";
}

/** Rank for sorting (higher = more severe). */
export function sevRank(sev?: string): number {
  const s = normSeverity(sev);
  if (s === "high") return 3;
  if (s === "medium") return 2;
  if (s === "low") return 1;
  return 0;
}

/** Remove array indexes and return the last segment of a dot path. */
function leafKey(path: string): string {
  const s = String(path ?? "");
  const noIndexes = s.replace(/\[\d+\]/g, "");
  const parts = noIndexes.split(".");
  return parts[parts.length - 1] ?? noIndexes;
}

/**
 * Identify secrets/sensitive keys.
 * Works for both env keys (JWT_SECRET) and flattened JSON paths (auth.jwt.secret).
 */
export function isSensitiveKey(key: string): boolean {
  const k = String(key ?? "").toLowerCase();
  const leaf = leafKey(k).toLowerCase();
  const hay = `${k} ${leaf}`;

  // Common secret-ish substrings
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

  // Generic "*key*" patterns (avoid too many false positives)
  // - env keys: SOME_KEY, AWS_ACCESS_KEY_ID
  // - json paths: auth.key, oauth.client_key
  if (leaf === "key" || leaf.endsWith("_key") || leaf.endsWith("-key")) return true;

  return (
    /(^|_)key($|_)/.test(hay) ||
    hay.endsWith("_key") ||
    hay.endsWith("_key_id") ||
    hay.endsWith("_access_key") ||
    hay.endsWith("_access_key_id")
  );
}

/**
 * Fast, bounded diff: common prefix/suffix + differing middle sections.
 * Used for highlighting changed values.
 */
export function computeDiffParts(fromStr: string, toStr: string, maxChars = 50_000): DiffParts {
  let a = fromStr ?? "";
  let b = toStr ?? "";

  if (a.length > maxChars) a = a.slice(0, maxChars);
  if (b.length > maxChars) b = b.slice(0, maxChars);

  if (a === b) return { prefix: a, fromMid: "", toMid: "", suffix: "" };

  const aLen = a.length;
  const bLen = b.length;
  const minLen = Math.min(aLen, bLen);

  // common prefix
  let i = 0;
  while (i < minLen && a.charCodeAt(i) === b.charCodeAt(i)) i++;

  // common suffix (don’t overlap prefix)
  let j = 0;
  while (j < minLen - i && a.charCodeAt(aLen - 1 - j) === b.charCodeAt(bLen - 1 - j)) {
    j++;
  }

  const prefix = a.slice(0, i);
  const suffix = a.slice(aLen - j);

  const fromMid = a.slice(i, aLen - j);
  const toMid = b.slice(i, bLen - j);

  return { prefix, fromMid, toMid, suffix };
}

/* ======================================================================================
   Parsing helpers (Compare hardening)
   ====================================================================================== */

export type EnvParseProfile = "dotenv" | "compose";

export type ParseIssue = {
  line: number;
  kind: "error" | "warning";
  message: string;
};

export type ParseMeta = {
  /** Duplicate keys seen (count includes the final occurrence). */
  duplicates: Record<string, number>;
  /** Non-fatal issues (we still return best-effort values). */
  issues: ParseIssue[];
};

export type ParsedKeyValues = {
  values: Record<string, string>;
  meta: ParseMeta;
};

/**
 * Parse .env style text into a key/value map.
 *
 * Goals:
 * - support dotenv-ish lines (export KEY=VALUE, quoted values, inline comments)
 * - support docker-compose env_file mode (strict KEY=VALUE, no "export")
 * - track duplicate keys (last-one-wins, but duplicates recorded)
 *
 * Notes:
 * - We treat keys as case-sensitive (do NOT lower-case).
 * - We do NOT aggressively trim values; we apply minimal normalization:
 *   - strip surrounding quotes for "..." or '...'
 *   - unescape common sequences inside double quotes
 */
export function parseEnv(text: string, profile: EnvParseProfile = "dotenv"): ParsedKeyValues {
  const values: Record<string, string> = Object.create(null);
  const duplicates: Record<string, number> = Object.create(null);
  const issues: ParseIssue[] = [];

  const lines = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const bumpDup = (k: string) => {
    duplicates[k] = (duplicates[k] ?? 1) + 1;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const raw = lines[idx] ?? "";
    const trimmed = raw.trim();

    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;

    let s = raw;

    // compose env_file is strict: KEY=VALUE only (no export)
    if (profile === "compose") {
      // keep as-is
    } else {
      // dotenv: allow "export KEY=VALUE"
      const exportMatch = s.match(/^\s*export\s+/);
      if (exportMatch) s = s.slice(exportMatch[0].length);
    }

    // Find first '=' that separates key/value
    // We do NOT support "KEY: value" etc — only KEY=VALUE.
    const eq = s.indexOf("=");
    if (eq <= 0) {
      issues.push({
        line: lineNo,
        kind: "warning",
        message: `Skipping non-assignment line (expected KEY=VALUE).`,
      });
      continue;
    }

    const keyPart = s.slice(0, eq).trim();
    let valPart = s.slice(eq + 1);

    if (!keyPart) {
      issues.push({ line: lineNo, kind: "warning", message: `Skipping line with empty key.` });
      continue;
    }

    // Validate key format lightly (don’t be too strict)
    // Allow dots/dashes for some env styles, but warn on spaces.
    if (/\s/.test(keyPart)) {
      issues.push({
        line: lineNo,
        kind: "warning",
        message: `Key contains whitespace; env keys typically do not. Interpreting key as "${keyPart}".`,
      });
    }

    // Remove inline comments ONLY when not inside quotes
    // Example: KEY=value # comment
    valPart = stripInlineComment(valPart);

    // Trim only leading/trailing whitespace around the raw value
    let v = valPart.trim();

    // Handle quoted values
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      const quote = v[0];
      v = v.slice(1, -1);

      if (quote === '"') {
        // Minimal unescape behavior (dotenv-ish)
        v = v
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      } else {
        // Single quotes: treat literally (common dotenv behavior)
        v = v.replace(/\\'/g, "'");
      }
    }

    // Track duplicates (last-one-wins)
    if (Object.prototype.hasOwnProperty.call(values, keyPart)) bumpDup(keyPart);

    values[keyPart] = v;
  }

  return { values, meta: { duplicates, issues } };
}

/**
 * Strip inline comments while respecting quotes.
 * - Comments start at # if not inside '...' or "..."
 */
function stripInlineComment(v: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < v.length; i++) {
    const ch = v[i];

    if (ch === "'" && !inDouble) {
      // toggle unless escaped
      const prev = v[i - 1];
      if (prev !== "\\") inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      const prev = v[i - 1];
      if (prev !== "\\") inDouble = !inDouble;
      continue;
    }

    if (ch === "#" && !inSingle && !inDouble) {
      return v.slice(0, i);
    }
  }

  return v;
}

/* ======================================================================================
   JSON flattening helpers
   ====================================================================================== */

export type JsonArrayMode =
  /** Represent arrays with indexes: arr[0], arr[1].x, etc. (default) */
  | "index"
  /** Ignore arrays entirely (no keys emitted for array values) */
  | "ignore"
  /** Store arrays as a JSON string at their path (no per-element keys) */
  | "stringify";

export type JsonParseOptions = {
  arrayMode?: JsonArrayMode;
  maxKeys?: number; // safety guard
};

export function parseJsonToFlatMap(text: string, opts: JsonParseOptions = {}): ParsedKeyValues {
  const values: Record<string, string> = Object.create(null);
  const duplicates: Record<string, number> = Object.create(null);
  const issues: ParseIssue[] = [];

  const arrayMode: JsonArrayMode = opts.arrayMode ?? "index";
  const maxKeys = Math.max(1, Math.min(opts.maxKeys ?? 200_000, 1_000_000));

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(text ?? ""));
  } catch (e: any) {
    issues.push({
      line: 1,
      kind: "error",
      message: e?.message ? `Invalid JSON: ${e.message}` : "Invalid JSON.",
    });
    return { values: {}, meta: { duplicates, issues } };
  }

  // Root primitives: store as a single key
  if (parsed === null || typeof parsed !== "object") {
    values["$"] = String(parsed);
    return { values, meta: { duplicates, issues } };
  }

  let emitted = 0;

  const emit = (k: string, v: unknown) => {
    emitted++;
    if (emitted > maxKeys) {
      throw new Error(`JSON too large (>${maxKeys} flattened keys).`);
    }
    const valStr = valueToStableString(v);

    // Duplicates should not happen in valid JSON object keys, but can happen
    // via pathological flattening collisions; track anyway.
    if (Object.prototype.hasOwnProperty.call(values, k)) {
      duplicates[k] = (duplicates[k] ?? 1) + 1;
    }
    values[k] = valStr;
  };

  try {
    flattenJson(parsed as any, "", emit, arrayMode);
  } catch (e: any) {
    issues.push({
      line: 1,
      kind: "error",
      message: e?.message ?? "Failed to flatten JSON.",
    });
  }

  return { values, meta: { duplicates, issues } };
}

function flattenJson(
  node: any,
  path: string,
  emit: (k: string, v: unknown) => void,
  arrayMode: JsonArrayMode
) {
  if (node === null || node === undefined) {
    emit(path || "$", node);
    return;
  }

  const t = typeof node;

  if (t !== "object") {
    emit(path || "$", node);
    return;
  }

  if (Array.isArray(node)) {
    if (arrayMode === "ignore") return;

    if (arrayMode === "stringify") {
      emit(path || "$", node);
      return;
    }

    // index mode
    for (let i = 0; i < node.length; i++) {
      const nextPath = path ? `${path}[${i}]` : `$[${i}]`;
      flattenJson(node[i], nextPath, emit, arrayMode);
    }
    return;
  }

  // object
  const keys = Object.keys(node);
  if (keys.length === 0) {
    // represent empty objects explicitly
    emit(path || "$", node);
    return;
  }

  for (const k of keys) {
    const nextPath = path ? `${path}.${k}` : k;
    flattenJson(node[k], nextPath, emit, arrayMode);
  }
}

/** Convert values into a stable string representation for comparing. */
function valueToStableString(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);

  // objects/arrays: stable JSON-ish stringify
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/* ======================================================================================
   Optional helpers for “Compare” feature: duplicates to findings
   (Use these in your worker/engine if you want.)
   ====================================================================================== */

export type Finding = { key: string; severity?: string; message: string };

export function duplicatesToFindings(meta: ParseMeta, label: string, severity: Severity = "medium"): Finding[] {
  const out: Finding[] = [];
  for (const k of Object.keys(meta.duplicates ?? {})) {
    const n = meta.duplicates[k];
    out.push({
      key: k,
      severity,
      message: `${label}: key appears ${n} times (last value wins).`,
    });
  }
  return out;
}

export function issuesToFindings(meta: ParseMeta, label: string): Finding[] {
  return (meta.issues ?? []).map((i) => ({
    key: `${label}:line:${i.line}`,
    severity: i.kind === "error" ? "high" : "low",
    message: `${label}: ${i.kind.toUpperCase()} on line ${i.line}: ${i.message}`,
  }));
}
