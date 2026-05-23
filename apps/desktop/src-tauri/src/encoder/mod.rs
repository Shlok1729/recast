use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};

use crate::recording::{pipeline::RecordingPipeline, CaptureArea};

/// Best-effort drain of FFmpeg's stderr after the process has exited.
/// Returns up to ~4KB of the tail so the encoder error message
/// surfaces *why* FFmpeg died (codec error, disk full, etc.) instead
/// of the cryptic "The pipe is being closed. (os error 232)" the OS
/// reports when we write to a dead child's stdin.
fn drain_child_stderr(child: &mut Child) -> String {
    let Some(mut stderr) = child.stderr.take() else {
        return String::new();
    };
    let mut buf = String::new();
    let _ = stderr.read_to_string(&mut buf);
    // Tail-only — the trailing lines are where the actual fatal
    // message lives; FFmpeg's startup chatter is noise.
    if buf.len() > 4096 {
        let cut = buf.len() - 4096;
        // Skip to the next newline so we don't start mid-UTF8-codepoint.
        if let Some(nl) = buf[cut..].find('\n') {
            buf.drain(..cut + nl + 1);
        } else {
            buf.drain(..cut);
        }
    }
    buf.trim().to_string()
}

/// Configuration for the live recording encoder.
#[derive(Clone, Debug)]
pub struct EncoderConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub crop: Option<CaptureArea>,
    pub output_path: PathBuf,
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

            // Per-codec quality knobs. Hardware encoders get a low-latency
            // preset matched to live capture; libx264 stays on `ultrafast`
            // so weak CPUs (older laptops, no GPU at all) don't drop
            // frames during recording — quality is recovered later by the
            // export pipeline if the user re-encodes.
            match encoder {
                "h264_nvenc" => {
                    args.extend([
                        "-c:v".to_string(),
                        "h264_nvenc".to_string(),
                        "-preset".to_string(),
                        "p5".to_string(),
                        "-tune".to_string(),
                        "ll".to_string(),
                        "-pix_fmt".to_string(),
                        "yuv420p".to_string(),
                    ]);
                }
                "h264_amf" => {
                    args.extend([
                        "-c:v".to_string(),
                        "h264_amf".to_string(),
                        "-quality".to_string(),
                        "speed".to_string(),
                        "-usage".to_string(),
                        "lowlatency".to_string(),
                        "-pix_fmt".to_string(),
                        "yuv420p".to_string(),
                    ]);
                }
                "h264_qsv" => {
                    args.extend([
                        "-c:v".to_string(),
                        "h264_qsv".to_string(),
                        "-preset".to_string(),
                        "veryfast".to_string(),
                        "-pix_fmt".to_string(),
                        "nv12".to_string(),
                    ]);
                }
                _ => {
                    args.extend([
                        "-c:v".to_string(),
                        "libx264".to_string(),
                        "-preset".to_string(),
                        "ultrafast".to_string(),
                        "-tune".to_string(),
                        "zerolatency".to_string(),
                        "-pix_fmt".to_string(),
                        "yuv420p".to_string(),
                    ]);
                }
            }

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
            let stats = pipeline.stats();

            // Frame counter — check FFmpeg's liveness periodically (every
            // ~30 frames, ~0.5s at 60fps) instead of every iteration. The
            // try_wait syscall is cheap but not free; checking each frame
            // would add noticeable overhead to the hot path.
            let mut frames_since_alive_check: u32 = 0;
            const ALIVE_CHECK_EVERY: u32 = 30;

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
                            let stderr_tail = drain_child_stderr(&mut child);
                            return Err(anyhow!(
                                "ffmpeg encoder exited unexpectedly mid-recording \
                                 (status: {status}). Last stderr output:\n{stderr_tail}"
                            ));
                        }
                    }
                    frames_since_alive_check += 1;

                    if let Err(e) = stdin.write_all(&frame.data) {
                        // Broken pipe — FFmpeg died between our liveness
                        // check and this write. Surface the real reason
                        // by draining stderr.
                        drop(stdin);
                        let _ = child.wait();
                        let stderr_tail = drain_child_stderr(&mut child);
                        return Err(anyhow!(
                            "ffmpeg encoder stdin write failed ({e}). \
                             FFmpeg likely exited mid-recording. \
                             Last stderr output:\n{stderr_tail}"
                        ));
                    }
                    stats.encoded_frames.fetch_add(1, Ordering::Relaxed);
                    continue;
                }

                if stop_flag.load(Ordering::Acquire) && pipeline.is_empty() {
                    break;
                }

                thread::sleep(Duration::from_millis(2));
            }

            drop(stdin);

            let output = child.wait_with_output()?;
            if !output.status.success() {
                return Err(anyhow!(
                    "ffmpeg encoder failed (status: {}): {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr)
                ));
            }

            Ok(())
        })
        .map_err(Into::into)
}
