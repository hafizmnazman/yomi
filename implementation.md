# Yomi: Implementation Guide

A desktop QR reader for laptops. Point it at an image or snip a region of your screen, and it pulls the link out and hands it to you, ready to copy or open. Every scan lands in a searchable history.

> `Yomi` is the working name (Japanese 読み, "reading", from 読み取り / *yomitori*, the word for QR scanning). Swap it freely; nothing below depends on it.

---

## 1. What it does

Three entry points, one result surface.

1. **Open an image.** Pick a file from disk (or drag one onto the window). Decode it.
2. **Snip a region.** Press a button or a global hotkey, the screen freezes, you drag a box over the QR, it decodes that crop.
3. **Result.** If a code is found, show the content. URLs get **Copy** and **Open**. Plain text, Wi-Fi configs, contact cards, and the rest get **Copy** plus a type label. If nothing is found, say so plainly: `No QR found in that region`.

Everything that decodes successfully (and optionally everything that fails) is written to a local history list you can re-copy or re-open from later.

---

## 2. Stack

Tauri 2 with a Rust backend and a React + TypeScript frontend on Vite. This matches your Tobira and Mujina setup, so the toolchain and mental model carry over.

The split:

- **Rust** owns the heavy and the native: QR decode, screen capture, region crop, DPI math, content classification. Fast, no WASM blob shipped, decode logic stays in one place.
- **React** owns the surface: the scan view, the result card, the history list, and the selection overlay.
- **Plugins** cover file dialogs, opening URLs, clipboard, persistence, and the global shortcut.

### Crates (`src-tauri/Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tauri-plugin-clipboard-manager = "2"
tauri-plugin-store = "2"
tauri-plugin-global-shortcut = "2"

rqrr = "0.7"          # pure-Rust QR decode
image = "0.25"        # load, convert, crop
xcap = "0.0"          # cross-platform screen capture (pin the exact version, API shifts)
url = "2"             # URL classification
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

> Versions drift. Run `cargo add <crate>` and check the docs.rs page for `xcap` and `rqrr` against whatever resolves, since both have changed method names across minor releases.

### npm

```
@tauri-apps/api
@tauri-apps/plugin-dialog
@tauri-apps/plugin-opener
@tauri-apps/plugin-clipboard-manager
@tauri-apps/plugin-store
@tauri-apps/plugin-global-shortcut
react  react-dom  typescript  vite  @vitejs/plugin-react
```

---

## 3. Project structure

```
yomi/
  src/                       # React frontend
    main.tsx
    App.tsx                  # layout shell, routes idle/result/history
    overlay.tsx              # the snip overlay (separate Tauri window)
    components/
      ScanZone.tsx           # drop target + Open Image / Snip Region buttons
      ResultCard.tsx         # decoded content, Copy / Open, empty + error states
      HistoryList.tsx        # past scans, re-copy / re-open / clear
    lib/
      scan.ts                # invoke wrappers around the Rust commands
      history.ts             # store-backed history read/write
      types.ts               # ScanResult, HistoryEntry
    styles.css
  src-tauri/
    src/
      lib.rs                 # builder, plugin wiring, command registration
      decode.rs              # rqrr decode + content classification
      capture.rs             # xcap freeze + region crop
      tray.rs                # tray menu + global shortcut
    capabilities/
      default.json           # main window permissions
      overlay.json           # overlay window permissions
    tauri.conf.json
    Cargo.toml
  index.html                 # main window entry
  overlay.html               # overlay window entry
```

---

## 4. Core feature: decode

One function does all decoding, whether the bytes come from a file or a screen crop. It returns every code found in the image (a poster can carry several), each tagged with what kind of payload it is.

`src-tauri/src/decode.rs`:

```rust
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ScanResult {
    pub content: String,
    pub kind: String, // "url" | "email" | "phone" | "wifi" | "geo" | "text"
}

/// Decode every QR in a luma image.
pub fn decode_luma(luma: image::GrayImage) -> Vec<ScanResult> {
    let mut prepared = rqrr::PreparedImage::prepare(luma);
    prepared
        .detect_grids()
        .into_iter()
        .filter_map(|grid| grid.decode().ok())
        .map(|(_meta, content)| ScanResult {
            kind: classify(&content),
            content,
        })
        .collect()
}

fn classify(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    if lower.starts_with("wifi:") {
        "wifi".into()
    } else if lower.starts_with("mailto:") {
        "email".into()
    } else if lower.starts_with("tel:") {
        "phone".into()
    } else if lower.starts_with("geo:") {
        "geo".into()
    } else if matches!(url::Url::parse(s).map(|u| u.scheme().to_owned()).as_deref(),
                       Ok("http") | Ok("https")) {
        "url".into()
    } else {
        "text".into()
    }
}

#[tauri::command]
pub fn decode_image_path(path: String) -> Result<Vec<ScanResult>, String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    Ok(decode_luma(img.to_luma8()))
}
```

