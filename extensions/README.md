# Recast Extensions

Community **asset packs** for the Recast editor. An extension adds cursors,
backgrounds, gradients, colors, or easing/smoothing presets — surfaced in the
editor's **Extensions** tab.

Packs are **declarative**: a manifest plus static asset files. They run **no
code**, so there's nothing to sandbox — the trust model is verification:
HTTPS-only downloads, per-asset SHA-256 pinning, strict schema, filename-
traversal rejection, and **zero permissions**. The same rules are enforced
twice: by CI when a PR is opened, and by the desktop app at install time
(`apps/desktop/src-tauri/src/commands/extensions.rs`).

## Contribute a pack

1. Create a folder under `packs/<your-pack-id>/`. The id is a slug
   (`[A-Za-z0-9._-]`, not leading with a dot) and **must equal the folder name**.
2. Add your assets under `packs/<id>/assets/` (cursors as `.svg`; backgrounds as
   `.png`/`.jpg`/`.webp`). Filenames must be bare (no subfolders).
3. Write `packs/<id>/extension.json` (see below).
4. Run the verifier locally:
   ```bash
   pnpm verify:extensions
   ```
5. Open a PR. The **Verify Extensions** workflow re-runs the verifier on your
   change. A green check means it's installable.

### Manifest (`extension.json`)

The committed manifest is the *source* form — you do **not** write URLs or
hashes. The registry builder computes the SHA-256 and download URL when the pack
is published.

```jsonc
{
  "$schema": "../../schema/extension.source.schema.json",
  "id": "my-cursors",
  "name": "My Cursors",
  "version": "1.0.0",
  "author": "you",
  "description": "Short blurb shown in the gallery.",
  "kind": "asset-pack",
  "permissions": [],
  "contributes": {
    "cursors": [
      {
        "id": "ring",
        "label": "Ring",
        "description": "Optional one-liner.",
        "rest": "ring",            // asset id of the rest-state SVG
        "press": "ring-press",     // optional pressed-state SVG asset id
        "hotspot": { "x": 32, "y": 32 },
        "pressedHotspot": { "x": 32, "y": 32 }
      }
    ]
  },
  "assets": [
    { "id": "ring", "file": "assets/ring.svg" },
    { "id": "ring-press", "file": "assets/ring-press.svg" }
  ]
}
```

Contribution kinds and their fields:

| Kind          | Fields                                                              | Asset? |
| ------------- | ------------------------------------------------------------------ | ------ |
| `cursors`     | `id, label, rest, press?, hotspot{x,y}, pressedHotspot?`            | SVG    |
| `backgrounds` | `id, label, asset, thumb?`                                          | image  |
| `gradients`   | `id, label, value` (CSS `linear-gradient(...)`)                    | —      |
| `colors`      | `id, label, value` (hex)                                            | —      |
| `easings`     | `id, label, value{x1,y1,x2,y2}`                                     | —      |
| `smoothings`  | `id, label, smoothing(0–100), snapToClicks, snapWindowMs`          | —      |

Cursor/background `rest`/`press`/`asset`/`thumb` fields reference an **asset
id** declared in `assets[]`. Cursors are authored on a **64×64** canvas with the
click point at `hotspot` (sprite-space pixels).

### What the verifier checks

- `kind` is `asset-pack` and `permissions` is empty.
- `id` is a safe slug and equals the folder name; `version` is `x.y.z`.
- Every asset file exists under `assets/`, has a bare/safe filename (no `..`,
  path separators, drive prefixes, or Windows device names), and the right type
  for its use (cursor → SVG, background → raster image).
- Every contribution references a declared asset; no unreferenced assets.
- Ids are unique within a kind.

## Maintainers: publish

The desktop app fetches the curated index at
`releases/download/extensions-v1/index.json` and installs from each pack's
manifest URL. To (re)publish after merging packs:

```bash
RELEASE_TAG=extensions-v1 node extensions/scripts/build-registry.mjs
gh release create extensions-v1 extensions/dist/*
```

(`extensions/dist/` is generated and git-ignored.)

### Local install dry-run (no release needed)

The installer accepts `http://localhost` URLs, so you can test the whole
download → verify → install path against a local server. `serve:extensions`
builds every pack, serves it from memory, and **watches `extensions/` to rebuild
on any change** — edit a pack and re-install without restarting:

```bash
pnpm serve:extensions            # http://localhost:4422 (PORT=<n> to change)
# In the app → Extensions tab → Install from URL:
#   http://localhost:4422/recast-cursors.extension.json
# (or point the browse gallery at http://localhost:4422/index.json)
```
