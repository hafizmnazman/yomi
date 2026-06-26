// Shared types. Kept in lock-step with the Rust `ScanResult` (see src-tauri/src/decode.rs).

export type ScanKind =
  | "url"
  | "email"
  | "phone"
  | "sms"
  | "wifi"
  | "geo"
  | "vcard"
  | "text";

export interface ScanResult {
  content: string;
  kind: ScanKind;
}

export type ScanSource = "file" | "region" | "clipboard" | "batch";

export interface HistoryEntry extends ScanResult {
  id: string;
  source: ScanSource;
  at: number; // epoch ms
  fileName?: string; // present for file / batch scans
}

export interface Settings {
  hotkey: string; // accelerator string, e.g. "Ctrl+Shift+Q"
  saveFailedScans: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  hotkey: "Ctrl+Shift+Q",
  saveFailedScans: false,
};
