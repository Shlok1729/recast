<script lang="ts">
	import type { EditorStore } from "$lib/stores/editor-store.svelte";
	import { onMount } from "svelte";

	interface Props {
		store: EditorStore;
		videoEl?: HTMLVideoElement | null;
	}

	let { store, videoEl = $bindable(null) }: Props = $props();

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let containerEl: HTMLDivElement | undefined = $state();
	let bgImageEl: HTMLImageElement | undefined = $state();
	let animFrameId: number;

	// Load background image when needed
	let bgImageSrc = $state("");
	let bgImageLoaded = $state(false);

	$effect(() => {
		if (store.backgroundType === "wallpaper" && store.backgroundValue) {
			bgImageSrc = store.backgroundValue;
			bgImageLoaded = false;
			const img = new Image();
			img.onload = () => {
				bgImageEl = img as any;
				bgImageLoaded = true;
			};
			img.src = store.backgroundValue;
		}
	});

	function getBackgroundStyle(): string {
		switch (store.backgroundType) {
			case "color":
				return store.backgroundValue;
			case "gradient":
				return ""; // gradient is CSS, handled separately
			case "wallpaper":
			case "image":
				return "#1a1a1a";
			default:
				return "#000000";
		}
	}

	function renderFrame() {
		if (!canvasEl || !videoEl) {
			animFrameId = requestAnimationFrame(renderFrame);
			return;
		}

		const ctx = canvasEl.getContext("2d");
		if (!ctx) {
			animFrameId = requestAnimationFrame(renderFrame);
			return;
		}

		const cw = canvasEl.width;
		const ch = canvasEl.height;

		// Clear
		ctx.clearRect(0, 0, cw, ch);

		// Draw background
		if (
			store.backgroundType === "wallpaper" &&
			bgImageEl &&
			bgImageLoaded
		) {
			// Draw wallpaper, covering the entire canvas
			ctx.save();
			if (store.backgroundBlur > 0) {
				ctx.filter = `blur(${store.backgroundBlur / 5}px)`;
			}
			const scale = Math.max(
				cw / (bgImageEl as HTMLImageElement).width,
				ch / (bgImageEl as HTMLImageElement).height,
			);
			const iw = (bgImageEl as HTMLImageElement).width * scale;
			const ih = (bgImageEl as HTMLImageElement).height * scale;
			ctx.drawImage(
				bgImageEl as HTMLImageElement,
				(cw - iw) / 2,
				(ch - ih) / 2,
				iw,
				ih,
			);
			ctx.restore();
		} else if (store.backgroundType === "color") {
			ctx.fillStyle = store.backgroundValue;
			ctx.fillRect(0, 0, cw, ch);
		} else if (store.backgroundType === "gradient") {
			// Parse CSS gradient to canvas gradient
			ctx.fillStyle = "#1a1a2e";
			ctx.fillRect(0, 0, cw, ch);
			// Simple gradient fallback
			const grad = ctx.createLinearGradient(0, 0, cw, ch);
			grad.addColorStop(0, "#4facfe");
			grad.addColorStop(1, "#00f2fe");
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, cw, ch);
		} else {
			ctx.fillStyle = "#1a1a1a";
			ctx.fillRect(0, 0, cw, ch);
		}

		// Calculate video rect with padding
		const pad = store.padding;
		const videoAreaW = cw - pad * 2;
		const videoAreaH = ch - pad * 2;

		if (
			videoEl &&
			videoEl.readyState >= 2 &&
			videoAreaW > 0 &&
			videoAreaH > 0
		) {
			const vw = videoEl.videoWidth || 1;
			const vh = videoEl.videoHeight || 1;
			const vAspect = vw / vh;
			const areaAspect = videoAreaW / videoAreaH;

			let drawW: number, drawH: number;
			if (vAspect > areaAspect) {
				drawW = videoAreaW;
				drawH = videoAreaW / vAspect;
			} else {
				drawH = videoAreaH;
				drawW = videoAreaH * vAspect;
			}

			const dx = pad + (videoAreaW - drawW) / 2;
			const dy = pad + (videoAreaH - drawH) / 2;

			// Draw rounded rect video frame
			const radius = 12;
			ctx.save();
			ctx.beginPath();
			ctx.roundRect(dx, dy, drawW, drawH, radius);
			ctx.clip();

			// Check for active zoom
			const currentZoom = store.zoomRegions.find(
				(z) =>
					store.currentTime >= z.start && store.currentTime <= z.end,
			);

			if (currentZoom) {
				const s = currentZoom.scale;
				const zw = vw / s;
				const zh = vh / s;
				const zx = (vw - zw) / 2;
				const zy = (vh - zh) / 2;
				ctx.drawImage(videoEl, zx, zy, zw, zh, dx, dy, drawW, drawH);
			} else {
				ctx.drawImage(videoEl, dx, dy, drawW, drawH);
			}

			ctx.restore();

			// Draw border around video frame
			ctx.save();
			ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.roundRect(dx, dy, drawW, drawH, radius);
			ctx.stroke();
			ctx.restore();
		}

		animFrameId = requestAnimationFrame(renderFrame);
	}

	function handleResize() {
		if (!canvasEl || !containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		canvasEl.width = rect.width * dpr;
		canvasEl.height = rect.height * dpr;
		canvasEl.style.width = `${rect.width}px`;
		canvasEl.style.height = `${rect.height}px`;
		const ctx = canvasEl.getContext("2d");
		if (ctx) ctx.scale(dpr, dpr);
		// Reset for proper scaling
		canvasEl.width = rect.width;
		canvasEl.height = rect.height;
	}

	onMount(() => {
		handleResize();
		animFrameId = requestAnimationFrame(renderFrame);

		const resizeObserver = new ResizeObserver(() => handleResize());
		if (containerEl) resizeObserver.observe(containerEl);

		return () => {
			cancelAnimationFrame(animFrameId);
			resizeObserver.disconnect();
		};
	});
</script>

<div
	bind:this={containerEl}
	class="relative flex-1 overflow-hidden rounded-xl bg-black/20"
>
	<canvas bind:this={canvasEl} class="h-full w-full"></canvas>

	<!-- Layout mode badge -->
	<div
		class="absolute left-3 top-3 flex items-center gap-2 pointer-events-none"
	>
		<div
			class="rounded-md bg-black/40 px-2 py-1 text-[10px] font-medium text-white/70 backdrop-blur-sm"
		>
			{store.metadata
				? `${store.metadata.width}×${store.metadata.height}`
				: "—"}
		</div>
	</div>
</div>
