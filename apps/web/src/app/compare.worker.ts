// apps/web/src/app/compare.worker.ts
/// <reference lib="webworker" />

import {
  parseEnv,
  parseJsonToFlatMap,
  duplicatesToFindings,
  issuesToFindings,
  isSensitiveKey,
  normSeverity,
  type EnvParseProfile,
  type ParsedKeyValues,
  type Finding as LibFinding,
} from "./lib/configdiff";
import { parseYamlToFlatMap } from "./lib/parseYaml";

type EnvProfileId = "dotenv" | "compose";
type FormatId = "env" | "json" | "yaml";

type WorkerReq = {
  requestId: number;
  left: string;
  right: string;
  format: FormatId;
  profile?: EnvProfileId; // only used for env
};

type DiffRowChanged = { key: string; from: string; to: string };
type DiffRowSingle = { key: string; value: string };

type Redacted = { raw: string; redacted: string };
type RedactedEntry = { from?: Redacted; to?: Redacted; value?: Redacted };

type WorkerOk = {
  requestId: number;
  ok: true;
  result: {
    changed: DiffRowChanged[];
    added: DiffRowSingle[];
    removed: DiffRowSingle[];
    findings: LibFinding[];
    redactedValues: Record<string, RedactedEntry>;
  };
  ms: number;
};

type WorkerErr = { requestId: number; ok: false; error: string; ms: number };

function stableNowMs() {
  // performance.now() exists in workers; fallback just in case.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function redact(key: string, value: string): Redacted {
  const raw = String(value ?? "");
  if (!raw) return { raw, redacted: raw };

  // If the key looks sensitive, always redact.
  if (isSensitiveKey(key)) return { raw, redacted: "••••" };

  // Otherwise leave as-is.
  return { raw, redacted: raw };
}

function parseByFormat(text: string, format: FormatId, profile: EnvProfileId): ParsedKeyValues {
  if (format === "env") return parseEnv(text, profile as EnvParseProfile);
  if (format === "json") return parseJsonToFlatMap(text);
  return parseYamlToFlatMap(text);
}

function addHeuristicFindings(values: Record<string, string>, sideLabel: string, out: LibFinding[]) {
  const push = (key: string, severity: string, message: string) => out.push({ key, severity, message });

  for (const k of Object.keys(values)) {
    const v = String(values[k] ?? "");

    // DEBUG flags
    if (/^debug$/i.test(k) && /^(true|1|yes|on)$/i.test(v.trim())) {
      push(k, "medium", `${sideLabel}: DEBUG appears enabled.`);
    }

    // NODE_ENV sanity
    if (/^node_env$/i.test(k) && v && !/production/i.test(v)) {
      push(k, "low", `${sideLabel}: NODE_ENV is "${v}" (not "production").`);
    }

    // Wildcard CORS / overly permissive
    if (/cors/i.test(k) && /\*/.test(v)) {
      push(k, "high", `${sideLabel}: CORS appears to allow "*".`);
    }

    // Obvious localhost URLs
    if (
      /(url|endpoint|host|origin|base)/i.test(k) &&
      /(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(v)
    ) {
      push(k, "high", `${sideLabel}: URL/host references localhost (unsafe for prod).`);
    }

    // http (non-https) URLs
    if (/(url|endpoint|origin|callback|redirect)/i.test(k) && /^\s*http:\/\//i.test(v.trim())) {
      push(k, "medium", `${sideLabel}: URL uses http:// (consider https://).`);
    }

    // Secret hygiene (only if key is sensitive)
    if (isSensitiveKey(k)) {
      const vv = v.trim().toLowerCase();
      if (!vv) continue;

      if (vv === "changeme" || vv === "change_me" || vv === "test" || vv === "testing" || vv === "password") {
        push(k, "high", `${sideLabel}: Secret value looks like a placeholder ("${v}").`);
      }

      if (vv.length < 8) {
        push(k, "medium", `${sideLabel}: Secret value looks short (consider a stronger secret).`);
      }
    }
  }
}

function unionKeys(a: Record<string, string>, b: Record<string, string>) {
  const set = new Set<string>();
  for (const k of Object.keys(a)) set.add(k);
  for (const k of Object.keys(b)) set.add(k);
  return Array.from(set);
}

self.onmessage = (e: MessageEvent<WorkerReq>) => {
  const t0 = stableNowMs();

  const { requestId, left, right, format, profile } = e.data;
  const envProfile: EnvProfileId = profile ?? "dotenv";

  try {
    const leftParsed = parseByFormat(left ?? "", format, envProfile);
    const rightParsed = parseByFormat(right ?? "", format, envProfile);

    const leftValues = leftParsed.values ?? {};
    const rightValues = rightParsed.values ?? {};

    const keys = unionKeys(leftValues, rightValues);

    const changed: DiffRowChanged[] = [];
    const added: DiffRowSingle[] = [];
    const removed: DiffRowSingle[] = [];

    const redactedValues: Record<string, RedactedEntry> = Object.create(null);

    for (const key of keys) {
      const hasL = Object.prototype.hasOwnProperty.call(leftValues, key);
      const hasR = Object.prototype.hasOwnProperty.call(rightValues, key);

      const l = hasL ? String(leftValues[key] ?? "") : "";
      const r = hasR ? String(rightValues[key] ?? "") : "";

      if (hasL && hasR) {
        if (l !== r) {
          changed.push({ key, from: l, to: r });
        }

        redactedValues[key] = {
          from: redact(key, l),
          to: redact(key, r),
        };
      } else if (hasL && !hasR) {
        removed.push({ key, value: l });
        redactedValues[key] = { value: redact(key, l) };
      } else if (!hasL && hasR) {
        added.push({ key, value: r });
        redactedValues[key] = { value: redact(key, r) };
      }
    }

    // Findings: parse issues + duplicates + heuristics
    const findings: LibFinding[] = [];

    findings.push(...issuesToFindings(leftParsed.meta, "Left"));
    findings.push(...duplicatesToFindings(leftParsed.meta, "Left", "medium"));
    findings.push(...issuesToFindings(rightParsed.meta, "Right"));
    findings.push(...duplicatesToFindings(rightParsed.meta, "Right", "medium"));

    addHeuristicFindings(leftValues, "Left", findings);
    addHeuristicFindings(rightValues, "Right", findings);

    // Normalize severity strings
    for (const f of findings) f.severity = normSeverity(f.severity);

    const t1 = stableNowMs();

    const msg: WorkerOk = {
      requestId,
      ok: true,
      result: { changed, added, removed, findings, redactedValues },
      ms: +((t1 - t0) as number).toFixed(1),
    };

    self.postMessage(msg);
  } catch (err: any) {
    const t1 = stableNowMs();
    const msg: WorkerErr = {
      requestId,
      ok: false,
      error: err?.message ?? "Compare worker failed.",
      ms: +((t1 - t0) as number).toFixed(1),
    };
    self.postMessage(msg);
  }
};

export {};
