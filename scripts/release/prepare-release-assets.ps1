# Gather every release-ready binary from the Tauri bundle output into a
# single `release-assets/` directory ready for GitHub Release upload.
#
# Tauri scatters bundle artifacts across multiple paths depending on
# whether a target triple was specified at build time; this script
# walks both candidate roots and collects every file matching the known
# release extensions. Throws if nothing is found — that almost always
# means the build step failed silently or the bundle config drifted.
#
# Inputs:
#   - $PlatformName arg — matrix.platform.name, used only in the error
#                         message ("No release assets found for X").
#   - $RustTarget   arg — Rust target triple.

param(
    [Parameter(Mandatory = $true)]
    [string]$PlatformName,
    [Parameter(Mandatory = $true)]
    [string]$RustTarget
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path "$ScriptDir/../..").Path
Set-Location $RepoRoot

$assetDir = "release-assets"
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

$bundleRoots = @(
    "apps/desktop/src-tauri/target/release/bundle",
    "apps/desktop/src-tauri/target/$RustTarget/release/bundle"
)
# `.sig` covers the updater signatures emitted alongside every bundle.
# `.gz` was previously included to pick up the macOS updater bundle
# (`recast*.app.tar.gz`) — but a broad `.gz` match also pulls in the
# `.deb` package's `control.tar.gz` / `data.tar.gz` intermediates
# during the recursive walk, which then get uploaded as release
# assets. Handle `.tar.gz` separately with a name filter so we only
# accept the macOS updater format.
$extensions = @(".AppImage", ".deb", ".dmg", ".exe", ".msi", ".msix", ".sig", ".json")
$assets = @()
foreach ($root in $bundleRoots) {
    if (Test-Path -LiteralPath $root) {
        $assets += Get-ChildItem -Path $root -Recurse -File | Where-Object {
            ($extensions -contains $_.Extension) -or
            ($_.Name -like "recast*.app.tar.gz")
        }
    }
}
if (-not $assets) {
    throw "No release assets found for $PlatformName"
}
foreach ($asset in $assets) {
    Copy-Item -LiteralPath $asset.FullName -Destination $assetDir -Force
    Write-Output "Prepared $($asset.Name)"
}
