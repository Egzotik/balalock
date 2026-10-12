<#
.SYNOPSIS
    Build the POSTMORTEM addon into pak01_dir.vpk.

.DESCRIPTION
    Twelve steps, in order, and each one has bitten somebody before:

      1. Stage  panorama\  ->  CSDK\content\citadel_addons\postmortem\panorama\
         CSDK owns both halves of an addon: content\ holds the sources you edit,
         game\ holds the compiled output. Copying in the wrong direction silently
         compiles stale files.

      2. Compile with game\bin_cs2\win64\resourcecompiler.exe
         NOT game\bin. The bin and bin_tools sets both abort with a schema mismatch
         ("ParticleFloatType_t / Mismatch - Member Count / Module 1 -
         resourcecompiler.dll:particleslib / Module 2 - particles.dll:particleslib"),
         and bin_server swaps the second module for animationsystem.dll and fails the
         same way. bin_cs2 compiles cleanly on build 25763945. If a future CSDK update
         changes that, test bin_cs2 first and only then try the others.

      3. Pack game\citadel_addons\postmortem\ into a VPK
         Everything is already compiled to _c names by step 2. There is no compile
         step hidden in here.

      4. Copy the VPK into build\ so Deadlock Mod Manager can pick it up.

.NOTES
    Requires: Reduced CSDK 12 at $CsdkRoot, python with the vpk package.
    Does NOT launch the game and does NOT touch the live Deadlock install.
#>
[CmdletBinding()]
param(
    [string]$CsdkRoot = 'C:\Reduced_CSDK_12',
    # $PSScriptRoot is not usable in a param-block default under Windows PowerShell 5.1,
    # so the roots get resolved in the body instead.
    [string]$ProjectRoot = '',
    [string]$AddonName = 'postmortem',
    [string]$OutDir = '',
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectParent = Split-Path -Parent $ScriptDir
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = $ProjectParent }
if ([string]::IsNullOrWhiteSpace($OutDir)) { $OutDir = Join-Path $ProjectParent 'build' }

$resourceCompiler = Join-Path $CsdkRoot 'game\bin_cs2\win64\resourcecompiler.exe'
$csdkContent = Join-Path $CsdkRoot "content\citadel_addons\$AddonName"
$csdkGame = Join-Path $CsdkRoot "game\citadel_addons\$AddonName"
$csdkGameInfo = Join-Path $CsdkRoot 'game\citadel'

function Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    OK   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    WARN $msg" -ForegroundColor Yellow }
function Die($msg) { Write-Host "    FAIL $msg" -ForegroundColor Red; exit 1 }

# ── preflight ──────────────────────────────────────────────────────────────────────
Step 0 'preflight'
if (-not (Test-Path $resourceCompiler)) {
    Die "resourcecompiler not found at $resourceCompiler"
}
Ok "compiler present (bin_cs2)"
if (-not (Test-Path (Join-Path $ProjectRoot 'panorama'))) {
    Die "no panorama\ directory under $ProjectRoot"
}

# ── 1. stage ───────────────────────────────────────────────────────────────────────
Step 1 'stage sources'
if ($Clean) {
    Remove-Item -Recurse -Force $csdkContent -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $csdkContent | Out-Null
New-Item -ItemType Directory -Force -Path $csdkGame | Out-Null
Remove-Item -Recurse -Force (Join-Path $csdkContent 'panorama') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $csdkGame 'panorama') -ErrorAction SilentlyContinue
Copy-Item (Join-Path $ProjectRoot 'panorama') (Join-Path $csdkContent 'panorama') -Recurse -Force
Ok "$((Get-ChildItem (Join-Path $csdkContent 'panorama') -Recurse -File).Count) source files staged"

# addoninfo.txt lives on the game side and marks the addon playable so the CSDK
# launcher will offer it. Without it the addon is treated as a template.
@"
"AddonInfo"
{
	"IsTemplate"	"0"
	"IsPlayable"	"1"
}
"@ | Set-Content (Join-Path $csdkGame 'addoninfo.txt') -Encoding UTF8

# ── 2. compile ─────────────────────────────────────────────────────────────────────
Step 2 'compile'
Push-Location $csdkContent
$raw = & $resourceCompiler -game $csdkGameInfo `
    -i 'panorama\layout\*.xml' `
    -i 'panorama\layout\post_game\*.xml' `
    -i 'panorama\styles\postmortem\*.vcss' `
    -i 'panorama\scripts\postmortem\*.js' `
    -r -f -nop4 -pc 2>&1
Pop-Location

$log = $raw | Out-String
$errors = @($log -split "`n" | Where-Object { $_ -match 'RESOURCE COMPILE ERROR|^ERROR:' })
$summary = ($log -split "`n" | Where-Object { $_ -match 'OK:' } | Select-Object -First 1)
if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Die 'compile failed'
}
Ok ($summary -replace '\s+', ' ').Trim()

