// apps/web/src/app/lib/parseYaml.ts
import YAML from "yaml";

export type ParseIssue = {
  line: number;
  kind: "error" | "warning";
  message: string;
};

export type ParseMeta = {
  duplicates: Record<string, number>; // keyPath -> occurrences (e.g. 2)
  duplicateLines?: Record<string, number>; // keyPath -> line number (best-effort)
  issues: ParseIssue[];
};

export type ParsedKeyValues = {
  values: Record<string, string>;
  meta: ParseMeta;
};

type JsonArrayMode = "index" | "ignore" | "stringify";

/**
 * Parse YAML and flatten it to a dot/bracket path map:
 *   services[0].endpoint -> "https://..."
 *
 * Important behavior:
 * - Duplicate YAML keys are NOT treated as syntax errors here.
 *   We parse with uniqueKeys:false, and separately detect duplicates by walking the AST.
 * - YAML merge keys (<<) are applied in doc.toJS({ merge: true })
 */
export function parseYamlToFlatMap(
  text: string,
  opts?: { arrayMode?: JsonArrayMode; maxKeys?: number }
): ParsedKeyValues {
  const values: Record<string, string> = Object.create(null);
  const duplicates: Record<string, number> = Object.create(null);
  const duplicateLines: Record<string, number> = Object.create(null);
  const issues: ParseIssue[] = [];

  const arrayMode: JsonArrayMode = opts?.arrayMode ?? "index";
  const maxKeys = Math.max(1, Math.min(opts?.maxKeys ?? 200_000, 1_000_000));

  let doc: any;
  try {
    // Allow duplicate keys; we'll report them via meta.duplicates + meta.duplicateLines
    doc = YAML.parseDocument(String(text ?? ""), { uniqueKeys: false, strict: false });
  } catch (e: any) {
    issues.push({
      line: 1,
      kind: "error",
      message: e?.message ? `Invalid YAML: ${e.message}` : "Invalid YAML.",
    });
    return { values: {}, meta: { duplicates, duplicateLines, issues } };
  }

  // Real syntax errors
  const docErrors = Array.isArray(doc?.errors) ? doc.errors : [];
  if (docErrors.length > 0) {
    const first = docErrors[0];
    issues.push({
      line: 1,
      kind: "error",
      message: first?.message ? `Invalid YAML: ${first.message}` : "Invalid YAML.",
    });
    return { values: {}, meta: { duplicates, duplicateLines, issues } };
  }

  // Precompute line starts so we can map char offsets -> line numbers
  const lineStarts = buildLineStarts(String(text ?? ""));

  // Detect duplicates by walking AST
  try {
    collectDuplicateKeyPaths(doc?.contents, "", duplicates, duplicateLines, issues, lineStarts);
  } catch (e: any) {
    issues.push({
      line: 1,
      kind: "warning",
      message: e?.message ?? "Failed to scan YAML for duplicate keys.",
    });
  }

  // Convert to JS with merges applied
  let parsed: unknown;
  try {
    parsed = doc.toJS({ merge: true });
  } catch (e: any) {
    issues.push({
      line: 1,
      kind: "error",
      message: e?.message ? `Invalid YAML: ${e.message}` : "Invalid YAML.",
    });
    return { values: {}, meta: { duplicates, duplicateLines, issues } };
  }

  if (parsed === null || typeof parsed !== "object") {
    values["$"] = valueToStableString(parsed);
    return { values, meta: { duplicates, duplicateLines, issues } };
  }

  let emitted = 0;

  const emit = (k: string, v: unknown) => {
    emitted++;
    if (emitted > maxKeys) throw new Error(`YAML too large (>${maxKeys} flattened keys).`);
    values[k] = valueToStableString(v);
  };

  try {
    flatten(parsed as any, "", emit, arrayMode);
  } catch (e: any) {
    issues.push({
      line: 1,
      kind: "error",
      message: e?.message ?? "Failed to flatten YAML.",
    });
  }

  return { values, meta: { duplicates, duplicateLines, issues } };
}

