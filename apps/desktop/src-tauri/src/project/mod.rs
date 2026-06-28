use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::recording::{CaptureTarget, RecordingStats};

pub mod autosave;
pub mod format;
pub mod reader;
pub mod writer;

/// Cheap format probe: reads only the ZIP central directory (entry names) — no
/// extraction or media decompression — to decide whether `path` is a legacy v1
/// bundle. Returns false for unreadable or non-archive files.
pub fn is_legacy_project(path: &Path) -> bool {
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let Ok(archive) = zip::ZipArchive::new(file) else {
        return false;
    };
    let names: Vec<String> = archive.file_names().map(str::to_string).collect();
    !format::is_v2(&names)
}

/// Re-pack a legacy v1 `.recast` as v2 in place, keeping a one-time
/// `*.recast.bak` of the original first (recordings can be irreplaceable).
/// No-op if the project is already v2. The atomic rename inside `write_project`
/// means a crash mid-migration leaves the backup and the untouched original.
pub fn migrate_project(path: &Path) -> Result<()> {
    let opened = reader::open_project(path).context("failed to open project for migration")?;
    if !opened.needs_migration {
        return Ok(());
    }

    let edits_json =
        std::fs::read_to_string(&opened.edits_path).context("failed to read edits to migrate")?;

    let backup = path.with_extension("recast.bak");
    std::fs::copy(path, &backup).context("failed to write migration backup")?;

    writer::write_project(writer::ProjectWriteRequest {
        output_path: path.to_path_buf(),
        metadata: opened.metadata,
        recording_path: opened.recording_path,
        cursor_path: opened.cursor_path,
        audio_path: opened.audio_path,
        microphone_path: opened.microphone_path,
        camera_path: opened.camera_path,
        edits_json,
    })
    .context("failed to write migrated project")?;
    Ok(())
}

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
