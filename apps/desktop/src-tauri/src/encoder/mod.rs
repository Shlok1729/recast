use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{ChildStderr, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};

use crate::recording::{pipeline::RecordingPipeline, CaptureArea};

/// Maximum stderr tail retained for diagnostics. The fatal line is always at
/// the end (codec error, disk full, etc.); FFmpeg's startup chatter is noise.
const STDERR_TAIL_LIMIT: usize = 8192;

/// Continuously read FFmpeg's stderr to EOF, keeping only the last
/// `STDERR_TAIL_LIMIT` bytes in `sink`. Runs on its own thread for the whole
/// life of the process so the stderr pipe is *always* drained.
///
/// This is load-bearing, not just for diagnostics: FFmpeg writes its banner
/// and periodic `frame=… fps=…` progress to stderr. If nobody reads it, the
/// ~64KB OS pipe buffer fills on a long recording, FFmpeg blocks on the stderr
/// `write()`, stops reading stdin, and the encoder thread's `stdin.write_all`
/// below deadlocks — the capture freezes mid-recording. macOS/Linux default to
/// smaller pipe buffers than Windows, so they hit it sooner. Draining on a side
/// thread also means the `child.wait()` calls on the error paths can never hang
/// waiting for a stderr-blocked process to exit.
fn pump_stderr_tail(stderr: ChildStderr, sink: Arc<Mutex<String>>) {
    let mut reader = std::io::BufReader::new(stderr);
    let mut chunk = [0u8; 4096];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break, // EOF — FFmpeg closed stderr (i.e. exited).
            Ok(n) => {
                if let Ok(mut tail) = sink.lock() {
                    tail.push_str(&String::from_utf8_lossy(&chunk[..n]));
                    if tail.len() > STDERR_TAIL_LIMIT {
                        let mut cut = tail.len() - STDERR_TAIL_LIMIT;
                        // Prefer a newline boundary so the tail starts on a
                        // clean line; fall back to the raw offset.
                        if let Some(nl) = tail[cut..].find('\n') {
                            cut += nl + 1;
                        }
                        // `drain` panics on a non-char boundary (lossy decoding
                        // can leave multi-byte chars straddling chunks), so back
                        // off to the nearest boundary first.
                        while cut < tail.len() && !tail.is_char_boundary(cut) {
                            cut += 1;
                        }
                        tail.drain(..cut);
                    }
                }
            }
            Err(_) => break,
        }
    }
}

/// Join the stderr pump (if it was spawned) and return the retained tail.
/// The pump exits when FFmpeg closes stderr, so the process must already have
/// exited — or be exiting — before this is called.
fn collect_stderr_tail(
    pump: &mut Option<thread::JoinHandle<()>>,
    sink: &Arc<Mutex<String>>,
) -> String {
    if let Some(handle) = pump.take() {
        let _ = handle.join();
    }
    sink.lock()
        .map(|t| t.trim().to_string())
        .unwrap_or_default()
}

/// Capture-time quality tier for the live recorder.
///
/// `Balanced` is the historical default and emits byte-identical encoder args
/// (fast preset + low-latency tune, no explicit rate control), so existing
/// recordings are unchanged. `High`/`Pristine` trade real-time encode headroom
/// for fidelity: the quality tune plus an explicit near-visually-lossless
/// constant-quality target.
///
/// Every tier stays 8-bit 4:2:0 (`yuv420p` / `nv12`). The editor previews the
/// raw `recording.mp4` in a WebView `<video>` element whose H.264 decoder only
/// supports up to High profile (4:2:0) — a 4:4:4 master would capture sharper
/// text but would not play back in the editor, so it's intentionally not an
/// option here. (A future "export-only master" could revisit 4:4:4 with a
/// transcode-for-preview step.)
///
/// Falling behind real time at a heavy tier degrades gracefully: the pacer
/// drops frames and the encoder loop re-emits duplicates (see the drop
/// compensation above), so the worst case is motion judder, never A/V desync.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum RecordingQuality {
    #[default]
    Balanced,
    High,
    Pristine,
}

impl RecordingQuality {
    /// Parse the frontend's string tier; anything unrecognized (incl. `None`)
    /// falls back to `Balanced` so an old/garbled payload can never break a
    /// recording.
    pub fn from_label(label: Option<&str>) -> Self {
        match label {
            Some("high") => Self::High,
            Some("pristine") => Self::Pristine,
            _ => Self::Balanced,
        }
    }
}

