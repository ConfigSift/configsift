"use client";

import { useState } from "react";

type Side = "left" | "right";

export function useEditorIO(opts: {
  setLeftDraft: (v: string) => void;
  setRightDraft: (v: string) => void;
}) {
  const { setLeftDraft, setRightDraft } = opts;

  const [pasteErr, setPasteErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  const pasteFromClipboard = async (side: Side) => {
    setPasteErr(null);
    try {
      if (!navigator.clipboard?.readText) {
        setPasteErr("Clipboard API not available (requires HTTPS or localhost).");
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text) {
        setPasteErr("Clipboard is empty.");
        return;
      }
      if (side === "left") setLeftDraft(text);
      else setRightDraft(text);
    } catch (e: any) {
      setPasteErr(e?.message ?? "Paste failed (clipboard permission).");
    }
  };

  const readFile = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(file);
    });
  };

  const onPickFile = async (side: Side, file?: File | null) => {
    if (!file) return;
    const text = await readFile(file);
    if (side === "left") setLeftDraft(text);
    else setRightDraft(text);
  };

  const onDrop = async (side: Side, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver((d) => ({ ...d, [side]: false }));

    const file = e.dataTransfer.files?.[0];
    await onPickFile(side, file);
  };

  const onDragOver = (side: Side, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver[side]) setDragOver((d) => ({ ...d, [side]: true }));
  };

  const onDragLeave = (side: Side, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver((d) => ({ ...d, [side]: false }));
  };

  return {
    pasteErr,
    setPasteErr,
    dragOver,
    pasteFromClipboard,
    readFile,
    onPickFile,
    onDrop,
    onDragOver,
    onDragLeave,
  };
}
