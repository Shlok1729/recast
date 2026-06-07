/**
 * Turn the source packs under `extensions/packs/*` into the **installable**
 * artifacts the desktop app consumes, and a curated **index** for the in-app
 * browse gallery. Mirrors `scripts/prepare-backgrounds.mjs`: compute SHA-256s,
 * template download URLs against a GitHub release tag, emit JSON.
 *
 * For each pack it emits an installable manifest (the source `assets[].file`
 * becomes `{ filename, url, sha256 }` matching the Rust `AssetEntry`), plus a
 * flattened copy of every asset for upload. `contributes` passes through
 * unchanged (the frontend interprets it).
 *
 * Outputs (under extensions/dist/):
 *   release/<packId>__<filename>     every asset, flat-named for one release
 *   <packId>.extension.json          installable manifest (what install_extension fetches)
 *   index.json                       { version, extensions: [{ id, manifestUrl, … }] }
 *
 * Env:
 *   RELEASE_TAG   GitHub release tag to template URLs against (default extensions-v1)
 *   GH_REPO       owner/repo for the release (default kanakkholwal/recast)
 *
 * Publish flow:
 *   RELEASE_TAG=extensions-v1 node extensions/scripts/build-registry.mjs
 *   gh release create extensions-v1 \
 *     extensions/dist/release/* \
 *     extensions/dist/*.extension.json \
 *     extensions/dist/index.json
 */

import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = resolve(SCRIPTS_DIR, "..");
const PACKS_DIR = join(EXT_ROOT, "packs");
const DIST_DIR = join(EXT_ROOT, "dist");
const RELEASE_DIR = join(DIST_DIR, "release");

const RELEASE_TAG = process.env.RELEASE_TAG ?? "extensions-v1";
const GH_REPO = process.env.GH_REPO ?? "kanakkholwal/recast";
const RELEASE_BASE = `https://github.com/${GH_REPO}/releases/download/${RELEASE_TAG}`;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function packDirs() {
	if (!existsSync(PACKS_DIR)) return [];
	return readdirSync(PACKS_DIR)
		.map((n) => join(PACKS_DIR, n))
		.filter((p) => statSync(p).isDirectory());
}

function buildPack(dir) {
	const src = JSON.parse(readFileSync(join(dir, "extension.json"), "utf8"));
	const packId = src.id;

	const assets = src.assets.map((a) => {
		const abs = join(dir, a.file);
		if (!existsSync(abs)) {
			throw new Error(`${packId}: asset "${a.id}" file missing at ${a.file}`);
		}
		const buf = readFileSync(abs);
		const filename = basename(a.file);
		const releaseName = `${packId}__${filename}`;
		copyFileSync(abs, join(RELEASE_DIR, releaseName));
		return {
			id: a.id,
			filename,
			url: `${RELEASE_BASE}/${releaseName}`,
			sha256: sha256(buf),
			size: buf.length,
		};
	});

	// Installable manifest — the exact envelope `install_extension` validates.
	const manifest = {
		id: packId,
		name: src.name,
		version: src.version,
		author: src.author ?? null,
		kind: src.kind,
		permissions: src.permissions ?? [],
		contributes: src.contributes ?? {},
		assets,
	};
	writeFileSync(
		join(DIST_DIR, `${packId}.extension.json`),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

	return {
		id: packId,
		name: src.name,
		version: src.version,
		author: src.author ?? undefined,
		description: src.description ?? undefined,
		manifestUrl: `${RELEASE_BASE}/${packId}.extension.json`,
	};
}

// ---- main -------------------------------------------------------------------

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(RELEASE_DIR, { recursive: true });

const dirs = packDirs();
const entries = dirs.map(buildPack).sort((a, b) => a.id.localeCompare(b.id));

const index = { version: RELEASE_TAG, extensions: entries };
writeFileSync(join(DIST_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);

console.log(`Built ${entries.length} pack(s) -> ${DIST_DIR}`);
for (const e of entries) console.log(`  ${e.id}  ${e.manifestUrl}`);
console.log(`\nPublish:\n  gh release create ${RELEASE_TAG} \\\n    extensions/dist/release/* \\\n    extensions/dist/*.extension.json \\\n    extensions/dist/index.json`);