function collectDuplicateKeyPaths(
  node: any,
  path: string,
  out: Record<string, number>,
  outLines: Record<string, number>,
  issues: ParseIssue[],
  lineStarts: number[]
) {
  if (!node || typeof node !== "object") return;

  // YAMLSeq: has .items but items are not Pairs
  if (Array.isArray(node?.items) && !node?.items?.some((x: any) => x?.key !== undefined)) {
    for (let i = 0; i < node.items.length; i++) {
      const nextPath = path ? `${path}[${i}]` : `$[${i}]`;
      collectDuplicateKeyPaths(node.items[i], nextPath, out, outLines, issues, lineStarts);
    }
    return;
  }

  // YAMLMap: .items are Pair(s) with .key/.value
  if (Array.isArray(node?.items) && node?.items?.some((x: any) => x?.key !== undefined)) {
    const seen = new Map<string, number>();

    for (const pair of node.items) {
      const keyNode = pair?.key;
      const keyStr = keyNodeToString(keyNode);
      if (!keyStr) continue;

      // Ignore merge key itself; traverse its value into same path
      if (keyStr === "<<") {
        collectDuplicateKeyPaths(pair?.value, path, out, outLines, issues, lineStarts);
        continue;
      }

      const prev = seen.get(keyStr) ?? 0;
      const next = prev + 1;
      seen.set(keyStr, next);

      if (next >= 2) {
        const keyPath = path ? `${path}.${keyStr}` : keyStr;
        out[keyPath] = Math.max(out[keyPath] ?? 0, next);

        // Best-effort: line of the *duplicate occurrence* (the current key node)
        const line = inferYamlNodeLine(keyNode, lineStarts) ?? 1;

        // Record a line once (keep the earliest duplicate line we see)
        if (!outLines[keyPath] || line < outLines[keyPath]) outLines[keyPath] = line;

        // Emit a warning issue that includes line-at (useful even in non-strict mode)
        const already = issues.some((it) => it.message.includes(`Duplicate key '${keyPath}'`));
        if (!already) {
          issues.push({
            line,
            kind: "warning",
            message: `Duplicate key '${keyPath}' line at ${line}`,
          });
        }
      }

      const nextPath = path ? `${path}.${keyStr}` : keyStr;
      collectDuplicateKeyPaths(pair?.value, nextPath, out, outLines, issues, lineStarts);
    }

    return;
  }

  // Alias/Scalar/etc
  if (node?.value !== undefined) collectDuplicateKeyPaths(node.value, path, out, outLines, issues, lineStarts);
}

function keyNodeToString(keyNode: any): string {
  if (keyNode == null) return "";
  if (typeof keyNode === "string") return keyNode;
  if (typeof keyNode === "number" || typeof keyNode === "boolean") return String(keyNode);
  if (typeof keyNode === "object") {
    if (typeof keyNode.value === "string") return keyNode.value;
    if (keyNode.value != null) return String(keyNode.value);
  }
  return String(keyNode ?? "");
}

function buildLineStarts(text: string): number[] {
  // line 1 starts at char 0
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(offset: number, lineStarts: number[]): number {
  // line number is 1-indexed
  if (!Number.isFinite(offset) || offset <= 0) return 1;

  // binary search for rightmost lineStart <= offset
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = lineStarts[mid];
    if (v <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, hi + 1);
}

function inferYamlNodeLine(node: any, lineStarts: number[]): number | null {
  // YAML nodes usually have `range: [start, end, ...]` where start is a char offset
  const r = node?.range;
  const start = Array.isArray(r) ? r[0] : null;
  if (typeof start === "number" && Number.isFinite(start) && start >= 0) {
    return offsetToLine(start, lineStarts);
  }
  return null;
}

function flatten(node: any, path: string, emit: (k: string, v: unknown) => void, arrayMode: JsonArrayMode) {
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

    for (let i = 0; i < node.length; i++) {
      const nextPath = path ? `${path}[${i}]` : `$[${i}]`;
      flatten(node[i], nextPath, emit, arrayMode);
    }
    return;
  }

  const keys = Object.keys(node);
  if (keys.length === 0) {
    emit(path || "$", node);
    return;
  }

  for (const k of keys) {
    const nextPath = path ? `${path}.${k}` : k;
    flatten((node as any)[k], nextPath, emit, arrayMode);
  }
}

function valueToStableString(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);

  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
