import type { AnalyticsEvent, EventPropMap } from "./taxonomy";

/** Which app a given event came from. Set once as a super-property. */
export type EventSource = "web" | "desktop";

export type EventProps = Record<string, unknown>;

/**
 * Two independent consent flags. They are deliberately separate so the desktop
 * default — product analytics OFF, error reporting ON — is a first-class state.
 *   - `product`: behaviour / engagement / telemetry events.
 *   - `errors`:  crash + error reporting (PII-scrubbed).
 */
export interface ConsentState {
	product: boolean;
	errors: boolean;
}

/** Allow-listed context for an error capture. Anything else is dropped. */
export interface ErrorContext {
	route?: string;
	command?: string;
	os?: string;
	app_version?: string;
	source?: EventSource;
	phase?: string;
}

/** The scrubbed, send-ready shape an error becomes before it reaches a provider. */
export interface ScrubbedError {
	name: string;
	message: string;
	stack?: string;
	fingerprint: string;
	context: Record<string, string>;
}

export type PersistenceMode =
	| "memory"
	| "localStorage"
	| "cookie"
	| "localStorage+cookie"
	| "sessionStorage";

/** Everything a provider needs to stand itself up. Built by each app's client. */
export interface ProviderInitConfig {
	apiKey: string;
	host: string;
	source: EventSource;
	persistence: PersistenceMode;
	autocapture: boolean;
	capturePageview: boolean;
	disableSessionRecording: boolean;
	/** Seed the anonymous distinct id (desktop uses the persistent install id). */
	bootstrapDistinctId?: string;
	/** Registered as super-properties on every event. */
	superProperties?: Record<string, unknown>;
}

/**
 * The swap seam. PostHog lives behind this interface in
 * `providers/posthog-browser.ts`; self-hosting later is a host change, another
 * vendor is a new file. Nothing outside `providers/` imports `posthog-js`.
 */
export interface Provider {
	init(config: ProviderInitConfig): void | Promise<void>;
	capture(event: string, props?: EventProps): void;
	identify(userId: string, traits?: Record<string, unknown>): void;
	reset(): void;
	captureError(err: ScrubbedError): void;
	register(props: Record<string, unknown>): void;
	/** Resume sending after a pause (consent re-granted). */
	optIn(): void;
	/** Stop sending without tearing down the instance (consent revoked). */
	optOut(): void;
	/** Upgrade memory persistence → persistent id + session replay (web banner). */
	upgradePersistence(): void;
	isFeatureEnabled(flag: string): boolean | undefined;
	shutdown(): void;
}

/** Strongly-typed props when the event is in `EventPropMap`, permissive otherwise. */
export type PropsFor<E extends AnalyticsEvent> = E extends keyof EventPropMap
	? EventPropMap[E]
	: EventProps;

/** The public client every call site uses. Imported only from `@recast/analytics`. */
export interface AnalyticsClient {
	capture<E extends AnalyticsEvent>(event: E, props?: PropsFor<E>): void;
	identify(userId: string, traits?: Record<string, unknown>): void;
	reset(): void;
	captureError(err: unknown, ctx?: ErrorContext): void;
	/** Merge additional super-properties after init (e.g. hydrated os/app_version). */
	register(props: Record<string, unknown>): void;
	setConsent(consent: Partial<ConsentState>): void;
	getConsent(): ConsentState;
	/** Web only: called from the consent banner to enable replay + persistent id. */
	upgradePersistence(): void;
	isReady(): boolean;
	isFeatureEnabled(flag: string): boolean | undefined;
}
