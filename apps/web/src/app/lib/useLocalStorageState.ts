"use client";

import { useEffect, useRef, useState } from "react";

type Serializer<T> = (value: T) => string;
type Parser<T> = (raw: string) => T;

type Options<T> = {
  serialize?: Serializer<T>;
  parse?: Parser<T>;
};

/**
 * Client-safe localStorage state.
 * - Initializes with `initialValue` to avoid hydration mismatch.
 * - Reads localStorage on mount and updates state if a value exists.
 * - Persists on changes.
 */
export function useLocalStorageState<T>(
  key: string,
  initialValue: T,
  opts?: Options<T>
): [T, React.Dispatch<React.SetStateAction<T>>, { hydrated: boolean }] {
  const serialize: Serializer<T> = opts?.serialize ?? ((v) => JSON.stringify(v));
  const parse: Parser<T> = opts?.parse ?? ((raw) => JSON.parse(raw) as T);

  const [value, setValue] = useState<T>(initialValue);
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  // hydrate from localStorage (once)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        setValue(parse(raw));
      }
    } catch {
      // ignore (private mode, blocked storage, bad JSON)
    } finally {
      hydratedRef.current = true;
      setHydrated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // persist
  useEffect(() => {
    if (!hydratedRef.current) return; // don't clobber LS before hydration read
    try {
      window.localStorage.setItem(key, serialize(value));
    } catch {
      // ignore
    }
  }, [key, serialize, value]);

  return [value, setValue, { hydrated }];
}
