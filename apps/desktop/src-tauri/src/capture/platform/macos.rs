//! macOS screen capture via FFmpeg AVFoundation.
//!
//! Replaces the xcap fallback (which on macOS reopens a CoreGraphics
//! session per frame — orders of magnitude slower than necessary) with
//! a single long-lived FFmpeg subprocess that streams raw BGRA frames
//! to stdout. Each `capture_next()` reads exactly one frame's worth of
//! bytes from the pipe.
//!
//! ## Why not ScreenCaptureKit
//!
//! ScreenCaptureKit (macOS 13+) is the right native source — it's
//! lower-latency, includes a system-audio tap, and is what Apple
//! recommends for any new screen recorder. But wiring it up requires:
//!   - non-trivial objc2 bindings for `SCStream`, `SCContentFilter`,
//!     `SCStreamConfiguration`, the async stream delegate, the audio
//!     output coupling …
//!   - a TCC permission scaffolding flow for first-run consent
//!   - testing on macOS 13/14/15 to catch the API renames per release
//!
//! Each of those is its own multi-day landing. FFmpeg AVFoundation
//! ships today on macOS 11+, performs well enough for 1080p60, and
//! shares all the existing infrastructure (binary path resolution,
//! `configure_silent_command`, the encoder downstream). It's the
//! pragmatic bridge until SCKit lands.
//!
//! ## Coordinate model
//!
//! This source captures the WHOLE selected display at its physical
//! resolution and emits full-`source`-sized BGRA frames; the encoder
//! crops to the region/window. That's the same contract the Windows DXGI
//! path follows, so region & window recordings work the same on both.
//!
//! - **Multi-monitor.** The display the user picked is mapped to its
//!   AVFoundation "Capture screen N" via its position in
//!   `CGGetActiveDisplayList` (which xcap's `Monitor::all()` mirrors), so
//!   secondary displays record correctly — see `screen_input_index`.
//! - **Retina.** `recording::apply_device_scale` lifts xcap's logical
//!   `source`/`crop` into the physical pixels AVFoundation delivers (using
//!   `Monitor::scale_factor`), and the cursor track is scaled to match. So
//!   crops land on-target and recordings keep full Retina resolution.
//!
//! ## Known limitations
//!
//! - **Permissions.** First record requires Screen Recording consent in
//!   System Settings → Privacy & Security. FFmpeg will spawn but
//!   produce zero frames until granted; the encoder's empty-output
//!   timeout will surface it.
//! - **Whole-display capture for regions.** Like the Windows path, a small
//!   region on a large display still pipes full-display frames to the
//!   encoder before cropping. Cropping inside AVFoundation would be lighter
//!   but is a cross-platform optimization, not a macOS-specific one.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};

use xcap::Monitor;

use crate::capture::CaptureSource;
use crate::recording::CaptureTarget;

pub fn create_source(target: &CaptureTarget) -> Result<Box<dyn CaptureSource>> {
    if target.source.width == 0 || target.source.height == 0 {
        return Err(anyhow!(
            "macOS capture: source has zero dimensions ({}x{}) — \
             the source picker did not report a usable size",
            target.source.width,
            target.source.height
        ));
    }
    // AVFoundation numbers its "Capture screen N" inputs in CGGetActiveDisplayList
    // order — the same order xcap's `Monitor::all()` returns — so the captured
    // display's position in that list is its screen ordinal. Map the target
    // display to that ordinal instead of always grabbing the first screen, so
    // multi-monitor users record the display they actually picked.
    let ordinal = screen_ordinal_for_display(target.display_id);
    let screen_index = screen_input_index(ordinal).context(
        "no matching 'Capture screen' device in the AVFoundation listing — \
         ensure Screen Recording is granted in System Settings → \
         Privacy & Security and that FFmpeg has avfoundation support",
    )?;
    // Capture the WHOLE display at its physical resolution and let the encoder
    // crop to the requested region. This is the cross-platform CaptureSource
    // contract (the Windows DXGI path does the same): the source always emits
    // full-`source`-sized frames; region/window cropping is the encoder's job.
    // `target.source` is already in physical device pixels (see
    // `apply_device_scale` in recording/mod.rs).
    let source =
        MacosCaptureSource::start(screen_index, target.source.width, target.source.height)?;
    Ok(Box::new(source))
}

