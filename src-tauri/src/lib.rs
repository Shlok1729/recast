use std::io::{Cursor, Write};
use std::sync::Mutex;
use std::process::{Command, Child, Stdio};
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
        .stdin(Stdio::piped())
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
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"q\n");
            let _ = stdin.flush();
        }
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

#[derive(Serialize, Clone)]
pub struct VideoMetadata {
    duration: f64,
    width: u32,
    height: u32,
    fps: f64,
    codec: String,
    size_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioSettingsPayload {
    volume: f64,
    muted: bool,
    fade_in: f64,
    fade_out: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatermarkSettingsPayload {
    enabled: bool,
    image_path: String,
    #[serde(rename = "imageSrc")]
    _image_src: String,
    opacity: f64,
    scale: f64,
    position: String,
    inset: f64,
}

fn input_has_audio(path: &str) -> bool {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            path,
        ])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            !String::from_utf8_lossy(&result.stdout).trim().is_empty()
        }
        _ => false,
    }
}

fn build_audio_filter(settings: &AudioSettingsPayload, duration: f64) -> Option<String> {
    let mut filters: Vec<String> = Vec::new();

    if settings.muted {
        filters.push("volume=0".into());
    } else if (settings.volume - 100.0).abs() > f64::EPSILON {
        filters.push(format!("volume={:.3}", (settings.volume / 100.0).max(0.0)));
    }

    if settings.fade_in > 0.0 {
        filters.push(format!("afade=t=in:st=0:d={:.3}", settings.fade_in));
    }

    if settings.fade_out > 0.0 {
        let fade_start = (duration - settings.fade_out).max(0.0);
        filters.push(format!(
            "afade=t=out:st={:.3}:d={:.3}",
            fade_start,
            settings.fade_out
        ));
    }

    if filters.is_empty() {
        None
    } else {
        Some(filters.join(","))
    }
}

fn get_watermark_overlay_position(position: &str, inset: f64) -> (String, String) {
    let safe_inset = inset.max(0.0).round() as i64;
    match position {
        "top-left" => (safe_inset.to_string(), safe_inset.to_string()),
        "top-right" => (
            format!("main_w-overlay_w-{}", safe_inset),
            safe_inset.to_string(),
        ),
        "bottom-left" => (
            safe_inset.to_string(),
            format!("main_h-overlay_h-{}", safe_inset),
        ),
        _ => (
            format!("main_w-overlay_w-{}", safe_inset),
            format!("main_h-overlay_h-{}", safe_inset),
        ),
    }
}

#[tauri::command]
fn get_video_metadata(path: String) -> Result<VideoMetadata, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err("File not found".into());
    }

    let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    // Try ffprobe for accurate metadata
    let output = Command::new("ffprobe")
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let json_str = String::from_utf8_lossy(&out.stdout);
            let parsed: serde_json::Value = serde_json::from_str(&json_str)
                .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

            let duration = parsed["format"]["duration"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
                .unwrap_or(0.0);

            // Find video stream
            let streams = parsed["streams"].as_array();
            let video_stream = streams
                .and_then(|s| s.iter().find(|st| st["codec_type"].as_str() == Some("video")));

            let (width, height, fps, codec) = if let Some(vs) = video_stream {
                let w = vs["width"].as_u64().unwrap_or(0) as u32;
                let h = vs["height"].as_u64().unwrap_or(0) as u32;
                let codec_name = vs["codec_name"].as_str().unwrap_or("unknown").to_string();

                // Parse FPS from r_frame_rate (e.g., "30/1")
                let fps_str = vs["r_frame_rate"].as_str().unwrap_or("30/1");
                let fps_val = if let Some((num, den)) = fps_str.split_once('/') {
                    let n: f64 = num.parse().unwrap_or(30.0);
                    let d: f64 = den.parse().unwrap_or(1.0);
                    if d > 0.0 { n / d } else { 30.0 }
                } else {
                    fps_str.parse::<f64>().unwrap_or(30.0)
                };

                (w, h, fps_val, codec_name)
            } else {
                (0, 0, 30.0, "unknown".to_string())
            };

            Ok(VideoMetadata { duration, width, height, fps, codec, size_bytes })
        }
        _ => {
            // Fallback: return minimal metadata
            Ok(VideoMetadata {
                duration: 0.0,
                width: 0,
                height: 0,
                fps: 30.0,
                codec: "unknown".to_string(),
                size_bytes,
            })
        }
    }
}