/// Build the codec + rate-control args (from `-c:v` onward) for a live
/// recording, given the probed hardware encoder and the requested quality
/// tier. `Balanced` reproduces the exact historical args for every encoder.
fn recording_codec_args(encoder: &str, quality: RecordingQuality) -> Vec<String> {
    let v = |args: &[&str]| args.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    use RecordingQuality::*;
    match (encoder, quality) {
        // NVIDIA NVENC — `cq` is constant-quality (lower = better, 0..51).
        ("h264_nvenc", Balanced) => v(&[
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p5",
            "-tune",
            "ll",
            "-pix_fmt",
            "yuv420p",
        ]),
        ("h264_nvenc", High) => v(&[
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p6",
            "-tune",
            "hq",
            "-rc",
            "vbr",
            "-cq",
            "21",
            "-b:v",
            "0",
            "-pix_fmt",
            "yuv420p",
        ]),
        ("h264_nvenc", Pristine) => v(&[
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p7",
            "-tune",
            "hq",
            "-rc",
            "vbr",
            "-cq",
            "16",
            "-b:v",
            "0",
            "-pix_fmt",
            "yuv420p",
        ]),

        // AMD AMF — `qp_i/qp_p` mirror the NVENC cq range.
        ("h264_amf", Balanced) => v(&[
            "-c:v",
            "h264_amf",
            "-quality",
            "speed",
            "-usage",
            "lowlatency",
            "-pix_fmt",
            "yuv420p",
        ]),
        ("h264_amf", High) => v(&[
            "-c:v",
            "h264_amf",
            "-quality",
            "balanced",
            "-usage",
            "transcoding",
            "-rc",
            "cqp",
            "-qp_i",
            "21",
            "-qp_p",
            "21",
            "-pix_fmt",
            "yuv420p",
        ]),
        ("h264_amf", Pristine) => v(&[
            "-c:v",
            "h264_amf",
            "-quality",
            "quality",
            "-usage",
            "transcoding",
            "-rc",
            "cqp",
            "-qp_i",
            "16",
            "-qp_p",
            "16",
            "-pix_fmt",
            "yuv420p",
        ]),

        // Intel Quick Sync — `global_quality` is its constant-quality knob.
        ("h264_qsv", Balanced) => v(&[
            "-c:v", "h264_qsv", "-preset", "veryfast", "-pix_fmt", "nv12",
        ]),
        ("h264_qsv", High) => v(&[
            "-c:v",
            "h264_qsv",
            "-preset",
            "medium",
            "-global_quality",
            "21",
            "-pix_fmt",
            "nv12",
        ]),
        ("h264_qsv", Pristine) => v(&[
            "-c:v",
            "h264_qsv",
            "-preset",
            "slow",
            "-global_quality",
            "16",
            "-pix_fmt",
            "nv12",
        ]),

        // libx264 software fallback. Balanced keeps zerolatency/ultrafast so
        // weak CPUs don't drop; higher tiers drop zerolatency and lower CRF.
        (_, Balanced) => v(&[
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-pix_fmt",
            "yuv420p",
        ]),
        (_, High) => v(&[
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        ]),
        (_, Pristine) => v(&[
            "-c:v", "libx264", "-preset", "faster", "-crf", "16", "-pix_fmt", "yuv420p",
        ]),
    }
}

/// Configuration for the live recording encoder.
#[derive(Clone, Debug)]
pub struct EncoderConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub crop: Option<CaptureArea>,
    pub output_path: PathBuf,
    /// Capture-time quality tier. `Default` (`Balanced`) keeps the historical
    /// fast/low-latency encoder args unchanged.
    pub quality: RecordingQuality,
}

/// Number of duplicate frames to emit alongside one real frame to make up
/// for pacer drops, bounded by `cap` so a large backlog drains over several
/// iterations rather than blocking the encode loop in one burst. The residual
/// (anything above `cap`) is flushed after the capture loop ends.
fn dup_count(total_drops: u64, compensated: u64, cap: u64) -> u64 {
    total_drops.saturating_sub(compensated).min(cap)
}

fn build_video_filter(crop: Option<CaptureArea>) -> Option<String> {
    crop.map(|area| {
        format!(
            "crop={}:{}:{}:{}",
            area.width,
            area.height,
            area.x.max(0),
            area.y.max(0)
        )
    })
}

