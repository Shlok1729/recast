use std::io::Cursor;
use std::sync::Mutex;
use std::process::{Command, Child};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use serde::{Deserialize, Serialize};
use xcap::{Monitor, Window};
use image::codecs::png::PngEncoder;
use image::{ImageEncoder, ColorType};
use base64::{Engine as _, engine::general_purpose};

const THUMBNAIL_WIDTH: u32 = 320;
const THUMBNAIL_HEIGHT: u32 = 180;

#[derive(Serialize, Clone)]
pub struct DisplayInfo {
    id: u32,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
    thumbnail: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct WindowInfo {
    id: u32,
    pid: u32,
    app_name: String,
    title: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_minimized: bool,
    thumbnail: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct RecordingEntry {
    filename: String,
    path: String,
    size_bytes: u64,
    created: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct AppConfig {
    output_dir: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self { output_dir: None }
    }
}

struct AppState {
    recording_process: Mutex<Option<Child>>,
    last_file_path: Mutex<Option<String>>,
    config: Mutex<AppConfig>,
}

fn config_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| env::temp_dir()).join("trace_config.json")
}

fn load_config(app: &AppHandle) -> AppConfig {
    let path = config_path(app);
    if let Ok(data) = fs::read_to_string(&path) {
        if let Ok(config) = serde_json::from_str(&data) {
            return config;
        }
    }
    AppConfig::default()
}

fn save_config(app: &AppHandle, config: &AppConfig) {
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(data) = serde_json::to_string_pretty(config) {
        let _ = fs::write(path, data);
    }
}

fn get_active_output_dir(state: &State<'_, AppState>) -> PathBuf {
    let config = state.config.lock().unwrap();
    if let Some(ref dir) = config.output_dir {
        PathBuf::from(dir)
    } else {
        env::temp_dir()
    }
}

fn make_thumbnail(img: &image::RgbaImage) -> image::RgbaImage {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return image::RgbaImage::from_pixel(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, image::Rgba([0, 0, 0, 255]));
    }
    let scale = (THUMBNAIL_WIDTH as f32 / w as f32).min(THUMBNAIL_HEIGHT as f32 / h as f32).max(f32::MIN_POSITIVE);
    let scaled_w = (w as f32 * scale).round().clamp(1.0, THUMBNAIL_WIDTH as f32) as u32;
    let scaled_h = (h as f32 * scale).round().clamp(1.0, THUMBNAIL_HEIGHT as f32) as u32;
    let resized = image::imageops::resize(img, scaled_w, scaled_h, image::imageops::FilterType::Triangle);
    let mut canvas = image::RgbaImage::from_pixel(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, image::Rgba([18, 18, 20, 255]));
    let ox = (THUMBNAIL_WIDTH - scaled_w) / 2;
    let oy = (THUMBNAIL_HEIGHT - scaled_h) / 2;
    image::imageops::overlay(&mut canvas, &resized, ox as i64, oy as i64);
    canvas
}

fn encode_thumbnail_base64(img: &image::RgbaImage) -> Option<String> {
    let mut buf = Cursor::new(Vec::new());
    let enc = PngEncoder::new(&mut buf);
    enc.write_image(img.as_raw(), img.width(), img.height(), ColorType::Rgba8.into()).ok()?;
    let b64 = general_purpose::STANDARD.encode(buf.into_inner());
    Some(format!("data:image/png;base64,{}", b64))
}

fn capture_monitor_thumbnail(m: &Monitor) -> Option<String> {
    let shot = m.capture_image().ok()?;
    encode_thumbnail_base64(&make_thumbnail(&shot))
}

fn capture_window_thumbnail(w: &Window) -> Option<String> {
    let shot = w.capture_image().ok()?;
    encode_thumbnail_base64(&make_thumbnail(&shot))
}

#[tauri::command]
fn get_output_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(get_active_output_dir(&state).to_string_lossy().to_string())
}

#[tauri::command]
fn set_output_dir(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("Directory does not exist".into());
    }
    let mut config = state.config.lock().unwrap();
    config.output_dir = Some(path);
    save_config(&app, &config);
    Ok(())
}

#[tauri::command]
fn get_displays() -> Result<Vec<DisplayInfo>, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    Ok(monitors.iter().map(|m| {
        let thumbnail = capture_monitor_thumbnail(m);
        DisplayInfo {
            id: m.id().unwrap_or_default(),
            name: m.name().unwrap_or_default(),
            x: m.x().unwrap_or_default(),
            y: m.y().unwrap_or_default(),
            width: m.width().unwrap_or_default(),
            height: m.height().unwrap_or_default(),
            is_primary: m.is_primary().unwrap_or_default(),
            thumbnail,
        }
    }).collect())
}

