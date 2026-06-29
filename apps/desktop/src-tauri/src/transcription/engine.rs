//! Inference seam — where the model is actually run.
//!
//! **Parakeet** via `transcribe-rs` (ONNX/`ort`). `ort` ships a prebuilt
//! runtime, so this needs no libclang/CMake. It shares one `ort` (rc.12) with
//! the `vad-rs` silence detector.
//!
//! **Whisper** (whisper.cpp) is intentionally deferred — enabling
//! transcribe-rs's `whisper-cpp` feature would pull the LLVM+CMake toolchain.
//! Until then the Whisper arm returns a typed error pointing at Parakeet.
//!
//! Behind the `captions` Cargo feature so the engine deps only enter an opt-in
//! build.

use std::path::Path;

use super::models::CaptionModel;
use super::Transcript;

#[cfg(not(feature = "captions"))]
pub fn transcribe(
    _model: &CaptionModel,
    _model_dir: &Path,
    _samples: &[f32],
    _language: Option<&str>,
) -> Result<Transcript, String> {
    Err("captions feature is not enabled in this build".into())
}

#[cfg(feature = "captions")]
pub fn transcribe(
    model: &CaptionModel,
    model_dir: &Path,
    samples: &[f32],
    _language: Option<&str>,
) -> Result<Transcript, String> {
    use super::models::Engine;
    match model.engine {
        Engine::Parakeet => parakeet_transcribe(model, model_dir, samples),
        Engine::Whisper => Err("Whisper (whisper.cpp) isn't enabled in this build yet — \
             use a Parakeet model. See docs/captions-transcription-plan.md."
            .into()),
    }
}

#[cfg(feature = "captions")]
fn parakeet_transcribe(
    model: &CaptionModel,
    model_dir: &Path,
    samples: &[f32],
) -> Result<Transcript, String> {
    use super::{TranscriptSegment, TranscriptWord};
    use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};
    use transcribe_rs::onnx::Quantization;

    let mut pk = ParakeetModel::load(model_dir, &Quantization::Int8)
        .map_err(|e| format!("load Parakeet model: {e}"))?;

    let params = ParakeetParams {
        timestamp_granularity: Some(TimestampGranularity::Segment),
        ..Default::default()
    };
    let result = pk
        .transcribe_with(samples, &params)
        .map_err(|e| format!("Parakeet transcription failed: {e}"))?;

    let segments: Vec<TranscriptSegment> = result
        .segments
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .map(|(i, s)| TranscriptSegment {
            id: format!("seg-{i}"),
            start: s.start as f64,
            end: s.end as f64,
            text: s.text.trim().to_string(),
            words: Vec::<TranscriptWord>::new(),
        })
        .collect();

    Ok(Transcript {
        engine: "parakeet".into(),
        model_id: model.id.clone(),
        language: None,
        segments,
    })
}