#[tauri::command]
fn generate_thumbnails(path: String, count: u32) -> Result<Vec<String>, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err("File not found".into());
    }

    // Get duration first
    let meta = get_video_metadata(path.clone())?;
    if meta.duration <= 0.0 {
        return Ok(Vec::new());
    }

    let interval = meta.duration / count as f64;
    let mut thumbnails = Vec::new();
    let temp_dir = env::temp_dir().join("trace_thumbnails");
    let _ = fs::create_dir_all(&temp_dir);

    for i in 0..count {
        let timestamp = i as f64 * interval;
        let thumb_path = temp_dir.join(format!("thumb_{}.jpg", i));

        let result = Command::new("ffmpeg")
            .args([
                "-y", "-ss", &format!("{:.2}", timestamp),
                "-i", &path,
                "-vframes", "1",
                "-vf", "scale=160:-1",
                "-q:v", "8",
                thumb_path.to_string_lossy().as_ref(),
            ])
            .output();

        if let Ok(out) = result {
            if out.status.success() {
                if let Ok(data) = fs::read(&thumb_path) {
                    let b64 = general_purpose::STANDARD.encode(&data);
                    thumbnails.push(format!("data:image/jpeg;base64,{}", b64));
                }
            }
        }
        let _ = fs::remove_file(&thumb_path);
    }

    Ok(thumbnails)
}

#[tauri::command]
fn export_video(
    input_path: String,
    format: String,
    trim_start: f64,
    trim_end: f64,
    _background_type: String,
    _background_value: String,
    _background_blur: f64,
    _padding: f64,
    audio_settings: AudioSettingsPayload,
    watermark_settings: WatermarkSettingsPayload,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let in_path = Path::new(&input_path);
    if !in_path.exists() {
        return Err("Input file not found".into());
    }

    let out_dir = get_active_output_dir(&state);
    let extension = match format.as_str() {
        "gif" => "gif",
        "webm" => "webm",
        _ => "mp4",
    };

    let out_path = out_dir.join(format!(
        "trace_export_{}.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        extension
    ));
    let out_str = out_path.to_string_lossy().to_string();

    let duration = trim_end - trim_start;
    let has_audio = format != "gif" && input_has_audio(&input_path);
    let has_watermark = watermark_settings.enabled
        && !watermark_settings.image_path.is_empty()
        && Path::new(&watermark_settings.image_path).exists();

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-ss".into(), format!("{:.3}", trim_start),
        "-i".into(), input_path.clone(),
        "-t".into(), format!("{:.3}", duration),
    ];

    if has_watermark {
        args.extend([
            "-i".into(),
            watermark_settings.image_path.clone(),
        ]);
    }

    if has_watermark {
        let watermark_scale = (watermark_settings.scale / 100.0).clamp(0.05, 0.5);
        let watermark_opacity = (watermark_settings.opacity / 100.0).clamp(0.1, 1.0);
        let (overlay_x, overlay_y) = get_watermark_overlay_position(
            &watermark_settings.position,
            watermark_settings.inset,
        );
        let filter_complex = format!(
            "[1:v][0:v]scale2ref=w=main_w*{:.4}:h=ow/mdar[wm][base];[wm]format=rgba,colorchannelmixer=aa={:.3}[wm_alpha];[base][wm_alpha]overlay=x={}:y={}[vout]",
            watermark_scale,
            watermark_opacity,
            overlay_x,
            overlay_y
        );

        args.extend([
            "-filter_complex".into(),
            filter_complex,
            "-map".into(),
            "[vout]".into(),
        ]);
    } else {
        args.extend([
            "-map".into(),
            "0:v:0".into(),
        ]);
    }

    if has_audio {
        args.extend([
            "-map".into(),
            "0:a?".into(),
        ]);
        if let Some(audio_filter) = build_audio_filter(&audio_settings, duration) {
            args.extend([
                "-af".into(),
                audio_filter,
            ]);
        }
    }

    match format.as_str() {
        "gif" => {
            args.extend([
                "-vf".into(),
                "fps=15,scale=640:-1:flags=lanczos".into(),
                "-loop".into(), "0".into(),
                out_str.clone(),
            ]);
        }
        "webm" => {
            args.extend([
                "-c:v".into(), "libvpx-vp9".into(),
                "-crf".into(), "30".into(),
                "-b:v".into(), "0".into(),
                "-c:a".into(), "libopus".into(),
                out_str.clone(),
            ]);
        }
        _ => {
            // MP4
            args.extend([
                "-c:v".into(), "libx264".into(),
                "-preset".into(), "medium".into(),
                "-crf".into(), "23".into(),
                "-pix_fmt".into(), "yuv420p".into(),
                "-c:a".into(), "aac".into(),
                out_str.clone(),
            ]);
        }
    }

    let result = Command::new("ffmpeg")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to start ffmpeg: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("FFmpeg export failed: {}", stderr));
    }

    Ok(out_str)
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
            app.handle().plugin(tauri_plugin_dialog::init())?;
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
            set_output_dir,
            get_video_metadata,
            generate_thumbnails,
            export_video
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
