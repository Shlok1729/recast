/**
 * Web Audio timeline engine — sample-accurate, cut-aware audio playback for the
 * WebCodecs editor preview.
 *
 * Instead of slaving an `<audio>` element to the playhead by seeking (which
 * drifts across cuts, stalls on cold starts, and can cut out), we decode the
 * recording's audio once into `AudioBuffer`s and schedule each KEPT region as
 * its own `AudioBufferSourceNode` on the audio hardware clock. The cuts are
 * simply the gaps between scheduled chunks, so they're silent and exact — no
 * seeking ever happens during playback.
 *
 * Lifecycle mirrors the picture clock: `play(regions, outputTime)` schedules
 * everything from the current output time; `pause()` stops it; `reschedule()`
 * re-plans on a seek or an edit-while-playing. Fully fallback-safe: `create`
 * throws if Web Audio is unavailable or nothing decodes, and the caller drops
 * back to the `<audio>`-element path, so the user is never left without audio.
 */

import { planAudioSchedule, type Region } from "./audio-schedule";

interface AudioTrack {
	buffer: AudioBuffer;
	gain: GainNode;
}

export class AudioTimelineEngine {
	#ctx: AudioContext;
	#tracks: AudioTrack[];
	#active: AudioBufferSourceNode[] = [];
	#playing = false;
	#volume = 1; // 0..1
	#muted = false;

	private constructor(ctx: AudioContext, tracks: AudioTrack[]) {
		this.#ctx = ctx;
		this.#tracks = tracks;
	}

	/**
	 * Create the engine for the given audio source URLs (system + mic; nulls are
	 * skipped). Fetches and decodes each into an `AudioBuffer`. Throws if Web
	 * Audio is unavailable or nothing decodes — the caller should then fall back
	 * to the `<audio>` elements.
	 */
	static async create(urls: ReadonlyArray<string | null | undefined>): Promise<AudioTimelineEngine> {
		const Ctx: typeof AudioContext | undefined =
			typeof AudioContext !== "undefined"
				? AudioContext
				: // eslint-disable-next-line @typescript-eslint/no-explicit-any
					(globalThis as any).webkitAudioContext;
		if (!Ctx) throw new Error("Web Audio API unavailable");

		const ctx = new Ctx();
		const tracks: AudioTrack[] = [];
		for (const url of urls) {
			if (!url) continue;
			try {
				const res = await fetch(url);
				if (!res.ok) continue;
				const data = await res.arrayBuffer();
				const buffer = await ctx.decodeAudioData(data);
				const gain = ctx.createGain();
				gain.connect(ctx.destination);
				tracks.push({ buffer, gain });
			} catch {
				// Skip a track that won't fetch/decode; others may still work.
			}
		}
		if (tracks.length === 0) {
			try {
				await ctx.close();
			} catch {
				/* ignore */
			}
			throw new Error("no decodable audio tracks");
		}
		return new AudioTimelineEngine(ctx, tracks);
	}

	get ready(): boolean {
		return this.#tracks.length > 0;
	}

	/** Apply volume (0–100) and mute to every track's gain. */
	setVolume(volume0to100: number, muted: boolean): void {
		this.#volume = Math.max(0, Math.min(1, volume0to100 / 100));
		this.#muted = muted;
		const v = this.#muted ? 0 : this.#volume;
		for (const t of this.#tracks) t.gain.gain.value = v;
	}

	#stopActive(): void {
		for (const node of this.#active) {
			try {
				node.onended = null;
				node.stop();
			} catch {
				/* already stopped */
			}
		}
		this.#active = [];
	}

	/** (Re)schedule all kept regions so audio plays from OUTPUT time `from`. */
	#schedule(regions: ReadonlyArray<Region>, from: number): void {
		this.#stopActive();
		const now = this.#ctx.currentTime;
		const chunks = planAudioSchedule(regions, from);
		for (const t of this.#tracks) {
			const bufDur = t.buffer.duration;
			for (const c of chunks) {
				// A track may be shorter than the timeline (e.g. mic stopped early);
				// clamp the slice to the available buffer.
				if (c.bufferOffset >= bufDur) continue;
				const playDur = Math.min(c.duration, bufDur - c.bufferOffset);
				if (playDur <= 0) continue;
				const node = this.#ctx.createBufferSource();
				node.buffer = t.buffer;
				node.connect(t.gain);
				node.onended = () => {
					const i = this.#active.indexOf(node);
					if (i >= 0) this.#active.splice(i, 1);
				};
				node.start(now + c.whenDelay, c.bufferOffset, playDur);
				this.#active.push(node);
			}
		}
	}

	/** Start (or restart) playback from OUTPUT time `fromOutputTime`. */
	async play(regions: ReadonlyArray<Region>, fromOutputTime: number): Promise<void> {
		if (this.#ctx.state === "suspended") {
			try {
				await this.#ctx.resume();
			} catch {
				/* resume may reject if not yet user-activated; schedule anyway */
			}
		}
		this.#playing = true;
		this.#schedule(regions, fromOutputTime);
	}

	/** Stop all sound; keep buffers for the next play. */
	pause(): void {
		this.#playing = false;
		this.#stopActive();
	}

	/**
	 * Re-plan playback to a new OUTPUT time — on a scrub, or when the cut set
	 * changes while playing. No-op while paused (the next `play` will schedule).
	 */
	reschedule(regions: ReadonlyArray<Region>, fromOutputTime: number): void {
		if (!this.#playing) return;
		this.#schedule(regions, fromOutputTime);
	}

	get playing(): boolean {
		return this.#playing;
	}

	dispose(): void {
		this.#stopActive();
		this.#playing = false;
		this.#tracks = [];
		try {
			void this.#ctx.close();
		} catch {
			/* already closed */
		}
	}
}
