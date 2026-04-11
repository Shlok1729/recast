use std::time::Duration;

use anyhow::{Context, Result};
use xcap::Monitor;

use crate::capture::CaptureSource;
use crate::recording::CaptureTarget;

pub fn create_source(target: &CaptureTarget) -> Result<Box<dyn CaptureSource>> {
    let source = XCapSource::new(target)?;
    Ok(Box::new(source))
}

struct XCapSource {
    monitor: Monitor,
    width: u32,
    height: u32,
}

impl XCapSource {
    fn new(target: &CaptureTarget) -> Result<Self> {
        let monitor = Monitor::all()?
            .into_iter()
            .find(|candidate| {
                candidate.x().ok() == Some(target.source.x)
                    && candidate.y().ok() == Some(target.source.y)
                    && candidate.width().ok() == Some(target.source.width)
                    && candidate.height().ok() == Some(target.source.height)
            })
            .context("unable to locate source monitor for fallback capture")?;

        Ok(Self {
            monitor,
            width: target.source.width,
            height: target.source.height,
        })
    }
}

// SAFETY: XCapSource contains xcap::Monitor which holds an HMONITOR (*mut c_void).
// HMONITOR is a system-wide handle that is safe to use from any thread.
unsafe impl Send for XCapSource {}

impl CaptureSource for XCapSource {
    fn capture_next(&mut self, _timeout: Duration) -> Result<Option<Vec<u8>>> {
        let image = self.monitor.capture_image()?;
        Ok(Some(image.into_raw()))
    }

    fn width(&self) -> u32 {
        self.width
    }

    fn height(&self) -> u32 {
        self.height
    }
}
