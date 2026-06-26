import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import type { HistoryEntry, ScanResult, ScanSource, Settings } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import {
  decodeFromClipboard,
  decodeImagePath,
  decodeImagePaths,
  pickFolder,
  pickImage,
  scanFolderPath,
  startSnip,
  baseName,
  isImagePath,
  type FileScan,
} from "./lib/scan";
import {
  getHistory,
  saveHistory,
  saveHistoryBatch,
  deleteHistory,
  clearHistory,
} from "./lib/history";
import { getSettings, saveSettings, applySavedHotkey } from "./lib/settings";
import { copy, openPayload, exportCsv } from "./lib/actions";

import ScanZone from "./components/ScanZone";
import ResultView, { type ScanStatus } from "./components/ResultView";
import HistoryList from "./components/HistoryList";
import SettingsModal from "./components/SettingsModal";
import QrModal from "./components/QrModal";
import { SettingsIcon, QrIcon } from "./components/icons";

const NO_QR: ScanResult = { content: "(no QR found)", kind: "text" };

function humanError(e: unknown): string {
  const s = String(e);
  if (/clipboard/i.test(s)) return "No image on the clipboard, or it isn't a picture.";
  if (/decode|format|corrupt|unsupported|open|image/i.test(s))
    return "Could not read that file. It may be corrupt or an unsupported format.";
  return s;
}

export default function App() {
  const [results, setResults] = useState<ScanResult[] | null>(null);
  const [batch, setBatch] = useState<FileScan[] | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [search, setSearch] = useState("");

  const [dragging, setDragging] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const [reduceMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );

  // Refs so listener closures always see the latest values without re-subscribing.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const toastTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 1600);
  }, []);

  // Apply a finished list of single-surface results (file / clipboard / region).
  const applyResults = useCallback(
    async (res: ScanResult[], source: ScanSource, fileName?: string) => {
      setBatch(null);
      setResults(res);
      setStatus("idle");
      if (res.length) {
        setHistory(await saveHistory(res, source, fileName));
      } else if (settingsRef.current.saveFailedScans) {
        setHistory(await saveHistory([NO_QR], source, fileName));
      }
    },
    [],
  );

  const runScan = useCallback(
    async (work: Promise<ScanResult[]>, source: ScanSource, fileName?: string) => {
      setBatch(null);
      setResults(null);
      setError(null);
      setStatus("scanning");
      try {
        await applyResults(await work, source, fileName);
      } catch (e) {
        setStatus("error");
        setError(humanError(e));
      }
    },
    [applyResults],
  );

  const doOpenImage = useCallback(async () => {
    const p = await pickImage();
    if (p) runScan(decodeImagePath(p), "file", baseName(p));
  }, [runScan]);

  const doClipboard = useCallback(() => {
    runScan(decodeFromClipboard(), "clipboard");
  }, [runScan]);

  const doSnip = useCallback(() => {
    startSnip().catch((e) => {
      setStatus("error");
      setError(humanError(e));
    });
  }, []);

  const doBatch = useCallback(async () => {
    const dir = await pickFolder();
    if (!dir) return;
    setResults(null);
    setBatch(null);
    setError(null);
    setStatus("scanning");
    try {
      const scans = await scanFolderPath(dir);
      setBatch(scans);
      setStatus("idle");
      const withCodes = scans.filter((f) => f.results.length > 0);
      if (withCodes.length) setHistory(await saveHistoryBatch(withCodes, "batch"));
    } catch (e) {
      setStatus("error");
      setError(humanError(e));
    }
  }, []);

  const onCopy = useCallback(
    (s: string) => {
      copy(s).then(() => toast("Copied"));
    },
    [toast],
  );

  const onOpen = useCallback((r: ScanResult) => {
    openPayload(r.content, r.kind).catch(() => {});
  }, []);

  const onDelete = useCallback((id: string) => {
    deleteHistory(id).then(setHistory);
  }, []);

  const onClear = useCallback(() => {
    clearHistory().then(() => setHistory([]));
  }, []);

  const onExport = useCallback(() => {
    exportCsv(history).then((ok) => ok && toast("Exported"));
  }, [history, toast]);

  const onSaveSettings = useCallback(
    async (next: Settings) => {
      try {
        await saveSettings(next);
        setSettings(next);
        setSettingsOpen(false);
        toast("Saved");
      } catch (e) {
        setError(humanError(e));
        setSettingsOpen(false);
      }
    },
    [toast],
  );

  // Handle an OS file drop.
  const handleDrop = useCallback(
    (paths: string[]) => {
      const images = paths.filter(isImagePath);
      if (images.length === 0) {
        setStatus("error");
        setError("That wasn't an image file.");
        return;
      }
      if (images.length === 1) {
        runScan(decodeImagePath(images[0]), "file", baseName(images[0]));
        return;
      }
      setResults(null);
      setError(null);
      setStatus("scanning");
      decodeImagePaths(images)
        .then(async (scans) => {
          setBatch(scans);
          setStatus("idle");
          const withCodes = scans.filter((f) => f.results.length > 0);
          if (withCodes.length) setHistory(await saveHistoryBatch(withCodes, "batch"));
        })
        .catch((e) => {
          setStatus("error");
          setError(humanError(e));
        });
    },
    [runScan],
  );

  // Initial load.
  useEffect(() => {
    getHistory().then(setHistory).catch(() => {});
    getSettings()
      .then((s) => {
        setSettings(s);
        return applySavedHotkey();
      })
      .catch(() => {});
  }, []);

  // Event wiring: region results, tray menu actions, and OS drag-and-drop.
  useEffect(() => {
    let active = true;
    let unlistens: UnlistenFn[] = [];
    (async () => {
      const subs = await Promise.all([
        listen<ScanResult[]>("scan-complete", (e) => applyResults(e.payload, "region")),
        listen("menu-open-image", () => doOpenImage()),
        listen("menu-decode-clipboard", () => doClipboard()),
        getCurrentWebview().onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "enter" || p.type === "over") setDragging(true);
          else if (p.type === "leave") setDragging(false);
          else if (p.type === "drop") {
            setDragging(false);
            handleDrop(p.paths);
          }
        }),
      ]);
      if (!active) subs.forEach((u) => u());
      else unlistens = subs;
    })();
    return () => {
      active = false;
      unlistens.forEach((u) => u());
    };
  }, [applyResults, doOpenImage, doClipboard, handleDrop]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <img className="mark" src="/yomi-icon.svg" alt="" />
          yomi
        </div>
        <div className="topbar-actions">
          <button className="btn-icon" title="Generate a QR code" onClick={() => setQrOpen(true)}>
            <QrIcon />
          </button>
          <button className="btn-icon" title="Settings" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div className="layout">
        <div className="main-col">
          <ScanZone
            dragging={dragging}
            scanning={status === "scanning"}
            reduceMotion={reduceMotion}
            onOpenImage={doOpenImage}
            onSnip={doSnip}
            onClipboard={doClipboard}
            onBatch={doBatch}
          />
          <ResultView
            status={status}
            error={error}
            results={results}
            batch={batch}
            onCopy={onCopy}
            onOpen={onOpen}
          />
        </div>

        <HistoryList
          entries={history}
          search={search}
          onSearch={setSearch}
          onCopy={onCopy}
          onOpen={onOpen}
          onDelete={onDelete}
          onClear={onClear}
          onExport={onExport}
        />
      </div>

      {toastMsg && <div className="toast">{toastMsg}</div>}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={onSaveSettings}
        />
      )}
      {qrOpen && <QrModal onClose={() => setQrOpen(false)} onToast={toast} />}
    </div>
  );
}