/// Spawn the encoder thread. Pulls raw BGRA frames from the pipeline
/// and pipes them to FFmpeg for H.264 encoding.
pub fn spawn_encoder_loop(
    config: EncoderConfig,
    stop_flag: Arc<AtomicBool>,
    pipeline: RecordingPipeline,
) -> Result<thread::JoinHandle<Result<()>>> {
    thread::Builder::new()
        .name("recast-encoder".into())
        .spawn(move || {
            let encoder = crate::ffmpeg::preferred_h264_encoder();
            let mut args = vec![
                "-y".to_string(),
                "-f".to_string(),
                "rawvideo".to_string(),
                "-pixel_format".to_string(),
                "bgra".to_string(),
                "-video_size".to_string(),
                format!("{}x{}", config.width, config.height),
                "-framerate".to_string(),
                config.fps.to_string(),
                "-i".to_string(),
                "-".to_string(),
                "-an".to_string(),
            ];

            if let Some(filter) = build_video_filter(config.crop) {
                args.extend(["-vf".to_string(), filter]);
            }

            // Per-codec quality knobs for the requested capture tier. Hardware
            // encoders get a low-latency preset matched to live capture on the
            // default (`Balanced`) tier; `High`/`Pristine` raise fidelity at the
            // cost of real-time headroom. libx264 stays on `ultrafast` for the
            // default tier so weak CPUs (older laptops, no GPU at all) don't
            // drop frames during recording.
            args.extend(recording_codec_args(encoder, config.quality));

            args.push(config.output_path.to_string_lossy().to_string());

            let mut command = Command::new(crate::ffmpeg::ffmpeg_path());
            command
                .args(&args)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::piped());
            crate::ffmpeg::configure_silent_command(&mut command);
            let mut child = command
                .spawn()
                .with_context(|| "failed to start ffmpeg encoder")?;

            let mut stdin = child
                .stdin
                .take()
                .context("ffmpeg encoder stdin was not available")?;

            // Drain stderr continuously on a side thread — see `pump_stderr_tail`
            // for why this is required (deadlock avoidance), not just nice-to-have.
            let stderr_tail = Arc::new(Mutex::new(String::new()));
            let mut stderr_pump = match child.stderr.take() {
                Some(stderr) => {
                    let sink = stderr_tail.clone();
                    thread::Builder::new()
                        .name("recast-encoder-stderr".into())
                        .spawn(move || pump_stderr_tail(stderr, sink))
                        .ok()
                }
                None => None,
            };
            let stats = pipeline.stats();

            // Frame counter — check FFmpeg's liveness periodically (every
            // ~30 frames, ~0.5s at 60fps) instead of every iteration. The
            // try_wait syscall is cheap but not free; checking each frame
            // would add noticeable overhead to the hot path.
            let mut frames_since_alive_check: u32 = 0;
            const ALIVE_CHECK_EVERY: u32 = 30;

            // Dropped-frame compensation. The capture pacer emits exactly
            // `fps` frames per wall-clock second; when the queue saturates
            // (encoder slower than capture), `RecordingPipeline::push` drops
            // the overflow. Because we declare a fixed `-framerate` to FFmpeg
            // and feed timestamp-less rawvideo, every dropped frame would
            // otherwise SHORTEN the output below real time — the recording
            // plays back sped-up and drifts out of sync with the cursor track
            // and audio (which are wall-clock-timed). To keep
            // `encoded == captured` (1 wall-clock second == 1 second of video
            // PTS), we re-emit a duplicate of the most recent frame once per
            // drop. A duplicate of an unchanged frame is ~free for every
            // encoder (a skipped / near-zero-byte P-frame), so this can't
            // meaningfully worsen the backpressure that caused the drop.
            let mut compensated_drops: u64 = 0;
            let mut last_frame: Option<std::sync::Arc<[u8]>> = None;
            // Bound the dup burst per real frame so a large backlog drains
            // over a few iterations instead of blocking the loop at once; any
            // residual is flushed after the loop.
            const MAX_DUPS_PER_ITER: u64 = 120;

            loop {
                if let Some(frame) = pipeline.pop() {
                    // Detect FFmpeg early exit BEFORE writing — otherwise
                    // write_all returns "The pipe is being closed.
                    // (os error 232)" on Windows, which surfaces to the
                    // user as a meaningless OS error instead of the actual
                    // ffmpeg failure reason.
                    if frames_since_alive_check >= ALIVE_CHECK_EVERY {
                        frames_since_alive_check = 0;
                        if let Ok(Some(status)) = child.try_wait() {
                            drop(stdin);
                            let tail = collect_stderr_tail(&mut stderr_pump, &stderr_tail);
                            return Err(anyhow!(
                                "ffmpeg encoder exited unexpectedly mid-recording \
                                 (status: {status}). Last stderr output:\n{tail}"
                            ));
                        }
                    }
                    frames_since_alive_check += 1;

                    // Emit the real frame, then one duplicate for each pacer
                    // drop seen since our last write (capped per iteration).
                    let drops = stats.dropped_frames.load(Ordering::Relaxed);
                    let dups = dup_count(drops, compensated_drops, MAX_DUPS_PER_ITER);
                    compensated_drops += dups;
                    for _ in 0..(1 + dups) {
                        if let Err(e) = stdin.write_all(&frame.data) {
                            // Broken pipe — FFmpeg died between our liveness
                            // check and this write. The stderr pump is already
                            // draining, so `wait()` can't hang; surface the real
                            // reason from the captured tail.
                            drop(stdin);
                            let _ = child.wait();
                            let tail = collect_stderr_tail(&mut stderr_pump, &stderr_tail);
                            return Err(anyhow!(
                                "ffmpeg encoder stdin write failed ({e}). \
                                 FFmpeg likely exited mid-recording. \
                                 Last stderr output:\n{tail}"
                            ));
                        }
                        stats.encoded_frames.fetch_add(1, Ordering::Relaxed);
                    }
                    last_frame = Some(frame.data.clone());
                    continue;
                }

                if stop_flag.load(Ordering::Acquire) && pipeline.is_empty() {
                    break;
                }

                thread::sleep(Duration::from_millis(2));
            }

            // Final reconciliation: flush any drops not yet compensated (e.g.
            // a backlog that exceeded the per-iteration cap right at the end)
            // as duplicates of the last real frame, so total encoded frames
            // equal total captured frames and the video length matches the
            // wall-clock recording length to the frame.
            if let Some(last) = last_frame {
                let drops = stats.dropped_frames.load(Ordering::Relaxed);
                let mut remaining = drops.saturating_sub(compensated_drops);
                while remaining > 0 {
                    if stdin.write_all(&last).is_err() {
                        break;
                    }
                    stats.encoded_frames.fetch_add(1, Ordering::Relaxed);
                    remaining -= 1;
                }
            }

            drop(stdin);

            // stdout is `Stdio::null` and stderr is drained by the pump, so a
            // bare `wait()` is sufficient and can't deadlock.
            let status = child.wait()?;
            let tail = collect_stderr_tail(&mut stderr_pump, &stderr_tail);
            if !status.success() {
                return Err(anyhow!("ffmpeg encoder failed (status: {status}): {tail}"));
            }

            Ok(())
        })
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::{build_video_filter, dup_count, recording_codec_args, RecordingQuality};
    use crate::recording::CaptureArea;

    #[test]
    fn recording_quality_parses_with_safe_default() {
        assert_eq!(
            RecordingQuality::from_label(Some("high")),
            RecordingQuality::High
        );
        assert_eq!(
            RecordingQuality::from_label(Some("pristine")),
            RecordingQuality::Pristine
        );
        // Unknown / missing / default → Balanced, never an error.
        assert_eq!(
            RecordingQuality::from_label(Some("balanced")),
            RecordingQuality::Balanced
        );
        assert_eq!(
            RecordingQuality::from_label(Some("garbage")),
            RecordingQuality::Balanced
        );
        assert_eq!(
            RecordingQuality::from_label(None),
            RecordingQuality::Balanced
        );
    }

    #[test]
    fn balanced_tier_reproduces_historical_args_exactly() {
        // Regression guard: the default tier must be byte-identical to the
        // pre-quality-tier encoder args so existing recordings don't change.
        assert_eq!(
            recording_codec_args("h264_nvenc", RecordingQuality::Balanced),
            [
                "-c:v",
                "h264_nvenc",
                "-preset",
                "p5",
                "-tune",
                "ll",
                "-pix_fmt",
                "yuv420p"
            ]
        );
        assert_eq!(
            recording_codec_args("h264_amf", RecordingQuality::Balanced),
            [
                "-c:v",
                "h264_amf",
                "-quality",
                "speed",
                "-usage",
                "lowlatency",
                "-pix_fmt",
                "yuv420p"
            ]
        );
        assert_eq!(
            recording_codec_args("h264_qsv", RecordingQuality::Balanced),
            ["-c:v", "h264_qsv", "-preset", "veryfast", "-pix_fmt", "nv12"]
        );
        assert_eq!(
            recording_codec_args("libx264", RecordingQuality::Balanced),
            [
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-tune",
                "zerolatency",
                "-pix_fmt",
                "yuv420p"
            ]
        );
        // Unknown encoder string falls back to the libx264 software path.
        assert_eq!(
            recording_codec_args("something_else", RecordingQuality::Balanced),
            [
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-tune",
                "zerolatency",
                "-pix_fmt",
                "yuv420p"
            ]
        );
    }

    #[test]
    fn higher_tiers_stay_420_and_add_quality_rate_control() {
        for enc in ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"] {
            for q in [RecordingQuality::High, RecordingQuality::Pristine] {
                let args = recording_codec_args(enc, q);
                // Never emit a 4:4:4 pixel format — the editor preview can't
                // decode it.
                assert!(
                    !args.iter().any(|a| a.contains("444")),
                    "{enc}/{q:?} must stay 4:2:0, got {args:?}"
                );
                // Must carry an explicit quality target (cq / qp / global_quality
                // / crf) so it's actually higher quality than Balanced.
                assert!(
                    args.iter().any(|a| matches!(
                        a.as_str(),
                        "-cq" | "-qp_i" | "-global_quality" | "-crf"
                    )),
                    "{enc}/{q:?} must set an explicit quality target, got {args:?}"
                );
            }
        }
    }

    /// Simulate the encoder's emit accounting over a whole recording and
    /// assert the load-bearing invariant: total frames written to FFmpeg
    /// (real + compensating duplicates, including the post-loop flush) equals
    /// the number the pacer captured — so 1 wall-clock second always maps to
    /// 1 second of video PTS regardless of how many frames were dropped.
    fn total_emitted(captured: u64, drops: u64, cap: u64) -> u64 {
        assert!(drops <= captured);
        let real_frames = captured - drops; // frames that made it through the queue
        let mut compensated = 0u64;
        let mut emitted = 0u64;
        for _ in 0..real_frames {
            // Worst case for placement: all drops are already visible by the
            // time each real frame is written.
            let dups = dup_count(drops, compensated, cap);
            compensated += dups;
            emitted += 1 + dups;
        }
        // Post-loop flush of any residual the per-iteration cap left behind.
        emitted += drops.saturating_sub(compensated);
        emitted
    }

    #[test]
    fn no_drops_emits_exactly_captured() {
        assert_eq!(total_emitted(600, 0, 120), 600);
    }

    #[test]
    fn drops_are_fully_compensated_to_match_captured() {
        // Encoded must equal captured across a spread of drop counts and a
        // small cap that forces multi-iteration draining + a final flush.
        for &(captured, drops) in &[(600, 50), (600, 599), (100, 1), (3600, 1200)] {
            assert_eq!(
                total_emitted(captured, drops, 8),
                captured,
                "captured={captured} drops={drops}"
            );
        }
    }

    #[test]
    fn dup_count_is_bounded_by_cap_and_never_over_compensates() {
        assert_eq!(dup_count(100, 0, 30), 30); // capped
        assert_eq!(dup_count(100, 90, 30), 10); // only the remainder
        assert_eq!(dup_count(100, 100, 30), 0); // fully compensated
        assert_eq!(dup_count(5, 9, 30), 0); // never negative
    }

    #[test]
    fn no_crop_yields_no_filter() {
        assert_eq!(build_video_filter(None), None);
    }

    #[test]
    fn crop_renders_ffmpeg_crop_filter() {
        let area = CaptureArea {
            x: 10,
            y: 20,
            width: 100,
            height: 50,
        };
        // Order is width:height:x:y — the FFmpeg `crop` argument order.
        assert_eq!(
            build_video_filter(Some(area)).as_deref(),
            Some("crop=100:50:10:20")
        );
    }

    #[test]
    fn negative_offsets_clamp_to_zero() {
        // A crop origin can go negative after coordinate math; FFmpeg rejects
        // negative offsets, so they must clamp.
        let area = CaptureArea {
            x: -5,
            y: -3,
            width: 40,
            height: 30,
        };
        assert_eq!(
            build_video_filter(Some(area)).as_deref(),
            Some("crop=40:30:0:0")
        );
    }
}
