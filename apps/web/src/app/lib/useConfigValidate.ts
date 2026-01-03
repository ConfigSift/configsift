// apps/web/src/app/lib/useConfigValidate.ts
import { useCallback, useEffect, useRef, useState } from "react";

type EnvProfileId = "dotenv" | "compose";
type FormatId = "env" | "json" | "yaml";

type WorkerReq = {
  requestId: number;
  left: string;
  right: string;
  format: FormatId;
  profile?: EnvProfileId;
  yamlStrict?: boolean;
};

type WorkerRes =
  | { requestId: number; ok: true; result: any; ms: number }
  | { requestId: number; ok: false; error: string; ms: number };

type Status = "Idle" | "Validating…";

type Payload = {
  left: string;
  right: string;
  format: FormatId;
  profile: EnvProfileId;
  yamlStrict: boolean;
};

const EMPTY_RESULT = {
  left: { ok: true, issues: [] as any[] },
  right: { ok: true, issues: [] as any[] },
  totals: { high: 0, medium: 0, low: 0 },
};

export function useConfigValidate(
  left: string,
  right: string,
  opts?: {
    debounceMs?: number;
    profile?: EnvProfileId;
    format?: FormatId;
    enabled?: boolean; // when true, auto-validate on (debounced) edits
    yamlStrict?: boolean; // YAML only: duplicates are errors
    debug?: boolean; // logs worker req/res to console

    // ✅ NEW: clear stale findings automatically when both inputs are empty
    clearOnEmpty?: boolean;
  }
) {
  const debounceMs = opts?.debounceMs ?? 250;
  const profile = opts?.profile ?? "dotenv";
  const format = opts?.format ?? "env";
  const enabled = opts?.enabled ?? true;
  const yamlStrict = opts?.yamlStrict ?? false;
  const debug = opts?.debug ?? false;

  // ✅ NEW
  const clearOnEmpty = opts?.clearOnEmpty ?? true;

  // Keep "stable" copies for debounced auto-validation.
  const [leftStable, setLeftStable] = useState(left);
  const [rightStable, setRightStable] = useState(right);

  // Keep stable values in sync even when enabled=false
  // (no auto-validate will run, but if you later enable it, stables are current)
  useEffect(() => {
    if (!enabled) {
      setLeftStable(left);
      return;
    }
    const t = setTimeout(() => setLeftStable(left), debounceMs);
    return () => clearTimeout(t);
  }, [left, debounceMs, enabled]);

  useEffect(() => {
    if (!enabled) {
      setRightStable(right);
      return;
    }
    const t = setTimeout(() => setRightStable(right), debounceMs);
    return () => clearTimeout(t);
  }, [right, debounceMs, enabled]);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestHandledRef = useRef(0);

  const [engineMs, setEngineMs] = useState<number | null>(null);
  const [result, setResult] = useState<any>(EMPTY_RESULT);
  const [status, setStatus] = useState<Status>("Idle");

  const [hasRun, setHasRun] = useState(false);
  const [lastValidatedAt, setLastValidatedAt] = useState<number | null>(null);

  const lastSentRef = useRef<Payload | null>(null);

  // ✅ NEW: helper to reset local state (and ignore any in-flight worker responses)
  const reset = useCallback(() => {
    // Bump ids so any late worker message is ignored
    const next = requestIdRef.current + 1;
    requestIdRef.current = next;
    latestHandledRef.current = next;

    lastSentRef.current = null;

    setStatus("Idle");
    setEngineMs(null);
    setHasRun(false);
    setLastValidatedAt(null);
    setResult(EMPTY_RESULT);
  }, []);

  // ✅ NEW: clear stale findings when both inputs are empty
  useEffect(() => {
    if (!clearOnEmpty) return;
    if (left.trim() === "" && right.trim() === "") {
      reset();
    }
  }, [left, right, clearOnEmpty, reset]);

  const post = useCallback(
    (payload: Payload, force?: boolean) => {
      const w = workerRef.current;
      if (!w) return;

      const last = lastSentRef.current;
      const same =
        !!last &&
        last.left === payload.left &&
        last.right === payload.right &&
        last.format === payload.format &&
        last.profile === payload.profile &&
        last.yamlStrict === payload.yamlStrict;

      if (!force && same) return;

      lastSentRef.current = payload;

      const requestId = ++requestIdRef.current;
      setStatus("Validating…");

      if (debug) {
        console.log("[validate] postMessage", {
          requestId,
          format: payload.format,
          profile: payload.profile,
          yamlStrict: payload.yamlStrict,
          leftLen: payload.left?.length ?? 0,
          rightLen: payload.right?.length ?? 0,
        });
      }

      w.postMessage({
        requestId,
        left: payload.left,
        right: payload.right,
        format: payload.format,
        profile: payload.profile,
        yamlStrict: payload.yamlStrict,
      } satisfies WorkerReq);
    },
    [debug]
  );

  // Manual trigger: validate exactly the current hook inputs.
  const run = useCallback(() => {
    // If the user runs validate with empty inputs, just reset to empty state.
    if (clearOnEmpty && left.trim() === "" && right.trim() === "") {
      reset();
      return;
    }
    post({ left, right, format, profile, yamlStrict }, true);
  }, [left, right, format, profile, yamlStrict, post, clearOnEmpty, reset]);

  useEffect(() => {
    const w = new Worker(new URL("../validate.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;

    w.onmessage = (e: MessageEvent<WorkerRes>) => {
      const msg = e.data;
      if (msg.requestId < latestHandledRef.current) return;
      latestHandledRef.current = msg.requestId;

      if (debug) {
        console.log("[validate] worker response", msg);
      }

      setEngineMs(msg.ms);
      setStatus("Idle");
      setHasRun(true);
      setLastValidatedAt(Date.now());

      if (msg.ok) setResult(msg.result);
      else setResult({ error: msg.error });
    };

    w.onerror = (err) => {
      if (debug) console.error("[validate] worker error", err);
      setStatus("Idle");
      setHasRun(true);
      setLastValidatedAt(Date.now());
      setResult({ error: String((err as any)?.message ?? "Validate worker error") });
    };

    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, [debug]);

  // Auto validate (debounced) when enabled=true.
  useEffect(() => {
    if (!enabled) return;

    // ✅ If auto-validation is enabled and both sides are empty, keep it clean.
    if (clearOnEmpty && leftStable.trim() === "" && rightStable.trim() === "") {
      reset();
      return;
    }

    post({ left: leftStable, right: rightStable, format, profile, yamlStrict }, false);
  }, [leftStable, rightStable, format, profile, yamlStrict, enabled, post, clearOnEmpty, reset]);

  return { result, engineMs, status, run, hasRun, lastValidatedAt, reset };
}
