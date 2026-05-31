use std::collections::HashMap;
use std::path::PathBuf;

mod audio;
mod camera;
mod capture;
mod commands;
mod cursor;
mod encoder;
pub mod ffmpeg;
mod project;
mod recording;
mod render;
mod silence;
mod telemetry;
mod tray;

use commands::system::load_config;
use commands::types::AppState;
use parking_lot::Mutex;
use recording::RecordingManager;
use tauri::{Emitter, Manager};

/// Pull a `.recast` file path out of process argv if the OS launched us
/// with one via the file association (Windows registry shell-open, macOS
/// LaunchServices, Linux xdg-open). Returns `None` for normal launches.
///
/// Defensive rules:
/// * Skip `argv[0]` (executable path).
/// * Skip any arg starting with `-` — covers dev-mode flags (`--port`,
///   etc.) and the macOS `-psn_NNNN_NNNN` process serial number that
///   LaunchServices sometimes prepends.
/// * Match the extension case-insensitively — Windows is case-insensitive
///   and APFS *can* be case-sensitive, so users may have `.Recast` files.
/// * Verify the path exists. If a user double-clicks then deletes the file
///   before we boot, we want to report "no longer exists" instead of
///   navigating to an editor window that immediately errors.
fn parse_open_arg(argv: &[String]) -> Option<PathBuf> {
    argv.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .find(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("recast"))
                && p.exists()
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load `apps/desktop/.env` so dev overrides like `CLOUD_API_URL` reach
    // the Rust side. dotenvy walks up from CWD looking for `.env`, so when
    // `pnpm tauri dev` runs cargo from `src-tauri/` it finds the file one
    // level up. Silent on missing/invalid file — release installs have no
    // .env and that's fine.
    #[cfg(debug_assertions)]
    let _ = dotenvy::dotenv();

    let mut builder = tauri::Builder::default()
        // Single-instance MUST be the first plugin registered. The handler
        // fires inside the second-launched process — by the time it runs,
        // any later plugin would have already initialized in that ghost
        // process. The plugin shuts the ghost down after the handler returns,
        // so we just refocus the existing window and exit.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            // Warm-start file-association path: the ghost process's argv is
            // forwarded here. Emit to the main window which always-new-windows
            // it via openProjectFromExternalPath. Close-to-tray keeps main's
            // JS alive even when hidden, so the listener catches this.
            if let Some(path) = parse_open_arg(&argv) {
                let payload = path.to_string_lossy().to_string();
                if let Err(e) = app.emit("app://open-recast", payload) {
                    log::warn!("emit app://open-recast failed: {e}");
                }
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // JS-injecting plugin — must be on the Builder before any window,
        // same constraint as dialog/os (see the comment block below).
        .plugin(tauri_plugin_sharekit::init())
        .plugin(tauri_plugin_os::init());

    // JS-injecting plugins (dialog, os) MUST be added on the Builder before
    // any window is created — registering them later via `app.handle().plugin()`
    // inside `setup()` is too late: the WebView has already loaded the bundle
    // without the plugin's init script, so `window.__TAURI_OS_PLUGIN_INTERNALS__`
    // is undefined and synchronous calls like `platform()` throw at module
    // evaluation time, taking the whole frontend down. The Rust-only log plugin
    // can stay inside `setup()`.
    //
    // Why log in release too: without this, MSI/NSIS/DMG installs were
    // silent — when a user hit a recording error there was no way to ask
    // them for a log file, so every report had to be reproduced live.
    // `tauri_plugin_log`'s defaults write to both stdout AND a rotating
    // file under the OS log dir (Windows: `%LOCALAPPDATA%\com.nexonauts.recast\logs\`,
    // macOS: `~/Library/Logs/com.nexonauts.recast/`, Linux:
    // `~/.local/share/com.nexonauts.recast/logs/`). Release builds get
    // Warn level so we don't bloat user disks with per-frame info noise;
    // debug builds stay at Info for active dev work.
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Info
    } else {
        log::LevelFilter::Warn
    };
    builder = builder.plugin(
        tauri_plugin_log::Builder::default()
            .level(log_level)
            .build(),
    );

    builder
        .setup(|app| {
            let handle = app.handle();
            let config = load_config(handle);

            // Cold-start file-association path: stash any `.recast` arg the
            // OS handed us so the main window can drain it on mount via
            // `take_pending_open_file`. None for a normal launch.
            let cold_open_file: Vec<String> = std::env::args().collect();
            let pending_open_file = parse_open_arg(&cold_open_file);

            app.manage(AppState {
                recording_manager: RecordingManager::default(),
                last_file_path: Mutex::new(None),
                config: Mutex::new(config),
                export_cancel: Mutex::new(HashMap::new()),
                auth_poller: Mutex::new(None),
                pending_open_file: Mutex::new(pending_open_file),
            });

            // Native crash reporting. Installed after AppState is managed so the
            // panic hook can read the consent flag + install id. Gated on the
            // user's `telemetry_errors` consent (default on) and PII-scrubbed.
            telemetry::install_panic_hook(handle.clone());

            // System tray. Init failure is non-fatal — the app still works
            // without a tray (the user just can't quick-access actions while
            // the window is hidden, which is fine). Log + continue.
            if let Err(e) = tray::init(handle) {
                log::warn!("tray init failed: {e}");
            }

            // FFmpeg path resolution probes ffmpeg/ffprobe `-version` against
            // up to 4 candidate locations, each spawn taking ~100–300 ms cold.
            // Doing this on the main thread froze the splash window for up to
            // a second on Windows. Resolve on a blocking worker; commands that
            // need the path will block on the OnceLock if they fire first.
            //
            // We also pre-warm `preferred_h264_encoder()` here (one extra
            // `ffmpeg -encoders` spawn, also ~200–300 ms cold). Without this,
            // the encoder probe ran *during the first recording-start*,
            // delaying the start_recording command by that much — the Windows
            // tester report described it as "the whole window freezes
            // suddenly". Pre-warming on the same blocking worker that
            // resolves FFmpeg paths fixes the first-recording case without
            // adding any extra spawn for subsequent recordings (the result is
            // cached behind an OnceLock).
            let resolver_handle = handle.clone();
            tauri::async_runtime::spawn_blocking(move || {
                ffmpeg::init(&resolver_handle);
                if let Err(e) = ffmpeg::check_availability() {
                    log::warn!("FFmpeg not available: {e}");
                }
                // Touch the OnceLock so the encoder probe runs here, not
                // during the user's first recording. Result is ignored —
                // the function logs internally and falls back to libx264
                // on probe failure.
                let _ = ffmpeg::preferred_h264_encoder();
            });

            // Startup: clean up stale temp files and orphaned session artifacts.
            let state = app.state::<AppState>();
            let output_dir = state.config.lock().output_dir.clone();
            if let Some(dir) = output_dir {
                project::autosave::cleanup_stale_sessions(std::path::Path::new(&dir));
            }

            // Sweep abandoned `recast-thumbnails/*` subdirs left behind by
            // crashed/killed editor sessions. The thumbnail extractor
            // best-effort-removes its own per-invocation dir, but a process
            // crash mid-scrub leaks the directory — on a long-running install
            // these can accumulate gigabytes of orphaned JPEGs. Anything
            // older than ~1 hour is safe to drop (no live process is still
            // writing into it).
            tauri::async_runtime::spawn_blocking(|| {
                let thumb_root = std::env::temp_dir().join("recast-thumbnails");
                let Ok(entries) = std::fs::read_dir(&thumb_root) else {
                    return;
                };
                let cutoff =
                    std::time::SystemTime::now().checked_sub(std::time::Duration::from_secs(3600));
                for entry in entries.flatten() {
                    let stale = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .zip(cutoff)
                        .map(|(modified, cutoff)| modified < cutoff)
                        .unwrap_or(false);
                    if stale {
                        let _ = std::fs::remove_dir_all(entry.path());
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_output_dir,
            commands::set_output_dir,
            commands::get_displays,
            commands::get_windows,
            commands::get_last_source,
            commands::set_last_source,
            commands::start_recording,
            commands::stop_recording,
            commands::pause_recording,
            commands::resume_recording,
            commands::is_recording_paused,
            commands::list_recasts,
            commands::list_exports,
            commands::open_file_location,
            commands::delete_file,
            commands::rename_file,
            commands::get_video_metadata,
            commands::load_editor_document,
            commands::generate_thumbnails,
            commands::export_video,
            commands::cancel_export,
            commands::get_audio_devices,
            commands::get_camera_devices,
            commands::validate_camera_source,
            commands::update_camera_preview_state,
            commands::exclude_window_from_capture,
            commands::autosave_project,
            commands::save_project_edits,
            commands::clear_autosave,
            commands::get_recoverable_sessions,
            commands::suggest_zoom_regions,
            silence::detect_silence,
            silence::extract_waveform,
            commands::ensure_assets_installed,
            commands::get_cached_asset_path,
            commands::hydrate_cached_assets,
            commands::diagnose_ffmpeg,
            commands::auth_start,
            commands::auth_status,
            commands::auth_sign_out,
            commands::auth_cancel,
            commands::get_close_to_tray,
            commands::set_close_to_tray,
            commands::set_telemetry_consent,
            commands::gdrive_connect,
            commands::gdrive_status,
            commands::gdrive_disconnect,
            commands::gdrive_upload,
            commands::gdrive_cancel_upload,
            commands::gdrive_list_uploads,
            commands::gdrive_forget_upload,
            commands::recast_cloud_upload,
            commands::recast_cloud_update_share,
            commands::recast_cloud_delete,
            commands::recast_cloud_list_shares,
            commands::recast_cloud_list_uploads,
            commands::recast_cloud_forget_upload,
            commands::take_pending_open_file,
            commands::peek_recast_project,
            commands::is_recording_active,
            tray::refresh_tray
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Main-window close handling has two modes, gated by the user's
            // `close_to_tray` setting (default on):
            //
            //   * close_to_tray=true: prevent the close, hide the window
            //     instead. The tray icon is the only way to bring the app
            //     back or to truly quit. Background captures (recording,
            //     editor autosave) keep running.
            //
            //   * close_to_tray=false: legacy behavior — close auxiliaries
            //     explicitly before exit(0) so Linux/Wayland doesn't race
            //     surface teardown against the main-thread exit.
            //
            // Tray "Quit" calls `app.exit(0)` directly, bypassing this
            // branch entirely (no CloseRequested event fires).
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } = &event
            {
                if label == "main" {
                    let hide_to_tray = app_handle
                        .try_state::<AppState>()
                        .map(|state| state.config.lock().close_to_tray)
                        .unwrap_or(true);

                    if hide_to_tray {
                        api.prevent_close();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                        tray::rebuild_menu(app_handle);
                        return;
                    }

                    for (aux_label, window) in app_handle.webview_windows() {
                        if aux_label != "main" {
                            let _ = window.close();
                        }
                    }
                    app_handle.exit(0);
                }
            }
        });
}
