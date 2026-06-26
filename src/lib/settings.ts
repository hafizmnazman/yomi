import { load, type Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS, type Settings } from "./types";

let storePromise: Promise<Store> | null = null;
function store(): Promise<Store> {
  return (storePromise ??= load("settings.json", { autoSave: true, defaults: {} }));
}

export async function getSettings(): Promise<Settings> {
  const s = await store();
  const saved = (await s.get<Partial<Settings>>("settings")) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const s = await store();
  await s.set("settings", settings);
  // Push the hotkey to the backend, which (re)registers it with the OS.
  await invoke("set_hotkey", { accel: settings.hotkey });
}

/** Apply the saved hotkey on startup (the backend registers a default too). */
export async function applySavedHotkey(): Promise<void> {
  const { hotkey } = await getSettings();
  try {
    await invoke("set_hotkey", { accel: hotkey });
  } catch {
    // ignore; the backend's default stays registered
  }
}
