#[cfg(windows)]
mod windows;

#[cfg(not(windows))]
mod fallback;

#[cfg(windows)]
pub use windows::PlatformCameraSession;

#[cfg(not(windows))]
pub use fallback::PlatformCameraSession;
