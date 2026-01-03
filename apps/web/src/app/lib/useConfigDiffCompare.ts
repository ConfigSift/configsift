// apps/web/src/app/lib/useConfigDiffCompare.ts
import { useEffect, useRef, useState } from "react";

type EnvProfileId = "dotenv" | "compose";
type FormatId = "env" | "json" | "yaml";

type WorkerReq = {
  requestId: number;
  left: string;
  right: string;
  format: FormatId;
  profile?: EnvProfileId; // only used for env
};

type WorkerRes =
  | { requestId: number; ok: true; result: any }
  | { requestId: number; ok: false; error: string };

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

  const [result, setResult] = useState<any>({ error: "Loading…" });
  const [status, setStatus] = useState<Status>("Idle");

  useEffect(() => {
    const w = new Worker(new URL("../compare.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;

    w.onmessage = (e: MessageEvent<any>) => {
      const msg = e.data as any;

      if (typeof msg?.requestId === "number" && msg.requestId < latestHandledRef.current) return;
      if (typeof msg?.requestId === "number") latestHandledRef.current = msg.requestId;

      setStatus("Idle");

      if (msg?.ok) setResult(msg.result);
      else setResult({ error: msg?.error ?? "Worker error" });
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

  return { result, status };
}
