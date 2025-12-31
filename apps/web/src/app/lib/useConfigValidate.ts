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

export function useConfigValidate(
  left: string,
  right: string,
  opts?: {
    debounceMs?: number;
    profile?: EnvProfileId;
    format?: FormatId;
    enabled?: boolean; // when true, auto-validate on (debounced) edits
    yamlStrict?: boolean; // YAML only: duplicates are errors
    debug?: boolean; // ✅ NEW: logs worker req/res to console
  }
) {
  const debounceMs = opts?.debounceMs ?? 250;
  const profile = opts?.profile ?? "dotenv";
  const format = opts?.format ?? "env";
  const enabled = opts?.enabled ?? true;
  const yamlStrict = opts?.yamlStrict ?? false;
  const debug = opts?.debug ?? false;

  // Keep "stable" copies for debounced auto-validation.
  const [leftStable, setLeftStable] = useState(left);
  const [rightStable, setRightStable] = useState(right);

  // ✅ NEW: keep stable values in sync even when enabled=false
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
  const [result, setResult] = useState<any>({
    left: { ok: true, issues: [] },
    right: { ok: true, issues: [] },
    totals: { high: 0, medium: 0, low: 0 },
  });
  const [status, setStatus] = useState<Status>("Idle");

  const [hasRun, setHasRun] = useState(false);
  const [lastValidatedAt, setLastValidatedAt] = useState<number | null>(null);

  const lastSentRef = useRef<Payload | null>(null);

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
    post({ left, right, format, profile, yamlStrict }, true);
  }, [left, right, format, profile, yamlStrict, post]);

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
    post({ left: leftStable, right: rightStable, format, profile, yamlStrict }, false);
  }, [leftStable, rightStable, format, profile, yamlStrict, enabled, post]);

  return { result, engineMs, status, run, hasRun, lastValidatedAt };
}
