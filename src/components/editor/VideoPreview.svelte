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
	let watermarkImageEl: HTMLImageElement | undefined = $state();
	let animFrameId: number;

	// Load background image when needed
	let bgImageLoaded = $state(false);
	let watermarkLoaded = $state(false);

	type ParsedGradient = {
		angle: number;
		stops: Array<{ color: string; offset: number }>;
	};

	$effect(() => {
		if (
			(store.backgroundType === "wallpaper" ||
				store.backgroundType === "image") &&
			store.backgroundValue
		) {
			bgImageLoaded = false;
			const img = new Image();
			img.onload = () => {
				bgImageEl = img;
				bgImageLoaded = true;
			};
			img.onerror = () => {
				bgImageLoaded = false;
				bgImageEl = undefined;
			};
			img.src = store.backgroundValue;
		}
	});

	$effect(() => {
		if (
			store.watermarkSettings.enabled &&
			store.watermarkSettings.imageSrc
		) {
			watermarkLoaded = false;
			const img = new Image();
			img.onload = () => {
				watermarkImageEl = img;
				watermarkLoaded = true;
			};
			img.onerror = () => {
				watermarkLoaded = false;
				watermarkImageEl = undefined;
			};
			img.src = store.watermarkSettings.imageSrc;
			return;
		}

		watermarkLoaded = false;
		watermarkImageEl = undefined;
	});

	function splitGradientArgs(input: string) {
		const parts: string[] = [];
		let current = "";
		let depth = 0;

		for (const char of input) {
			if (char === "(") depth += 1;
			if (char === ")") depth = Math.max(0, depth - 1);

			if (char === "," && depth === 0) {
				parts.push(current.trim());
				current = "";
				continue;
			}

			current += char;
		}

		if (current.trim()) {
			parts.push(current.trim());
		}

		return parts;
	}

	function parseCssAngle(token: string) {
		const trimmed = token.trim().toLowerCase();
		if (trimmed.endsWith("deg")) {
			return Number.parseFloat(trimmed.slice(0, -3));
		}

		switch (trimmed) {
			case "to top":
				return 0;
			case "to right":
				return 90;
			case "to bottom":
				return 180;
			case "to left":
				return 270;
			default:
				return 135;
		}
	}

	function parseLinearGradient(value: string): ParsedGradient | null {
		const match = value.match(/linear-gradient\((.+)\)$/i);
		if (!match) return null;

		const parts = splitGradientArgs(match[1]);
		if (parts.length < 2) return null;

		const hasExplicitAngle =
			parts[0].includes("deg") || parts[0].trim().toLowerCase().startsWith("to ");
		const angle = hasExplicitAngle ? parseCssAngle(parts[0]) : 135;
		const colorStops = (hasExplicitAngle ? parts.slice(1) : parts).map((part) => {
			const stopMatch = part.match(/(.+?)\s+([0-9.]+)%$/);
			return {
				color: (stopMatch?.[1] ?? part).trim(),
				offset: stopMatch ? Number.parseFloat(stopMatch[2]) / 100 : Number.NaN,
			};
		});

		const resolvedStops = colorStops.map((stop, index, collection) => ({
			color: stop.color,
			offset:
				Number.isFinite(stop.offset) && stop.offset >= 0
					? stop.offset
					: collection.length === 1
						? 0
						: index / (collection.length - 1),
		}));

		return {
			angle,
			stops: resolvedStops,
		};
	}

	function createCanvasGradient(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		gradientValue: string,
	) {
		const parsed = parseLinearGradient(gradientValue);
		if (!parsed) return null;

		const angleInRadians = ((parsed.angle - 90) * Math.PI) / 180;
		const x = Math.cos(angleInRadians);
		const y = Math.sin(angleInRadians);
		const radius = Math.sqrt(width * width + height * height) / 2;
		const centerX = width / 2;
		const centerY = height / 2;

		const gradient = ctx.createLinearGradient(
			centerX - x * radius,
			centerY - y * radius,
			centerX + x * radius,
			centerY + y * radius,
		);

		for (const stop of parsed.stops) {
			gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
		}

		return gradient;
	}

	function getWatermarkPosition(
		frameX: number,
		frameY: number,
		frameWidth: number,
		frameHeight: number,
		watermarkWidth: number,
		watermarkHeight: number,
	) {
		const inset = store.watermarkSettings.inset;

		switch (store.watermarkSettings.position) {
			case "top-left":
				return { x: frameX + inset, y: frameY + inset };
			case "top-right":
				return {
					x: frameX + frameWidth - watermarkWidth - inset,
					y: frameY + inset,
				};
			case "bottom-left":
				return {
					x: frameX + inset,
					y: frameY + frameHeight - watermarkHeight - inset,
				};
			case "bottom-right":
			default:
				return {
					x: frameX + frameWidth - watermarkWidth - inset,
					y: frameY + frameHeight - watermarkHeight - inset,
				};
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
			(store.backgroundType === "wallpaper" ||
				store.backgroundType === "image") &&
			bgImageEl &&
			bgImageLoaded
		) {
			// Draw wallpaper, covering the entire canvas
			ctx.save();
			if (store.backgroundBlur > 0) {
				ctx.filter = `blur(${store.backgroundBlur / 5}px)`;
			}
			const scale = Math.max(
				cw / bgImageEl.width,
				ch / bgImageEl.height,
			);
			const iw = bgImageEl.width * scale;
			const ih = bgImageEl.height * scale;
			ctx.drawImage(
				bgImageEl,
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
			const gradient =
				createCanvasGradient(ctx, cw, ch, store.backgroundValue) ??
				createCanvasGradient(
					ctx,
					cw,
					ch,
					"linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
				);

			ctx.fillStyle = gradient ?? "#1a1a2e";
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

			if (
				store.watermarkSettings.enabled &&
				watermarkLoaded &&
				watermarkImageEl
			) {
				const watermarkWidth = Math.max(
					24,
					drawW * (store.watermarkSettings.scale / 100),
				);
				const watermarkHeight =
					watermarkWidth * (watermarkImageEl.height / watermarkImageEl.width);
				const { x, y } = getWatermarkPosition(
					dx,
					dy,
					drawW,
					drawH,
					watermarkWidth,
					watermarkHeight,
				);

				ctx.save();
				ctx.globalAlpha = Math.min(
					1,
					Math.max(0.1, store.watermarkSettings.opacity / 100),
				);
				ctx.drawImage(
					watermarkImageEl,
					x,
					y,
					watermarkWidth,
					watermarkHeight,
				);
				ctx.restore();
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
