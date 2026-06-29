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
    use transcribe_rs::onnx::{
        canary::CanaryModel, cohere::CohereModel, gigaam::GigaAMModel, Quantization,
    };

    match model.engine {
        // Parakeet uses its own params to request SEGMENT-level timestamps.
        Engine::Parakeet => parakeet_transcribe(model, model_dir, samples),
        // The other ONNX engines share one path via the `SpeechModel` trait.
        Engine::Canary => {
            let m = CanaryModel::load(model_dir, &Quantization::Int8)
                .map_err(|e| format!("load Canary model: {e}"))?;
            run_speech_model(m, model, samples)
        }
        Engine::GigaAM => {
            let m = GigaAMModel::load(model_dir, &Quantization::Int8)
                .map_err(|e| format!("load GigaAM model: {e}"))?;
            run_speech_model(m, model, samples)
        }
        Engine::Cohere => {
            let m = CohereModel::load(model_dir, &Quantization::Int4)
                .map_err(|e| format!("load Cohere model: {e}"))?;
            run_speech_model(m, model, samples)
        }
        Engine::Whisper => Err("Whisper (whisper.cpp) isn't enabled in this build yet — \
             use a Parakeet or Canary model. See docs/captions-transcription-plan.md."
            .into()),
    }
}

#[cfg(feature = "captions")]
fn parakeet_transcribe(
    model: &CaptionModel,
    model_dir: &Path,
    samples: &[f32],
) -> Result<Transcript, String> {
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
    Ok(build_transcript(model, samples, result))
}

/// Run any engine that implements `SpeechModel` with default options, then map
/// its result into our transcript shape.
#[cfg(feature = "captions")]
fn run_speech_model<M: transcribe_rs::SpeechModel>(
    mut model_impl: M,
    model: &CaptionModel,
    samples: &[f32],
) -> Result<Transcript, String> {
    let result = model_impl
        .transcribe(samples, &transcribe_rs::TranscribeOptions::default())
        .map_err(|e| format!("transcription failed: {e}"))?;
    Ok(build_transcript(model, samples, result))
}

/// Map a transcribe-rs result into our `Transcript`. Segments carry seconds.
/// When an engine returns no segment timing, fall back to one block spanning
/// the clip so captions still render.
#[cfg(feature = "captions")]
fn build_transcript(
    model: &CaptionModel,
    samples: &[f32],
    result: transcribe_rs::TranscriptionResult,
) -> Transcript {
    use super::models::Engine;
    use super::{TranscriptSegment, TranscriptWord};

    let segments: Vec<TranscriptSegment> = match result.segments {
        Some(segs) if !segs.is_empty() => segs
            .into_iter()
            .enumerate()
            .map(|(i, s)| TranscriptSegment {
                id: format!("seg-{i}"),
                start: s.start as f64,
                end: s.end as f64,
                text: s.text.trim().to_string(),
                words: Vec::<TranscriptWord>::new(),
            })
            .collect(),
        _ => {
            let text = result.text.trim().to_string();
            if text.is_empty() {
                Vec::new()
            } else {
                vec![TranscriptSegment {
                    id: "seg-0".into(),
                    start: 0.0,
                    end: samples.len() as f64 / 16_000.0,
                    text,
                    words: Vec::new(),
                }]
            }
        }
    };

    let engine = match model.engine {
        Engine::Parakeet => "parakeet",
        Engine::Canary => "canary",
        Engine::GigaAM => "gigaam",
        Engine::Cohere => "cohere",
        Engine::Whisper => "whisper",
    };

    Transcript {
        engine: engine.into(),
        model_id: model.id.clone(),
        language: None,
        segments,
    }
}
