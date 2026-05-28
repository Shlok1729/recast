export type RecastPlayerTrack = {
	src: string;
	kind: "subtitles" | "captions" | "chapters" | "descriptions" | "metadata";
	label?: string;
	srclang?: string;
	default?: boolean;
};

export type RecastPlayerControls = {
	bigPlay: boolean;
	seek: boolean;
	time: boolean;
	volume: boolean;
	playbackRate: boolean;
	captions: boolean;
	pip: boolean;
	fullscreen: boolean;
};

export type RecastPlayerState = {
	paused: boolean;
	ended: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	muted: boolean;
	playbackRate: number;
	videoWidth: number;
	videoHeight: number;
};

/**
 * Engagement events fired by RecastPlayer. `progress` is throttled to
 * ~5% steps so a long video can't spam the parent with hundreds of calls.
 */
export type RecastPlayerEngagement =
	| { type: "view-start"; percent: 0 }
	| { type: "progress"; percent: number; currentTime: number }
	| { type: "ended"; percent: 100; currentTime: number };

export type RecastPlayerApi = {
	play: () => Promise<void>;
	pause: () => void;
	seek: (seconds: number) => void;
	setMuted: (next: boolean) => void;
	setVolume: (next: number) => void;
	setPlaybackRate: (next: number) => void;
	enterFullscreen: () => Promise<void>;
	exitFullscreen: () => Promise<void>;
	enterPictureInPicture: () => Promise<void>;
	getCurrentTime: () => number;
	getDuration: () => number;
	getState: () => RecastPlayerState;
	getVideoElement: () => HTMLVideoElement | null;
};

export type RecastPlayerProps = {
	src: string;
	poster?: string | null;
	thumbnails?: string | null;
	tracks?: RecastPlayerTrack[];
	title?: string;
	autoplay?: boolean;
	preload?: "none" | "metadata" | "auto";
	crossorigin?: "anonymous" | "use-credentials" | null;
	loop?: boolean;
	volume?: number;
	muted?: boolean;
	playbackRate?: number;
	currentTime?: number;
	paused?: boolean | null;
	showMenu?: boolean;
	controls?: Partial<RecastPlayerControls>;
	aspectRatio?: number | string | null;
	objectFit?: "contain" | "cover" | "fill" | "none" | "scale-down";
	ariaLabel?: string;
	className?: string;
	onengagement?: (event: RecastPlayerEngagement) => void;
	onstatechange?: (state: RecastPlayerState) => void;
	api?: RecastPlayerApi | null;
};
