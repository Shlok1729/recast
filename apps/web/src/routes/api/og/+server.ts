import { render } from "svelte/server";
import ImageResponse from "takumi-js/response";
import OgImage from "$lib/components/OgImage.svelte";
import type { RequestHandler } from "./$types";

const GEIST_CDN = "https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@5.2.8/files/geist-latin-wght-normal.woff2";

let cachedFont: Promise<ArrayBuffer> | null = null;
const loadGeist = () => {
	if (!cachedFont) {
		cachedFont = fetch(GEIST_CDN).then((res) => {
			if (!res.ok) throw new Error(`Geist font fetch failed: ${res.status}`);
			return res.arrayBuffer();
		});
	}
	return cachedFont;
};

const clip = (value: string | null, max: number, fallback = "") => {
	if (!value) return fallback;
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
};

export const GET: RequestHandler = async ({ url }) => {
	const title = clip(
		url.searchParams.get("title"),
		90,
		"Record. Polish. Share.",
	);
	const description = clip(
		url.searchParams.get("description"),
		180,
		"Recast turns a raw screen capture into a polished, shareable demo. Smart auto-edits and a friendly timeline anyone can drive.",
	);
	const eyebrow = clip(url.searchParams.get("eyebrow"), 24);

	const { body, head } = render(OgImage, {
		props: { title, description, eyebrow },
	});

	return new ImageResponse(`${head}${body}`, {
		width: 1200,
		height: 630,
		fonts: [
			{
				name: "Geist",
				data: loadGeist,
			},
		],
		headers: {
			"Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
		},
	});
};
