// apps/web/src/app/lib/useConfigDiffCompare.ts
import { useEffect, useRef, useState } from "react";

type EnvProfileId = "dotenv" | "compose";
type FormatId = "env" | "json";

type WorkerReq = {
  requestId: number;
  left: string;
  right: string;
  format: FormatId;
  profile?: EnvProfileId; // only used for env
};

type WorkerRes =
  | { requestId: number; ok: true; result: any; ms: number }
  | { requestId: number; ok: false; error: string; ms: number };

type Status = "Idle" | "Comparing…";

export function useConfigDiffCompare(
  left: string,
  right: string,
  opts?: { debounceMs?: number; profile?: EnvProfileId; format?: FormatId }
) {
  const debounceMs = opts?.debounceMs ?? 300;
  const profile = opts?.profile ?? "dotenv";
  const format = opts?.format ?? "env";

  // debounced inputs
  const [leftStable, setLeftStable] = useState(left);
  const [rightStable, setRightStable] = useState(right);

  useEffect(() => {
    const t = setTimeout(() => setLeftStable(left), debounceMs);
    return () => clearTimeout(t);
  }, [left, debounceMs]);

  useEffect(() => {
    const t = setTimeout(() => setRightStable(right), debounceMs);
    return () => clearTimeout(t);
  }, [right, debounceMs]);

  // worker lifecycle
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const latestHandledRef = useRef(0);

  const [engineMs, setEngineMs] = useState<number | null>(null);
  const [result, setResult] = useState<any>({ error: "Loading…" });
  const [status, setStatus] = useState<Status>("Idle");

  useEffect(() => {
    const w = new Worker(new URL("../compare.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;

    w.onmessage = (e: MessageEvent<WorkerRes>) => {
      const msg = e.data;

      if (msg.requestId < latestHandledRef.current) return;
      latestHandledRef.current = msg.requestId;

      setEngineMs(msg.ms);
      setStatus("Idle");

      if (msg.ok) setResult(msg.result);
      else setResult({ error: msg.error });
    };

    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;

    const requestId = ++requestIdRef.current;
    setStatus("Comparing…");

    w.postMessage({
      requestId,
      left: leftStable,
      right: rightStable,
      format,
      profile,
    } satisfies WorkerReq);
  }, [leftStable, rightStable, format, profile]);

  return { result, engineMs, status };
}