The frontend wrapper, `src/lib/scan.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ScanResult } from "./types";

export async function scanFromFile(): Promise<ScanResult[] | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }],
  });
  if (typeof path !== "string") return null;
  return invoke<ScanResult[]>("decode_image_path", { path });
}
```

Drag-and-drop uses the same command. Tauri 2 emits a drop event carrying file paths, so you pass the dropped path straight to `decode_image_path` with no extra Rust.

---

## 5. Core feature: snip a region

The interesting one. The trick that makes it feel like the system snipping tool: **freeze first, then select.** Capture the whole screen up front, show that frozen image in a transparent overlay, let the user draw on the still, then crop from the buffer you already hold. This sidesteps two problems at once: the overlay never appears in the capture, and there is no timing race between hiding the UI and taking the shot.

The flow:

```
button / hotkey
   -> freeze_screens()        Rust captures every monitor, holds the buffers in state
   -> open overlay window     transparent, borderless, always-on-top, covers the desktop
   -> overlay shows the frozen shot, dimmed; user drags a rectangle
   -> capture_region(rect)    Rust crops the held buffer, decodes, returns ScanResult[]
   -> close overlay, render result, append to history
```

`src-tauri/src/capture.rs`:

```rust
use std::sync::Mutex;
use image::DynamicImage;
use xcap::Monitor;
use crate::decode::{decode_luma, ScanResult};

pub struct Frozen {
    pub x: i32,
    pub y: i32,
    pub scale: f32,
    pub image: DynamicImage,
}

#[derive(Default)]
pub struct CaptureState(pub Mutex<Vec<Frozen>>);

#[tauri::command]
pub fn freeze_screens(state: tauri::State<CaptureState>) -> Result<(), String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let mut frozen = Vec::new();
    for m in monitors {
        let rgba = m.capture_image().map_err(|e| e.to_string())?;
        frozen.push(Frozen {
            x: m.x(),
            y: m.y(),
            scale: m.scale_factor(),
            image: DynamicImage::ImageRgba8(rgba),
        });
    }
    *state.0.lock().unwrap() = frozen;
    Ok(())
}

/// rect is in logical desktop coordinates, as the overlay reports them.
#[tauri::command]
pub fn capture_region(
    state: tauri::State<CaptureState>,
    x: i32, y: i32, w: u32, h: u32,
) -> Result<Vec<ScanResult>, String> {
    let frozen = state.0.lock().unwrap();

    // Find the monitor that contains the selection origin.
    let mon = frozen
        .iter()
        .find(|m| {
            let mw = (m.image.width() as f32 / m.scale) as i32;
            let mh = (m.image.height() as f32 / m.scale) as i32;
            x >= m.x && y >= m.y && x < m.x + mw && y < m.y + mh
        })
        .ok_or("selection is outside any monitor")?;

    // Logical -> physical pixels, relative to that monitor's origin.
    let s = mon.scale;
    let px = (((x - mon.x) as f32) * s).round() as u32;
    let py = (((y - mon.y) as f32) * s).round() as u32;
    let pw = ((w as f32) * s).round() as u32;
    let ph = ((h as f32) * s).round() as u32;

    let crop = mon.image.crop_imm(px, py, pw, ph);
    Ok(decode_luma(crop.to_luma8()))
}
```

### Opening the overlay window

Create it from Rust so you control its size against the full desktop. For a single monitor, `fullscreen(true)` is enough. For multi-monitor, set the window to the union of all monitor bounds instead.

```rust
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn open_overlay(app: tauri::AppHandle) -> Result<(), String> {
    WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("overlay.html".into()))
        .fullscreen(true)        // single monitor; size to virtual bounds for multi
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

> Transparent windows on macOS need `"app": { "macOSPrivateApi": true }` in `tauri.conf.json`. Windows needs nothing extra.

### The overlay UI

`src/overlay.tsx` is a second React entry. It draws the frozen screenshot full-bleed, dims it, and tracks a drag rectangle that "cuts out" a bright window over the selection. On mouse-up it sends the rectangle to Rust and closes itself.

```tsx
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { useRef, useState } from "react";

type Box = { x: number; y: number; w: number; h: number };

