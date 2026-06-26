//! Screen snip: freeze every monitor up front, show a transparent overlay, then
//! crop from the frozen buffer. Capturing *before* the overlay appears keeps the
//! dimming layer and selection rectangle out of the decoded pixels.
//!
//! Everything here works in PHYSICAL pixels in the virtual-desktop coordinate
//! space. The overlay reports the selection as `css × devicePixelRatio`, which is
//! physical pixels relative to the overlay's top-left. That makes the math
//! correct across mixed-DPI multi-monitor setups (the doc's logical-pixel
//! approach breaks there).

use std::sync::Mutex;

use image::DynamicImage;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use xcap::Monitor;

use crate::decode::{decode_luma, ScanResult};

/// One frozen monitor. `x`/`y` are the monitor's physical origin in the virtual
/// desktop; `image` holds that monitor's physical pixels.
pub struct Frozen {
    pub x: i32,
    pub y: i32,
    pub image: DynamicImage,
}

#[derive(Default)]
pub struct CaptureState(pub Mutex<Vec<Frozen>>);

fn freeze(state: &CaptureState) -> Result<(), String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let mut frozen = Vec::with_capacity(monitors.len());
    for m in monitors {
        // Every xcap getter is Result-wrapped in 0.9.
        let x = m.x().map_err(|e| e.to_string())?;
        let y = m.y().map_err(|e| e.to_string())?;
        let rgba = m.capture_image().map_err(|e| e.to_string())?;
        frozen.push(Frozen {
            x,
            y,
            image: DynamicImage::ImageRgba8(rgba),
        });
    }
    *state.0.lock().unwrap() = frozen;
    Ok(())
}

/// Union of all frozen monitors, in physical pixels: (min_x, min_y, width, height).
fn virtual_bounds(frozen: &[Frozen]) -> Option<(i32, i32, u32, u32)> {
    if frozen.is_empty() {
        return None;
    }
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    for f in frozen {
        min_x = min_x.min(f.x);
        min_y = min_y.min(f.y);
        max_x = max_x.max(f.x + f.image.width() as i32);
        max_y = max_y.max(f.y + f.image.height() as i32);
    }
    Some((min_x, min_y, (max_x - min_x) as u32, (max_y - min_y) as u32))
}

/// Build (or rebuild) the overlay window covering the whole virtual desktop.
/// Must be called from an async context (building a window in a sync command or
/// event handler deadlocks on Windows).
async fn open_overlay(app: &AppHandle) -> Result<(), String> {
    let bounds = {
        let state = app.state::<CaptureState>();
        let frozen = state.0.lock().unwrap();
        virtual_bounds(&frozen) // MutexGuard dropped at end of block, before any await/build
    };
    let (min_x, min_y, w, h) = bounds.ok_or("nothing was captured to snip from")?;

    if let Some(existing) = app.get_webview_window("overlay") {
        let _ = existing.close();
    }

    let overlay = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    // position/inner_size on the builder are LOGICAL; set physical bounds here instead.
    overlay
        .set_position(PhysicalPosition::new(min_x, min_y))
        .map_err(|e| e.to_string())?;
    overlay
        .set_size(PhysicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    overlay.show().map_err(|e| e.to_string())?;
    overlay.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Freeze the screen and open the overlay. Shared by the in-app button, the tray
/// menu, and the global hotkey. `async` so the overlay build is safe on Windows.
#[tauri::command]
pub async fn start_snip(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<CaptureState>();
        freeze(&state)?;
    }
    open_overlay(&app).await
}

/// Crop the frozen buffer to the selection and decode it.
/// `x`/`y`/`w`/`h` are PHYSICAL pixels relative to the overlay's top-left.
#[tauri::command]
pub fn capture_region(
    app: AppHandle,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<Vec<ScanResult>, String> {
    let results = {
        let state = app.state::<CaptureState>();
        let frozen = state.0.lock().unwrap();
        let (min_x, min_y, _, _) =
            virtual_bounds(&frozen).ok_or("nothing was captured to snip from")?;

        // Selection rectangle in absolute physical desktop coordinates.
        let sel_x = min_x + x;
        let sel_y = min_y + y;
        let sel_x2 = sel_x + w as i32;
        let sel_y2 = sel_y + h as i32;

        // Decode every monitor the selection overlaps, then union the results.
        // This handles a selection that crosses a monitor seam or whose origin
        // lands in a layout gap, not just the one under the top-left corner.
        let mut all = Vec::new();
        let mut overlapped = false;
        for f in frozen.iter() {
            let mw = f.image.width() as i32;
            let mh = f.image.height() as i32;
            let ox1 = sel_x.max(f.x);
            let oy1 = sel_y.max(f.y);
            let ox2 = sel_x2.min(f.x + mw);
            let oy2 = sel_y2.min(f.y + mh);
            if ox2 <= ox1 || oy2 <= oy1 {
                continue; // this monitor isn't under the selection
            }
            overlapped = true;
            let crop = f.image.crop_imm(
                (ox1 - f.x) as u32,
                (oy1 - f.y) as u32,
                (ox2 - ox1) as u32,
                (oy2 - oy1) as u32,
            );
            all.extend(decode_luma(crop.to_luma8()));
        }
        if !overlapped {
            return Err("selection is outside any monitor".into());
        }

        // De-dupe identical codes seen on more than one monitor.
        let mut seen = std::collections::HashSet::new();
        all.retain(|r| seen.insert(r.content.clone()));
        all
    };

    // The snip may have been triggered while the main window was hidden (tray /
    // hotkey). Bring it forward so the result is visible.
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }

    Ok(results)
}
