//! QR decoding + payload classification, plus QR *generation* (stretch).
//! One decode path (`decode_luma`) serves file scans, folder/batch scans,
//! screen-region crops, and clipboard images.

use std::collections::HashSet;
use std::io::Cursor;
use std::path::Path;

use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, GrayImage, ImageEncoder, Luma};
use qrcode::{Color, EcLevel, QrCode};
use rqrr::PreparedImage;
use serde::Serialize;
use tauri_plugin_clipboard_manager::ClipboardExt;

const IMAGE_EXTS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

#[derive(Serialize, Clone)]
pub struct ScanResult {
    pub content: String,
    pub kind: String, // "url" | "email" | "phone" | "sms" | "wifi" | "geo" | "vcard" | "text"
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")] // so `file_name` reaches the frontend as `fileName`
pub struct FileScan {
    pub path: String,
    pub file_name: String,
    pub results: Vec<ScanResult>,
}

/// Tag a decoded payload by what kind of thing it is.
pub fn classify(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    if lower.starts_with("wifi:") {
        "wifi".into()
    } else if lower.starts_with("mailto:") {
        "email".into()
    } else if lower.starts_with("tel:") {
        "phone".into()
    } else if lower.starts_with("sms:") || lower.starts_with("smsto:") {
        "sms".into()
    } else if lower.starts_with("geo:") {
        "geo".into()
    } else if lower.starts_with("begin:vcard") {
        "vcard".into()
    } else if matches!(
        url::Url::parse(s).map(|u| u.scheme().to_owned()).as_deref(),
        Ok("http") | Ok("https")
    ) {
        "url".into()
    } else {
        "text".into()
    }
}

/// Decode every distinct QR code in a grayscale image.
///
/// `image::GrayImage` works directly: rqrr 0.7 depends on image "0.25", the same
/// crate the app uses, so the buffer type unifies (verified against the source).
pub fn decode_luma(luma: GrayImage) -> Vec<ScanResult> {
    // `prepare` takes the buffer by value; the binding must be `mut` for `detect_grids(&mut self)`.
    let mut prepared = PreparedImage::prepare(luma);
    let mut seen = HashSet::new();
    prepared
        .detect_grids()
        .into_iter()
        .filter_map(|grid| grid.decode().ok()) // Result<(MetaData, String), rqrr::DeQRError>
        .filter(|(_, content)| seen.insert(content.clone())) // a poster can carry the same code twice
        .map(|(_meta, content)| ScanResult {
            kind: classify(&content),
            content,
        })
        .collect()
}

fn decode_path(path: &Path) -> Vec<ScanResult> {
    image::open(path)
        .map(|img| decode_luma(img.to_luma8()))
        .unwrap_or_default()
}

// ---------- Commands ----------

#[tauri::command]
pub fn decode_image_path(path: String) -> Result<Vec<ScanResult>, String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    Ok(decode_luma(img.to_luma8()))
}

/// Decode an explicit list of image files (multi-select batch).
#[tauri::command]
pub fn decode_image_paths(paths: Vec<String>) -> Vec<FileScan> {
    paths
        .into_iter()
        .map(|p| {
            let path = Path::new(&p);
            FileScan {
                file_name: file_name_of(path, &p),
                results: decode_path(path),
                path: p,
            }
        })
        .collect()
}

/// Decode every image directly inside a folder (non-recursive batch).
#[tauri::command]
pub fn scan_folder(dir: String) -> Result<Vec<FileScan>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_image = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if !is_image {
            continue;
        }
        let p = path.to_string_lossy().into_owned();
        out.push(FileScan {
            file_name: file_name_of(&path, &p),
            results: decode_path(&path),
            path: p,
        });
    }
    out.sort_by(|a, b| a.file_name.to_lowercase().cmp(&b.file_name.to_lowercase()));
    Ok(out)
}

