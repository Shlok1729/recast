/**
 * Feature flags for in-progress / platform-gated functionality.
 *
 * These flags gate UI surfaces only — the underlying capture, render, and
 * export pipelines remain wired up. Flipping a flag back to `true` should
 * re-enable the feature without any code changes elsewhere.
 *
 * If you're touching one of these, also read the matching design note under
 * `apps/desktop/docs/`.
 */

/**
 * Editor-side camera overlay UI (properties panel tab + draggable overlay
 * on the preview canvas).
 *
 * Recording with the camera still works — the bubble is captured to a
 * separate track in the .recast bundle exactly as before. This flag only
 * hides the editor controls for re-positioning, mirroring, shape, size,
 * etc. Re-enable plan + per-platform exclusion APIs (the eventual fix for
 * the floating preview window leaking into screen capture) are documented
 * in `apps/desktop/docs/camera-recording-todo.md`.
 */
export const CAMERA_OVERLAY_UI_ENABLED = false;

/**
 * WebCodecs-based preview playback engine.
 *
 * When ON, the editor preview drops the HTML `<video>` element entirely and
 * drives playback from a JS master clock (`$lib/playback/clock`) plus a
 * WebCodecs `VideoDecoder` frame source (`$lib/playback/webcodecs-source`).
 * The audio `<audio>` tracks slave to the clock instead of to the video
 * element. This is what removes the freeze when playback crosses a cut/split:
 * frames are decoded from our own GOP cache rather than via the `<video>`
 * element's slow native seek.
 *
 * When OFF (default while this lands), the proven `<video>`-element path is
 * used unchanged — the two implementations live side by side so the new engine
 * can be validated against real recordings before it becomes the default.
 *
 * Requires a WebView with WebCodecs (`VideoDecoder`): WebView2 on Windows and
 * WKWebView (Safari 16.4+) on macOS. If the source codec isn't supported the
 * engine throws at load and the caller falls back to the `<video>` path.
 */
export const WEBCODECS_PREVIEW_ENABLED = true;
