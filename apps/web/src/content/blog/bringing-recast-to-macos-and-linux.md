---
title: "Bringing Recast to macOS and Linux"
description: "What it actually takes to make one screen recorder feel native on three operating systems — the abstractions that made it tractable, the war story that nearly hid behind a platform quirk, and where we are now."
slug: bringing-recast-to-macos-and-linux
date: 2026-06-08
author: Kanak
tags: [engineering, cross-platform, desktop, tauri, rust]
published: false
---

Recast started life as a Windows app. Not by ideology — by gravity. You build
where you sit, and the fastest path to "record your screen, polish it, share
it" ran through DXGI and WASAPI. But a recorder that only works on one OS isn't
a recorder; it's a demo. So we set out to make Recast feel genuinely native on
macOS and Linux too — not a port, not a lowest-common-denominator wrapper, but
the same Record → Polish → Share loop on whatever you happen to be sitting in
front of.

Here's what that actually took, and — because we'd rather be honest than
breathless — exactly where each platform stands today.

## The two abstractions that made it tractable

Cross-platform native code has a reputation for being a swamp. Ours wasn't,
and the reason comes down to two decisions we'd made early without fully
appreciating how much they'd pay off.

**One: a per-capability platform module.** Screen capture, audio, camera,
cursor — each is a folder of small files (`windows.rs`, `macos.rs`,
`linux_wayland.rs`, `linux_x11.rs`) behind a single trait and a `#[cfg]`
dispatch. Adding macOS screen capture didn't mean touching the Windows path;
it meant writing one new file that satisfied the same contract. Every gap was
*additive and isolated*. No grand refactor, no flag-day rewrite.

**Two: FFmpeg as the great equalizer.** Underneath the OS-specific capture
front-ends, every platform hands raw frames and PCM to the same FFmpeg-based
encode/format layer. DXGI on Windows, AVFoundation on macOS, PipeWire and
XGetImage on Linux — four very different ways to get pixels — all funnel into
one encoding pipeline. The hard, OS-specific part shrinks to "get me frames";
everything downstream is shared.

With that shape, the macOS and Linux build-out went faster than the planning
doc feared. Screen capture, system audio, microphone, camera, cursor tracking,
device pickers — all implemented on all three, all green in CI on every push.

## The war story: a freeze that only existed on a Mac

The most instructive bug of the whole effort never reproduced on Windows.

A macOS tester reported that the app froze right after a recording finished —
the window went dead, clicks stopped landing. On Windows: flawless. We had two
tempting suspects (a UI scroll-lock quirk, an FFmpeg subprocess) and both were
red herrings.

The real cause was a single missing keyword. The "stop recording" command was
a *synchronous* function, and inside it the app did real work: flushing the
encoder, finalizing the file, sometimes a multi-second video re-encode. On
Windows that's invisible, because Windows renders the web UI in a *separate
process* — it keeps painting no matter what the backend is doing. macOS (and
Linux) render the UI on the *same* main thread the command runs on. Block that
thread and the entire window beach-balls until the work finishes.

The fix was to move the heavy work onto a background worker so the UI thread
stays free. But the lesson was bigger than one command: we swept the whole
recording surface for the same anti-pattern and found several more — device
enumeration, file listing, "reveal in folder" — each a latent freeze that
Windows had been quietly hiding for us. We also found and closed a subtler one:
on a long recording, FFmpeg's own progress chatter could fill an OS pipe buffer
nobody was draining, stalling the encode mid-capture. None of these were "macOS
bugs." They were *our* bugs that only macOS and Linux were honest enough to
show us.

That's the recurring theme of going cross-platform: other operating systems
don't just run your code, they *audit* it.

## Where each platform stands

We'd rather tell you the truth than a roadmap.

- **Windows** is done. It's the reference platform, it's in users' hands, and
  everything is verified.
- **macOS** is in active testing — that freeze above came from a real macOS
  build, which is exactly the point. The capture paths are all there. The
  honest remaining gaps are hardware verification of the permissions flow and
  Retina/multi-monitor behavior, the system-audio default (macOS has no
  built-in loopback the way Windows does — the native path exists but we're
  finishing its bring-up), and the Apple notarization grind that turns "an app
  you have to right-click past Gatekeeper" into "an app that just opens."
- **Linux** is code-complete and waiting on its first real hardware pass.
  Wayland (via the desktop portal and PipeWire) and X11 are both written and
  audit-fixed, but nothing earns a checkmark from us until it has actually run
  on a real GNOME, KDE, and X11 session.

If you want the one-liner: Windows ships today, macOS is a focused
verification-and-notarization cycle from a public preview, and Linux is one
hardware bring-up behind that.

## Why we're sharing the messy middle

Most "now on macOS and Linux!" posts are written the day everything is
perfect. We're writing this one a little earlier, on purpose. Recast is
founder-built and we'd rather show you the actual engineering — the
abstractions, the war stories, the honest gaps — than a polished press
release. The code is there. The remaining distance is a person in front of a
Mac and a Linux box, doing the unglamorous work of proving each path on real
hardware.

If you're on macOS or Linux and want to help us get there faster, that's
exactly the kind of early signal that moves a checkmark from 🟢 to ✅. We'll
have preview builds to share soon.
