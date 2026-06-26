import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { HistoryEntry, ScanKind } from "./types";
import { parseGeo } from "./format";

export const copy = (s: string): Promise<void> => writeText(s);

/** Open a decoded payload with the OS default handler. */
export function openPayload(content: string, kind: ScanKind): Promise<void> {
  if (kind === "geo") {
    const g = parseGeo(content);
    if (g) return openUrl(`https://www.google.com/maps?q=${g.lat},${g.lng}`);
  }
  // url, mailto:, tel:, sms: are handed straight to the OS.
  return openUrl(content);
}

function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** Export history to a CSV the user names via a save dialog. Returns false if cancelled. */
export async function exportCsv(entries: HistoryEntry[]): Promise<boolean> {
  const path = await save({
    title: "Export history as CSV",
    defaultPath: "yomi-history.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;
  const header = "time,kind,source,file,content";
  const rows = entries.map((e) =>
    [
      new Date(e.at).toISOString(),
      e.kind,
      e.source,
      csvCell(e.fileName ?? ""),
      csvCell(e.content),
    ].join(","),
  );
  await invoke("write_file", { path, contents: [header, ...rows].join("\n") + "\n" });
  return true;
}

/** Generate a QR PNG for `content`; returns its raw bytes and an object URL for preview. */
export async function generateQr(content: string): Promise<{ bytes: number[]; url: string }> {
  const bytes = await invoke<number[]>("generate_qr", { content });
  const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
  return { bytes, url: URL.createObjectURL(blob) };
}

/** Save previously generated QR bytes to a PNG the user names. Returns false if cancelled. */
export async function saveQrPng(bytes: number[]): Promise<boolean> {
  const path = await save({
    title: "Save QR code",
    defaultPath: "qr.png",
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!path) return false;
  await invoke("write_file_bytes", { path, bytes });
  return true;
}
