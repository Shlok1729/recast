use serde::{Deserialize, Serialize};

use crate::recording::{CaptureTarget, RecordingStats};

pub mod autosave;
pub mod reader;
pub mod writer;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub schema_version: u32,
    pub created_at_unix_ms: u64,
    pub capture_target: CaptureTarget,
    pub stats: RecordingStats,
    pub video: ProjectVideoMetadata,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<ProjectMediaMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectVideoMetadata {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMediaMetadata {
    pub has_system_audio: bool,
    pub has_microphone: bool,
    pub has_camera: bool,
}
