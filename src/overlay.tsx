import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import type { ScanResult } from "./lib/types";

import "@fontsource/jetbrains-mono/400.css";
import "./styles.css";

type Box = { x: number; y: number; w: number; h: number };

function Overlay() {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const busy = useRef(false);

  // Esc cancels without decoding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") getCurrentWindow().close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const down = (e: React.MouseEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
    setBox({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  };

  const move = (e: React.MouseEvent) => {
    if (!start.current) return;
    const x = Math.min(start.current.x, e.clientX);
    const y = Math.min(start.current.y, e.clientY);
    setBox({
      x,
      y,
      w: Math.abs(e.clientX - start.current.x),
      h: Math.abs(e.clientY - start.current.y),
    });
  };

  const up = async () => {
    const b = box;
    start.current = null;
    if (busy.current) return;

    if (b && b.w > 4 && b.h > 4) {
      busy.current = true;
      // Report the selection in PHYSICAL pixels (css x devicePixelRatio), relative
      // to the overlay's top-left. The backend works entirely in physical space.
      const dpr = window.devicePixelRatio || 1;
      try {
        const results = await invoke<ScanResult[]>("capture_region", {
          x: Math.round(b.x * dpr),
          y: Math.round(b.y * dpr),
          w: Math.round(b.w * dpr),
          h: Math.round(b.h * dpr),
        });
        await emit("scan-complete", results);
      } catch {
        // Backend already surfaces failures; just close.
      }
    }
    await getCurrentWindow().close();
  };

  return (
    <div className="overlay" onMouseDown={down} onMouseMove={move} onMouseUp={up}>
      {!box && <div className="dim" />}
      {box && (
        <div className="selection" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
          <span className="dims">
            {Math.round(box.w)} x {Math.round(box.h)}
          </span>
        </div>
      )}
      <div className="help">Drag to select a QR code &middot; Esc to cancel</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("overlay-root") as HTMLElement).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
);
