#!/usr/bin/env python
"""extract_vanilla.py — pull the readable token stream out of a local Deadlock install.

WHY THIS EXISTS
The two layouts this mod overrides must match the build that is actually installed.
GameTracking is close but not guaranteed current, so a local build is worth reading
directly.

HONEST SCOPE
This is a COMPARISON TOOL, not a decompiler, and it is best-effort. What it does:
locates the LZ4 blocks inside a compiled .vxml_c / .vcss_c / .vjs_c and prints the token
table they hold, so you can diff a local build against the copy in upstream/.

What it cannot do: give you back the source. The string table stores FRAGMENTS, not whole
identifiers - the vanilla post-game layout yields runs like 'Team1&', 'QScore' and
'oGraphs' where the source says 'Team1Screen', 'ScoreboardScreen' and 'GraphsScreen'.
So an identifier lookup that misses here does NOT prove the child is absent from the
build. Use the output to decide what to look at, then diff the real sources.

The authoritative compatibility check is runtime: pm_compat.js, inside the game.

This tool is never an input to the build. The build compiles hand-merged .xml/.vcss/.js
with CSDK 12.

Usage:
    python tools/extract_vanilla.py                      # list targets
    python tools/extract_vanilla.py --target post_game    # dump one target
    python tools/extract_vanilla.py --all --canary
    python tools/extract_vanilla.py --game "D:\\SteamLibrary\\...\\Deadlock"

Output goes to build/vanilla/<target>/ and is not meant to be committed.
"""

import argparse
import hashlib
import os
import re
import sys

try:
    import vpk
except ImportError:
    sys.exit("pip install vpk lz4")

import lz4.block

# The layouts and stylesheets this mod depends on. Keep in sync with
# docs/COMPAT.md and with the <include> lists in panorama/layout/*.
TARGETS = {
    "post_game": "panorama/layout/post_game/citadel_db_page_post_game_new.vxml_c",
    "footer_bar": "panorama/layout/citadel_dashboard_footer_bar.vxml_c",
    "post_game_css": "panorama/styles/post_game/citadel_db_page_post_game_new.vcss_c",
    "footer_bar_css": "panorama/styles/citadel_dashboard_footer_bar.vcss_c",
    "profile": "panorama/layout/citadel_db_page_profile.vxml_c",
    "match_history": "panorama/layout/citadel_db_page_profile_match_history.vxml_c",
    "scoreboard": "panorama/layout/post_game/citadel_db_post_game_scoreboard_new.vxml_c",
    "match_history_block": "panorama/layout/citadel_match_history_block_large.vxml_c",
}

# Markers that prove a decompressed blob really is Panorama source and not noise.
PANORAMA_MARKERS = (
    b"PANEL", b"STYLES", b"SCRIPTS", b"ROOT", b"vecChildren", b"REFERENCE_COMPILED",
    b"panorama/", b"Snippet", b"SNIPPET",
)

MIN_BLOCK = 64
MAX_BLOCK = 1 << 21
MAX_OUT = 1 << 22


def find_vpk(game_root):
    for name in ("pak01_dir.vpk", "pak01_000.vpk"):
        candidate = os.path.join(game_root, "game", "citadel", name)
        if os.path.exists(candidate):
            return candidate
    raise SystemExit("no pak01_dir.vpk under %s/game/citadel" % game_root)


def default_game_root():
    for base in (
        r"C:\Program Files (x86)\Steam\steamapps\common\Deadlock",
        r"C:\Program Files\Steam\steamapps\common\Deadlock",
    ):
        if os.path.isdir(os.path.join(base, "game", "citadel")):
            return base
    raise SystemExit("pass --game: Deadlock is not in a default Steam path")


def probe_blocks(data):
    """Recover the readable token stream from a compiled panorama asset.

    Compiled .vxml_c / .vcss_c / .vjs_c are a short container header followed by LZ4
    blocks that together hold one de-duplicated string table. This is a probe, not a
    parser, and it is explicitly best-effort: a canary aid for diffing a local build
    against upstream/, never an input to the build.

    Strategy that works on the files actually seen: find the single offset that
    decompresses to the LARGEST output, then chain forward from the end of that block.
    Walking forward greedily from zero instead latches onto small incidental blocks and
    steps straight past the big one, which is how the first version of this function
    recovered only a third of the file.

    The size ladder is geometric because LZ4 rejects a wrong length cheaply; trying every
    4-byte step is wasted work.
    """
    # Sizes must include the EXACT block length, and those lengths are not powers of two
    # - citadel_db_page_post_game_new.vxml_c decompresses at offset 1093 with size 288,
    # which a pure geometric ladder (256, 512) skips entirely. So: dense small steps plus
    # a geometric tail. On a 4 KB asset this is cheap.
    ladder = list(range(16, 1200, 8))
    size = 1200
    while size <= (1 << 17):
        ladder.append(size)
        size = size + size // 4

    def readable(out):
        """A decompressed block is useful if it is mostly printable token text.

        Requiring a known Panorama marker instead turned out to reject the later blocks:
        they carry continuation of the string table and contain none of the AST keywords.
        """
        if len(out) < 64:
            return False
        printable = sum(1 for b in out if 32 <= b < 127 or b in (9, 10, 13))
        return printable >= len(out) * 0.75

    def best_from(offset):
        for size in ladder:
            if offset + size > len(data):
                return None
            try:
                out = lz4.block.decompress(
                    data[offset:offset + size], uncompressed_size=MAX_OUT
                )
            except Exception:
                continue
            if readable(out):
                return (size, out)
        return None

    # phase 1: the largest block anywhere in the file is the string table
    seed = None
    for offset in range(0, len(data)):
        hit = best_from(offset)
        if hit and (seed is None or len(hit[1]) > len(seed[1][1])):
            seed = (offset, hit)
    if seed is None:
        return {}

    found = {}
    offset, (size, out) = seed
    found[hashlib.sha1(out).hexdigest()] = (offset, size, out)
    # phase 2: chain forward from there
    offset += size
    while offset < len(data):
        hit = best_from(offset)
        if hit is None:
            offset += 1
            continue
        size, out = hit
        digest = hashlib.sha1(out).hexdigest()
        if digest in found:
            offset += 1
            continue
        found[digest] = (offset, size, out)
        offset += size
    return found


