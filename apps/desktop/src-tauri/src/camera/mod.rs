mod platform;

use std::path::PathBuf;

use anyhow::Result;

/// Configuration for camera/webcam capture.
#[derive(Debug, Clone)]
pub struct CameraCaptureConfig {
    /// Path to write the output MP4 file.
    pub output_path: PathBuf,
    /// DirectShow device name (None = first available camera).
    pub device_name: Option<String>,
}

/// Handle to a running camera capture session.
/// Captures video from a webcam device via FFmpeg DirectShow and encodes to MP4.
pub struct CameraCaptureSession {
    inner: platform::PlatformCameraSession,
}

impl CameraCaptureSession {
    pub fn start(config: CameraCaptureConfig) -> Result<Self> {
        let inner = platform::PlatformCameraSession::start(config)?;
        Ok(Self { inner })
    }

    pub fn stop(self) -> Result<PathBuf> {
        self.inner.stop()
    }
}
