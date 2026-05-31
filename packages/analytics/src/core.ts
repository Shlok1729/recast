import type { AnalyticsEvent } from "./taxonomy";
import type {
	AnalyticsClient,
	ConsentState,
	ErrorContext,
	PropsFor,
	Provider,
	ProviderInitConfig,
} from "./types";
import { anyConsent, canCapture, canReportErrors, DEFAULT_CONSENT } from "./consent";
import { scrubError } from "./scrub";
import { noopProvider } from "./providers/noop";

export interface CreateAnalyticsOptions {
	/** The real provider (e.g. `createPostHogBrowserProvider()`). */
	provider: Provider;
	/** Provider init config (api key, host, persistence, super-properties…). */
	config: ProviderInitConfig;
	/**
	 * Hard kill-switch. When false (e.g. no PostHog key configured) the client is
	 * a total no-op — the real provider is never even constructed. Defaults to
	 * `Boolean(config.apiKey)`.
	 */
	enabled?: boolean;
	/** Starting consent. Web: `{product:true,errors:true}`. Desktop: `{product:false,errors:true}`. */
	initialConsent?: Partial<ConsentState>;
	/**
	 * Stand the provider up at construction even when product consent is off.
	 * Web sets this so PostHog's automatic pageview fires on load. Desktop
	 * leaves it false so an errors-only install makes ZERO network calls (not
	 * even PostHog's `/flags` fetch) until a real crash or an explicit opt-in.
	 */
	eagerInit?: boolean;
}

/**
 * The consent gate + swap seam — the heart of the abstraction.
 *
 * Two layers of enforcement, exactly as specified:
 *   1. Init-time: the real provider is not stood up until *some* consent allows
 *      it. Until then every call routes to the noop provider, so nothing is even
 *      loaded (posthog-js is dynamically imported inside the provider's `init`).
 *   2. Per-call: `capture`/`identify` require `consent.product`; `captureError`
 *      requires `consent.errors`. The two flags are independent, so the desktop
 *      default — product OFF, errors ON — sends crash reports while never
 *      emitting a behaviour event.
 *
 * Errors are scrubbed *here*, before the provider is ever called, so the noop
 * path and the real path redact identically.
 */
/**
 * Analytics is a non-essential side channel: it must NEVER throw into a caller
 * or crash a feature. Every interaction with the provider goes through `safe`,
 * which swallows any error (sync or async) and — in dev only — logs it. This is
 * what makes `analytics.capture(...)` safe to call inline before critical work
 * (e.g. right before `invoke("start_recording")`).
 */
function isDev(): boolean {
	try {
		return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
	} catch {
		return false;
	}
}

function devlog(msg: string, err: unknown): void {
	if (isDev() && typeof console !== "undefined") {
		console.debug(`[analytics] ${msg}`, err);
	}
}

function safe(fn: () => void): void {
	try {
		fn();
	} catch (err) {
		devlog("swallowed error:", err);
	}
}

export function createAnalytics(opts: CreateAnalyticsOptions): AnalyticsClient {
	const enabled = opts.enabled ?? Boolean(opts.config.apiKey);
	const provider: Provider = enabled ? opts.provider : noopProvider;

	let consent: ConsentState = { ...DEFAULT_CONSENT, ...opts.initialConsent };
	let initialized = false;
	let optedOut = false;

	// Internal — already wrapped by `safe` at every call site below.
	function ensureProviderUnsafe() {
		if (!enabled) return;
		if (!anyConsent(consent)) {
			// Both channels off — if we were running, stop (keep the instance so a
			// re-grant is a cheap opt-in rather than a full re-init).
			if (initialized && !optedOut) {
				provider.optOut();
				optedOut = true;
			}
			return;
		}
		if (!initialized) {
			// Mark initialized BEFORE init so a slow/failed init can't trigger a
			// re-init storm. Call init SYNCHRONOUSLY (not deferred to a microtask)
			// so its synchronous side-effects — e.g. the provider stashing config
			// for a later upgradePersistence() — happen this tick, before any
			// same-tick caller (returning-visitor upgrade) runs. Sync throws are
			// caught by the enclosing safe(); the async tail (dynamic import of
			// posthog-js) gets its own .catch so a rejection never surfaces.
			initialized = true;
			optedOut = false;
			const result = provider.init(opts.config) as void | Promise<void>;
			if (result && typeof (result as Promise<void>).then === "function") {
				(result as Promise<void>).catch((err) => devlog("provider init failed:", err));
			}
		} else if (optedOut) {
			provider.optIn();
			optedOut = false;
		}
	}

	const ensureProvider = () => safe(ensureProviderUnsafe);

	// Stand the provider up at construction only when behaviour tracking is
	// already consented to, or the app explicitly asks for eager init (web). An
	// errors-only desktop install stays fully silent until `captureError` (a real
	// crash) or an opt-in calls `ensureProvider()` lazily — no startup phone-home.
	if (consent.product || opts.eagerInit) ensureProvider();

	return {
		capture<E extends AnalyticsEvent>(event: E, props?: PropsFor<E>) {
			if (!canCapture(consent)) return;
			safe(() => {
				ensureProviderUnsafe();
				provider.capture(event, props as Record<string, unknown> | undefined);
			});
		},

		identify(userId, traits) {
			// Identity is part of product analytics — only link a real user when
			// behaviour tracking is consented to.
			if (!canCapture(consent)) return;
			safe(() => {
				ensureProviderUnsafe();
				provider.identify(userId, traits);
			});
		},

		reset() {
			if (!initialized) return;
			safe(() => provider.reset());
		},

		captureError(err: unknown, ctx?: ErrorContext) {
			safe(() => {
				// Always scrub, even when we won't send — keeps the redaction path
				// exercised and means callers can't leak PII through a later path.
				const scrubbed = scrubError(err, ctx);
				if (!canReportErrors(consent)) return;
				ensureProviderUnsafe();
				provider.captureError(scrubbed);
			});
		},

		register(props) {
			safe(() => {
				// Merge into the init config NOW so a not-yet-initialized provider
				// (desktop sets `os` before product opt-in) still picks these
				// super-properties up when it eventually stands up. `opts.config` is
				// the same object later handed to `provider.init`. Forward live too
				// when already running.
				opts.config.superProperties = {
					...(opts.config.superProperties ?? {}),
					...props,
				};
				if (initialized) provider.register(props);
			});
		},

		setConsent(next) {
			const prev = consent;
			consent = { ...consent, ...next };
			safe(() => {
				ensureProviderUnsafe();
				// Record the opt-in so we can measure consent rates. Revocation is
				// intentionally silent — once product is off the gate would drop the
				// event anyway, and sending a final beacon on opt-out is bad manners.
				if (next.product === true && prev.product !== true) {
					provider.capture("consent_granted", { channel: "product" });
				}
			});
		},

		getConsent() {
			return { ...consent };
		},

		upgradePersistence() {
			if (!initialized) return;
			safe(() => provider.upgradePersistence());
		},

		isReady() {
			return initialized && !optedOut;
		},

		isFeatureEnabled(flag) {
			let result: boolean | undefined;
			safe(() => {
				result = provider.isFeatureEnabled(flag);
			});
			return result;
		},
	};
}
