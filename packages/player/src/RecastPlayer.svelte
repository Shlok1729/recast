<script lang="ts">
	import { onMount } from "svelte";
	import {
		Captions,
		Maximize,
		Minimize,
		PictureInPicture,
		PictureInPicture2,
		Pause,
		Play,
		RotateCcw,
		RotateCw,
		Volume,
		Volume1,
		Volume2,
		VolumeX,
	} from "@lucide/svelte";
	import type {
		RecastPlayerApi,
		RecastPlayerControls,
		RecastPlayerProps,
		RecastPlayerState,
	} from "./types";

	import "media-chrome";
	import "hls-video-element";

	const DEFAULT_CONTROLS: RecastPlayerControls = {
		bigPlay: true,
		seek: true,
		time: true,
		volume: true,
		playbackRate: true,
		captions: true,
		pip: true,
		fullscreen: true,
	};

	let {
		src,
		poster = null,
		thumbnails = null,
		tracks = [],
		title = "",
		autoplay = false,
		preload = "metadata",
		crossorigin = "anonymous",
		loop = false,
		volume = $bindable(1),
		muted = $bindable(false),
		playbackRate = $bindable(1),
		currentTime = $bindable(0),
		paused = $bindable<boolean | null>(null),
		showMenu = true,
		controls = {},
		aspectRatio = null,
		objectFit = "contain",
		ariaLabel = "",
		className = "",
		onengagement,
		onstatechange,
		api = $bindable<RecastPlayerApi | null>(null),
	}: RecastPlayerProps = $props();

	let controllerEl = $state<HTMLElement | null>(null);
	let videoEl = $state<HTMLVideoElement | null>(null);
	let lastReportedPct = 0;
	let started = false;
	let intrinsicWidth = $state(0);
	let intrinsicHeight = $state(0);

	const isHls = $derived(/\.m3u8(\?|#|$)/i.test(src));
	const mergedControls = $derived({ ...DEFAULT_CONTROLS, ...controls });
	const showCaptions = $derived(mergedControls.captions && showMenu);
	const playerLabel = $derived(ariaLabel || title || "Video player");
	const resolvedAspectRatio = $derived.by(() => {
		if (typeof aspectRatio === "number" && aspectRatio > 0) return `${aspectRatio}`;
		if (typeof aspectRatio === "string" && aspectRatio.trim()) return aspectRatio.trim();
		if (intrinsicWidth > 0 && intrinsicHeight > 0) {
			return `${intrinsicWidth} / ${intrinsicHeight}`;
		}
		return null;
	});
	const playerStyle = $derived.by(() => {
		const vars = [
			resolvedAspectRatio
				? `--recast-player-aspect-ratio: ${resolvedAspectRatio};`
				: "--recast-player-aspect-ratio: auto;",
			`--recast-player-object-fit: ${objectFit};`,
		];
		return vars.join(" ");
	});

	function clamp01(value: number) {
		return Math.min(1, Math.max(0, value));
	}

	function emitState() {
		if (!onstatechange || !videoEl) return;
		onstatechange(getState());
	}

	function getState(): RecastPlayerState {
		return {
			paused: videoEl?.paused ?? true,
			ended: videoEl?.ended ?? false,
			currentTime: videoEl?.currentTime ?? currentTime,
			duration: videoEl?.duration ?? 0,
			volume: videoEl?.volume ?? clamp01(volume),
			muted: videoEl?.muted ?? muted,
			playbackRate: videoEl?.playbackRate ?? playbackRate,
			videoWidth: videoEl?.videoWidth ?? intrinsicWidth,
			videoHeight: videoEl?.videoHeight ?? intrinsicHeight,
		};
	}

	async function safePlay() {
		if (!videoEl) return;
		try {
			await videoEl.play();
		} catch {
			paused = true;
			emitState();
		}
	}

	async function enterFullscreen() {
		if (!controllerEl) return;
		if (document.fullscreenElement === controllerEl) return;
		await controllerEl.requestFullscreen?.();
	}

	async function exitFullscreen() {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
		}
	}

	async function enterPictureInPicture() {
		if (!videoEl || !document.pictureInPictureEnabled) return;
		if (document.pictureInPictureElement === videoEl) return;
		await videoEl.requestPictureInPicture?.();
	}

	onMount(() => {
		api = {
			play: safePlay,
			pause: () => videoEl?.pause(),
			seek: (seconds) => {
				if (videoEl) videoEl.currentTime = Math.max(0, seconds);
			},
			setMuted: (next) => {
				if (videoEl) videoEl.muted = next;
			},
			setVolume: (next) => {
				if (videoEl) videoEl.volume = clamp01(next);
			},
			setPlaybackRate: (next) => {
				if (videoEl) videoEl.playbackRate = next;
			},
			enterFullscreen,
			exitFullscreen,
			enterPictureInPicture,
			getCurrentTime: () => videoEl?.currentTime ?? 0,
			getDuration: () => videoEl?.duration ?? 0,
			getState,
			getVideoElement: () => videoEl,
		};
		return () => {
			api = null;
		};
	});

	function handlePlay() {
		paused = false;
		if (!started && onengagement) {
			started = true;
			onengagement({ type: "view-start", percent: 0 });
		}
		emitState();
	}

	function handlePause() {
		paused = true;
		emitState();
	}

	function handleLoadedMetadata() {
		if (!videoEl) return;
		intrinsicWidth = videoEl.videoWidth;
		intrinsicHeight = videoEl.videoHeight;
		currentTime = videoEl.currentTime;
		emitState();
	}

	function handleTimeUpdate() {
		if (!videoEl) return;
		currentTime = videoEl.currentTime;
		emitState();
		if (!onengagement) return;
		const duration = videoEl.duration || 0;
		if (!duration || !isFinite(duration)) return;
		const pct = Math.min(100, Math.round((videoEl.currentTime / duration) * 100));
		if (pct - lastReportedPct >= 5) {
			lastReportedPct = pct;
			onengagement({
				type: "progress",
				percent: pct,
				currentTime: videoEl.currentTime,
			});
		}
	}

	function handleVolumeChange() {
		if (!videoEl) return;
		volume = videoEl.volume;
		muted = videoEl.muted;
		emitState();
	}

	function handleRateChange() {
		if (!videoEl) return;
		playbackRate = videoEl.playbackRate;
		emitState();
	}

	function handleSeeked() {
		if (!videoEl) return;
		currentTime = videoEl.currentTime;
		emitState();
	}

	function handleEnded() {
		if (!videoEl) return;
		paused = true;
		emitState();
		if (!onengagement) return;
		onengagement({
			type: "ended",
			percent: 100,
			currentTime: videoEl.currentTime,
		});
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (!videoEl) return;
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable)
		) {
			return;
		}

		switch (event.key) {
			case " ":
			case "k":
			case "K":
				event.preventDefault();
				if (videoEl.paused) void safePlay();
				else videoEl.pause();
				break;
			case "ArrowLeft":
			case "j":
			case "J":
				event.preventDefault();
				videoEl.currentTime = Math.max(0, videoEl.currentTime - 5);
				break;
			case "ArrowRight":
			case "l":
			case "L":
				event.preventDefault();
				videoEl.currentTime = Math.min(
					videoEl.duration || Number.MAX_SAFE_INTEGER,
					videoEl.currentTime + 5,
				);
				break;
			case "m":
			case "M":
				event.preventDefault();
				videoEl.muted = !videoEl.muted;
				break;
			case "f":
			case "F":
				event.preventDefault();
				if (document.fullscreenElement) void exitFullscreen();
				else void enterFullscreen();
				break;
			case "Home":
				event.preventDefault();
				videoEl.currentTime = 0;
				break;
			case "End":
				if (isFinite(videoEl.duration)) {
					event.preventDefault();
					videoEl.currentTime = videoEl.duration;
				}
				break;
		}
	}

	$effect(() => {
		if (!videoEl) return;
		const next = clamp01(volume);
		if (Math.abs(videoEl.volume - next) > 0.01) videoEl.volume = next;
	});

	$effect(() => {
		if (!videoEl) return;
		if (videoEl.muted !== muted) videoEl.muted = muted;
	});

	$effect(() => {
		if (!videoEl) return;
		if (Math.abs(videoEl.playbackRate - playbackRate) > 0.001) {
			videoEl.playbackRate = playbackRate;
		}
	});

	$effect(() => {
		if (!videoEl) return;
		if (paused === null) return;
		if (paused && !videoEl.paused) videoEl.pause();
		if (!paused && videoEl.paused) void safePlay();
	});

	$effect(() => {
		if (!videoEl || !isFinite(currentTime)) return;
		if (Math.abs(videoEl.currentTime - currentTime) > 0.05) {
			videoEl.currentTime = Math.max(0, currentTime);
		}
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<media-controller
	bind:this={controllerEl}
	class={`recast-player ${className}`}
	style={playerStyle}
	aria-label={playerLabel}
	role="region"
	tabindex="0"
	defaultsubtitles
	onkeydown={handleKeyDown}
>
	{#if isHls}
		<!-- svelte-ignore a11y_media_has_caption -->
		<hls-video
			bind:this={videoEl}
			slot="media"
			class="recast-media"
			{src}
			{poster}
			{title}
			{preload}
			{loop}
			crossorigin={crossorigin ?? undefined}
			playsinline
			{autoplay}
			onplay={handlePlay}
			onpause={handlePause}
			onloadedmetadata={handleLoadedMetadata}
			ontimeupdate={handleTimeUpdate}
			onvolumechange={handleVolumeChange}
			onratechange={handleRateChange}
			onseeked={handleSeeked}
			onended={handleEnded}
		>
			{#if thumbnails}
				<track kind="metadata" src={thumbnails} label="thumbnails" default />
			{/if}
			{#each tracks as track (track.src)}
				<track
					src={track.src}
					kind={track.kind}
					label={track.label}
					srclang={track.srclang}
					default={track.default}
				/>
			{/each}
		</hls-video>
	{:else}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			slot="media"
			class="recast-media"
			{src}
			{poster}
			{title}
			{preload}
			{loop}
			crossorigin={crossorigin ?? undefined}
			playsinline
			{autoplay}
			onplay={handlePlay}
			onpause={handlePause}
			onloadedmetadata={handleLoadedMetadata}
			ontimeupdate={handleTimeUpdate}
			onvolumechange={handleVolumeChange}
			onratechange={handleRateChange}
			onseeked={handleSeeked}
			onended={handleEnded}
		>
			{#if thumbnails}
				<track kind="metadata" src={thumbnails} label="thumbnails" default />
			{/if}
			{#each tracks as track (track.src)}
				<track
					src={track.src}
					kind={track.kind}
					label={track.label}
					srclang={track.srclang}
					default={track.default}
				/>
			{/each}
		</video>
	{/if}

	<media-loading-indicator class="recast-loading"></media-loading-indicator>

	{#if mergedControls.bigPlay}
		<media-play-button class="recast-big-play" aria-label="Toggle playback">
			<span slot="play" class="recast-icon recast-icon-big">
				<Play class="size-7 translate-x-px" />
			</span>
			<span slot="pause" class="recast-icon recast-icon-big">
				<Pause class="size-7" />
			</span>
		</media-play-button>
	{/if}

	<media-control-bar class="recast-control-bar">
		<media-play-button class="recast-btn" aria-label="Play or pause">
			<span slot="play" class="recast-icon"><Play class="size-4 translate-x-[0.5px]" /></span>
			<span slot="pause" class="recast-icon"><Pause class="size-4" /></span>
		</media-play-button>

		{#if mergedControls.seek}
			<media-seek-backward-button class="recast-btn" seekoffset="10" aria-label="Back 10 seconds">
				<span slot="icon" class="recast-icon"><RotateCcw class="size-4" /></span>
			</media-seek-backward-button>

			<media-seek-forward-button class="recast-btn" seekoffset="10" aria-label="Forward 10 seconds">
				<span slot="icon" class="recast-icon"><RotateCw class="size-4" /></span>
			</media-seek-forward-button>
		{/if}

		{#if mergedControls.time}
			<media-time-display class="recast-time" showduration></media-time-display>
		{/if}

		<media-time-range class="recast-scrubber" aria-label="Seek">
			{#if thumbnails}
				<media-preview-thumbnail
					slot="preview"
					class="recast-thumb"
				></media-preview-thumbnail>
			{/if}
			<media-preview-time-display
				slot="preview"
				class="recast-preview-time"
			></media-preview-time-display>
		</media-time-range>

		{#if mergedControls.volume}
			<media-mute-button class="recast-btn" aria-label="Mute or unmute">
				<span slot="off" class="recast-icon"><VolumeX class="size-4" /></span>
				<span slot="low" class="recast-icon"><Volume class="size-4" /></span>
				<span slot="medium" class="recast-icon"><Volume1 class="size-4" /></span>
				<span slot="high" class="recast-icon"><Volume2 class="size-4" /></span>
			</media-mute-button>

			<media-volume-range class="recast-volume" aria-label="Volume"></media-volume-range>
		{/if}

		{#if mergedControls.playbackRate}
			<media-playback-rate-button
				class="recast-btn recast-btn-text"
				rates="0.25 0.5 0.75 1 1.25 1.5 1.75 2"
				aria-label="Playback speed"
			></media-playback-rate-button>
		{/if}

		{#if showCaptions}
			<media-captions-button class="recast-btn" aria-label="Captions">
				<span slot="on" class="recast-icon"><Captions class="size-4" /></span>
				<span slot="off" class="recast-icon recast-icon-muted">
					<Captions class="size-4" />
				</span>
			</media-captions-button>
		{/if}

		{#if mergedControls.pip}
			<media-pip-button class="recast-btn" aria-label="Picture in picture">
				<span slot="enter" class="recast-icon"><PictureInPicture class="size-4" /></span>
				<span slot="exit" class="recast-icon"><PictureInPicture2 class="size-4" /></span>
			</media-pip-button>
		{/if}

		{#if mergedControls.fullscreen}
			<media-fullscreen-button class="recast-btn" aria-label="Fullscreen">
				<span slot="enter" class="recast-icon"><Maximize class="size-4" /></span>
				<span slot="exit" class="recast-icon"><Minimize class="size-4" /></span>
			</media-fullscreen-button>
		{/if}
	</media-control-bar>
</media-controller>

<style>
	:global(.recast-player) {
		display: block;
		width: 100%;
		aspect-ratio: var(--recast-player-aspect-ratio, auto);
		background: #000;
	}

	:global(.recast-player .recast-media) {
		width: 100%;
		height: 100%;
		object-fit: var(--recast-player-object-fit, contain);
		background: #000;
	}
</style>
