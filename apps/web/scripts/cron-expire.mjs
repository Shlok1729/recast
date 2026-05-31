#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Invokes the expiry cron endpoint. Useful for:
 *   • Manual cleanup runs (`pnpm cron:expire`)
 *   • Cron schedulers that can run shell commands (systemd, GitHub
 *     Actions) but can't hit a URL directly
 *
 * For Vercel / Cloudflare-hosted deployments, prefer their native cron
 * surface (vercel.json `crons` or `wrangler.toml` `triggers.crons`) so
 * the function runs on the same edge node as your traffic — pointing at
 * /api/cron/expire and including the `Authorization: Bearer $CRON_SECRET`
 * header.
 *
 * Env: PUBLIC_APP_URL (where the API lives), CRON_SECRET (auth). Both
 * read from .env.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
	const path = resolve(__dirname, "..", ".env");
	try {
		const raw = readFileSync(path, "utf8");
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq === -1) continue;
			const key = trimmed.slice(0, eq).trim();
			let value = trimmed.slice(eq + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			if (!(key in process.env)) process.env[key] = value;
		}
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
}

loadEnvFile();

const base = process.env.PUBLIC_APP_URL || "http://localhost:4420";
const secret = process.env.CRON_SECRET;

if (!secret) {
	console.error("✗ CRON_SECRET not set. Generate one and add to .env first.");
	process.exit(1);
}

const url = `${base.replace(/\/$/, "")}/api/cron/expire`;
console.log(`→ POST ${url}`);

const res = await fetch(url, {
	method: "POST",
	headers: { authorization: `Bearer ${secret}` },
});

const body = await res.json().catch(() => ({}));

if (!res.ok) {
	console.error(`✗ ${res.status} ${res.statusText}`);
	console.error(body);
	process.exit(1);
}

console.log(`✓ ${JSON.stringify(body)}`);
