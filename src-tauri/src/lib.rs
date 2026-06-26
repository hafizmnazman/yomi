mod capture;
mod decode;
mod tray;

use capture::CaptureState;

const DEFAULT_HOTKEY: &str = "Ctrl+Shift+Q";

/// Write UTF-8 text to a path the user chose via a save dialog (used by CSV export).
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Write raw bytes to a path the user chose (used to save a generated QR PNG).
#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(CaptureState::default())
        .invoke_handler(tauri::generate_handler![
            decode::decode_image_path,
            decode::decode_image_paths,
            decode::scan_folder,
            decode::decode_from_clipboard,
            decode::generate_qr,
            capture::start_snip,
            capture::capture_region,
            tray::set_hotkey,
            write_file,
            write_file_bytes,
        ])
        .on_window_event(|window, event| {
            // Closing the main window hides it to the tray instead of quitting, so
            // the global hotkey and tray stay live. "Quit" in the tray menu exits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle();
            tray::setup(handle)?;
            // A bad saved/default accelerator should not stop the app from launching.
            if let Err(e) = tray::register_hotkey(handle, DEFAULT_HOTKEY) {
                eprintln!("could not register default hotkey: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running yomi");
}
