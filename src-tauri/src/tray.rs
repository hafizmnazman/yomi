//! Tray icon, its menu, and the global hotkey. All three (tray "Scan region",
//! the hotkey, and the in-app button) funnel into the same snip flow.

use std::str::FromStr;

use tauri::menu::{MenuBuilder, MenuEvent};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Build the tray icon + menu. Call from `.setup()`.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("scan_region", "Scan region")
        .text("open_image", "Open image...")
        .text("decode_clipboard", "Decode from clipboard")
        .text("show", "Show window")
        .separator()
        .text("quit", "Quit")
        .build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("a default window icon is configured in tauri.conf.json bundle.icon");

    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("Yomi")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event: MenuEvent| match event.id().as_ref() {
            "scan_region" => trigger_snip(app),
            "open_image" => {
                let _ = app.emit("menu-open-image", ());
                show_main(app);
            }
            "decode_clipboard" => {
                let _ = app.emit("menu-decode-clipboard", ());
                show_main(app);
            }
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event: TrayIconEvent| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    // Keep the tray alive for the app's lifetime (dropping the last handle removes it).
    app.manage(tray);
    Ok(())
}

/// (Re)register the global hotkey. Unregisters any previous binding first so the
/// settings screen can change it at runtime.
pub fn register_hotkey(app: &AppHandle, accel: &str) -> Result<(), String> {
    let shortcut = Shortcut::from_str(accel).map_err(|e| format!("invalid shortcut: {e}"))?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.on_shortcut(shortcut, |app, _shortcut, event| {
        // The handler fires on both press and release; only act on press.
        if event.state() == ShortcutState::Pressed {
            trigger_snip(app);
        }
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_hotkey(app: AppHandle, accel: String) -> Result<(), String> {
    register_hotkey(&app, &accel)
}

/// Freeze + open overlay from a sync context. The window build must not run on
/// the main thread on Windows, so spawn it onto the async runtime.
fn trigger_snip(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::capture::start_snip(app).await;
    });
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}
