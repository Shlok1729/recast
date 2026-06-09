# Cross-Platform Support Plan — macOS & Linux

> Status: **Code-complete, verification-gated** · Created 2026-05-19 ·
> Last updated 2026-06-08 · Owner: Kanak
>
> **Original framing (2026-05-19):** the app was fully functional only on
> Windows; macOS/Linux produced a file but silently degraded several capture
> subsystems to stubs (silent audio, no cursor track, camera errors), and
> Linux screen capture was written but unverified.
>
> **Where we are now (2026-06-08):** every capture subsystem — screen, system
> audio, microphone, camera, cursor, device enumeration — is *implemented* on
> all three OSes. The remaining distance to production is **runtime
> verification on real macOS/Linux hardware**, not missing code. macOS is in
> active testing (a real macOS build surfaced and we fixed a post-recording
> UI-freeze; see the 2026-06-08 hardening note). Linux has not yet had a
> hardware pass. See the **[readiness scorecard](#readiness-scorecard--2026-06-08)**
> for the per-OS gap.

---

<a name="readiness-scorecard--2026-06-08"></a>

## 0. Readiness scorecard — 2026-06-08

"Code complete" = the path is written and compiles in CI for that target.
"Production-ready" = a real user on that OS can record → edit → export without
hitting a known-broken path, verified on hardware.

| OS | Code complete | Production-ready | What's actually left |
|---|---|---|---|
| **Windows** | 100% | **~100% — shipping** | Verified, in users' hands. The reference platform. |
| **macOS** | ~95% | **~75%** | (a) Out-of-the-box **system audio** needs BlackHole/virtual driver — native ScreenCaptureKit loopback is implemented but **default-off** behind the `sckit-loopback` Cargo feature (upstream SDK-symbol issue). (b) Hardware verification of capture + the TCC permission flow + Retina/multi-monitor. (c) Deferred capture-read robustness (a stalled device can hang `stop()`). (d) Developer-ID signing + **notarization** (identity task, gates a no-warnings download). (e) First-run permissions UX. |
| **Linux** | ~90% | **~60%** | (a) **Zero hardware verification yet** — biggest unknown. Portal+PipeWire (Wayland) and XGetImage (X11) are written + audit-fixed (F1) but never run on a real session. (b) Wayland: cursor double-render (`CursorMode::Embedded`) and a portal dialog on every record (no `restore_token` persistence). (c) X11 perf TODOs: XShm fast path unwired, ~4× over-capture (F4); window-occlusion not handled. (d) Functional sign-off on GNOME + KDE + an X11 session. |

**One-line answer to "how far behind?":** Windows is done. **macOS is roughly
one focused hardware-test + audio-default + notarization cycle from a public
beta.** **Linux is one hardware bring-up cycle behind macOS** — the code is
there, but nothing has run on a real Linux session, so confidence is lowest.

### Stability hardening landed 2026-06-08 (cross-cutting, helps macOS/Linux most)
A pass over the recording IPC surface fixed a class of freeze/hang that only
*manifests* on macOS/Linux (their in-process WebView renders on the same main
thread Tauri runs sync commands on; Windows' out-of-process WebView2 masked it):

- `start_recording` / `stop_recording`, `get_audio_devices`,
  `list_recasts` / `list_exports`, `open_file_location` were **synchronous**
  commands doing process-spawn / thread-join / device-enum / disk work on the
  UI thread → converted to `async` + `spawn_blocking`. (`stop_recording` was
  the post-record freeze a macOS tester reported.)
- Encoder **stderr-pipe deadlock**: FFmpeg's progress output filled the
  undrained ~64KB stderr pipe on long recordings → froze the encode
  mid-capture. Now drained continuously on a side thread.
- Recording **start-failure orphan cascade**: a partial `start()` failure left
  capture/encoder threads (and their FFmpeg children) running forever; now torn
  down on the error path.
- A compile-time regression guard keeps `start`/`stop_recording` async.

**Still open (deferred, needs on-device validation):** interruptible/timeout
reads in `capture/platform/macos.rs` and `linux_x11.rs` so a device stall
(permission revoked mid-record, hung X server) can't block `stop()`.

---

## 1. Current state by platform

Legend: ✅ verified on hardware · 🟢 implemented, compiles in CI, **not yet
hardware-verified** · ⚠️ implemented with a known limitation · ❌ stub/no-op.
(Updated 2026-06-08 — the rows the original plan marked "❌ empty list" for
device enumeration are now implemented.)

| Subsystem | Windows | Linux | macOS |
|---|---|---|---|
| Screen capture | ✅ DXGI Desktop Duplication | 🟢 Wayland (portal+PipeWire, F1 fix landed) & X11 (XGetImage) — written, awaiting hardware test | 🟢 FFmpeg AVFoundation (replaces xcap) |
| System audio (loopback) | ✅ WASAPI | 🟢 FFmpeg pulse `.monitor` (silence fallback if no PA) | ⚠️ Default path = BlackHole/Soundflower/Loopback/VB-Cable if installed, else silence + actionable log. Native **ScreenCaptureKit loopback is now implemented** but **default-off** behind the `sckit-loopback` Cargo feature (upstream apple-metal SDK-symbol issue) |
| Microphone | ✅ WASAPI | 🟢 FFmpeg pulse `default` | 🟢 FFmpeg avfoundation `:0` |
| Camera / webcam | ✅ FFmpeg DirectShow | 🟢 FFmpeg V4L2 | 🟢 FFmpeg AVFoundation |
| Cursor sampling | ✅ Win32 GetCursorPos | 🟢 device_query (xcb / XWayland) | 🟢 device_query (CoreGraphics) |
| Reveal in file manager | ✅ `explorer /select,` | 🟢 D-Bus `FileManager1.ShowItems` + xdg-open fallback | 🟢 `open -R` |
| Audio device list | ✅ WASAPI enumerate | 🟢 `pactl list short sources` (`.monitor` filtered) | 🟢 AVFoundation listing parsed |
| Camera device list | ✅ FFmpeg `-list_devices` | 🟢 `/dev/video*` + sysfs V4L2-capture filter | 🟢 AVFoundation listing (screens filtered) |
| Capture capabilities probe | ✅ `capture_capabilities` | 🟢 `capture_capabilities` | 🟢 `capture_capabilities` |
| Window capture-exclusion | ✅ `SetWindowDisplayAffinity` | ❌ no-op (deferred) | ❌ no-op (deferred) |
| Video encoding | ✅ FFmpeg (NVENC/x264) | 🟢 FFmpeg (x264, hw if present) | 🟢 FFmpeg (x264, VideoToolbox if present) |
| Delete to trash | ✅ `trash` crate | 🟢 `trash` crate | 🟢 `trash` crate |

**Good news:** the architecture already has a clean per-module
`platform/{windows,fallback,...}.rs` abstraction with `#[cfg]` dispatch, so
each gap is an additive, isolated file — no refactor required. FFmpeg is the
codec/format abstraction layer and is already cross-platform. **The 🟢 rows are
the whole story now: code is written and green in CI on every target; the
distance to ✅ is a person sitting in front of a Mac / a Linux box.**

---

## 2. Phased plan

Ordered by **value-per-effort** — cheapest, highest-confidence wins first.

### Phase 0 — Build & toolchain readiness *(prerequisite)*
- **Per-push compile CI — done 2026-05-19.** `.github/workflows/ci-desktop.yml`
  runs `tauri build --no-bundle` + clippy on Linux/macOS/Windows for every
  push & PR, so cross-platform code stays green while it is written. The
  release workflow (`release-desktop.yml`) already bundles all three on tags.
- WSL note: WSL2 can *compile* the Linux code (needs Rust + the
  `pipewire-upstream` PPA for headers ≥1.4) but **cannot test capture** —
  WSLg ships no `xdg-desktop-portal` ScreenCast backend. CI covers the
  compile gate; functional capture testing needs real Linux/macOS hardware.
- Source per-platform FFmpeg + FFprobe static binaries; place under
  `apps/desktop/binaries/` with the target-triple naming `ffmpeg.rs`
  already expects (`ffmpeg-x86_64-apple-darwin`, `-aarch64-apple-darwin`,
  `-x86_64-unknown-linux-gnu`, etc.). The release workflow already does this.
- Confirm `cargo build` succeeds on each OS with the platform deps
  (`ashpd`, `pipewire`, `x11rb` on Linux). Fix any compile breakage in the
  `fallback.rs` stubs.
- **Exit criteria:** an unsigned dev build launches and records *something*
  on all three OSes.

### Phase 1 — Linux screen capture validation *(low effort, code exists)*
- **Pre-flight static audit — done 2026-05-19. See [Appendix A](#appendix-a)** —
  one critical bug found before any Linux run.
- Get a Linux machine / CI runner (this needs hardware — the `pipewire`,
  `ashpd`, `x11rb` stack links against system C libs and cannot build on
  the Windows dev host).
- Fix audit finding **F1** (missing PipeWire `param_changed` handler) —
  highest-risk, do before first run.
- Test `capture/platform/linux_wayland.rs` on a real Wayland session
  (GNOME + KDE): portal dialog, PipeWire stream, frame pacing.
- Test `capture/platform/linux_x11.rs` on an X11 session.
- Wire the XShm fast path (currently a TODO behind a feature flag) if X11
  GetImage proves too slow.
- **Exit criteria:** Linux screen recording verified at target FPS on both
  session types.

### Phase 2 — Cursor sampling *(done 2026-05-19)*
Landed via a single shared file `cursor/platform/device_query_impl.rs`
backed by the `device_query` crate (CoreGraphics on macOS, xcb on Linux).
Dispatched from `cursor/platform/mod.rs` for `target_os = "macos"` and
`"linux"`; the existing `fallback.rs` stays for other targets. Pointer
state is sampled at 125 Hz by `cursor::spawn_cursor_capture`, identical to
the Windows backend's contract.

**Caveats** (documented in the impl file):
- No cursor *visibility* signal — `device_query` doesn't expose
  `CGCursorIsVisible` / X11 hide state, so `visible` is always `true`.
  The cursor capture loop's frame-bounds check still hides the cursor
  when it leaves the recorded area, so editor behaviour stays correct.
- On Wayland, pointer queries go through XWayland (present on every
  mainstream Wayland distro). Coords match the compositor 1:1 at
  integer scaling; under HiDPI / fractional scaling the editor's
  *stylized* cursor may be slightly offset from the user's actual
  cursor. The recording itself shows the cursor correctly because the
  portal stream uses `CursorMode::Embedded`. True Wayland-native
  tracking (libei or PipeWire cursor metadata) is the long-term fix.
- `DeviceState` is cached in `thread_local!` so the X11/CoreGraphics
  handle is opened once, not per-sample.

**Exit criteria:** zoom-trigger / idle detection works on macOS and Linux
X11 — verified once CI compile-checks the build and a real machine
records a session.

### Phase 3 — Camera capture *(done 2026-05-19)*
Landed as one shared file
[`camera/platform/ffmpeg_unix.rs`](../src-tauri/src/camera/platform/ffmpeg_unix.rs)
covering macOS (AVFoundation) and Linux (V4L2). Mirrors the existing
`windows.rs` thread/stop-flag/graceful-stop structure exactly so the
upstream `PlatformCameraSession` contract is unchanged. Same 1280×720@30
defaults, same MP4 sanity check, same `q`-then-kill shutdown sequence.

Device resolution falls back to the first available device when the JS
panel sends "Default"/empty (matches the Windows path). Listing logic:
- macOS — parses FFmpeg's `-list_devices true` stderr, skips the
  "Capture screen N" pseudo-devices.
- Linux — picks the lowest-numbered `/dev/video*` node up to 16.

**Follow-up — done (since 2026-05-19):**
`commands/system.rs::get_camera_devices` now enumerates on macOS (AVFoundation
listing, "Capture screen" pseudo-devices filtered) and Linux (`/dev/video*` +
sysfs `V4L2_CAP_VIDEO_CAPTURE` filter), so the in-app picker populates instead
of leaning on the auto-first-device fallback. (Hardware-unverified.)

### Phase 4 — Audio capture *(done 2026-05-19, with documented caveat)*
Landed as one shared file
[`audio/platform/ffmpeg_unix.rs`](../src-tauri/src/audio/platform/ffmpeg_unix.rs).
FFmpeg streams raw PCM (`s16le` 48 kHz stereo) to stdout; the capture
thread copies it into the existing `WavWriter`, honouring `pause_flag`
exactly the way WASAPI does — drains the pipe always, only writes
samples when not paused. A stop-watcher thread sends FFmpeg a graceful
`q` on `stop_flag`, escalating to kill on timeout.

**Loopback sources (three-tier resolution chain, top tier deferred):**
- **macOS — ScreenCaptureKit** (`audio/platform/macos_sckit.rs`): the
  only built-in macOS API for system audio without a virtual driver,
  and the path every modern recorder uses. **Now implemented** against
  the `screencapturekit` 6.0 crate (`SCShareableContent` → `SCStream`
  with an audio handler → `CMSampleBuffer` Float32→s16le, pause
  semantics matched to WASAPI). **Gated default-off behind the
  `sckit-loopback` Cargo feature** because the build currently trips an
  upstream apple-metal SDK-symbol issue on the CI SDK; the file carries
  a Mac-reviewer smoke-test checklist. Until it's enabled by default,
  the *effective* macOS loopback is the BlackHole/virtual-driver tier
  below — **this is the single biggest macOS out-of-the-box gap.** When
  on, it shares the Screen Recording TCC prompt with Phase 5 video, so
  there is no second permission cost.
- **macOS — BlackHole / virtual driver** (FFmpeg avfoundation): scans
  for BlackHole / Soundflower / Loopback / VB-Cable and routes through
  FFmpeg if present. Today's effective macOS loopback path.
- **Linux** — `pactl get-default-sink` → `<sink>.monitor` via FFmpeg's
  `-f pulse` input. Works on any PulseAudio or pipewire-pulse install.
- **Silence + actionable warning** — final degrade when no tier
  succeeds; the macOS message names BlackHole specifically.

**Microphone:** AVFoundation `:0` (macOS) or `pulse default` (Linux); a
user-supplied device id falls through if non-empty/non-"default". Mic
failure surfaces as an error — there's no silent fallback for an
explicitly-enabled mic.

**Follow-up — done (since 2026-05-19):**
`commands/system.rs::get_audio_devices` now enumerates on macOS (AVFoundation
listing) and Linux (`pactl list short sources`, `.monitor` sources filtered
out), so the mic picker populates instead of always defaulting.
(Hardware-unverified.)

### Phase 5 — macOS screen capture *(done 2026-05-19, with planned 5b)*
Landed as
[`capture/platform/macos.rs`](../src-tauri/src/capture/platform/macos.rs)
using FFmpeg AVFoundation as a `CaptureSource`. A single long-lived
FFmpeg subprocess streams raw BGRA frames over stdout; `capture_next()`
reads exactly one frame's worth of bytes per call (same shape as
`X11CaptureSource`). The pacer's `MAX_DRAIN` cap keeps the
"always-Some" behaviour in check.

`-vf scale=W:H` forces output dimensions to match what the encoder
expects, regardless of the screen's native resolution; `-capture_cursor 1`
matches the Wayland path's `CursorMode::Embedded`. macOS no longer hits
the xcap fallback at all.

**Known limitations:**
- First "Capture screen" device only — multi-monitor users get the
  primary display; mapping xcap monitor IDs to AVFoundation indices is
  a follow-up.
- No region capture on macOS; the in-app picker's region selector
  doesn't propagate. AVFoundation captures full screen; `-vf scale=…`
  matches dims. Cropping can be added with `-vf crop=…` later.
- First record requires Screen Recording consent in
  System Settings → Privacy & Security. FFmpeg will spawn but produce
  zero frames until granted; surface this via the capture-source error
  path.

**Phase 5b (deferred):** ScreenCaptureKit *video* source. The audio
half of SCKit is now wired (see Phase 4), so the Screen Recording TCC
prompt the user sees on first record already grants SCKit access; a
future iteration can swap the FFmpeg AVFoundation video source for an
SCKit `SCStream` video output without re-prompting. Wins: lower
latency, per-window/per-app filtering, native HiDPI handling. Cost:
non-trivial objc2 plumbing around `CMSampleBuffer` video frame
extraction → BGRA conversion. The FFmpeg backend is the production
bridge until 5b lands.

### Phase 6 — OS integration polish *(reveal landed 2026-05-19)*
- **Reveal in file manager — landed.** `commands/system.rs::open_file_location`
  now branches: Windows `explorer /select,`, macOS `open -R`, Linux
  tries D-Bus `org.freedesktop.FileManager1.ShowItems` via `gdbus` and
  falls back to `xdg-open` on the parent directory if D-Bus is
  unavailable (covers GNOME/KDE/XFCE/Cinnamon natively).
- **Window capture-exclusion — deferred.** macOS would use
  `NSWindow.sharingType = .none`; Linux has no portable API. Both stay
  no-op until there is a user-visible need.
- **Permissions UX — deferred.** macOS Screen Recording / Microphone /
  Camera TCC prompts surface implicitly on first attempt (the user gets
  an OS dialog). A polished first-run flow with deep-links to System
  Settings is a follow-up; right now the capture error messages name
  the relevant Settings pane.

### Phase 7 — Packaging, signing & distribution *(release path already wired)*
[`release-desktop.yml`](../../../.github/workflows/release-desktop.yml)
already builds and bundles MSI/NSIS (Windows), DMG + updater bundle
(macOS), and AppImage + `.deb` (Linux) on every `v*` tag. The
per-push CI gate added in Phase 0
([`ci-desktop.yml`](../../../.github/workflows/ci-desktop.yml)) keeps
each OS compiling on every change.

**Still missing for a real macOS public ship:**
- Developer ID signing + **notarization** + stapling for the DMG and
  updater bundle (currently produces unsigned DMGs the README warns
  users to `xattr -dr com.apple.quarantine` past).
- Hardened-runtime entitlements declaring `com.apple.security.device.camera`,
  `device.microphone`, and the screen-capture entitlement.

These are credential/identity tasks, not code tasks — outside the scope
of cross-platform code parity, but they gate a "no warnings" macOS
download experience.

---

## 3. Effort & risk summary

| Phase | Effort | Risk | Notes |
|---|---|---|---|
| 0 Toolchain | M | Low | Pure setup |
| 1 Linux capture validation | S | Low | Code already written |
| 2 Cursor sampling | S | Low | Wayland has a known limitation |
| 3 Camera | M | Low | FFmpeg does the heavy lifting |
| 4 Audio | L | **High** | macOS loopback is the hardest single item |
| 5 macOS screen capture | L | Med | ScreenCaptureKit; pair with Phase 4 |
| 6 OS integration | S | Low | Scattered small items |
| 7 Packaging/signing | M | Med | macOS notarization is fiddly |

**Critical path / biggest unknowns:** macOS system-audio loopback (Phase 4)
and ScreenCaptureKit bring-up (Phase 5). De-risk these early with a spike
before committing the rest of Phase 4–5.

**Suggested milestones (re-sequenced 2026-06-08 — all code now landed, so these
are *verification* milestones, not build milestones):**
- **M1 — macOS beta** *(now the nearer milestone — macOS is already in active
  testing):* hardware pass on capture + TCC permissions + Retina/multi-monitor;
  decide system-audio default (enable `sckit-loopback` once the SDK-symbol issue
  clears, or ship the BlackHole-guided path with clear in-app messaging); land
  the deferred capture-read timeout; Developer-ID signing + notarization (Phase
  7). Ship behind a "macOS preview" label.
- **M2 — Linux beta:** first real hardware bring-up on GNOME + KDE (Wayland) and
  an X11 session; fix Wayland cursor double-render + portal-every-record; X11
  perf (XShm / over-capture) only if a tested display needs it.

---

## 4. Key files touched

- `apps/desktop/src-tauri/src/capture/platform/` — `macos.rs` (new),
  validate `linux_wayland.rs` / `linux_x11.rs`
- `apps/desktop/src-tauri/src/audio/platform/` — `macos.rs`, `linux.rs` (new)
- `apps/desktop/src-tauri/src/camera/platform/` — `macos.rs`, `linux.rs` (new)
- `apps/desktop/src-tauri/src/cursor/platform/` — `macos.rs`, `linux.rs` (new)
- `apps/desktop/src-tauri/src/commands/system.rs` — device enumeration,
  window exclusion, reveal-in-explorer per-OS branches
- `apps/desktop/src-tauri/Cargo.toml` — macOS deps
  (`objc2` / `core-graphics` / `screencapturekit` bindings)
- `apps/desktop/src-tauri/tauri.conf.json` — macOS entitlements, signing
- `apps/desktop/binaries/` — per-platform FFmpeg/FFprobe

---

<a name="appendix-a"></a>

## Appendix A — Phase 1 pre-flight audit (2026-05-19)

Static review of the already-written Linux capture code. It cannot be
compiled or run on the Windows dev host, so this is a code-reading pass to
catch bugs before the first Linux run. Findings ranked by first-run risk.

> Note: a prior design doc, `apps/desktop/docs/linux-native-recording.md`,
> was deleted from the working tree during this session. It held the
> original lifecycle diagram and a first-iteration debug list. The relevant
> conclusions are folded into this appendix; recover the file from git
> (`git checkout -- apps/desktop/docs/linux-native-recording.md`) if its
> diagrams are still wanted.

### F1 — CRITICAL *(fixed 2026-05-19)* · PipeWire format negotiation
`linux_wayland.rs::pipewire_capture_loop` originally registered only a
`.process()` listener and assumed the portal-reported size + BGRA format
matched what PipeWire actually streamed. But `build_format_param` offered
`VideoSize` as a **Range (1×1 … 7680×4320)**, so the compositor was free
to pick a different size — every frame would then fail the
`slice.len() < total` check and be silently dropped → **black / zero-length
recording with no error**.

**Fix landed** as two layers in [linux_wayland.rs](../src-tauri/src/capture/platform/linux_wayland.rs):
1. `build_format_param` now pins `VideoSize` to a fixed `Rectangle`
   instead of a Range, so PipeWire either honours the portal-reported
   dims or fails the stream connection (an observable failure replaces a
   silent one).
2. A `.param_changed()` listener parses the negotiated `VideoInfoRaw`
   and stashes the real geometry in a shared `Arc<Mutex<…>>` that
   `process()` reads each tick. With (1) in place the negotiated dims
   should always match portal dims; if they ever don't, the log line
   says so loudly and `process()` adapts.

### F2 — HIGH *(resolved by F1 fix)* · Encoder size mismatch
Same root cause as F1; with F1's fixed-size pin the encoder's
portal-reported dims will always equal PipeWire's negotiated dims, so
this no longer exists. If F1's `param_changed` warning ever fires, the
encoder will still be wrong for that recording — but at that point the
log makes it visible instead of silently producing a broken file.

### F3 — MEDIUM · X11 frame buffer size was unvalidated *(fixed 2026-05-19)*
`linux_x11.rs::capture_next` handed `GetImage`'s reply straight downstream
as BGRA. If the X server packs depth-24 at 24 bpp, or pads scanlines to a
wider `bitmap_pad`, `reply.data.len() != width*height*4` and the encoder
panics or renders striped frames. **Fixed:** added a length check that
returns a clear error naming the geometry mismatch. A real stride-repack
path is still TODO if any tested display actually trips it.

### F4 — MEDIUM (perf) · X11 captures ~4× more than needed
The pacer's drain loop (`pipeline.rs`, `MAX_DRAIN = 4`) calls
`capture_next(0)` up to 4× per tick. `X11CaptureSource` ignores the timeout
and does a full synchronous `GetImage` on every call, returning `Some`
unconditionally — so 3 of every 4 full-screen captures are discarded. At
1080p60 that is ~180 wasted full-frame copies/sec. **Fix:** rate-limit
inside `X11CaptureSource` (record last-capture `Instant`, return `Ok(None)`
if called again within a frame period), or land the XShm fast path.

### F5 — LOW · Portal stream orphaned if `recording_manager.start()` fails
`commands/recording.rs::start_recording` calls `stash_portal_stream()`
*before* `recording_manager.start()`. If `start()` returns `Err`, the
stashed stream (and its open fd) is never consumed. Not a true leak — the
next Wayland recording overwrites the slot via `.replace()` — but the fd
lingers. **Fix:** stash after a successful `start()`, or clear the slot on
the error path.

### F6 — LOW · pipewire version drift in docs *(fixed 2026-05-19)*
Design doc said `pipewire = "0.8"`; Cargo.toml pins `0.9` and the code uses
the 0.9 `Rc` API (`ContextRc`, `MainLoopRc`, `connect_fd_rc`, `StreamBox`).
Doc references corrected before the file was deleted.

### Confirmed-still-present known issues (from the original debug list)
- **Cursor double-render:** `CursorMode::Embedded` burns the compositor
  cursor into frames *and* our own cursor track records positions — the
  export shows two cursors. Switch to `CursorMode::Metadata` once the
  editor's stylized cursor is reliable on Linux.
- **Portal dialog every Record:** `PersistMode::DoNot` saves no consent.
  Switch to `PersistMode::ExplicitlyRevoked` + persist the `restore_token`
  in `AppConfig` for a one-time grant.

### Audit verdict
The architecture is sound and the dispatch logic in `capture/platform/mod.rs`
is correct. **F1 is a genuine bug that will black-screen the first Wayland
run** — fix it before testing. F3 and F6 are fixed. F4 and F5 are
quality/perf items that can follow the first successful capture. None of
this needs re-architecting; Phase 1 remains low-effort once a Linux host is
available.
