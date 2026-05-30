import { AwsClient } from "aws4fetch";
import { serverEnv } from "$lib/env/server";

/**
 * Cloudflare R2 client — S3-compatible, signed via aws4fetch (4kB, edge-safe).
 *
 * R2 endpoints look like:
 *   https://{ACCOUNT_ID}.r2.cloudflarestorage.com/{BUCKET}/{KEY}
 *
 * Bucket is private by default — every read goes through a signed GET URL
 * unless R2_PUBLIC_URL is set and points at a custom domain bound to the
 * bucket. Even with R2_PUBLIC_URL, `private` / `selected` / password-gated
 * shares still go through signed GETs so the bucket URL can't be guessed.
 *
 * Bucket CORS must allow PUT from the app's origin for browser/desktop
 * uploads. Set it once via the R2 dashboard or `wrangler r2 bucket cors put`.
 */

type R2Config = {
	accountId: string;
	bucket: string;
	publicUrl: string | null;
	client: AwsClient;
};

let cached: R2Config | null = null;

export function isR2Configured(): boolean {
	const env = serverEnv();
	return Boolean(
		env.R2_ACCOUNT_ID &&
			env.R2_ACCESS_KEY_ID &&
			env.R2_SECRET_ACCESS_KEY &&
			env.R2_BUCKET,
	);
}

function getR2(): R2Config {
	if (cached) return cached;
	const env = serverEnv();
	if (!isR2Configured()) {
		throw new Error(
			"R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
		);
	}
	cached = {
		accountId: env.R2_ACCOUNT_ID!,
		bucket: env.R2_BUCKET!,
		publicUrl: env.R2_PUBLIC_URL ?? null,
		client: new AwsClient({
			accessKeyId: env.R2_ACCESS_KEY_ID!,
			secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
			service: "s3",
			region: "auto",
		}),
	};
	return cached;
}

/**
 * Object key layout: `workspace/{workspaceId}/{recastId}.mp4`. Keeps blobs
 * grouped per workspace for easy bulk-delete on org termination.
 */
export function recastObjectKey(workspaceId: string, recastId: string): string {
	return `workspace/${workspaceId}/${recastId}.mp4`;
}

export function posterObjectKey(workspaceId: string, recastId: string): string {
	return `workspace/${workspaceId}/${recastId}.poster.jpg`;
}

function objectUrl(key: string): string {
	const { accountId, bucket } = getR2();
	return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeURI(key)}`;
}

/**
 * Pre-signed PUT URL for a single-shot upload. R2's single-PUT cap is 5GB,
 * which covers our entire tier matrix (Free downscales to 720p before
 * upload ≈ 150MB; Pro source upload of a 10-min 4K take ≈ 2GB).
 *
 * The URL is bound to `Content-Type: video/mp4`; the client MUST send that
 * exact header or the upload will 403. Lock down what we accept early so a
 * misconfigured browser can't drop arbitrary blobs into the bucket.
 */
export async function signUploadUrl(opts: {
	key: string;
	contentType?: string;
	expiresInSeconds?: number;
}): Promise<string> {
	const { client } = getR2();
	const url = new URL(objectUrl(opts.key));
	url.searchParams.set(
		"X-Amz-Expires",
		String(opts.expiresInSeconds ?? 15 * 60),
	);
	const signed = await client.sign(
		new Request(url, {
			method: "PUT",
			headers: { "Content-Type": opts.contentType ?? "video/mp4" },
		}),
		{ aws: { signQuery: true } },
	);
	return signed.url;
}

/**
 * Pre-signed GET URL for hosted playback. Returned to the player after the
 * visibility / password check passes. Keep TTL short enough that a leaked
 * link expires before it can spread, long enough that the player doesn't
 * have to re-request mid-watch for a typical 10-min clip.
 */
export async function signDownloadUrl(opts: {
	key: string;
	expiresInSeconds?: number;
}): Promise<string> {
	const { client } = getR2();
	const url = new URL(objectUrl(opts.key));
	url.searchParams.set(
		"X-Amz-Expires",
		String(opts.expiresInSeconds ?? 60 * 60),
	);
	const signed = await client.sign(
		new Request(url, { method: "GET" }),
		{ aws: { signQuery: true } },
	);
	return signed.url;
}

/**
 * HEAD the object to verify the upload actually landed and report its
 * server-side size. Used by /api/uploads/complete to reject calls that
 * never actually PUT anything (or PUT something larger than the quota
 * pre-check accounted for).
 *
 * Returns `null` if the object is missing — let the caller decide whether
 * that's a 404 or a "still uploading, retry."
 */
export async function statObject(key: string): Promise<
	| {
			contentLength: number;
			contentType: string | null;
			etag: string | null;
	  }
	| null
> {
	const { client } = getR2();
	const res = await client.fetch(new Request(objectUrl(key), { method: "HEAD" }));
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new Error(`R2 HEAD failed: ${res.status} ${res.statusText}`);
	}
	const len = res.headers.get("content-length");
	return {
		contentLength: len ? Number(len) : 0,
		contentType: res.headers.get("content-type"),
		etag: res.headers.get("etag"),
	};
}

/**
 * Delete an object. Used by the archive/expiry job. R2's delete is a single
 * request; for bulk we can layer S3 DeleteObjects later if needed.
 */
export async function deleteObject(key: string): Promise<void> {
	const { client } = getR2();
	const res = await client.fetch(
		new Request(objectUrl(key), { method: "DELETE" }),
	);
	// R2 returns 204 on success, 204 even when the object didn't exist.
	if (!res.ok && res.status !== 204) {
		throw new Error(`R2 DELETE failed: ${res.status} ${res.statusText}`);
	}
}

/**
 * Public URL for a recast video. Only safe to expose for `public` shares
 * when R2_PUBLIC_URL is bound — otherwise the bucket URL is private and
 * a signed GET must be used.
 */
export function publicObjectUrl(key: string): string | null {
	const { publicUrl } = getR2();
	if (!publicUrl) return null;
	return `${publicUrl.replace(/\/$/, "")}/${encodeURI(key)}`;
}
