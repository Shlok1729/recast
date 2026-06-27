<script lang="ts">
  import { dev } from "$app/environment";
  import { page } from "$app/state";
  import { analytics } from "$lib/analytics/client";
  import { webConsent } from "$lib/analytics/consent.svelte";
  import { authClient } from "$lib/auth/client";
  import ImpersonationBanner from "$lib/auth/components/ImpersonationBanner.svelte";
  import {
    DevThemeToggle,
    Navbar,
    SeoMeta,
    ThemeShortcut,
  } from "$lib/components";
  import ConsentBanner from "$lib/components/ConsentBanner.svelte";
  import { NavProgress } from "@recast/ui/nav-progress";

  import { Toaster } from "@recast/ui/sonner";
  import { ModeWatcher } from "@recast/ui/theme";
  import "../app.css";
// Player theme — imported once at the root so any /share or dashboard
  // route that mounts <RecastPlayer> picks up the branded CSS variables.
  import "@recast/player/styles.css";

  let { children } = $props();

  // The dashboard, auth, and waitlist screens ship their own focused
  // shells — keep the marketing chrome off them.
  const chromelessPaths = new Set([
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/waitlist",
    "/device",
  ]);
  const isChromeless = $derived(
    page.url.pathname.startsWith("/dashboard") ||
      page.url.pathname.startsWith("/admin") ||
      page.url.pathname.startsWith("/onboarding") ||
      page.url.pathname.startsWith("/share/") ||
      page.url.pathname === "/accept-invitation" ||
      page.url.pathname === "/verify-email" ||
      chromelessPaths.has(page.url.pathname),
  );

  // Only the public marketing/tool pages should be indexed; everything else
  // (dashboard, admin, auth, onboarding, shares) is marked noindex.
  const PUBLIC_PREFIXES = [
    "/features",
    "/extensions",
    "/pricing",
    "/download",
    "/changelog",
    "/privacy-policy",
    "/terms-of-service",
    "/tools",
  ];
  const indexable = $derived(
    page.url.pathname === "/" ||
      PUBLIC_PREFIXES.some(
        (p) => page.url.pathname === p || page.url.pathname.startsWith(`${p}/`),
      ),
  );
  // Site-wide brand structured data (helps search engines understand the brand
  // and enables sitelinks). Emitted only on indexable pages.
  const siteJsonLd = $derived(
    JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Recast",
        url: page.url.origin,
        sameAs: [
          "https://github.com/kanakkholwal/recast",
          "https://x.com/kanakkholwal",
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Recast",
        url: page.url.origin,
      },
    ]),
  );

  // Returning visitor who already accepted → re-enable replay + persistent id
  // before any events fire this session.
  $effect(() => {
    if (webConsent.hasAccepted) analytics.upgradePersistence();
  });

  // Tie events to the signed-in user (aliases the anonymous distinct id) and
  // drop the identity on sign-out. Gated by product consent inside the client.
  const session = authClient.useSession();
  let lastUserId: string | null = null;
  $effect(() => {
    const userId = $session.data?.user?.id ?? null;
    if (userId && userId !== lastUserId) {
      analytics.identify(userId);
      lastUserId = userId;
    } else if (!userId && lastUserId) {
      analytics.reset();
      lastUserId = null;
    }
  });
</script>

<!-- Site-wide default social/SEO tags. Routes that need their own card (e.g.
	 a shared recast) set `customSeo: true` in their load data and render their
	 own <SeoMeta>; suppressing the default here keeps a single, authoritative
	 set of og: tags instead of duplicates (scrapers take the first og:image). -->
{#if !(page.data as { customSeo?: boolean }).customSeo}
  <SeoMeta
    title="Record. Polish. Share."
    description="Recast turns a raw screen capture into a polished, shareable demo. Smart auto-edits and a friendly timeline anyone can drive. macOS, Windows, Linux."
    pageTitle="Recast - Record. Polish. Share."
  />
{/if}
<svelte:head>
  {#if indexable}
    {@html `<script type="application/ld+json">${siteJsonLd}</` + `script>`}
  {:else}
    <meta name="robots" content="noindex, nofollow" />
  {/if}
</svelte:head>
<NavProgress />
<ModeWatcher />
<!-- Cmd/Ctrl+Shift+L from any route toggles light↔dark. Runs in prod
	 (DevThemeToggle's floating chip is still dev-only). -->
<ThemeShortcut />

<!-- Global impersonation indicator. Self-renders only when an admin is
	 acting as another user; invisible otherwise. -->
<ImpersonationBanner />

{#if !isChromeless}
  <div
    aria-hidden="true"
    class="bg-grid bg-grid-fade pointer-events-none fixed inset-0 -z-10 opacity-30"
  ></div>

  <Navbar />
{/if}

<div class="relative isolate flex min-h-screen flex-col overflow-x-hidden">
  {@render children()}
</div>

<Toaster position="bottom-right" duration={5000} />

<ConsentBanner />

{#if dev}
  <DevThemeToggle />
{/if}
