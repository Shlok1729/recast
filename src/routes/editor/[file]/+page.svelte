<script lang="ts">
	import { goto } from "$app/navigation";
	import EditorToolbar from "$components/editor/EditorToolbar.svelte";
	import PlaybackControls from "$components/editor/PlaybackControls.svelte";
	import PropertiesPanel from "$components/editor/PropertiesPanel.svelte";
	import Timeline from "$components/editor/Timeline.svelte";
	import VideoPreview from "$components/editor/VideoPreview.svelte";
	import { createEditorStore } from "$lib/stores/editor-store.svelte";
	import { convertFileSrc, invoke } from "@tauri-apps/api/core";
	import { tick } from "svelte";

	interface Props {
		data: {
			filePath: string;
			filename: string;
		};
	}

	let { data }: Props = $props();

	const store = createEditorStore();

	let videoEl: HTMLVideoElement | null = $state(null);
	let videoSrc = $state("");
	let isLoading = $state(true);
	let error = $state("");
	let loadedPath = $state("");

	// Sync video time → store
	function handleTimeUpdate() {
		if (videoEl && !store.isPlaying) return;
		if (videoEl) {
			store.currentTime = videoEl.currentTime;
		}
	}

	function handleVideoEnded() {
		store.isPlaying = false;
	}

	function mergeVideoMetadata(next: {
		duration?: number;
		width?: number;
		height?: number;
		fps?: number;
		codec?: string;
		sizeBytes?: number;
	}) {
		store.metadata = {
			duration: next.duration ?? store.metadata?.duration ?? 0,
			width: next.width ?? store.metadata?.width ?? 0,
			height: next.height ?? store.metadata?.height ?? 0,
			fps: next.fps ?? store.metadata?.fps ?? 30,
			codec: next.codec ?? store.metadata?.codec ?? "unknown",
			sizeBytes: next.sizeBytes ?? store.metadata?.sizeBytes ?? 0,
		};
		if (store.trimEnd <= 0 && store.metadata.duration > 0) {
			store.trimEnd = store.metadata.duration;
		}
	}

	function handleVideoLoadedMetadata() {
		if (!videoEl) return;
		mergeVideoMetadata({
			duration: videoEl.duration,
			width: videoEl.videoWidth,
			height: videoEl.videoHeight,
			fps: 30, // default, will be overridden by Rust metadata
			codec: "h264",
			sizeBytes: 0,
		});
	}

	function handleVideoReady() {
		handleVideoLoadedMetadata();
		isLoading = false;
	}

	function handleVideoError() {
		const code = videoEl?.error?.code;
		console.error("Video failed to load", {
			path: data.filePath,
			src: videoSrc,
			code,
		});
		error = code
			? `Failed to load video (media error ${code}).`
			: "Failed to load video.";
		isLoading = false;
	}

	async function loadVideo() {
		error = "";
		isLoading = true;
		videoSrc = "";
		videoEl?.pause();
		store.metadata = null;
		store.reset();

		try {
			// Convert local file path to asset protocol URL for Tauri
			videoSrc = convertFileSrc(data.filePath);
			await tick();
			videoEl?.load();

			// Also try to get metadata from Rust
			try {
				const meta = await invoke<{
					duration: number;
					width: number;
					height: number;
					fps: number;
					codec: string;
					size_bytes: number;
				}>("get_video_metadata", { path: data.filePath });

				mergeVideoMetadata({
					duration: meta.duration,
					width: meta.width,
					height: meta.height,
					fps: meta.fps,
					codec: meta.codec,
					sizeBytes: meta.size_bytes,
				});
			} catch {
				// Fallback to HTML5 video metadata
				console.warn(
					"Could not get Rust video metadata, using HTML5 fallback",
				);
			}
		} catch (e) {
			console.error("Failed to load video:", e);
			error = `Could not load video: ${e}`;
			isLoading = false;
		}
	}

	async function handleExport() {
		if (store.isExporting) return;
		store.isExporting = true;
		store.exportProgress = 0;

		try {
			const result = await invoke<string>("export_video", {
				inputPath: data.filePath,
				format: store.exportFormat,
				trimStart: store.trimStart,
				trimEnd: store.trimEnd,
				backgroundType: store.backgroundType,
				backgroundValue: store.backgroundValue,
				backgroundBlur: store.backgroundBlur,
				padding: store.padding,
				audioSettings: store.audioSettings,
				watermarkSettings: store.watermarkSettings,
			});
			console.log("Export complete:", result);
			// Could show a toast here
		} catch (e) {
			console.error("Export failed:", e);
			alert(`Export failed: ${e}`);
		} finally {
			store.isExporting = false;
			store.exportProgress = null;
		}
	}

	function handleBack() {
		goto("/");
	}

	// Keyboard shortcuts
	function handleKeydown(e: KeyboardEvent) {
		if (e.defaultPrevented) return;
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement
		)
			return;

		switch (e.key) {
			case " ":
				e.preventDefault();
				if (videoEl) {
					if (store.isPlaying) {
						videoEl.pause();
						store.isPlaying = false;
					} else {
						videoEl.play();
						store.isPlaying = true;
					}
				}
				break;
			case "ArrowLeft":
				if (videoEl && store.metadata) {
					const frameDur = 1 / (store.metadata.fps || 30);
					videoEl.currentTime = Math.max(
						0,
						videoEl.currentTime - frameDur,
					);
					store.currentTime = videoEl.currentTime;
				}
				break;
			case "ArrowRight":
				if (videoEl && store.metadata) {
					const frameDur = 1 / (store.metadata.fps || 30);
					videoEl.currentTime = Math.min(
						store.metadata.duration,
						videoEl.currentTime + frameDur,
					);
					store.currentTime = videoEl.currentTime;
				}
				break;
			case "z":
				if (e.ctrlKey || e.metaKey) {
					e.preventDefault();
					if (e.shiftKey) {
						store.redo();
					} else {
						store.undo();
					}
				}
				break;
		}
	}

	$effect(() => {
		if (!data.filePath || data.filePath === loadedPath) return;
		loadedPath = data.filePath;
		store.videoPath = data.filePath;
		void loadVideo();
	});

	$effect(() => {
		if (!videoEl) return;
		videoEl.muted = store.audioSettings.muted;
		videoEl.volume = Math.min(
			1,
			Math.max(0, store.audioSettings.volume / 100),
		);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="flex min-h-screen w-full flex-col overflow-hidden bg-background text-foreground"
>
	<!-- Toolbar -->
	<EditorToolbar
		{store}
		filename={data.filename}
		onback={handleBack}
		onexport={handleExport}
	/>

	<!-- Main content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Left: Preview area -->
		<div class="flex flex-1 flex-col overflow-hidden">
			<!-- Video Preview -->
			<div class="flex flex-1 items-center justify-center p-6 pb-2">
				{#if isLoading}
					<div
						class="flex flex-col items-center gap-4 animate-in fade-in duration-500"
					>
						<div
							class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
						></div>
						<p class="text-sm text-muted-foreground">
							Loading video…
						</p>
					</div>
				{:else if error}
					<div
						class="flex flex-col items-center gap-4 text-center animate-in fade-in duration-500"
					>
						<div
							class="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
						>
							<span class="text-2xl">⚠</span>
						</div>
						<p class="text-sm text-muted-foreground max-w-sm">
							{error}
						</p>
						<button
							onclick={handleBack}
							class="text-sm text-primary hover:underline"
						>
							← Back to recordings
						</button>
					</div>
				{:else}
					<VideoPreview {store} bind:videoEl />
				{/if}
			</div>

			<!-- Playback Controls -->
			<PlaybackControls {store} {videoEl} />

			<!-- Timeline -->
			<Timeline {store} {videoEl} />
		</div>

		<!-- Right: Properties Panel -->
		<div class="w-96 shrink-0">
			<PropertiesPanel {store} />
		</div>
	</div>

	<!-- Hidden video element -->
	{#if videoSrc}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={videoEl}
			src={videoSrc}
			ontimeupdate={handleTimeUpdate}
			onended={handleVideoEnded}
			onloadedmetadata={handleVideoLoadedMetadata}
			onloadeddata={handleVideoReady}
			oncanplay={handleVideoReady}
			onerror={handleVideoError}
			class="absolute opacity-0 pointer-events-none -z-10"
			playsinline
			preload="auto"
		></video>
	{/if}

	<!-- Export progress overlay -->
	{#if store.isExporting}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-200"
		>
			<div
				class="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 shadow-2xl animate-in zoom-in-95 duration-300"
			>
				<div
					class="h-10 w-10 animate-spin rounded-full border-3 border-primary border-t-transparent"
				></div>
				<div class="text-center">
					<p class="text-sm font-semibold text-foreground">
						Exporting video…
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						{store.exportFormat.toUpperCase()} • {store.exportProgress !==
						null
							? `${Math.round(store.exportProgress)}%`
							: "Preparing…"}
					</p>
				</div>
				{#if store.exportProgress !== null}
					<div
						class="h-1.5 w-48 overflow-hidden rounded-full bg-muted"
					>
						<div
							class="h-full rounded-full bg-linear-to-r from-primary to-blue-400 transition-[width] duration-300"
							style="width: {store.exportProgress}%"
						></div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