export default function Overlay() {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  const down = (e: React.MouseEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
    setBox({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  };
  const move = (e: React.MouseEvent) => {
    if (!start.current) return;
    const x = Math.min(start.current.x, e.clientX);
    const y = Math.min(start.current.y, e.clientY);
    setBox({ x, y, w: Math.abs(e.clientX - start.current.x), h: Math.abs(e.clientY - start.current.y) });
  };
  const up = async () => {
    if (box && box.w > 4 && box.h > 4) {
      const results = await invoke("capture_region", box);
      await emit("scan-complete", results); // main window listens, renders, saves
    }
    await getCurrentWindow().close();
  };

  return (
    <div className="overlay" onMouseDown={down} onMouseMove={move} onMouseUp={up}>
      <div className="dim" />
      {box && (
        <div className="selection"
             style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
          <span className="dims">{box.w} x {box.h}</span>
        </div>
      )}
    </div>
  );
}
```

`Escape` should cancel: listen for it and call `getCurrentWindow().close()` without emitting.

The main window listens for the result:

```ts
import { listen } from "@tauri-apps/api/event";
listen<ScanResult[]>("scan-complete", (e) => {
  showResults(e.payload);
  saveHistory(e.payload, "region");
});
```

---

## 6. Result handling

`ResultCard.tsx` switches on `kind`:

- **url**: show the link, a **Copy** button, and an **Open** button.
- **email / phone / geo / wifi**: show the parsed value with a small type chip, a **Copy** button, and **Open** where the OS can handle the scheme.
- **text**: show the raw string with **Copy**.
- **empty array**: the no-result state. `No QR found. Try a tighter crop or a sharper image.`
- **multiple results**: stack one card per code.

Open and copy:

```ts
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export const copy = (s: string) => writeText(s);
export const openLink = (s: string) => openUrl(s);
```

Keep the button labels honest through the flow: the button says **Copy**, the toast says **Copied**.

---

## 7. History

A local JSON file via the store plugin. Enough for a list with re-copy and re-open, and you can graduate to SQLite later if you want full-text search or thumbnails at scale.

`src/lib/history.ts`:

```ts
import { load } from "@tauri-apps/plugin-store";
import type { ScanResult } from "./types";

export type HistoryEntry = ScanResult & {
  id: string;
  source: "file" | "region";
  at: number; // epoch ms
};

const file = await load("history.json", { autoSave: true });

export async function saveHistory(results: ScanResult[], source: "file" | "region") {
  const list = (await file.get<HistoryEntry[]>("entries")) ?? [];
  const stamped = results.map((r) => ({
    ...r,
    id: crypto.randomUUID(),
    source,
    at: Date.now(),
  }));
  await file.set("entries", [...stamped, ...list].slice(0, 500)); // cap the list
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return (await file.get<HistoryEntry[]>("entries")) ?? [];
}

export async function clearHistory() {
  await file.set("entries", []);
}
```

`HistoryList.tsx` renders each entry with its content (truncated), a source icon, a relative timestamp, and inline copy/open. Add a search box that filters on `content`, and a **Clear all** action.

**Optional thumbnails:** save the cropped PNG to `appDataDir()/thumbs/<id>.png` after a region scan and store the path on the entry. Skip for v1; it is a clean follow-up.

---

## 8. Tray and global hotkey

This is the part that fixes the original annoyance: a code on your screen and no fast way to read it. Register a shortcut that triggers the snip even when the window is hidden, and put the same actions in a tray menu.

`src-tauri/src/tray.rs` registers the shortcut and a tray menu (Scan region, Open image, Show window, Quit). The shortcut handler calls `freeze_screens` then `open_overlay`, identical to the in-app button.

```rust
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

// inside the builder setup
app.global_shortcut().on_shortcut(
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyQ),
    move |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            // freeze + open overlay
        }
    },
)?;
```

Pick a default that does not collide on your machine and make it user-editable in settings later.

---

## 9. Builder wiring

`src-tauri/src/lib.rs` ties it together:

```rust
mod decode;
mod capture;
mod tray;

