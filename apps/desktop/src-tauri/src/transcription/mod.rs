//! Offline captions / transcription (M1 foundation).
//!
//! Transcribes a *recorded clip's* audio on-device — Recast doesn't capture a
//! live mic for this (that's dictation; out of scope). The flow is:
//!   model download (verified) → FFmpeg decode to 16 kHz mono f32 → engine.
//!
//! Everything here is async + `spawn_blocking` for CPU/FFmpeg work — sync Tauri
//! commands freeze the macOS WebView (see the recording-IPC hardening). The
//! engine call is the one piece still gated/blocked (see `engine.rs`).
//!
//! Full design: `apps/desktop/docs/captions-transcription-plan.md`.

mod audio;
mod capabilities;
mod engine;
mod models;
mod subtitles;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::fs;

use capabilities::DeviceCapabilities;
use models::{CaptionModel, Engine as ModelEngine};

// Reused by silence detection to fetch the Silero VAD model (vad-rs needs an
// external silero_vad.onnx; the download/verify path lives in `models`).
pub(crate) use models::{download_file, models_dir};

// ---- Transcript data model (mirrors the planned project-format `transcript` section) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptWord {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub words: Vec<TranscriptWord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub engine: String,
    pub model_id: String,
    pub language: Option<String>,
    pub segments: Vec<TranscriptSegment>,
}

/// Flattened model row for the UI (registry meta + on-disk install state).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionModelInfo {
    pub id: String,
    pub display_name: String,
    pub engine: ModelEngine,
    pub family: String,
    pub languages: Vec<String>,
    pub approx_size_bytes: Option<u64>,
    pub is_default: bool,
    pub installed: bool,
    /// False until the model's files are defined (Parakeet V3 is pending).
    pub downloadable: bool,
    pub requires_gpu: bool,
    pub prefers_gpu: bool,
    pub min_ram_bytes: Option<u64>,
    /// Can this device run the model at all? (false → hard-disabled in the UI).
    pub runnable: bool,
    /// Non-blocking caveat for this device (slow on CPU, low RAM, …).
    pub warning: Option<String>,
}

/// Decide whether a model can run on this device and what to warn about.
/// Hard requirement (GPU) disables; soft factors (CPU-slow, low RAM) warn.
fn evaluate(model: &CaptionModel, caps: &DeviceCapabilities) -> (bool, Option<String>) {
    if model.requires_gpu && !caps.gpu.available {
        return (
            false,
            Some("Requires a supported GPU on this device.".into()),
        );
    }
    let mut notes: Vec<String> = Vec::new();
    if model.prefers_gpu && !caps.gpu.available {
        notes.push("Runs on CPU here — expect slower transcription.".into());
    }
    if let (Some(min), Some(ram)) = (model.min_ram_bytes, caps.total_ram_bytes) {
        if ram < min {
            notes.push(format!(
                "Recommended {:.0} GB RAM; this device has {:.1} GB.",
                min as f64 / 1e9,
                ram as f64 / 1e9
            ));
        }
    }
    (true, (!notes.is_empty()).then(|| notes.join(" ")))
}

// ---- Event payloads ----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    model_id: String,
    /// File currently downloading (empty on the final "complete" tick).
    file: String,
    downloaded: u64,
    /// 0 when the server didn't report a content length.
    total: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeProgress {
    phase: String, // "extracting" | "transcribing" | "done"
}

// ---- Commands ----

/// Catalog + per-model install state. Cheap disk checks; async to honour the
/// no-sync-commands rule.
#[tauri::command]
pub async fn list_caption_models(app: AppHandle) -> Result<Vec<CaptionModelInfo>, String> {
    let caps = capabilities::detect();
    let infos = models::registry()
        .into_iter()
        .map(|m| {
            let installed = models::is_installed(&app, &m).unwrap_or(false);
            let downloadable = !m.files.is_empty();
            let (runnable, warning) = evaluate(&m, &caps);
            CaptionModelInfo {
                id: m.id,
                display_name: m.display_name,
                engine: m.engine,
                family: m.family,
                languages: m.languages,
                approx_size_bytes: m.approx_size_bytes,
                is_default: m.is_default,
                installed,
                downloadable,
                requires_gpu: m.requires_gpu,
                prefers_gpu: m.prefers_gpu,
                min_ram_bytes: m.min_ram_bytes,
                runnable,
                warning,
            }
        })
        .collect();
    Ok(infos)
}

