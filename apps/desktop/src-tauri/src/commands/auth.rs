//! Cloud sign-in via OAuth 2.0 Device Authorization Grant (RFC 8628).
//!
//! Flow from the desktop's point of view:
//!
//!   1. `auth_start` posts to `/api/auth/device/code`, gets a `device_code`,
//!      `user_code`, `verification_uri_complete`, and polling `interval`.
//!      Opens the user's default browser to `verification_uri_complete`
//!      (the verification page with the user code already in the URL).
//!      Returns the `user_code` immediately so the UI can surface it as a
//!      fallback if the browser launch silently failed.
//!   2. A background poller hits `/api/auth/device/token` every `interval`
//!      seconds until it sees `access_token` (approved), `access_denied`,
//!      or the token expires. On success, Better Auth's plugin has already
//!      created a real session row in the same request — so the row's
//!      `ipAddress` and `userAgent` are this desktop's, not the browser's.
//!      We just persist the returned token to the OS keyring.
//!   3. The frontend listens for `auth:signed-in`, `auth:denied`,
//!      `auth:expired`, and `auth:error` events to update its state.
//!
//! Token storage uses `keyring` — DPAPI on Windows, Keychain on macOS,
//! SecretService on Linux. Service name is the bundle identifier.

use std::time::{Duration, Instant};

use keyring::Entry;
use reqwest::header;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const KEYRING_SERVICE: &str = "com.nexonauts.recast";
const KEYRING_ENTRY: &str = "cloud-session-token";
const CLIENT_ID: &str = "recast-desktop";
const DEFAULT_CLOUD_API_URL: &str = "https://recast.nexonauts.com";

/// Resolves the cloud API base URL. Runtime env override (`CLOUD_API_URL`)
/// is honored first so dev builds can point at a local SvelteKit server
/// without recompiling. Trailing slashes are stripped.
fn cloud_api_url() -> String {
    let raw = std::env::var("CLOUD_API_URL").unwrap_or_else(|_| DEFAULT_CLOUD_API_URL.to_string());
    raw.trim_end_matches('/').to_string()
}

fn user_agent() -> String {
    // Better Auth captures this header into session.userAgent. Putting the
    // OS + hostname here gives the user a recognizable label in the future
    // Settings → Devices list ("Kanak-Desktop on Windows") without needing
    // a custom field on the deviceCode body schema.
    let host = hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "Unknown".to_string());
    format!(
        "Recast/{} ({}; {})",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        host
    )
}

fn http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(user_agent())
        .timeout(Duration::from_secs(15))
        .build()
}

fn keyring_entry() -> keyring::Result<Entry> {
    Entry::new(KEYRING_SERVICE, KEYRING_ENTRY)
}

fn store_session_token(token: &str) -> Result<(), String> {
    keyring_entry()
        .and_then(|e| e.set_password(token))
        .map_err(|e| format!("keyring write failed: {e}"))
}

fn read_session_token() -> Option<String> {
    keyring_entry().ok().and_then(|e| e.get_password().ok())
}

fn delete_session_token() -> Result<(), String> {
    match keyring_entry() {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keyring delete failed: {e}")),
        },
        Err(e) => Err(format!("keyring open failed: {e}")),
    }
}

#[derive(Deserialize)]
struct DeviceCodeResp {
    device_code: String,
    user_code: String,
    verification_uri_complete: Option<String>,
    verification_uri: String,
    interval: u64,
    expires_in: u64,
}

#[derive(Deserialize)]
struct DeviceTokenSuccess {
    access_token: String,
}

#[derive(Deserialize)]
struct DeviceTokenError {
    error: String,
}

#[derive(Serialize)]
pub struct AuthStartResult {
    user_code: String,
    verification_uri: String,
    expires_in: u64,
}

#[derive(Serialize, Clone)]
pub struct AuthStatus {
    signed_in: bool,
    email: Option<String>,
    name: Option<String>,
}

/// Kicks off a device-authorization sign-in. Returns immediately with the
/// user code (for UI fallback) and spawns a background poller that emits
/// `auth:signed-in` / `auth:denied` / `auth:expired` / `auth:error` events
/// when the flow terminates.
#[tauri::command]
pub async fn auth_start(app: AppHandle) -> Result<AuthStartResult, String> {
    let client = http_client().map_err(|e| format!("http client init failed: {e}"))?;
    let base = cloud_api_url();

    let resp = client
        .post(format!("{base}/api/auth/device/code"))
        .json(&serde_json::json!({
            "client_id": CLIENT_ID,
            "scope": "sync",
        }))
        .send()
        .await
        .map_err(|e| format!("device/code request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("device/code returned {status}: {body}"));
    }

    let code: DeviceCodeResp = resp
        .json()
        .await
        .map_err(|e| format!("device/code response parse failed: {e}"))?;

    let open_url = code
        .verification_uri_complete
        .clone()
        .unwrap_or_else(|| code.verification_uri.clone());
    if let Err(e) = tauri_plugin_opener::open_url(&open_url, None::<&str>) {
        // Non-fatal — the UI still surfaces the user code so the user can
        // navigate manually. Just log.
        log::warn!("auth: failed to open browser to {open_url}: {e}");
    }

    let result = AuthStartResult {
        user_code: code.user_code.clone(),
        verification_uri: code.verification_uri.clone(),
        expires_in: code.expires_in,
    };

    let poll_app = app.clone();
    let device_code = code.device_code.clone();
    let interval = code.interval.max(1);
    let expires_in = code.expires_in;
    let client_for_poll = client.clone();
    let base_for_poll = base.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = poll_for_token(
            &poll_app,
            &client_for_poll,
            &base_for_poll,
            &device_code,
            interval,
            expires_in,
        )
        .await
        {
            let _ = poll_app.emit("auth:error", e);
        }
    });

    Ok(result)
}