struct MacosCaptureSource {
    child: Child,
    width: u32,
    height: u32,
    frame_bytes: usize,
    buf: Vec<u8>,
}

impl MacosCaptureSource {
    fn start(screen_index: u32, width: u32, height: u32) -> Result<Self> {
        // The pacer in `recording/pipeline.rs` runs at a fixed
        // `target_fps`. Asking AVFoundation for a slightly higher rate
        // (60) leaves slack for the pacer's MAX_DRAIN to pick the
        // freshest frame rather than emit a stale cached one.
        let request_fps = 60u32;
        // AVFoundation's input string: "<video>:<audio>". We do not
        // capture audio here (audio comes from `audio/platform/ffmpeg_unix.rs`),
        // so the audio side stays empty.
        let input = format!("{screen_index}:");
        // Normalize the captured display to the exact (physical) `source` size
        // the encoder declares, then stop — we deliberately do NOT crop here.
        // Region/window cropping is the encoder's job (`crop_relative_to_source`),
        // so this source always emits full-`source`-sized frames like every
        // other platform's CaptureSource. When AVFoundation already delivers at
        // `width`x`height` (the common case) swscale fast-paths the no-op.
        //
        // (History: this filter used to also `crop=W:H:X:Y` to the region and
        // emit crop-sized frames, which collided with the encoder's own crop and
        // corrupted region/window recordings — frames were the wrong byte size.)
        let filter = format!("scale={width}:{height}");
        let mut command = Command::new(crate::ffmpeg::ffmpeg_path());
        command
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "avfoundation",
                // Draw the OS cursor into the captured frames. Mirrors
                // CursorMode::Embedded on the Wayland path so the
                // editor's stylized cursor lands on top of a real
                // pixel-baked cursor (we record positions separately).
                "-capture_cursor",
                "1",
                "-framerate",
                &request_fps.to_string(),
                "-i",
                &input,
                "-vf",
                &filter,
                "-pix_fmt",
                "bgra",
                "-f",
                "rawvideo",
                "-",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::ffmpeg::configure_silent_command(&mut command);
        let child = command
            .spawn()
            .context("failed to spawn FFmpeg avfoundation screen capture")?;
        let frame_bytes = (width as usize) * (height as usize) * 4;
        // Pre-allocate the frame buffer once. `capture_next` reads into
        // this slice and clones it on success; the alloc cost stays out
        // of the per-frame hot path.
        Ok(Self {
            child,
            width,
            height,
            frame_bytes,
            buf: vec![0u8; frame_bytes],
        })
    }
}

impl CaptureSource for MacosCaptureSource {
    fn capture_next(&mut self, _timeout: Duration) -> Result<Option<Vec<u8>>> {
        // Same shape as `X11CaptureSource::capture_next` — the pacer's
        // `MAX_DRAIN` cap keeps us from over-capturing, so we just do a
        // blocking `read_exact`-style pull of one whole frame.
        let stdout = self
            .child
            .stdout
            .as_mut()
            .ok_or_else(|| anyhow!("avfoundation FFmpeg stdout pipe missing"))?;
        let mut read = 0usize;
        while read < self.frame_bytes {
            match stdout.read(&mut self.buf[read..]) {
                Ok(0) => {
                    // FFmpeg closed stdout mid-frame — fetch stderr for
                    // the actual error before propagating.
                    let stderr = read_child_stderr(&mut self.child);
                    return Err(anyhow!(
                        "avfoundation capture exited mid-frame ({}/{} bytes read): {}",
                        read,
                        self.frame_bytes,
                        if stderr.is_empty() {
                            "<no stderr — check Screen Recording permission>".to_string()
                        } else {
                            stderr
                        }
                    ));
                }
                Ok(n) => read += n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(anyhow!("avfoundation stdout read failed: {e}")),
            }
        }
        // Clone so the buffer can be reused for the next read while the
        // pipeline owns this frame. The alloc dominates 1080p frame
        // cost (~8 MB) but the underlying frame copy was already
        // unavoidable — FFmpeg writes into our slice, we hand a Vec
        // downstream.
        Ok(Some(self.buf.clone()))
    }

