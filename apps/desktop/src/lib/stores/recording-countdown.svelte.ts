/**
 * Pre-capture countdown setting, shared between Settings → Recording and the
 * recording panel window via `PersistedState`. Tauri v2 webviews share a
 * localStorage origin, so a Settings change reaches an open panel live via the
 * `storage` event.
 *
 * Stored as a raw number string (historical format); `value` coerces to a known
 * option so a stale / out-of-range number can never reach the UI.
 */

import { PersistedState } from "@recast/ui/persisted-state";

export type CountdownSeconds = 0 | 3 | 5 | 10;

const STORAGE_KEY = "recast-recording-countdown";
const VALID: readonly CountdownSeconds[] = [0, 3, 5, 10];
const DEFAULT: CountdownSeconds = 3;

function coerce(n: number): CountdownSeconds {
	return (VALID as readonly number[]).includes(n) ? (n as CountdownSeconds) : DEFAULT;
}

function createRecordingCountdownStore() {
	const store = new PersistedState<number>(STORAGE_KEY, DEFAULT);

	return {
		/** Current countdown in seconds, coerced to a valid option (0/3/5/10). */
		get value(): CountdownSeconds {
			return coerce(store.current);
		},
		set(value: CountdownSeconds) {
			store.current = value;
		},
	};
}

export const recordingCountdown = createRecordingCountdownStore();