/// Report this device's OS / arch / RAM / GPU so the UI can explain why a model
/// is disabled or warned.
#[tauri::command]
pub async fn caption_capabilities() -> Result<DeviceCapabilities, String> {
    Ok(capabilities::detect())
}

/// Download every file for a model, emitting `captions:download-progress`.
#[tauri::command]
pub async fn download_caption_model(app: AppHandle, id: String) -> Result<(), String> {
    let model = models::find(&id).ok_or_else(|| format!("unknown caption model: {id}"))?;
    if model.files.is_empty() {
        return Err(format!(
            "model '{id}' has no downloadable files defined yet"
        ));
    }
    let dir = models::model_dir(&app, &id)?;
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create model dir: {e}"))?;

    let client = reqwest::Client::builder()
        .user_agent("recast-desktop")
        .build()
        .map_err(|e| format!("client: {e}"))?;

    for f in &model.files {
        let dest = dir.join(&f.rel_path);
        let rel = f.rel_path.clone();
        models::download_file(
            &client,
            &f.url,
            f.sha256.as_deref(),
            &dest,
            |downloaded, total| {
                let _ = app.emit(
                    "captions:download-progress",
                    DownloadProgress {
                        model_id: id.clone(),
                        file: rel.clone(),
                        downloaded,
                        total,
                    },
                );
            },
        )
        .await?;
    }

    let _ = app.emit(
        "captions:download-progress",
        DownloadProgress {
            model_id: id.clone(),
            file: String::new(),
            downloaded: 1,
            total: 1,
        },
    );
    Ok(())
}

/// Remove a downloaded model's files.
#[tauri::command]
pub async fn delete_caption_model(app: AppHandle, id: String) -> Result<(), String> {
    let dir = models::model_dir(&app, &id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .await
            .map_err(|e| format!("delete model: {e}"))?;
    }
    Ok(())
}

/// Transcribe a recording's audio with the chosen model. Decode + inference run
/// on a blocking thread; phase events drive the UI.
#[tauri::command]
pub async fn transcribe_project(
    app: AppHandle,
    audio_path: Option<String>,
    microphone_path: Option<String>,
    model_id: String,
    language: Option<String>,
) -> Result<Transcript, String> {
    let model =
        models::find(&model_id).ok_or_else(|| format!("unknown caption model: {model_id}"))?;
    let (runnable, _) = evaluate(&model, &capabilities::detect());
    if !runnable {
        return Err(format!("model '{model_id}' can't run on this device"));
    }
    if !models::is_installed(&app, &model)? {
        return Err(format!("model '{model_id}' is not downloaded"));
    }
    let model_dir = models::model_dir(&app, &model.id)?;

    let _ = app.emit(
        "captions:transcribe-progress",
        TranscribeProgress {
            phase: "extracting".into(),
        },
    );

    let sources: Vec<String> = [audio_path, microphone_path]
        .into_iter()
        .flatten()
        .collect();
    let lang = language.clone();
    let transcript = tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = sources.iter().map(|s| s.as_str()).collect();
        let samples = audio::extract_pcm_f32(&refs)?;
        if samples.is_empty() {
            return Err("no audio to transcribe".to_string());
        }
        engine::transcribe(&model, &model_dir, &samples, lang.as_deref())
    })
    .await
    .map_err(|e| format!("transcription task panicked: {e}"))??;

    let _ = app.emit(
        "captions:transcribe-progress",
        TranscribeProgress {
            phase: "done".into(),
        },
    );
    Ok(transcript)
}

/// Serialize a transcript to a subtitle sidecar (`srt` | `vtt`) and write it to
/// `dest_path` (chosen by the caller via the save dialog).
#[tauri::command]
pub async fn export_captions(
    transcript: Transcript,
    format: String,
    dest_path: String,
) -> Result<(), String> {
    let body = match format.as_str() {
        "srt" => subtitles::to_srt(&transcript),
        "vtt" => subtitles::to_vtt(&transcript),
        other => return Err(format!("unsupported subtitle format: {other}")),
    };
    fs::write(&dest_path, body)
        .await
        .map_err(|e| format!("write subtitles: {e}"))
}
