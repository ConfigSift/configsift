// apps/web/src/app/lib/useConfigValidate.ts
import { useCallback, useEffect, useRef, useState } from "react";

type EnvProfileId = "dotenv" | "compose";
type FormatId = "env" | "json";

type WorkerReq = {
  requestId: number;
  left: string;
  right: string;
  format: FormatId;
  profile?: EnvProfileId;
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
};

export function useConfigValidate(
  left: string,
  right: string,
  opts?: {
    debounceMs?: number;
    profile?: EnvProfileId;
    format?: FormatId;
    enabled?: boolean; // when true, auto-validate on (debounced) edits
  }
) {
  const debounceMs = opts?.debounceMs ?? 250;
  const profile = opts?.profile ?? "dotenv";
  const format = opts?.format ?? "env";
  const enabled = opts?.enabled ?? true;

  // debounced inputs (only used for auto/live validation)
  const [leftStable, setLeftStable] = useState(left);
  const [rightStable, setRightStable] = useState(right);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => setLeftStable(left), debounceMs);
    return () => clearTimeout(t);
  }, [left, debounceMs, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => setRightStable(right), debounceMs);
    return () => clearTimeout(t);
  }, [right, debounceMs, enabled]);

  // worker lifecycle
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

  // prevent duplicate posts (e.g., manual run on tab open + auto run when live toggles on)
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
        last.profile === payload.profile;

      if (!force && same) return;

      lastSentRef.current = payload;

      const requestId = ++requestIdRef.current;
      setStatus("Validating…");

      w.postMessage({
        requestId,
        left: payload.left,
        right: payload.right,
        format: payload.format,
        profile: payload.profile,
      } satisfies WorkerReq);
    },
    []
  );

  // manual run() (used by "Run Validate" button + auto-run on tab open)
  const run = useCallback(() => {
    post({ left, right, format, profile }, true);
  }, [left, right, format, profile, post]);

  useEffect(() => {
    const w = new Worker(new URL("../validate.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;

    w.onmessage = (e: MessageEvent<WorkerRes>) => {
      const msg = e.data;
      if (msg.requestId < latestHandledRef.current) return;
      latestHandledRef.current = msg.requestId;

      setEngineMs(msg.ms);
      setStatus("Idle");
      setHasRun(true);
      setLastValidatedAt(Date.now());

      if (msg.ok) setResult(msg.result);
      else setResult({ error: msg.error });
    };

    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, []);

  // auto/live validate on stable edits (when enabled)
  useEffect(() => {
    if (!enabled) return;
    post({ left: leftStable, right: rightStable, format, profile }, false);
  }, [leftStable, rightStable, format, profile, enabled, post]);

  return { result, engineMs, status, run, hasRun, lastValidatedAt };
}
