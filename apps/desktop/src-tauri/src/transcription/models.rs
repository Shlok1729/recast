//! Caption model registry + verified, resumable-friendly download.
//!
//! Models are fetched **directly from HuggingFace** (decided 2026-06-29) into
//! `app_data_dir/models/<id>/`, sha256-verified when a hash is known. The
//! download/verify path mirrors `commands/assets.rs` (streamed `.tmp` + atomic
//! rename) but emits per-byte progress so the UI can show a real bar.
//!
//! NOTE ON DATA: the Whisper entries use the canonical `ggerganov/whisper.cpp`
//! GGML files (stable URLs). Their `sha256` is left `None` for now (skip-verify
//! with a warning) — fill them in when locking exact revisions. The **Parakeet
//! V3** entry has no `files` yet: the exact ONNX file set `transcribe-rs`
//! expects must be confirmed against its loader before we can pin URLs/hashes.
//! `download`/`transcribe` guard against the empty file list.

use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::fs;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Parakeet,
    Whisper,
}

/// One file that makes up a model. Whisper is a single `.bin`; Parakeet is a
/// directory of ONNX files (hence `rel_path`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    /// Path under the model dir, e.g. `ggml-small.bin` or `encoder.onnx`.
    pub rel_path: String,
    pub url: String,
    /// Expected sha256; `None`/empty skips verification (logged).
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionModel {
    pub id: String,
    pub display_name: String,
    pub engine: Engine,
    /// BCP-47-ish language hints; `["multi"]` for multilingual.
    pub languages: Vec<String>,
    pub approx_size_bytes: Option<u64>,
    pub is_default: bool,
    pub files: Vec<ModelFile>,
}

const WHISPER_BASE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

fn whisper(id: &str, name: &str, file: &str, size: u64) -> CaptionModel {
    CaptionModel {
        id: id.into(),
        display_name: name.into(),
        engine: Engine::Whisper,
        languages: vec!["multi".into()],
        approx_size_bytes: Some(size),
        is_default: false,
        files: vec![ModelFile {
            rel_path: file.into(),
            url: format!("{WHISPER_BASE}/{file}"),
            sha256: None, // TODO: pin once we lock a revision
        }],
    }
}

/// The model catalog. Parakeet V3 is the default; the Whisper tiers match the
/// set Handy ships (small / medium / turbo / large), all multilingual.
pub fn registry() -> Vec<CaptionModel> {
    vec![
        CaptionModel {
            id: "parakeet-v3".into(),
            display_name: "Parakeet V3 (0.6B)".into(),
            engine: Engine::Parakeet,
            languages: vec!["multi".into()],
            approx_size_bytes: None,
            is_default: true,
            // TODO: confirm the exact ONNX file set + HF repo `transcribe-rs`
            // loads for Parakeet V3, then populate (rel_path/url/sha256).
            files: vec![],
        },
        whisper("whisper-small", "Whisper Small", "ggml-small.bin", 488_000_000),
        whisper("whisper-medium", "Whisper Medium", "ggml-medium.bin", 1_530_000_000),
        whisper(
            "whisper-large-v3-turbo",
            "Whisper Turbo (large-v3)",
            "ggml-large-v3-turbo.bin",
            1_620_000_000,
        ),
        whisper("whisper-large-v3", "Whisper Large v3", "ggml-large-v3.bin", 3_100_000_000),
    ]
}

pub fn find(id: &str) -> Option<CaptionModel> {
    registry().into_iter().find(|m| m.id == id)
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?;
    Ok(base.join("models"))
}

pub fn model_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(id))
}

/// A model is installed when every declared file is present (and matches its
/// sha256 if one is known). A model with no files defined is never "installed".
pub fn is_installed(app: &AppHandle, model: &CaptionModel) -> Result<bool, String> {
    if model.files.is_empty() {
        return Ok(false);
    }
    let dir = model_dir(app, &model.id)?;
    for f in &model.files {
        let path = dir.join(&f.rel_path);
        if !path.exists() {
            return Ok(false);
        }
        if let Some(expected) = f.sha256.as_deref().filter(|s| !s.is_empty()) {
            match file_sha256(&path) {
                Ok(got) if got.eq_ignore_ascii_case(expected) => {}
                _ => return Ok(false),
            }
        }
    }
    Ok(true)
}

fn file_sha256(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Stream `url` into `dest` (via a sibling `.tmp`), hashing as we go and calling
/// `on_progress(downloaded, total)` per chunk. Verifies sha256 when known, then
/// atomically renames into place. `total` is 0 when the server omits a length.
pub async fn download_file(
    client: &reqwest::Client,
    url: &str,
    sha256: Option<&str>,
    dest: &Path,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("create dir: {e}"))?;
    }
    let tmp = dest.with_extension("tmp");
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request: {e}"))?
        .error_for_status()
        .map_err(|e| format!("http: {e}"))?;
    let total = resp.content_length().unwrap_or(0);

    let mut hasher = Sha256::new();
    let mut file = fs::File::create(&tmp)
        .await
        .map_err(|e| format!("create tmp: {e}"))?;
    let mut downloaded = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream: {e}"))?;
        hasher.update(&bytes);
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("write: {e}"))?;
        downloaded += bytes.len() as u64;
        on_progress(downloaded, total);
    }
    file.flush().await.map_err(|e| format!("flush: {e}"))?;
    drop(file);

    if let Some(expected) = sha256.filter(|s| !s.is_empty()) {
        let got = hex::encode(hasher.finalize());
        if !got.eq_ignore_ascii_case(expected) {
            let _ = fs::remove_file(&tmp).await;
            return Err(format!("sha256 mismatch (expected {expected}, got {got})"));
        }
    } else {
        log::warn!("caption model file {} downloaded without sha256 verification", url);
    }

    if dest.exists() {
        let _ = fs::remove_file(dest).await;
    }
    fs::rename(&tmp, dest)
        .await
        .map_err(|e| format!("rename: {e}"))?;
    Ok(())
}
