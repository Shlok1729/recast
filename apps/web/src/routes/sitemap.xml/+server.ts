import { getPublicEnv } from "$lib/env/public";
import { TOOLS } from "$lib/tools/registry";
import type { RequestHandler } from "./$types";

export const prerender = true;

// Public, indexable pages. Private areas (dashboard, admin, auth, share) are
// intentionally excluded — they're noindex and disallowed in robots.txt.
const STATIC_PATHS = [
	"/",
	"/features",
	"/extensions",
	"/pricing",
	"/download",
	"/changelog",
	"/privacy-policy",
	"/terms-of-service",
	"/tools",
];

function siteOrigin(fallback: string): string {
	try {
		return getPublicEnv().PUBLIC_APP_URL.replace(/\/+$/, "");
	} catch {
		return fallback.replace(/\/+$/, "");
	}
}

export const GET: RequestHandler = ({ url }) => {
	const origin = siteOrigin(url.origin);
	const paths = [...STATIC_PATHS, ...TOOLS.map((t) => `/tools/${t.slug}`)];
	const urls = paths
		.map((p) => `  <url>\n    <loc>${origin}${p === "/" ? "" : p}</loc>\n  </url>`)
		.join("\n");
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
	return new Response(body, {
		headers: {
			"content-type": "application/xml",
			"cache-control": "max-age=0, s-maxage=3600",
		},
	});
};