$compiled = @(Get-ChildItem $csdkGame -Recurse -File -Filter '*_c')
if ($compiled.Count -lt 13) {
    Die "only $($compiled.Count) compiled assets in the game tree, expected at least 13"
}
foreach ($c in $compiled) { Ok ($c.FullName.Substring($csdkGame.Length + 1)) }

# Guard against shipping the compiler's dependency placeholders. The vanilla layout
# references panorama/videos/pick_screen/play_btn_grn_flame.webm, which does not exist
# in ANY citadel VPK in build 25763945 - the game tolerates the dangling reference, the
# compiler does not, so tools/seed_missing_assets.ps1 puts a stub into CSDK's citadel
# tree to satisfy it. That stub must never reach our VPK.
$strays = @(Get-ChildItem $csdkGame -Recurse -File | Where-Object { $_.Extension -eq '.webm' })
if ($strays.Count -gt 0) {
    $strays | ForEach-Object { Remove-Item $_.FullName -Force }
    Warn "removed $($strays.Count) placeholder asset(s) from the pack set"
}

# ── 2a. js namespace lint ──────────────────────────────────────────────────────
# The Panorama JS compiler is happy with code that dies at load. Build 1 through build 5
# all shipped the same one-line defect: pm_compat.js and pm_probe.js wrote
# `PM.Compat.check = fn` on a slot nobody had created, so both files were skipped whole
# when Panorama loaded them, and the only symptom was a "Skipping rest of script" line in
# a 3 MB console buffer. Five in-game runs went into that.
#
# pm_data.js and pm_net.js survived the whole time because they assign PM.Data = {...}
# wholesale, which made the failure look like a shared-namespace problem when it was a
# missing object. tools/check_js_namespace.py turns it into a build error.
Step '2a' 'js namespace lint'
$nsLint = Join-Path $ProjectParent 'tools\check_js_namespace.py'
$nsOut = python $nsLint 2>&1
if ($LASTEXITCODE -ne 0) {
    $nsOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Die 'namespace defect: a module writes a field on a slot it never creates'
}
($nsOut | Out-String) -split "`n" | Where-Object { $_ -match '^OK' } | ForEach-Object { Ok $_.Trim() }

# ── 2b. analysis tests ────────────────────────────────────────────────────────
# pm_analysis.js is the only part of this mod with arithmetic in it, and until build 7 it
# had never been executed even once: the sole way to run Panorama JS is to be inside the
# game, so every formula shipped unverified and the user found out in a match. Node is not
# installed here, but Windows Script Host ships a JScript interpreter with Windows, and
# pm_analysis.js stays inside ES3 so both can read it.
#
# It has already earned its keep. Running it caught a trailing comma in the METRICS array
# literal, which made a tolerant parser append a seventh undefined element - every metric
# loop in build() would have thrown the moment the overlay opened. The Panorama compiler
# accepted that file six times without a word.
Step '2b' 'analysis tests'
$testRunner = Join-Path $ProjectParent 'tools\test_analysis.js'
$cscript = Get-Command cscript -ErrorAction SilentlyContinue
if (-not $cscript) {
    Die 'cscript not found; the analysis engine cannot be verified on this machine'
}
$testOut = & cscript //E:JScript //nologo $testRunner 2>&1
$testOut | ForEach-Object { if ($_ -match '^\s') { Write-Host "    $_" -ForegroundColor DarkGray } }
if ($LASTEXITCODE -ne 0) {
    $testOut | ForEach-Object { if ($_ -match '^  -' -or $_ -match '^FAIL') { Write-Host "    $_" -ForegroundColor Red } }
    Die 'analysis engine tests failed'
}
($testOut | Out-String) -split "`n" | Where-Object { $_ -match '^OK' } | ForEach-Object { Ok $_.Trim() }