    fn width(&self) -> u32 {
        self.width
    }

    fn height(&self) -> u32 {
        self.height
    }
}

impl Drop for MacosCaptureSource {
    fn drop(&mut self) {
        // Mirror the camera backend's graceful-stop: write `q` to ask
        // FFmpeg to exit cleanly, escalate to kill if it doesn't.
        if let Some(mut stdin) = self.child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(b"q");
            let _ = stdin.flush();
        }
        for _ in 0..40 {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        log::warn!("avfoundation capture did not exit gracefully — killing");
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn read_child_stderr(child: &mut Child) -> String {
    let mut s = String::new();
    if let Some(ref mut e) = child.stderr {
        let _ = e.read_to_string(&mut s);
    }
    if s.len() > 500 {
        s.truncate(500);
    }
    s
}

/// Ordinal (0-based position in `CGGetActiveDisplayList`) of the display with
/// the given `CGDirectDisplayID`. xcap's `Monitor::all()` enumerates in exactly
/// that order, so the index in the returned list is the AVFoundation "Capture
/// screen N" number. Falls back to 0 (the primary) if the id isn't found.
fn screen_ordinal_for_display(display_id: u32) -> u32 {
    Monitor::all()
        .ok()
        .and_then(|monitors| {
            monitors
                .iter()
                .position(|m| m.id().ok() == Some(display_id))
        })
        .map(|pos| pos as u32)
        .unwrap_or(0)
}

/// Parse the cached AVFoundation device listing into `(screen_ordinal,
/// avfoundation_input_index)` pairs. The input index is the global `[N]` FFmpeg
/// assigns across all video devices (cameras come first, then screens), which
/// is what `-i "N:"` expects; the screen ordinal is the number in the
/// "Capture screen K" label. Cached for the process lifetime — the listing is
/// shared with the camera/audio probes via `ffmpeg::cached_avfoundation_devices`.
fn capture_screen_indices() -> &'static [(u32, u32)] {
    static CACHED: OnceLock<Vec<(u32, u32)>> = OnceLock::new();
    CACHED.get_or_init(|| {
        let stderr = crate::ffmpeg::cached_avfoundation_devices();
        let mut out = Vec::new();
        let mut in_video = false;
        for line in stderr.lines() {
            if line.contains("video devices:") {
                in_video = true;
                continue;
            }
            if line.contains("audio devices:") {
                in_video = false;
                continue;
            }
            if !in_video {
                continue;
            }
            let lower = line.to_ascii_lowercase();
            let Some(pos) = lower.find("capture screen") else {
                continue;
            };
            // Screen ordinal: the first integer after "capture screen".
            let after = lower[pos + "capture screen".len()..].trim_start();
            let ordinal: u32 = match after
                .split(|c: char| !c.is_ascii_digit())
                .find(|t| !t.is_empty())
                .and_then(|t| t.parse().ok())
            {
                Some(n) => n,
                None => continue,
            };
            // Global input index: the last `[N]` bracket pair BEFORE the
            // "Capture screen" text (skips the `[AVFoundation indev @ 0x..]`
            // log prefix and never reads into the label itself).
            let prefix = &line[..pos];
            let Some(close) = prefix.rfind(']') else {
                continue;
            };
            let Some(open) = prefix[..close].rfind('[') else {
                continue;
            };
            if let Ok(global) = prefix[open + 1..close].trim().parse::<u32>() {
                out.push((ordinal, global));
            }
        }
        out
    })
}

/// AVFoundation input index for the "Capture screen {ordinal}" device, falling
/// back to the lowest-ordinal screen when the exact ordinal isn't listed (so a
/// stale display arrangement still records *something* rather than failing).
fn screen_input_index(ordinal: u32) -> Result<u32> {
    let map = capture_screen_indices();
    if let Some((_, idx)) = map.iter().find(|(ord, _)| *ord == ordinal) {
        return Ok(*idx);
    }
    map.iter()
        .min_by_key(|(ord, _)| *ord)
        .map(|(_, idx)| *idx)
        .ok_or_else(|| anyhow!("no 'Capture screen' device in AVFoundation listing"))
}
