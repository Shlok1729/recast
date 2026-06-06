import type { Component } from "svelte";
import { Bug, RefreshCw, Sparkles, Wrench } from "@lucide/svelte";

export type ChangeKind = "added" | "changed" | "fixed" | "deprecated";

export interface ChangelogChange {
	kind: ChangeKind;
	summary: string;
}

export interface ChangelogRelease {
	version: string;
	date: string;
	title?: string;
	highlights?: string[];
	changes: ChangelogChange[];
}

export const KIND_META: Record<
	ChangeKind,
	{ label: string; icon: Component<any>; tone: string }
> = {
	added: { label: "New", icon: Sparkles, tone: "text-primary" },
	changed: { label: "Changed", icon: RefreshCw, tone: "text-foreground" },
	fixed: { label: "Fixed", icon: Wrench, tone: "text-emerald-500" },
	deprecated: { label: "Deprecated", icon: Bug, tone: "text-amber-500" },
};

// Newest release first. The first entry's `version` is shown as the "latest".
// In-flight (unreleased) changes live only in CHANGELOG.md under
// `[Unreleased]`. They migrate here once the version is bumped and tagged.
//
// The block between RELEASES:START and RELEASES:END is regenerated from the
// root CHANGELOG.md by `pnpm sync:changelog` (and automatically before each
// desktop build via the `predev` / `prebuild` hook). Edit CHANGELOG.md, not
// this array.
// RELEASES:START — auto-generated, do not edit by hand
export const RELEASES: readonly ChangelogRelease[] = [
	{
		version: '0.2.2',
		date: '2026-06-05',
		highlights: [
			'**Recast Cloud management got broader and sharper** — uploads, shares, poster replacement, engagement tracking, and dashboard-side performance views all moved forward together.',
			'**Desktop playback and editing feel faster on real projects** — thumbnail and waveform data can now be cached on disk instead of being recomputed every session.',
			'**Capture setup is more defensive** — camera capability gating and browser-side device enumeration reduce bad hardware choices before recording starts.',
		],
		changes: [
			{ kind: 'added', summary: 'Poster replacement for recasts, plus engagement tracking and supporting shares / performance surfaces on the dashboard so cloud-hosted recordings are easier to manage after upload.' },
			{ kind: 'added', summary: 'Browser-side device enumeration and capability checks for cameras, helping the recorder present more reliable hardware choices before capture begins.' },
			{ kind: 'added', summary: 'New SVG cursor sprites and the supporting cursor-style management refactor, laying cleaner groundwork for richer cursor overlays in the editor and exports.' },
			{ kind: 'changed', summary: 'Dashboard upload and recast-management flows were expanded, giving Recast Cloud a more complete post-upload management surface instead of treating upload as the end of the workflow.' },
			{ kind: 'changed', summary: 'Legacy share-visibility values are normalized more consistently, and share access management is clearer across older and newer recast records.' },
			{ kind: 'changed', summary: 'Desktop environment configuration was reorganized, and the macOS capture path received follow-up handling improvements as the beta setup hardened.' },
			{ kind: 'changed', summary: 'macOS installation guidance was tightened up so download and setup steps are clearer for beta users.' },
			{ kind: 'fixed', summary: 'Thumbnails and waveform data can now be cached to disk, cutting down repeated processing and improving responsiveness when reopening projects.' },
		],
	},
	{
		version: '0.2.1',
		date: '2026-06-03',
		highlights: [
			'**Recast Cloud arrived in earnest** — uploads, share links, password protection, expiry, workspace-aware routing, and self-host configuration all landed across web and desktop.',
			'**Library organization got real tools** — tags, archives, and tag-management UI make larger recast collections manageable instead of flat lists.',
			'**Recording startup became more controllable** — countdown support, per-profile delay overrides, and Windows aspect-ratio locking smooth out capture setup.',
		],
		changes: [
			{ kind: 'added', summary: 'Recast Cloud upload and share flows across the app, including workspace-aware upload routing and broader share-management plumbing for cloud-hosted recasts.' },
			{ kind: 'added', summary: 'Password-protected and expiring share links, plus account-less access for selected shares so private distribution has more than one mode.' },
			{ kind: 'added', summary: 'Tags and archives for recasts: API support, archived recast management, and a tag-management dialog for renaming, recoloring, and deleting tags.' },
			{ kind: 'added', summary: 'Self-hosting endpoint configuration in desktop settings through the `CloudEndpoint` settings surface.' },
			{ kind: 'added', summary: 'Recording countdown support with customizable duration and per-profile overrides, so different recording setups can start with different delays.' },
			{ kind: 'added', summary: 'Analytics groundwork across web and desktop for measuring product and sharing behavior as Recast Cloud rolls out.' },
			{ kind: 'changed', summary: 'Local desktop persistence moved from raw `localStorage` usage to `safeStorage`-backed handling where appropriate, improving resilience and synchronization for saved state.' },
			{ kind: 'changed', summary: 'Azure storage configuration validation was hardened with constant-time comparison, reducing opportunities for subtle auth and config mistakes.' },
			{ kind: 'changed', summary: 'Shared recast pages picked up release-process and SEO improvements, and the pricing table layout was adjusted to hold up better at narrower widths.' },
			{ kind: 'changed', summary: 'The Windows recording window now respects aspect-ratio locking while resizing, making capture setup less fussy.' },
		],
	},
	{
		version: '0.2.0',
		date: '2026-05-30',
		highlights: [
			'A single **morphing export dialog** that flows Options → Encoding → Success / Cancelled / Error without ever closing — width and height ease between phases, content cross-fades on top.',
			'**Sliding tab indicator** behind every `Tabs.List` (Settings, properties panel, source select) — the active pill slides between tabs instead of snapping.',
			'Export Options redesigned end-to-end against `DESIGN.md`: GIF extras open as a smooth side panel on wide screens, fall back to an inline accordion on narrow ones, and the dialog auto-morphs its width as you switch formats.',
		],
		changes: [
			{ kind: 'added', summary: '`ExportFlowDialog` wrapper component that owns the dialog chrome (portal, backdrop, scale-in, focus + Esc routing) and auto-morphs its width and height to whatever the active phase declares via a `ResizeObserver`. A custom out-transition absolute-positions the leaving phase so its fade-out can\'t drag the wrapper size around — the new phase mounts in normal flow, the wrapper Tweens to match, the old phase fades on top.' },
			{ kind: 'added', summary: 'Per-phase Esc and backdrop routing: Esc cancels a running export, dismisses a finished one, or closes the options picker; the backdrop never cancels an in-flight encode (too easy to misclick mid-render).' },
			{ kind: 'added', summary: 'Share button on the export success card (when `navigator.share` is available), with sensible fallback messaging when the platform doesn\'t support sharing files but a Drive link is on hand.' },
			{ kind: 'added', summary: 'Sliding active-tab indicator inside `Tabs.List` (shared `@recast/ui` component). Driven by a Svelte 5 `Tween` plus a `MutationObserver` watching `data-state` changes, so it stays decoupled from `bits-ui` internals. Variant-aware visual — `soft` uses `bg-card + shadow-craft-inset`, `default` uses `bg-background + shadow-sm`, `line` slides a 2 px `bg-foreground` bar. Works in both horizontal and vertical orientations and snaps on first measure so it doesn\'t grow from `(0,0)`.' },
			{ kind: 'changed', summary: 'Export UI consolidated into one surface across three previously-separate states (options dialog, inline progress overlay, inline result overlay) — eliminates the close/reopen flash between picking a format and seeing encode progress, and again between encode finishing and the success card.' },
			{ kind: 'changed', summary: 'Export Options dialog redesigned against `DESIGN.md` dialog rhythm: header `px-5 py-4` with title + description, section dividers softened to `border-border/40`, footer `bg-muted/30 py-2.5`, stat strip inlined with a single divider instead of nested glass cards, section labels paired with a one-line description per the design vocabulary. Buttons use the canonical glass surface (`bg-card/40 + border-border/40`) with `bg-primary/8 + ring-primary/25` for selection.' },
			{ kind: 'changed', summary: 'GIF extras (frame rate, color richness, gradients, loop) now reveal as a side panel on wide screens — the dialog grows from 440 px to 760 px through the flow dialog\'s morph rather than animating an internal collapse — and stack as an inline accordion when the viewport is narrower than 720 px.' },
			{ kind: 'changed', summary: 'Export Options dialog is now responsive: container clamps to `min(820px, calc(100vw - 2rem))` and the body picks its own natural width that the wrapper auto-morphs to.' },
			{ kind: 'changed', summary: '`EditorToolbar` no longer mounts its own `ExportDialog`; the toolbar\'s Export button now bubbles a single `onexport` callback up to the editor page, which owns the flow phase.' },
			{ kind: 'changed', summary: 'Progress, Success, Cancelled, and Error views adopted the same chrome and spacing rhythm as the Options view — `size-10 rounded-xl` status icon badges, consistent footer padding, primary actions on the right.' },
			{ kind: 'fixed', summary: 'No more visual "snap" when switching the export format between MP4/WebM and GIF — the GIF settings panel mounts inline and the wrapper morphs to the new natural size in one motion.' },
			{ kind: 'fixed', summary: 'Focus is re-routed back into the dialog on every phase change, so screen readers re-announce and keyboard navigation stays inside the modal as content swaps under the user.' },
		],
	},
	{
		version: '0.1.10',
		date: '2026-05-28',
		highlights: [
			'**Google Drive uploads** straight from the export success card, with per-upload progress, history, and cancel/retry — the first "send it somewhere" target after local files.',
			'**Account and authentication** across desktop and web: device-authorization OAuth flow on the app, magic-link + password sign-in on the web, plus a templated transactional-email system behind both.',
			'**Hardware-accelerated exports** on NVIDIA / AMD / Intel where available, with startup probing so the app picks the right encoder once and remembers — and multi-threaded VP9 + camera pause-trim on the recording path.',
			'**macOS feature parity work**: native `ScreenCaptureKit` audio loopback, cross-platform cursor sampling, and the macOS / Linux audio + camera platform modules wired through the recorder.',
			'**Tabbed Settings** layout (General / Local / Cloud) and a **frame snapshot → clipboard** action in the editor.',
		],
		changes: [
			{ kind: 'added', summary: 'Google Drive integration: connect from Settings → Cloud, upload exports from the success card, watch live upload progress with a per-upload progress bar, cancel in flight, retry failures, copy or open the Drive link once it\'s done, and review a per-file upload history that survives dismissals.' },
			{ kind: 'added', summary: 'OAuth 2.0 Device Authorization Grant flow for the desktop app, with the matching UI components (device code display, polling state, success card), so the app can sign in without ever embedding a browser window.' },
			{ kind: 'added', summary: 'Magic-link sign-in and password-reset on the web, backed by Better Auth + Drizzle, with templated transactional emails (layout + transport abstraction so future templates plug in cleanly).' },
			{ kind: 'added', summary: 'Cross-window panel error routing through sonner toasts — Rust-side errors from the recording panel now surface as proper toasts in the main window instead of vanishing into the panel\'s own console.' },
			{ kind: 'added', summary: 'Admin surface for the web: user management, waitlist approvals, teams management, and impersonation with transaction-safe team creation / switching.' },
			{ kind: 'added', summary: '`NavProgress` component for a top-of-page navigation indicator, with a generation token so stale completion callbacks from cancelled navigations can\'t flash the bar.' },
			{ kind: 'added', summary: 'macOS-only `ScreenCaptureKit` audio loopback gated behind an opt-in `sckit-loopback` feature flag, and a cross-platform cursor sampler that finally unblocks the macOS / Linux recording paths.' },
			{ kind: 'added', summary: 'Hardware-encoder startup probe + documentation of hardware requirements, so the encoder picker no longer fails late inside FFmpeg when a GPU encoder isn\'t actually installed.' },
			{ kind: 'added', summary: 'Tabbed Settings interface (Local / Cloud / General) replacing the previous single-column scroll, with each tab keeping its own subtle slide-in.' },
			{ kind: 'added', summary: 'Editor "capture frame" action: grab the current composited frame and copy it to the clipboard from the player controls.' },
			{ kind: 'added', summary: 'Homebrew Cask publishing workflow and matching install instructions for macOS alongside the existing `.dmg`, `.deb`, `.AppImage`, and `.exe` artifacts.' },
			{ kind: 'added', summary: 'Pricing page footer / navbar "Join Waitlist" entry and a refreshed pricing layout.' },
			{ kind: 'added', summary: 'Top-level formatting + linting scripts wired through Turbo, so `pnpm format` and `pnpm lint` run consistently across the monorepo.' },
			{ kind: 'changed', summary: 'Export pipeline now multi-threads VP9 encodes and hardware-accelerates AMD / Intel paths in addition to NVENC, with a RAM-bounded capture queue to prevent runaway memory during long recordings.' },
			{ kind: 'changed', summary: 'Editor performance: thumbnails are batched into a single FFmpeg call, the preview falls back to WebGL2 where supported, and a temp-file sweep reclaims scratch storage during sessions.' },
			{ kind: 'changed', summary: 'Camera pause-trim is now hardware-accelerated end-to-end, removing the worst stalls on long captures with camera overlay.' },
			{ kind: 'changed', summary: 'Smart-zoom suggestions tightened with improved scoring + clustering (continuing the 0.1.8 rework with better dedupe behavior under repeat clicks).' },
			{ kind: 'changed', summary: 'Toaster + theming updated for consistent visual language across the corner notifications it shares space with.' },
			{ kind: 'changed', summary: 'Trusted-origins handling in `better-auth` now reads CSV-formatted env vars, and the env schema defaults sensible URLs for optional CSV fields so first-run setups don\'t trip on missing values.' },
			{ kind: 'fixed', summary: 'Updater manifest generation now runs even when one of the per-platform build legs fails, so a partial release no longer leaves the auto-updater pointing at the previous version forever.' },
			{ kind: 'fixed', summary: 'MSIX builds now stage the FFmpeg sidecars correctly (and stop uploading internal `.deb` payloads as release artifacts).' },
			{ kind: 'fixed', summary: 'FFmpeg / ffprobe spawn audit completed: every spawn site uses `configure_silent_command` on Windows, so console-flash focus theft no longer reads as "the whole window froze".' },
			{ kind: 'fixed', summary: '"Recording stop" failures no longer get blamed on FFmpeg by default — the UI now resets client-side state cleanly on stop-failure and reports the actual cause when there is one.' },
			{ kind: 'fixed', summary: 'Diagnostics: file logging stays enabled in release builds and surfaces the full `anyhow` cause chain, so support reports actually contain the root error.' },
			{ kind: 'fixed', summary: 'Pinned `apple-metal` to `0.6.1` for CI compatibility so macOS leg builds don\'t break on transitive bumps.' },
			{ kind: 'fixed', summary: 'Contact email updated to the new address in Footer and Navbar.' },
			{ kind: 'fixed', summary: 'Various button + UI fixes: prevent text selection on `<Button>`, button hover regressions, and a Vercel deploy workflow tweak so install no longer fails on lockfile drift.' },
		],
	},
	{
		version: '0.1.9',
		date: '2026-05-23',
		changes: [
			{ kind: 'added', summary: 'Inline playback for recordings: tapping a card on the exports page now opens a `PlayerDialog` powered by `@recast/player` (RecastPlayer) with the branded media-chrome controls, instead of jumping straight to the file location. "Show in folder" stays one click away inside the dialog footer.' },
			{ kind: 'added', summary: 'Global `@recast/player/styles.css` import in the desktop root layout so any future inline players pick up the same theming without per-route boilerplate.' },
			{ kind: 'fixed', summary: 'Pointer-events leak from floating UI surfaces in the Tauri build: `DropdownMenu`, `HoverCard`, `Popover`, and `Select` content wrappers now also default `preventScroll={false}` (matching the earlier `Dialog` and `Sheet` fix from 0.1.6), so a closed menu or popover can no longer leave `pointer-events: none` on the document body and freeze the window.' },
		],
	},
	{
		version: '0.1.8',
		date: '2026-05-22',
		changes: [
			{ kind: 'added', summary: 'Pause and resume during recording with controls in the recording panel and a clearer status indicator, so a notification or knock at the door no longer forces a restart.' },
			{ kind: 'added', summary: 'Auto-updater and "What\'s new" notifications in the bottom-right corner of the editor, so release prompts and changelog nudges stay out of the way of the timeline.' },
			{ kind: 'added', summary: 'Silence detection (phase 1, opt-in under Settings → Experimental): finds dead-air segments by combining waveform analysis with cursor idleness, then offers one-click cuts you can review or dismiss.' },
			{ kind: 'added', summary: 'Dashboard route with a local-storage-backed data layer for recordings and exports, plus first analytics hooks.' },
			{ kind: 'added', summary: 'Web auth foundation: magic-link sign-in and password-reset flows backed by Better Auth + Drizzle, plus a public waitlist endpoint for Recast Cloud.' },
			{ kind: 'added', summary: 'macOS and Linux platform modules for audio and camera capture, paving the way for full feature parity with the Windows build.' },
			{ kind: 'added', summary: 'Homebrew Cask publishing workflow and matching install instructions for macOS alongside the existing `.dmg`, `.deb`, `.AppImage`, and `.exe` artifacts.' },
			{ kind: 'changed', summary: 'Smart-zoom suggestions: new scoring model that clusters clicks, weighs dwell time, and dedupes same-spot triggers, so auto-applied focus regions land on the moments that actually matter instead of every mouse-down.' },
			{ kind: 'changed', summary: 'Toaster restyled to share visual language with the bottom-right update notifications: same card geometry, same close affordance, same icon-badge variants. Sits in `bottom-right` everywhere instead of `top-center`.' },
			{ kind: 'changed', summary: 'Marketing site: hero copy rewritten to honestly describe the timeline ("the lightest editor you\'ve used") instead of pretending it doesn\'t exist; new editor-tour rail showcases the auto and manual tools side by side. Features, gamers, pricing pages refreshed too.' },
			{ kind: 'changed', summary: 'Recordings library cards (web + desktop) picked up techy framing — dot-grid placeholders, primary glow, CRT-style corner brackets — so an empty thumbnail reads as "ready for a frame" instead of an empty hole.' },
			{ kind: 'fixed', summary: 'Window-freeze regression on recording start: every FFmpeg/ffprobe spawn site now uses `configure_silent_command` on Windows so the console flash no longer steals focus and reads as "the whole window is frozen".' },
			{ kind: 'fixed', summary: 'Closing the recorder window while a recording is in flight no longer drops the capture; the app prompts and resolves the save first.' },
		],
	},
	{
		version: '0.1.7',
		date: '2026-05-16',
		changes: [
			{ kind: 'added', summary: 'Bulk-select mode for recordings and exports, with a floating action bar for delete and a single-tap "select all".' },
			{ kind: 'added', summary: 'Morph animations when toggling between grid and list views on the recordings and exports pages — same items, no jarring re-flow.' },
			{ kind: 'added', summary: 'One-shot setup scripts (`setup.ps1` / `setup.sh`) so first-time contributors can bring the whole monorepo up with a single command on Windows or macOS/Linux.' },
			{ kind: 'changed', summary: 'Export filenames now suffix duplicates with `(1)`, `(2)`, ... via a shared `unique_path` helper, so re-exporting the same recording keeps both files instead of silently overwriting the previous one.' },
			{ kind: 'changed', summary: 'Quick-start docs screenshot refreshed to show region selection.' },
			{ kind: 'fixed', summary: 'Hero CTA region: removed an unused background layer that was painting a stray gradient behind the headline on some viewport widths.' },
		],
	},
	{
		version: '0.1.6',
		date: '2026-05-10',
		changes: [
			{ kind: 'added', summary: 'Version-sync release scripts: every build manifest validates against the release tag and fails fast if a `0.0.0-dev` placeholder slips through.' },
			{ kind: 'added', summary: 'GitHub issue templates for bug reports, feature requests, and performance issues.' },
			{ kind: 'changed', summary: 'Dialog and Sheet components default `preventScroll={false}` so a closed dialog can no longer leak `pointer-events: none` onto the document body inside Tauri — the root cause of the earlier "the whole window is dead" reports.' },
			{ kind: 'fixed', summary: 'Resolved an intermittent pointer-blockage bug in the Dialog component that froze interactions after closing a modal.' },
			{ kind: 'fixed', summary: 'Version placeholders unified across files so dev and release builds no longer disagree about who they are.' },
		],
	},
	{
		version: '0.1.5',
		date: '2026-05-09',
		changes: [
			{ kind: 'added', summary: 'Linux screen capture: a Wayland-native pipeline using `xdg-desktop-portal` + PipeWire, and a parallel X11 native capture path. Linux recording docs refreshed alongside the new backends.' },
			{ kind: 'added', summary: 'Recording profiles: per-launch capture profiles with dynamic capability combinations, device awareness, and a management UI in Settings.' },
			{ kind: 'added', summary: 'Command palette (⌘K) extracted into a global `CommandPaletteHost` mounted at the root layout, so the shortcut and dialog work on every route — including the editor — not only on routes that render the sidebar.' },
			{ kind: 'added', summary: 'Web download page redesigned with new platform icons and a feature grid.' },
			{ kind: 'changed', summary: 'Properties panel: shared `PanelSection` primitive replaces ~30 ad-hoc section headers, drops repeated panel-name titles, normalises gap to `gap-4`, and standardises toggle / reset placement across Background, Focus, Annotations, Cursor, Audio, Camera, and Info panels.' },
			{ kind: 'changed', summary: 'Design tokens: introduced a Framer-inspired vocabulary (`canvas`, `surface-1/2`, `ink`, `ink-muted`, `hairline`, gradient spotlight cards, elevation shadows) layered on top of the existing shadcn tokens. Primary colour and font stack preserved.' },
		],
	},
	{
		version: '0.1.4',
		date: '2026-05-08',
		changes: [
			{ kind: 'added', summary: 'Camera overlay in the editor: composite the recorded camera track over the screen video with position presets, size, shape, and mirror toggles. Gated behind a `CAMERA_OVERLAY_UI_ENABLED` feature flag.' },
			{ kind: 'added', summary: 'Cursor: mouse-press events feed into the recorded timeline, and a refreshed set of cursor styles ships with the editor.' },
			{ kind: 'added', summary: 'Native macOS-style page transitions via the View Transitions API, with a smoother titlebar handoff between routes.' },
			{ kind: 'changed', summary: 'Canvas geometry and aspect-ratio handling: editor geometry helpers now carry the chosen aspect end-to-end (preview, composite, drop-shadow) without per-call ad-hoc math.' },
		],
	},
	{
		version: '0.1.3-beta',
		date: '2026-05-07',
		changes: [
			{ kind: 'added', summary: 'Active-preset chip in the editor toolbar with a reset-to-source affordance.' },
			{ kind: 'added', summary: 'Per-project preset persistence: applied preset and output aspect round-trip with undo/redo and project autosave.' },
			{ kind: 'changed', summary: 'GIF export now uses a 2-pass palettegen → paletteuse pipeline, so the progress bar advances in real time instead of sitting at 0% while only the elapsed counter ticked.' },
			{ kind: 'changed', summary: 'Presets actually resize the canvas to their target aspect (16:9, 9:16, 1:1, 1.91:1) end-to-end through the preview, FFmpeg filter graph, cursor overlay, and drop-shadow rasteriser.' },
			{ kind: 'changed', summary: 'Stronger blur annotation: redacts content even at full strength, with scaled tint opacity and an optional gray wash above 0.6 strength.' },
			{ kind: 'changed', summary: 'FFmpeg error reporting filters out progress noise so real diagnostic lines reach the failure toast.' },
			{ kind: 'fixed', summary: 'Region picker "Use area" / "Cancel" buttons now work; closing the main window exits the app instead of leaving aux windows holding the process.' },
			{ kind: 'fixed', summary: 'Quick action no longer opens the camera preview inside the recording panel window.' },
		],
	},
	{
		version: '0.1.2-beta',
		date: '2026-05-06',
		changes: [
			{ kind: 'added', summary: 'Timeline workspace: clip bar, playhead, ruler, toolbar, and zoom lane components.' },
			{ kind: 'added', summary: 'Blur annotations with adjustable strength, rendered through the composite canvas pipeline.' },
			{ kind: 'added', summary: 'Cursor animation effects: click bounce, idle sway, and motion blur.' },
			{ kind: 'added', summary: 'Glass card and chip components for a more refined UI surface.' },
			{ kind: 'added', summary: '`Kbd` component for consistent keyboard shortcut hints.' },
			{ kind: 'added', summary: 'Region selection in the source picker, with last-used source persistence.' },
			{ kind: 'added', summary: 'Camera overlay settings and validation, plus browser-based camera enumeration.' },
			{ kind: 'added', summary: 'Command palette (⌘K) with global navigation, recording, theme and external commands.' },
			{ kind: 'added', summary: 'Sidebar pinning and hover behavior.' },
			{ kind: 'changed', summary: 'Refactored project structure for readability and maintainability.' },
			{ kind: 'changed', summary: 'Upgraded Node.js to v24 and enabled `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`.' },
			{ kind: 'changed', summary: 'Redesigned loading screen with new logo and progress bar.' },
			{ kind: 'changed', summary: 'Polished typography, spacing, and accessibility across annotation panels and headers.' },
			{ kind: 'fixed', summary: 'Reverted erroneous app version bump; settings layout regressions cleaned up.' },
		],
	},
	{
		version: '0.1.0-beta',
		date: 'Initial beta',
		changes: [
			{ kind: 'changed', summary: 'First public beta of Recast: offline-first desktop screen recorder and editor' },
		],
	},
] as const;
// RELEASES:END

export const LATEST_RELEASE = RELEASES[0];