# ── 2b2. es3 dialect ──────────────────────────────────────────────────────
# Panorama's parser accepts a trailing comma, `const`, and reserved words as keys. The
# JScript parser in tools/test_analysis.js does not. Anything in that gap compiles, packs,
# and then throws the first time a user presses the button - which is how METRICS grew a
# silent seventh undefined element and shipped six builds.
Step '2b2' 'es3 dialect'
$es3 = Join-Path $ProjectParent 'tools\check_js_es3.py'
$es3Out = python $es3 2>&1
if ($LASTEXITCODE -ne 0) {
    $es3Out | ForEach-Object { if ($_ -match 'FAIL|line ') { Write-Host "    $_" -ForegroundColor Red } }
    Die 'a script uses syntax Panorama accepts but the ES3 test harness cannot parse'
}
($es3Out | Out-String) -split "`n" | Where-Object { $_ -match '^OK' } | ForEach-Object { Ok $_.Trim() }

# ── 2b2a. global collisions ─────────────────────────────────────────────────────
# Panorama gives every script in one context the SAME global scope. pm_data.js declared
# AWARD_CLASSES as a list of names while pm_analysis.js declared it as a list of pairs;
# whichever loaded last won and every team award came back empty with nothing logged.
# Three separate bugs in this project have been exactly this, so it is a gate now.
Step '2b2a' 'global collisions'
$globals = Join-Path $ProjectParent 'tools\check_js_globals.py'
$gOut = python $globals 2>&1
if ($LASTEXITCODE -ne 0) {
    $gOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Die 'two modules declare the same module-scope name; one silently overwrites the other'
}
$gOut | ForEach-Object { if ($_ -match '^scanned') { Ok $_.Trim() } }

# ── 2b2b. module exports ─────────────────────────────────────────────────────
# A rename that moves the function but forgets the object key leaves every reader
# calling undefined. Build 10 lost the entire report to `compatValid: compatValid`:
# detectHost() threw, boot() died before it could set state.host, and the overlay still
# appeared because openOverlay() builds it lazily - so the user saw a finished-looking
# empty screen and one exception with an empty message.
Step '2b2b' 'module exports'
$exports = Join-Path $ProjectParent 'tools\check_js_exports.py'
$expOut = python $exports 2>&1
if ($LASTEXITCODE -ne 0) {
    $expOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Die 'a cross-module read does not resolve against a published key'
}
$expOut | ForEach-Object { if ($_ -match '^OK') { Ok $_.Trim() } }

# ── 2b3. panel slot order ─────────────────────────────────────────────────────
# make(type, parent, id, cls). Ninety-three call sites had the class list in the id slot.
# The stylesheet also styles by id, so the same mistake WORKED at the top of the screen
# and silently did nothing in every table underneath it: collapsed columns, text on top
# of text, an 'undefined' header. Nothing crashed and nothing was logged.
Step '2b3' 'panel slot order'
$slots = Join-Path $ProjectParent 'tools\check_panel_slots.py'
$slotOut = python $slots 2>&1
if ($LASTEXITCODE -ne 0) {
    $slotOut | ForEach-Object { if ($_ -match 'FAIL|line ') { Write-Host "    $_" -ForegroundColor Red } }
    Die 'a panel is given a class in the id slot, or an id that only exists as a class'
}
$slotOut | ForEach-Object { if ($_ -match '^OK') { Ok $_.Trim() } }

# ── 2b4. horizontal overflow ──────────────────────────────────────────────────────
# width:100% in Panorama is 100% of the parent's CONTENT box, and horizontal margins
# are added on top. Four blocks were 48px too wide, which put a horizontal scrollbar under
# the report and clipped the right-hand column. Nothing warns: the compiler is clean,
# the numbers are right, and the screen is still cut off at the edge.
Step '2b4' 'horizontal overflow'
$ovf = Join-Path $ProjectParent 'tools\check_css_overflow.py'
$ovfOut = python $ovf 2>&1
if ($LASTEXITCODE -ne 0) {
    $ovfOut | ForEach-Object { if ($_ -match 'FAIL|panorama') { Write-Host "    $_" -ForegroundColor Red } }
    Die 'a percentage width overflows its parent; use fill-parent-flow( 1.0 )'
}
$ovfOut | ForEach-Object { if ($_ -match '^OK') { Ok $_.Trim() } }

