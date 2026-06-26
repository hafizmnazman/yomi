import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ScanResult } from "./types";

export interface FileScan {
  path: string;
  fileName: string;
  results: ScanResult[];
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

export function decodeImagePath(path: string): Promise<ScanResult[]> {
  return invoke<ScanResult[]>("decode_image_path", { path });
}

export function decodeImagePaths(paths: string[]): Promise<FileScan[]> {
  return invoke<FileScan[]>("decode_image_paths", { paths });
}

export function scanFolderPath(dir: string): Promise<FileScan[]> {
  return invoke<FileScan[]>("scan_folder", { dir });
}

export function decodeFromClipboard(): Promise<ScanResult[]> {
  return invoke<ScanResult[]>("decode_from_clipboard");
}

/** Start the screen snip. The overlay window takes over and emits `scan-complete`. */
export function startSnip(): Promise<void> {
  return invoke("start_snip");
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTS.includes(ext);
}

/** Open a single image file picker. Returns the chosen path, or null if cancelled. */
export async function pickImage(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    title: "Choose an image",
    filters: [{ name: "Images", extensions: IMAGE_EXTS }],
  });
  return typeof selected === "string" ? selected : null;
}

/** Pick a folder for batch scanning. */
export async function pickFolder(): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false, title: "Choose a folder to scan" });
  return typeof dir === "string" ? dir : null;
}