async fn poll_for_token(
    app: &AppHandle,
    client: &reqwest::Client,
    base: &str,
    device_code: &str,
    initial_interval: u64,
    expires_in: u64,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(expires_in);
    let mut interval = initial_interval;

    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if Instant::now() > deadline {
            let _ = app.emit("auth:expired", ());
            return Ok(());
        }

        let resp = client
            .post(format!("{base}/api/auth/device/token"))
            .json(&serde_json::json!({
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": device_code,
                "client_id": CLIENT_ID,
            }))
            .send()
            .await
            .map_err(|e| format!("device/token request failed: {e}"))?;

        let status = resp.status();
        if status.is_success() {
            let body: DeviceTokenSuccess = resp
                .json()
                .await
                .map_err(|e| format!("device/token success parse failed: {e}"))?;
            store_session_token(&body.access_token)?;
            // Surface the new identity so the UI can update without
            // round-tripping through auth_status.
            let status = fetch_status(client, base, &body.access_token).await;
            let _ = app.emit("auth:signed-in", status);
            return Ok(());
        }

        // Non-2xx — try to parse the OAuth error envelope. RFC 8628 reserves
        // a specific set of error codes for the polling path.
        let err: DeviceTokenError = resp.json().await.map_err(|e| {
            format!("device/token error parse failed (status {status}): {e}")
        })?;
        match err.error.as_str() {
            "authorization_pending" => continue,
            "slow_down" => {
                interval = interval.saturating_add(5);
                continue;
            }
            "access_denied" => {
                let _ = app.emit("auth:denied", ());
                return Ok(());
            }
            "expired_token" => {
                let _ = app.emit("auth:expired", ());
                return Ok(());
            }
            other => {
                let _ = app.emit("auth:error", format!("server error: {other}"));
                return Ok(());
            }
        }
    }
}

async fn fetch_status(client: &reqwest::Client, base: &str, token: &str) -> AuthStatus {
    // Better Auth's /api/auth/get-session reads a bearer token or cookie.
    // Bearer is what we have, so set it explicitly.
    let resp = client
        .get(format!("{base}/api/auth/get-session"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await;

    let Ok(resp) = resp else {
        return AuthStatus { signed_in: true, email: None, name: None };
    };
    if !resp.status().is_success() {
        return AuthStatus { signed_in: true, email: None, name: None };
    }
    // get-session response shape: { session: {...}, user: { email, name, ... } }
    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return AuthStatus { signed_in: true, email: None, name: None },
    };
    AuthStatus {
        signed_in: true,
        email: body
            .get("user")
            .and_then(|u| u.get("email"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        name: body
            .get("user")
            .and_then(|u| u.get("name"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
    }
}

/// Returns the current sign-in state. Hits the server to validate the
/// stored token — a revoked/expired token reports as signed-out and is
/// cleared from the keyring so the next `auth_start` is clean.
#[tauri::command]
pub async fn auth_status() -> Result<AuthStatus, String> {
    let Some(token) = read_session_token() else {
        return Ok(AuthStatus { signed_in: false, email: None, name: None });
    };
    let client = http_client().map_err(|e| format!("http client init failed: {e}"))?;
    let base = cloud_api_url();

    let resp = client
        .get(format!("{base}/api/auth/get-session"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("get-session request failed: {e}"))?;

    if !resp.status().is_success() {
        // 401 / 403 means token is no longer valid — purge it locally so we
        // don't stay in a "signed in" UI state forever.
        let _ = delete_session_token();
        return Ok(AuthStatus { signed_in: false, email: None, name: None });
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("get-session parse failed: {e}"))?;

    // Server occasionally returns 200 with null body when no session — treat
    // that the same as 401.
    if body.is_null() || body.get("user").is_none() {
        let _ = delete_session_token();
        return Ok(AuthStatus { signed_in: false, email: None, name: None });
    }

    Ok(AuthStatus {
        signed_in: true,
        email: body
            .get("user")
            .and_then(|u| u.get("email"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        name: body
            .get("user")
            .and_then(|u| u.get("name"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
    })
}

/// Server-side revoke + local delete. Best-effort on the server side — if
/// the request fails (offline, server down) we still drop the local token,
/// because a stale UI state is worse than a still-valid server session
/// (which can be revoked from the dashboard's Devices list later).
#[tauri::command]
pub async fn auth_sign_out() -> Result<(), String> {
    let token = read_session_token();
    if let Some(token) = token {
        if let Ok(client) = http_client() {
            let base = cloud_api_url();
            let _ = client
                .post(format!("{base}/api/auth/sign-out"))
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .send()
                .await;
        }
    }
    delete_session_token()
}

/// Returns the stored bearer token for downstream cloud-API calls (sync,
/// upload, share). Intentionally not exposed via Tauri command — the
/// frontend should never see the raw token. Sync features should call
/// dedicated Rust commands that fetch + use this internally.
#[allow(dead_code)]
pub fn current_session_token() -> Option<String> {
    read_session_token()
}