def printable_runs(blob):
    """Compiled panorama data is a flat string table; split it into readable tokens."""
    runs = re.findall(rb"[ -~]{3,}", blob)
    return [r.decode("ascii") for r in runs]


def report_vpk(game_root):
    vpk_path = find_vpk(game_root)
    print("vpk:   %s" % vpk_path)
    print("size:  %.1f MB" % (os.path.getsize(vpk_path) / 1048576.0))
    manifest = os.path.join(
        os.path.dirname(os.path.dirname(game_root)), "appmanifest_1422450.acf"
    )
    if os.path.exists(manifest):
        text = open(manifest, encoding="utf-8", errors="replace").read()
        for key in ("buildid", "TargetBuildID", "BytesToDownload"):
            found = re.search(r'"%s"\s+"(\d+)"' % key, text)
            if found:
                print("%-6s %s" % (key + ":", found.group(1)))
        if re.search(r'"TargetBuildID"\s+"(?!25763945")', text):
            print("\n!! A Steam update is pending. Update the game before merging,"
                  "\n   or you will package an override for a stale build.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", default=None, help="Deadlock install root")
    parser.add_argument("--target", choices=sorted(TARGETS), action="append")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--out", default="build/vanilla")
    parser.add_argument("--canary", action="store_true",
                        help="print which required child ids appear in the dump")
    args = parser.parse_args()

    game_root = args.game or default_game_root()
    report_vpk(game_root)

    # Identifiers the C++ post-game page expects to find by name. If any disappears
    # from the dump, our override would trip "FATAL ERROR: Unable to find child".
    CANARIES = [
        "MVPScreen", "Team1Screen", "Team2Screen", "ScoreboardScreen", "GraphsScreen",
        "ScreensCarousel", "PlayAgainButton", "ReplayButton", "CarouselNavItems",
        "CarouselNavLeftArrow", "CarouselNavRightArrow", "CommendNotification",
        "MatchID", "Team1", "Team2", "Scoreboard", "Graphs",
    ]

    targets = TARGETS if (args.all or not args.target) else {
        k: v for k, v in TARGETS.items() if k in args.target
    }

    vpk_path = find_vpk(game_root)
    pak = vpk.open(vpk_path)

    for name, path in targets.items():
        print("\n=== %s  (%s)" % (name, path))
        try:
            entry = pak[path]
        except KeyError:
            print("    not present in this build")
            continue
        data = entry.read()
        blocks = probe_blocks(data)
        tokens = []
        for _, (offset, _size, out) in sorted(blocks.items(), key=lambda kv: kv[1][0]):
            tokens.extend(printable_runs(out))

        joined = " ".join(tokens)
        seen = set(t for t in tokens if t in CANARIES)
        print("    %d bytes, %d blocks, %d tokens" % (len(data), len(blocks), len(tokens)))
        if args.canary:
            # HONEST LIMITATION. The compiled string table stores fragments, not whole
            # identifiers: the vanilla post-game file yields runs like 'Team1&', 'QScore'
            # and 'oGraphs' where the source says 'Team1Screen', 'ScoreboardScreen' and
            # 'GraphsScreen'. A MISSING below therefore does NOT mean the child is absent
            # from the build. Treat this output as a prompt to diff against upstream/,
            # never as proof. pm_compat.js is the only authoritative check, because it
            # runs in the game.
            coverage = len(joined) / max(1, len(data))
            print("    token coverage %.0f%% of file size" % (coverage * 100))
            for c in CANARIES:
                print("      %-20s %s" % (c, "found" if c in seen else "not resolved"))

        dest = os.path.join(args.out, name)
        os.makedirs(dest, exist_ok=True)
        with open(os.path.join(dest, "tokens.txt"), "w", encoding="utf-8") as fh:
            fh.write("\n".join(tokens))
        with open(os.path.join(dest, "joined.txt"), "w", encoding="utf-8") as fh:
            fh.write(joined)
        print("    wrote %s" % dest)


if __name__ == "__main__":
    main()