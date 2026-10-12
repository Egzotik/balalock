<#
.SYNOPSIS
    Seed the assets the vanilla layouts reference but the game does not ship.

.DESCRIPTION
    The vanilla citadel_db_page_post_game_new.xml contains:

      <MoviePanel id="PlayButtonFX" ... src="file://{resources}/videos/pick_screen/
      play_btn_grn_flame.webm" ... />

    Build 25763945 has no such file in ANY citadel or core VPK. The game does not care -
    a MoviePanel with a missing source simply never plays, and that is the behaviour
    players see today. The resource compiler DOES care: it refuses the layout with

      RESOURCE COMPILE ERROR: File does not exist
      "panorama/videos/pick_screen/play_btn_grn_flame.webm"

    which means an addon that overrides this layout cannot be compiled at all until the
    reference resolves.

    This script drops a 20 byte EBML stub at that path, on both sides of the CSDK tree
    (content\ is where sources are looked up, game\ is where compiled output lives).
    It deliberately does NOT touch content\citadel_addons\, so the stub can never end up
    inside our VPK. build_mod.ps1 also sweeps any .webm out of the pack set as a second
    line of defence.

    Re-run this after every CSDK update or every game update: if Valve restores the
    video, remove the stubs and the compile will work without them.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\seed_missing_assets.ps1
#>
[CmdletBinding()]
param(
    [string]$CsdkRoot = 'C:\Reduced_CSDK_12'
)

$ErrorActionPreference = 'Stop'

# Minimal EBML header, enough to be a file with a .webm extension. It is never played:
# the game resolves this asset from its own VPKs, where it does not exist either.
[byte[]]$stub = 0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x74, 0x70,
0x77, 0x65, 0x62, 0x6D

$targets = @(
    # path relative to citadel, stub is required by
    'panorama\videos\pick_screen\play_btn_grn_flame.webm'
)

foreach ($t in $targets) {
    foreach ($side in @('content', 'game')) {
        $dir = Join-Path $CsdkRoot "$side\citadel\$(Split-Path -Parent $t)"
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $dir (Split-Path -Leaf $t)), $stub)
        Write-Host "  seeded $side\citadel\$t" -ForegroundColor DarkGray
    }
}

Write-Host 'Done. These stubs exist only so the compiler resolves the reference.' -ForegroundColor Green
Write-Host 'They are never packaged.' -ForegroundColor Green