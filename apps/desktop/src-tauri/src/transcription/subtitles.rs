//! Subtitle serialization from a transcript: SRT / WebVTT sidecars, plus ASS
//! for the FFmpeg burn-in path (libass renders the styled overlay into pixels).

use super::{CaptionStyle, Transcript};

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

/// Render a transcript to an ASS subtitle script for FFmpeg's `ass`/`subtitles`
/// burn-in filter, styled from `CaptionStyle`. `play_w`/`play_h` are the canvas
/// dimensions captions are laid out against (the composite size, pre-downscale),
/// so font size / margins resolve in the same pixel space as the preview.
/// `offset` is the trim start (seconds): burn-in is injected before the cut /
/// speed stage, so times are on the trimmed-but-uncut axis and the later
/// select/setpts re-times the burned pixels. `clip_len` caps the output.
pub fn to_ass(
    t: &Transcript,
    style: &CaptionStyle,
    play_w: u32,
    play_h: u32,
    offset: f64,
    clip_len: f64,
) -> String {
    let font = ass_font_name(&style.font_family);
    let font_size = (style.font_size_pct / 100.0 * play_h as f64).max(8.0);
    let bold = if style.font_weight >= 600 { -1 } else { 0 };
    let spacing = style.letter_spacing * font_size;
    let outline_px = (style.outline_width / 100.0 * font_size).max(0.0);

    let primary = ass_color(&style.color, 0.0);
    let outline_col = ass_color(&style.outline_color, 0.0);
    // ASS BackColour alpha: 00 = opaque, FF = transparent (inverse of our %).
    let back_col = ass_color(&style.background_color, 100.0 - style.background_opacity);

    let (border_style, outline, shadow) = match style.background.as_str() {
        "box" => (3, outline_px.max(font_size * 0.08), 0.0),
        "soft" => (1, outline_px, (font_size * 0.04).max(1.5)),
        _ => (1, outline_px, 0.0),
    };

    let alignment = match style.position.as_str() {
        "top" => 8,
        "center" => 5,
        _ => 2,
    };
    let margin_v = (style.offset_pct / 100.0 * play_h as f64).round() as i32;

    let mut out = String::new();
    out.push_str("[Script Info]\n");
    out.push_str("ScriptType: v4.00+\n");
    out.push_str("WrapStyle: 0\n");
    out.push_str("ScaledBorderAndShadow: yes\n");
    out.push_str(&format!("PlayResX: {play_w}\nPlayResY: {play_h}\n\n"));

    out.push_str("[V4+ Styles]\n");
    out.push_str(
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, \
BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, \
Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n",
    );
    out.push_str(&format!(
        "Style: Default,{font},{size:.0},{primary},{primary},{outline_col},{back_col},{bold},0,0,0,\
100,100,{spacing:.1},0,{border_style},{outline:.1},{shadow:.1},{alignment},40,40,{margin_v},1\n\n",
        size = font_size,
    ));

    out.push_str("[Events]\n");
    out.push_str("Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text\n");
    for seg in &t.segments {
        let start = (seg.start - offset).max(0.0);
        let mut end = seg.end - offset;
        if end <= 0.0 || start >= clip_len {
            continue;
        }
        if clip_len > 0.0 {
            end = end.min(clip_len);
        }
        if end <= start {
            continue;
        }
        out.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            ass_time(start),
            ass_time(end),
            ass_text(&seg.text, style.uppercase),
        ));
    }
    out
}

/// First family of a CSS stack, unquoted, with web generics mapped to a font
/// libass can resolve on the host (`system-ui` → Arial, etc.).
fn ass_font_name(stack: &str) -> String {
    let first = stack.split(',').next().unwrap_or(stack).trim();
    let name = first.trim_matches(|c| c == '\'' || c == '"').trim();
    match name {
        "system-ui" | "sans-serif" | "" => "Arial".to_string(),
        "serif" => "Times New Roman".to_string(),
        "monospace" => "Courier New".to_string(),
        other => other.to_string(),
    }
}

/// `#RRGGBB` + 0–100 transparency → ASS `&HAABBGGRR` (AA: 00 opaque, FF clear).
fn ass_color(hex: &str, transparency_pct: f64) -> String {
    let h = hex.trim_start_matches('#');
    let r = u8::from_str_radix(h.get(0..2).unwrap_or("ff"), 16).unwrap_or(255);
    let g = u8::from_str_radix(h.get(2..4).unwrap_or("ff"), 16).unwrap_or(255);
    let b = u8::from_str_radix(h.get(4..6).unwrap_or("ff"), 16).unwrap_or(255);
    let a = (transparency_pct.clamp(0.0, 100.0) / 100.0 * 255.0).round() as u8;
    format!("&H{a:02X}{b:02X}{g:02X}{r:02X}")
}

/// `H:MM:SS.cc` (centiseconds) — the ASS time format.
fn ass_time(seconds: f64) -> String {
    let total_cs = (seconds.max(0.0) * 100.0).round() as u64;
    let cs = total_cs % 100;
    let total_s = total_cs / 100;
    format!(
        "{}:{:02}:{:02}.{:02}",
        total_s / 3600,
        (total_s / 60) % 60,
        total_s % 60,
        cs
    )
}

/// Sanitize segment text for an ASS Dialogue line: strip override braces, fold
/// hard newlines to `\N`, optionally uppercase.
fn ass_text(text: &str, uppercase: bool) -> String {
    let cleaned = text.trim().replace(['{', '}'], "");
    let joined = cleaned
        .split(['\n', '\r'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\\N");
    if uppercase {
        joined.to_uppercase()
    } else {
        joined
    }
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
