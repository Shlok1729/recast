//! On-demand Google Fonts: fetch a family's woff2 once and cache it on device,
//! so captions (and later annotations) can render any Google font offline after
//! the first use. Returns a local path the frontend loads via the FontFace API.

use tauri::{AppHandle, Manager};

/// Ensure the woff2 for `family` at `weight` is cached under
/// `app_data/fonts/`, downloading it from Google Fonts on first use. Returns the
/// local file path.
#[tauri::command]
pub async fn ensure_google_font(
    app: AppHandle,
    family: String,
    weight: u32,
) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?
        .join("fonts");
    let safe: String = family
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    let dest = dir.join(format!("{safe}-{weight}.woff2"));
    if dest.exists() {
        return Ok(dest.to_string_lossy().to_string());
    }

    // A modern browser UA makes Google Fonts serve woff2 (older UAs get ttf).
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .build()
        .map_err(|e| format!("client: {e}"))?;

    let css_url = format!(
        "https://fonts.googleapis.com/css2?family={}:wght@{weight}&display=swap",
        family.replace(' ', "+")
    );
    let css = client
        .get(&css_url)
        .send()
        .await
        .map_err(|e| format!("font css request: {e}"))?
        .error_for_status()
        .map_err(|e| format!("font css http: {e}"))?
        .text()
        .await
        .map_err(|e| format!("font css body: {e}"))?;

    let woff2 = extract_woff2(&css)
        .ok_or_else(|| format!("no woff2 URL for '{family}' in Google Fonts CSS"))?;

    crate::transcription::download_file(&client, &woff2, None, &dest, |_, _| {}).await?;
    Ok(dest.to_string_lossy().to_string())
}

/// Pull the first `…woff2` URL out of a Google Fonts `css2` response
/// (`src: url(https://fonts.gstatic.com/…woff2) format('woff2')`).
fn extract_woff2(css: &str) -> Option<String> {
    for part in css.split("url(").skip(1) {
        let end = part.find(')')?;
        let raw = part[..end].trim_matches(|c| c == '"' || c == '\'');
        if raw.ends_with(".woff2") {
            return Some(raw.to_string());
        }
    }
    None
}