# ── 2c. palette check ─────────────────────────────────────────────────────────────
# The Panorama CSS compiler accepts an unknown colour name without a word. The failure
# only shows up in-game as a parsing warning per property, and a silently unstyled panel
# is easy to mistake for "the mod does not work". That is how color-orange, color-blue
# and color-black&CC shipped in build 1. Caught here instead.
Step '2c' 'css palette'
$paletteCheck = Join-Path $ProjectParent 'tools\check_css_palette.py'
$paletteOut = python $paletteCheck 2>&1
if ($LASTEXITCODE -ne 0) {
    $paletteOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Die 'unknown Panorama colour tokens (see above)'
}
($paletteOut | Out-String) -split "`n" | Where-Object { $_ -match '^(OK|palette)' } |
    ForEach-Object { Ok $_.Trim() }

# ── 3. pack ────────────────────────────────────────────────────────────────────────
Step 3 'pack vpk'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$vpkPath = Join-Path $OutDir 'pak01_dir.vpk'
Remove-Item $vpkPath -Force -ErrorAction SilentlyContinue

# Only the panorama\ subtree goes into the VPK, but the entry names inside the VPK must
# still start with 'panorama/'. Packing csdkGame directly would work but would also ship
# addoninfo.txt, the CSDK marker that makes the launcher treat a folder as a template.
# So stage a clean tree and pack that.
$packStage = Join-Path $OutDir '_pack'
Remove-Item -Recurse -Force $packStage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $packStage | Out-Null
Copy-Item (Join-Path $csdkGame 'panorama') (Join-Path $packStage 'panorama') -Recurse -Force
Ok "staged $($((Get-ChildItem $packStage -Recurse -File).Count)) files for packing"

# ValvePython's API here is vpk.new(dir).save(out) - there is no vpk.pack(), no context
# manager and no version kwarg. It walks the directory, splits each name on the LAST
# dot, and writes a single embedded VPK v2. Reading the result back reproduces
# '.../pm_core.vjs_c' exactly, which is the name the game has to see.
$packScript = @"
import sys, vpk
src, dst = sys.argv[1], sys.argv[2]
pak = vpk.new(src)
pak.save(dst)
print('packed %d entries -> %s' % (pak.file_count, dst))
"@
$packTmp = Join-Path $env:TEMP 'pm_pack.py'
$packScript | Set-Content $packTmp -Encoding UTF8
$packOut = python $packTmp $packStage $vpkPath 2>&1
if ($LASTEXITCODE -ne 0) {
    $packOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Die 'packing failed'
}
Ok ($packOut | Out-String).Trim()

# ── 4. verify ──────────────────────────────────────────────────────────────────────
Step 4 'verify'
$verifyScript = @"
import sys, vpk
pak = vpk.open(sys.argv[1])
need = [
    'panorama/layout/citadel_db_page_profile.vxml_c',
    'panorama/layout/post_game/citadel_db_page_post_game_new.vxml_c',
    'panorama/layout/hud_escape_menu.vxml_c',
    'panorama/styles/postmortem/pm_button.vcss_c',
    'panorama/styles/postmortem/pm_root.vcss_c',
    'panorama/scripts/postmortem/pm_text.vjs_c',
    'panorama/scripts/postmortem/pm_compat.vjs_c',
    'panorama/scripts/postmortem/pm_data.vjs_c',
    'panorama/scripts/postmortem/pm_analysis.vjs_c',
    'panorama/scripts/postmortem/pm_net.vjs_c',
    'panorama/scripts/postmortem/pm_api.vjs_c',
    'panorama/scripts/postmortem/pm_probe.vjs_c',
    'panorama/scripts/postmortem/pm_core.vjs_c',
]
have = set(pak)
missing = [n for n in need if n not in have]
extra = sorted(n for n in have if n not in need)
for n in need:
    print('    %-64s %s' % (n, 'present' if n in have else 'MISSING'))
for n in extra:
    print('    extra: %s' % n)
sys.exit(1 if missing else 0)
"@
$verifyTmp = Join-Path $env:TEMP 'pm_verify.py'
$verifyScript | Set-Content $verifyTmp -Encoding UTF8
python $verifyTmp $vpkPath
if ($LASTEXITCODE -ne 0) { Die 'verification failed: the VPK is incomplete' }

$size = [math]::Round((Get-Item $vpkPath).Length / 1KB, 1)
Write-Host ''
Write-Host "Built $vpkPath ($size KB)" -ForegroundColor Green
Write-Host 'Next: Deadlock Mod Manager -> Mods Library -> Add Local Mod -> drop this file.' -ForegroundColor Green