/// Decode a QR from the image currently on the clipboard (stretch).
/// `async` so it runs off the main thread (the clipboard read can deadlock there).
#[tauri::command]
pub async fn decode_from_clipboard(app: tauri::AppHandle) -> Result<Vec<ScanResult>, String> {
    let img = app.clipboard().read_image().map_err(|e| e.to_string())?;
    let (w, h) = (img.width(), img.height());
    // `img.rgba()` borrows from `img`; copy it out immediately.
    let rgba = image::RgbaImage::from_raw(w, h, img.rgba().to_vec())
        .ok_or("clipboard image buffer does not match its dimensions")?;
    Ok(decode_luma(image::DynamicImage::ImageRgba8(rgba).into_luma8()))
}

/// Generate a QR PNG (bytes) for arbitrary text/URL (stretch, the reverse direction).
#[tauri::command]
pub fn generate_qr(content: String) -> Result<Vec<u8>, String> {
    if content.trim().is_empty() {
        return Err("Enter text or a URL to encode".into());
    }
    generate_qr_png(&content)
}

fn file_name_of(path: &Path, fallback: &str) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| fallback.to_owned())
}

/// Build a QR PNG using only the app's `image` crate, so it is version-safe
/// regardless of what `image` version qrcode pulls.
pub fn generate_qr_png(content: &str) -> Result<Vec<u8>, String> {
    let code = QrCode::with_error_correction_level(content.as_bytes(), EcLevel::M)
        .map_err(|e| format!("could not encode that content: {e}"))?;

    let modules = code.to_colors(); // row-major, len == w*w, NO quiet zone
    let w = code.width();

    let quiet = 4usize; // standard quiet-zone border, in modules
    let scale = 8u32; // pixels per module
    let side = (w + 2 * quiet) as u32 * scale;

    let img: GrayImage = GrayImage::from_fn(side, side, |x, y| {
        let mx = (x / scale) as usize;
        let my = (y / scale) as usize;
        if mx < quiet || my < quiet || mx >= quiet + w || my >= quiet + w {
            return Luma([255]); // quiet-zone border = white
        }
        if modules[(my - quiet) * w + (mx - quiet)] == Color::Light {
            Luma([255])
        } else {
            Luma([0])
        }
    });

    let mut buf: Vec<u8> = Vec::new();
    PngEncoder::new(Cursor::new(&mut buf))
        .write_image(img.as_raw(), img.width(), img.height(), ExtendedColorType::L8)
        .map_err(|e| format!("could not encode PNG: {e}"))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_kinds() {
        assert_eq!(classify("https://example.com"), "url");
        assert_eq!(classify("HTTP://X.IO/path"), "url");
        assert_eq!(classify("WIFI:T:WPA;S:Net;P:pw;;"), "wifi");
        assert_eq!(classify("mailto:a@b.com"), "email");
        assert_eq!(classify("tel:+60123456"), "phone");
        assert_eq!(classify("smsto:123:hello"), "sms");
        assert_eq!(classify("sms:+15551234"), "sms");
        assert_eq!(classify("geo:1.23,4.56"), "geo");
        assert_eq!(classify("BEGIN:VCARD\nFN:John\nEND:VCARD"), "vcard");
        assert_eq!(classify("just some text"), "text");
        assert_eq!(classify("ftp://host/file"), "text"); // non-http scheme is not a "url"
    }

    #[test]
    fn qr_generate_then_decode_roundtrips() {
        // generate_qr_png doubles as our decode fixture: encode, then decode back.
        let png = generate_qr_png("https://yomi.test/abc").unwrap();
        let img = image::load_from_memory(&png).unwrap();
        let results = decode_luma(img.to_luma8());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].content, "https://yomi.test/abc");
        assert_eq!(results[0].kind, "url");
    }

    #[test]
    fn blank_image_returns_empty_not_panic() {
        let blank = GrayImage::from_pixel(96, 96, Luma([255]));
        assert!(decode_luma(blank).is_empty());
    }
}
