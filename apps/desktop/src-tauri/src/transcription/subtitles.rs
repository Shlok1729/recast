//! Subtitle serialization (SRT / WebVTT) from a transcript — the "soft
//! captions" sidecar half of M4. Burned-in (ASS via FFmpeg) comes later.

use super::Transcript;

pub fn to_srt(t: &Transcript) -> String {
    let mut out = String::new();
    for (i, seg) in t.segments.iter().enumerate() {
        out.push_str(&format!("{}\n", i + 1));
        out.push_str(&format!(
            "{} --> {}\n",
            ts(seg.start, ','),
            ts(seg.end, ',')
        ));
        out.push_str(seg.text.trim());
        out.push_str("\n\n");
    }
    out
}

pub fn to_vtt(t: &Transcript) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for seg in &t.segments {
        out.push_str(&format!(
            "{} --> {}\n",
            ts(seg.start, '.'),
            ts(seg.end, '.')
        ));
        out.push_str(seg.text.trim());
        out.push_str("\n\n");
    }
    out
}

/// `HH:MM:SS<sep>mmm` — SRT uses `,` before milliseconds, WebVTT uses `.`.
fn ts(seconds: f64, sep: char) -> String {
    let total_ms = (seconds.max(0.0) * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let total_s = total_ms / 1000;
    format!(
        "{:02}:{:02}:{:02}{}{:03}",
        total_s / 3600,
        (total_s / 60) % 60,
        total_s % 60,
        sep,
        ms
    )
}
