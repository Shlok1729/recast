#[cfg(windows)]
mod windows;

#[cfg(not(windows))]
mod fallback;

#[cfg(windows)]
pub use windows::PlatformAudioSession;

#[cfg(not(windows))]
pub use fallback::PlatformAudioSession;

#[cfg(windows)]
pub use windows::PlatformMicrophoneSession;

#[cfg(not(windows))]
pub use fallback::PlatformMicrophoneSession;
