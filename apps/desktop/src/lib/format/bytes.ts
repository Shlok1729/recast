/**
 * Human-readable byte size up to TB, e.g. `1.4 GB`, `932 MB`, `84 KB`. Shared by
 * InfoPanel and CloudSignIn (which had identical maths, differing only in the
 * zero/empty placeholder — hence `zeroLabel`).
 *
 * Distinct from `formatSize` in `./files.ts`, which is the MB-capped file-listing
 * variant; keep both.
 */
export function formatBytes(
	bytes: number | undefined,
	zeroLabel = "0 B",
): string {
	if (!bytes || bytes < 0) return zeroLabel;
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	let v = bytes;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
