/**
 * Pure helpers + data for AudioPanel: fade presets, the dB readout, and the SVG
 * gain-envelope path. Extracted so the maths is testable; the component keeps
 * the store wiring (and a thin wrapper that feeds clip duration into the path).
 */

export interface FadePreset {
	label: string;
	in: number;
	out: number;
}

export const FADE_PRESETS: FadePreset[] = [
	{ label: "None", in: 0, out: 0 },
	{ label: "Subtle", in: 0.25, out: 0.25 },
	{ label: "Smooth", in: 0.5, out: 1.0 },
	{ label: "Cinematic", in: 1.0, out: 2.0 },
];

/**
 * dB-ish display ("0 dB" at 100%, calibrated as 20·log10(volume/100)). Not the
 * exact same curve as the Rust ffmpeg `volume=` filter (a linear multiplier) but
 * matches user intuition.
 */
export function dbForVolume(v: number): string {
	if (v <= 0) return "−∞ dB";
	const db = 20 * Math.log10(v / 100);
	if (Math.abs(db) < 0.05) return "0.0 dB";
	return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

/**
 * SVG path for a gain envelope across a 100×24 box. Mirrors the FFmpeg afade
 * behaviour: linear ramp 0→1 over `fadeIn` at the head, hold at 1, then linear
 * ramp 1→0 over `fadeOut` at the tail. Each fade is capped at half the clip.
 */
export function envelopePath(
	fadeIn: number,
	fadeOut: number,
	clipDuration: number,
): string {
	const W = 100;
	const H = 24;
	const totalSecs = Math.max(0.01, clipDuration || 1);
	const fi = Math.max(0, Math.min(fadeIn, totalSecs * 0.5));
	const fo = Math.max(0, Math.min(fadeOut, totalSecs * 0.5));
	const xIn = (fi / totalSecs) * W;
	const xOut = W - (fo / totalSecs) * W;
	const yTop = 2;
	const yBottom = H - 2;
	return `M 0 ${yBottom} L ${xIn.toFixed(2)} ${yTop} L ${xOut.toFixed(2)} ${yTop} L ${W} ${yBottom}`;
}