#[tauri::command]
fn get_windows() -> Result<Vec<WindowInfo>, String> {
    let windows = Window::all().map_err(|e| e.to_string())?;
    Ok(windows.iter().filter(|w| {
        let minimized = w.is_minimized().unwrap_or(false);
        let title = w.title().unwrap_or_default();
        !minimized && !title.is_empty()
    }).map(|w| {
        let thumbnail = capture_window_thumbnail(w);
        WindowInfo {
            id: w.id().unwrap_or_default(),
            pid: w.pid().unwrap_or_default(),
            app_name: w.app_name().unwrap_or_default(),
            title: w.title().unwrap_or_default(),
            x: w.x().unwrap_or_default(),
            y: w.y().unwrap_or_default(),
            width: w.width().unwrap_or_default(),
            height: w.height().unwrap_or_default(),
            is_minimized: w.is_minimized().unwrap_or_default(),
            thumbnail,
        }
    }).collect())
}

#[tauri::command]
fn start_recording(target_type: String, target_id: u32, state: State<'_, AppState>) -> Result<(), String> {
    let mut process_guard = state.recording_process.lock().unwrap();
    if process_guard.is_some() {
        return Err("Already recording".into());
    }

    let out_dir = get_active_output_dir(&state);
    let file_path = out_dir.join(format!(
        "trace_recording_{}.mp4",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    ));
    let file_path_str = file_path.to_string_lossy().to_string();

    let mut args = vec![
        "-y".to_string(),
        "-f".to_string(), "gdigrab".to_string(),
        "-framerate".to_string(), "30".to_string(),
    ];

    if target_type == "window" {
        let windows = Window::all().map_err(|e| e.to_string())?;
        let window = windows.iter().find(|w| w.id().unwrap_or_default() == target_id)
            .ok_or("Window not found")?;
        let title = window.title().unwrap_or_default();
        args.push("-i".to_string());
        args.push(format!("title={}", title));
    } else {
        let monitors = Monitor::all().map_err(|e| e.to_string())?;
        let monitor = monitors.iter().find(|m| m.id().unwrap_or_default() == target_id)
            .ok_or("Display not found")?;

        let ox = monitor.x().unwrap_or_default();
        let oy = monitor.y().unwrap_or_default();
        let w = monitor.width().unwrap_or_default();
        let h = monitor.height().unwrap_or_default();

        args.extend([
            "-offset_x".into(), ox.to_string(),
            "-offset_y".into(), oy.to_string(),
            "-video_size".into(), format!("{}x{}", w, h),
            "-i".into(), "desktop".into(),
        ]);
    }

    args.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
        file_path_str.clone(),
    ]);

    let child = Command::new("ffmpeg")
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    *process_guard = Some(child);
    *state.last_file_path.lock().unwrap() = Some(file_path_str);
    Ok(())
}

#[tauri::command]
fn stop_recording(state: State<'_, AppState>) -> Result<String, String> {
    let mut guard = state.recording_process.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    } else {
        return Err("Not recording".into());
    }
    let path = state.last_file_path.lock().unwrap().clone().unwrap_or_default();
    Ok(path)
}

#[tauri::command]
fn list_recordings(state: State<'_, AppState>) -> Result<Vec<RecordingEntry>, String> {
    let dir_path = get_active_output_dir(&state);
    let mut entries = Vec::new();

    let dir = fs::read_dir(&dir_path).map_err(|e| e.to_string())?;
    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("trace_recording_") && name.ends_with(".mp4") {
            if let Ok(meta) = entry.metadata() {
                let created = meta.modified()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                entries.push(RecordingEntry {
                    filename: name,
                    path: entry.path().to_string_lossy().to_string(),
                    size_bytes: meta.len(),
                    created,
                });
            }
        }
    }

    entries.sort_by(|a, b| b.created.cmp(&a.created));
    Ok(entries)
}

#[tauri::command]
fn open_file_location(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let config = load_config(&handle);
            app.manage(AppState {
                recording_process: Mutex::new(None),
                last_file_path: Mutex::new(None),
                config: Mutex::new(config),
            });
            
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_displays,
            get_windows,
            start_recording,
            stop_recording,
            list_recordings,
            open_file_location,
            get_output_dir,
            set_output_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
