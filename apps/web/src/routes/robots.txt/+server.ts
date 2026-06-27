import { getPublicEnv } from "$lib/env/public";
import type { RequestHandler } from "./$types";

export const prerender = true;

function siteOrigin(fallback: string): string {
	try {
		return getPublicEnv().PUBLIC_APP_URL.replace(/\/+$/, "");
	} catch {
		return fallback.replace(/\/+$/, "");
	}
}

export const GET: RequestHandler = ({ url }) => {
	const origin = siteOrigin(url.origin);
	// Crawl public pages; keep the app, admin, and auth flows out of the index.
	const body = `User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /admin
Disallow: /onboarding
Disallow: /login
Disallow: /signup
Disallow: /reset-password
Disallow: /forgot-password
Disallow: /verify-email
Disallow: /accept-invitation

Sitemap: ${origin}/sitemap.xml
`;
	return new Response(body, {
		headers: { "content-type": "text/plain", "cache-control": "max-age=0, s-maxage=3600" },
	});
};
