"use client";

export type EnvProfileId = "dotenv" | "compose";
export type FormatId = "env" | "json";

export type ShareStateV1 = {
  v: 1;
  left: string;
  right: string;

  ui: {
    // ✅ format + parsing
    format: FormatId;
    envProfile: EnvProfileId;

    // ✅ core controls
    query: string;
    showChanged: boolean;
    showAdded: boolean;
    showRemoved: boolean;
    showFindings: boolean;

    sevHigh: boolean;
    sevMed: boolean;
    sevLow: boolean;

    maskValues: boolean;
    secretsOnly: boolean;

    rowLimit: number;
    sortMode: "key_asc" | "key_desc" | "severity_desc" | "none";

    // ✅ Option A: "More" collapsible
    showMore: boolean;
  };
};

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeShareState(state: ShareStateV1): string {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  return base64UrlEncode(bytes);
}

export function decodeShareState(encoded: string): ShareStateV1 | null {
  try {
    const bytes = base64UrlDecode(encoded);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as ShareStateV1;

    if (!parsed || parsed.v !== 1) return null;
    if (typeof parsed.left !== "string" || typeof parsed.right !== "string") return null;
    if (!parsed.ui) return null;

    // Backward-compatible defaults for any missing fields
    const ui: any = parsed.ui;

    if (ui.format !== "env" && ui.format !== "json") ui.format = "env";
    if (ui.envProfile !== "dotenv" && ui.envProfile !== "compose") ui.envProfile = "dotenv";
    if (typeof ui.showMore !== "boolean") ui.showMore = false;

    // Basic sanity for known booleans/numbers
    const boolKeys = [
      "showChanged",
      "showAdded",
      "showRemoved",
      "showFindings",
      "sevHigh",
      "sevMed",
      "sevLow",
      "maskValues",
      "secretsOnly",
    ];
    for (const k of boolKeys) if (typeof ui[k] !== "boolean") ui[k] = true;

    if (!Number.isFinite(ui.rowLimit)) ui.rowLimit = 500;
    if (!["key_asc", "key_desc", "severity_desc", "none"].includes(ui.sortMode)) ui.sortMode = "none";
    if (typeof ui.query !== "string") ui.query = "";

    return parsed;
  } catch {
    return null;
  }
}