use capture::CaptureState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(CaptureState::default())
        .invoke_handler(tauri::generate_handler![
            decode::decode_image_path,
            capture::freeze_screens,
            capture::capture_region,
            capture::open_overlay,
        ])
        .setup(|app| {
            tray::setup(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running yomi");
}
```

The overlay window needs its own entry in `capabilities/` granting `core:window:allow-close`, `core:event:allow-emit`, and the `capture_region` command. Keep its permission set tight, it only selects and closes.

---

## 10. UI direction

A distinct identity that reads as "scanner that reveals", separate from your other projects' palettes.

**Palette**

| Token | Hex | Use |
|-------|-----|-----|
| ink | `#0A2528` | app background |
| ink-raised | `#123E42` | cards, panels |
| jade | `#2ED3A6` | primary actions, the finder mark |
| jade-soft | `#6FEFCB` | hovers, focus rings |
| amber | `#FFB454` | the "revealed" accent, found-link highlight |
| paper | `#E9F7F2` | primary text |
| muted | `#7FA39C` | secondary text, timestamps |

**Type:** a geometric display face for the wordmark and headers (Poppins or Space Grotesk), a clean body face for content and history (Inter), and a mono face for the decoded payload itself (JetBrains Mono), so a raw URL or Wi-Fi string is unmistakable as machine data.

**Layout**

```
+-------------------------------------------------------+
|  yomi                                   [ tray icon ]  |
+----------------------------+--------------------------+
|                            |  History                 |
|     drop an image here     |  - airbnb.com/...  2m     |
|   [ Open Image ] [ Snip ]  |  - WIFI:Office...  1h     |
|                            |  - tel:+60...      3h     |
|     ( result appears       |  [ search ]  [ clear ]    |
|       here as a card )      |                          |
+----------------------------+--------------------------+
```

Main column holds the scan zone and the result card in the same spot, so a scan replaces the prompt in place. History sits in a right rail.

**States, written in the interface's voice**

- idle: `Drop an image, pick one, or snip a region of your screen.`
- scanning: a brief jade scan-line sweep over the zone.
- found: the result card, mono payload, Copy and Open.
- empty: `No QR found. Try a tighter crop or a sharper image.`
- error: `Could not read that file. It may be corrupt or an unsupported format.`

**The signature:** the amber reading-line. It lives in the icon, runs once across the scan zone while decoding, and tints the found-link highlight. One accent, used with intent, quiet everywhere else.

Quality floor: responsive down to a small window, visible keyboard focus, `prefers-reduced-motion` honored (drop the sweep).

---

## 11. Build and package

```bash
# dev
npm install
npm run tauri dev

# release bundles
npm run tauri build
```

Bundle targets come out per platform: MSI and NSIS on Windows, `.dmg` on macOS, AppImage and `.deb` on Linux.

**Icons:** convert `yomi-icon.svg` to a 1024x1024 PNG, then let Tauri generate every platform size:

```bash
npm run tauri icon path/to/yomi-icon.png
```

For distribution, sign on Windows and notarize on macOS. Skip while it is yours alone.

---

## 12. Phased roadmap

Built to slice cleanly into commits, so the contribution graph fills as the app grows.

- **Phase 0, scaffold.** `create-tauri-app`, wire the plugins, window shell, the palette and type set. App opens to the idle state.
- **Phase 1, file scan.** `decode_image_path`, the Open Image button, drag-and-drop, the result card with Copy and Open. The smallest end-to-end slice, and the one that already solves your problem.
- **Phase 2, history.** Store plugin, the history rail, search, clear all.
- **Phase 3, snip.** The meaty phase, worth splitting:
  - 3a: overlay window and selection UI against a frozen still.
  - 3b: `freeze_screens` and `capture_region`, single monitor.
  - 3c: DPI scaling and multi-monitor, the case that takes the real time.
- **Phase 4, tray and hotkey.** Global shortcut, tray menu, snip-from-anywhere.
- **Phase 5, polish.** Special payload types (Wi-Fi, vCard, geo), multiple-QR handling, settings (editable hotkey, save-failed-scans toggle), thumbnails, the scan-line animation, accessibility pass.

---

## 13. Known gotchas

- **DPI scaling.** The overlay reports logical pixels, `xcap` captures physical pixels. Multiply by `scale_factor()` before cropping or your selection lands shifted and the wrong size. This is the single most likely source of "it decodes the wrong area" bugs.
- **Multi-monitor coordinates.** Monitors live in one virtual coordinate space with offsets that can be negative. Find the monitor containing the selection origin, then translate relative to that monitor's own origin. A selection that spans two monitors is a Phase 5 problem, not a Phase 3 one.
- **macOS Screen Recording permission.** First capture prompts the user to grant it in System Settings. Detect a failed or blank capture and point them there.
- **Linux Wayland.** Screen capture goes through a portal and is restricted compared to X11. Check `xcap`'s current Wayland support before committing to Linux as a first-class target.
- **rqrr needs resolution.** Tiny or blurry codes fail to decode. The freeze-and-crop flow helps because the user frames the code tightly. If a full-screen image misses, a tighter crop usually reads.
- **Do not capture the overlay.** Freezing the screen before the overlay appears is what keeps the dimming layer and selection rectangle out of the decoded pixels. Capture first, then show.
- **Store autosave.** With `autoSave: true` the JSON writes on every `set`. Cap the entry count so the file does not grow without bound.

---

## 14. Tests worth writing

A couple of LLM-free unit tests, in the style you already keep:

- `classify()`: feed known strings (an `https` URL, a `WIFI:` block, a `mailto:`, plain text) and assert the kind.
- `decode_luma()`: drop a few known-good QR PNGs in `src-tauri/tests/fixtures/`, decode, assert the exact payload. Add one deliberately blurry fixture and assert it returns empty rather than panicking.

---

## 15. Stretch ideas

- Batch-scan a folder of images.
- Generate a QR from text or a URL (the reverse direction).
- Webcam scan for the rare case you do have a camera.
- Export history to CSV.
- A "decode from clipboard" hotkey, since `Win+Shift+S` already lands a snip on the clipboard as an image.
