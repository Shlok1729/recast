// Browser-side camera enumeration. The Rust ffmpeg/dshow enumeration returns
// DirectShow friendly names, but the WebView's getUserMedia operates on
// MediaDevices deviceIds. When those disagree (e.g., Phone Link or other
// virtual cameras registered ahead of the real webcam), passing a DirectShow
// name to getUserMedia silently fails and falling back to `video: true` lets
// the browser pick its own default — which on Windows is often Phone Link.
//
// Use this module everywhere the WebView needs to open a specific camera.

const VIRTUAL_CAMERA_PATTERNS: RegExp[] = [
	/phone\s*link/i,
	/windows\s*camera/i,
	/obs\s*virtual/i,
	/obs-?camera/i,
	/nvidia\s*broadcast/i,
	/snap\s*camera/i,
	/xsplit/i,
	/manycam/i,
	/e2esoft/i,
	/splitcam/i,
	/droidcam/i,
	/iriun/i,
	/epoccam/i,
];

export interface BrowserCamera {
	deviceId: string;
	label: string;
	groupId: string;
	isVirtual: boolean;
}

export function isVirtualCameraLabel(label: string): boolean {
	return VIRTUAL_CAMERA_PATTERNS.some((p) => p.test(label));
}

/**
 * Why camera enumeration couldn't produce a usable device — but only for the
 * cases that are a *blocker* rather than simply "no hardware":
 *   - `unavailable` → the WebView exposes no MediaDevices API at all (macOS
 *     WKWebView without NSCameraUsageDescription, or Linux WebKitGTK with
 *     media-stream off). A build/permission misconfig, not the user's doing.
 *   - `denied` → a camera exists but the OS/WebView refused capture (the user,
 *     or a policy, blocked access).
 * An empty result with NO error means genuinely no camera is connected;
 * callers distinguish that from these two so the UI can say the right thing.
 */
export type CameraAccessReason = "unavailable" | "denied";

export class CameraAccessError extends Error {
	readonly reason: CameraAccessReason;
	constructor(reason: CameraAccessReason, message: string) {
		super(message);
		this.name = "CameraAccessError";
		this.reason = reason;
	}
}

/** A getUserMedia rejection that means "blocked" — not "device busy" / other. */
function isPermissionDenied(e: unknown): boolean {
	return (
		e instanceof DOMException &&
		(e.name === "NotAllowedError" || e.name === "SecurityError")
	);
}

/**
 * The WebView exposes no `navigator.mediaDevices` at all. On macOS this is
 * what WKWebView does when the bundle declares no `NSCameraUsageDescription`
 * (see src-tauri/Info.plist); on Linux it's WebKitGTK with `enable-media-stream`
 * off (see `enable_webview_media` in lib.rs). The whole MediaDevices API is
 * stripped rather than prompting, so enumerate/getUserMedia would throw the
 * opaque "undefined is not an object" instead of a real error. Surface
 * something the user can act on.
 */
function assertMediaDevices(): MediaDevices {
	const media = navigator.mediaDevices;
	if (!media || typeof media.enumerateDevices !== "function") {
		throw new CameraAccessError(
			"unavailable",
			"Camera access isn't available in this build. Update Recast, then " +
				"check that camera permission is enabled for it in your system settings.",
		);
	}
	return media;
}

/**
 * Enumerate video input devices visible to this WebView. Triggers a one-shot
 * permission probe if labels are blank (browsers strip labels until permission
 * is granted at least once). Real hardware is sorted ahead of virtual cameras
 * so callers that pick `[0]` get a sane default.
 */
export async function enumerateCameras(): Promise<BrowserCamera[]> {
	const media = assertMediaDevices();
	let devices = await media.enumerateDevices();
	// No videoinput entry at all → no camera is connected. Return empty (the
	// "none" case) rather than probing — getUserMedia on absent hardware would
	// either no-op or pop a needless prompt. Callers render "no camera found".
	if (!devices.some((d) => d.kind === "videoinput")) return [];

	const labelsPopulated = devices.some(
		(d) => d.kind === "videoinput" && !!d.label,
	);
	if (!labelsPopulated) {
		// Labels stay blank until capture is authorized once. Probe to unlock
		// them — and to turn a silent block into an explicit, actionable error.
		try {
			const probe = await media.getUserMedia({ video: true });
			probe.getTracks().forEach((t) => t.stop());
		} catch (e) {
			if (isPermissionDenied(e)) {
				throw new CameraAccessError(
					"denied",
					"Camera access is blocked. Allow it in your system settings, then rescan.",
				);
			}
			// NotReadableError (device busy) and friends are non-fatal: fall
			// through and return the (still-unlabeled) device so it's visible.
			console.warn("[camera] label probe failed:", e);
		}
		devices = await media.enumerateDevices();
	}

	return devices
		.filter((d) => d.kind === "videoinput")
		.map((d) => ({
			deviceId: d.deviceId,
			label: d.label || "Camera",
			groupId: d.groupId,
			isVirtual: isVirtualCameraLabel(d.label),
		}))
		.sort((a, b) => Number(a.isVirtual) - Number(b.isVirtual));
}

/**
 * Resolve a query (browser deviceId, exact label, or DirectShow name) to a
 * specific camera. Falls back to fuzzy label matching, but always prefers
 * non-virtual hardware when multiple candidates match.
 */
export function findCamera(
	cameras: BrowserCamera[],
	query: string | null | undefined,
): BrowserCamera | null {
	if (!query) return null;
	const direct = cameras.find((c) => c.deviceId === query);
	if (direct) return direct;
	const exact = cameras.find((c) => c.label === query);
	if (exact) return exact;
	const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
	const q = norm(query);
	const partial = cameras.filter((c) => {
		const lbl = norm(c.label);
		return lbl.includes(q) || q.includes(lbl);
	});
	if (partial.length === 0) return null;
	return partial.find((c) => !c.isVirtual) ?? partial[0];
}

export class CameraNotFoundError extends Error {
	readonly query: string | null;
	constructor(query: string | null, message: string) {
		super(message);
		this.name = "CameraNotFoundError";
		this.query = query;
	}
}

/**
 * Open a stream for `query` (or the best non-virtual default if null). Always
 * uses `deviceId: { exact }` so the browser cannot substitute another device.
 * Throws CameraNotFoundError instead of silently picking a default.
 */
export async function openCameraStream(
	query: string | null,
): Promise<{ stream: MediaStream; camera: BrowserCamera }> {
	const cameras = await enumerateCameras();
	if (cameras.length === 0) {
		throw new CameraNotFoundError(query, "No camera devices available.");
	}

	const target = query
		? findCamera(cameras, query)
		: (cameras.find((c) => !c.isVirtual) ?? cameras[0]);

	if (!target) {
		throw new CameraNotFoundError(
			query,
			`Requested camera "${query}" is not available in this WebView.`,
		);
	}

	const stream = await assertMediaDevices().getUserMedia({
		video: { deviceId: { exact: target.deviceId } },
		audio: false,
	});
	return { stream, camera: target };
}
