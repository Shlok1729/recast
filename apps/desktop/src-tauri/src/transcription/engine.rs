//! Inference seam — the single point where the model is actually run.
//!
//! Parakeet (via `transcribe-rs`) / Whisper (via `whisper-rs`) plug in here. The
//! whole pipeline around it — model download, audio extraction, the async
//! command/event surface — is built and exercisable; this is the one remaining
//! integration point.
//!
//! BLOCKED — ONNX Runtime version clash. `transcribe-rs` pins
//! `ort = "=2.0.0-rc.12"`; this app already links `ort 2.0.0-rc.10` through
//! `voice_activity_detector` (silence detection). `ort-sys` uses `links`, so the
//! two cannot coexist — adding `transcribe-rs` fails cargo resolution until the
//! versions are aligned (bump/patch `voice_activity_detector` to rc.12, or fork
//! one crate). See `apps/desktop/docs/captions-transcription-plan.md` §7.
//!
//! Gated behind the `captions` Cargo feature so the dependency (and this build
//! risk) only enters a build that opts in; default builds stay green.

use super::models::CaptionModel;
use super::Transcript;

#[cfg(not(feature = "captions"))]
pub fn transcribe(
    _model: &CaptionModel,
    _samples: &[f32],
    _language: Option<&str>,
) -> Result<Transcript, String> {
    Err("captions feature is not enabled in this build".into())
}

#[cfg(feature = "captions")]
pub fn transcribe(
    model: &CaptionModel,
    samples: &[f32],
    language: Option<&str>,
) -> Result<Transcript, String> {
    // TODO(captions): wire `transcribe-rs` (Parakeet) / `whisper-rs` once the
    // ort rc.10/rc.12 conflict is resolved. Inputs are ready: `samples` is mono
    // 16 kHz f32, `model` carries the on-disk file paths.
    let _ = (model, samples, language);
    Err(
        "transcription engine not yet integrated — blocked on ort rc.10/rc.12 \
         alignment (see docs/captions-transcription-plan.md §7)"
            .into(),
    )
}
