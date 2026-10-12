#!/usr/bin/env python
"""check_css_palette.py — fail the build on Panorama colour tokens the game does not define.

WHY
The Panorama CSS compiler accepts an unknown colour NAME without a word. The failure
only surfaces in-game, as a parsing warning per property:

    [Panorama] ***** Parsing warning on panorama/styles/postmortem/pm_button.css(1):
      Invalid value for property 'background-color': color-orange

That is how this repo shipped a build with four bad tokens in it: color-orange twice,
color-blue once, and color-black&CC. The panel still rendered, just unstyled, so nothing
looked obviously broken and the warnings were easy to lose in a 3 MB console buffer.

So the check runs here instead. Every `color-x` / named token used in our .vcss files has
to exist in tools/deadlock_palette.txt, which is generated from the game's own
citadel_base_styles.css.

WHAT COUNTS AS A TOKEN
  - `name: value` pairs where name is a bare identifier and value is NOT a literal
    (#hex, rgb()/rgba(), a quoted string, transparent, none, inherit)
  - token names may carry an alpha suffix, e.g. offWhite&88, so the & part is stripped
  - anything used inside gradient(from(...)) is tokenised the same way

Usage:
    python tools/check_css_palette.py            # check our stylesheets
    python tools/check_css_palette.py --refresh  # re-download the palette first
"""

import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
PALETTE = os.path.join(HERE, "deadlock_palette.txt")
CSS_DIR = os.path.join(PROJECT, "panorama", "styles")
PALETTE_URL = ("https://raw.githubusercontent.com/SteamTracking/GameTracking-Deadlock/"
               "master/game/citadel/pak01_dir/panorama/styles/citadel_base_styles.css")

# Values that are self-describing and need no palette entry.
# Values that are self-describing and need no palette entry. Includes border styles,
# because `border: 1px solid offWhite&22` is checked as a colour-bearing shorthand.
LITERALS = {
    "transparent", "none", "inherit", "initial", "unset", "auto", "currentcolor",
    "solid", "hidden", "dotted", "dashed", "double", "groove", "ridge", "inset",
    "outset", "groove", "medium", "thick", "thin",
}

# Only colour-bearing properties are inspected. Checking every declaration turns the
# report into a list of "vertical-align: middle", which tells nobody anything.
COLOUR_PROPS = {
    "color", "background-color", "wash-color", "outline-color",
    "border-color", "border-top-color", "border-bottom-color",
    "border-left-color", "border-right-color",
    "border", "border-top", "border-bottom", "border-left", "border-right",
    "text-shadow", "box-shadow", "shadow",
}

# id/class rules (.Foo, #Foo) are not colour tokens.
SELECTOR = re.compile(r"^\s*[.#&]")

# property: value
DECL = re.compile(r"^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*;\s*$")


def load_palette(refresh=False):
    if refresh or not os.path.exists(PALETTE):
        print("downloading palette from %s" % PALETTE_URL)
        with urllib.request.urlopen(PALETTE_URL, timeout=60) as r:
            css = r.read().decode("utf-8", "replace")
        names = sorted(set(re.findall(r"@define\s+([A-Za-z_][\w-]*)\s*:", css)))
        with open(PALETTE, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("# Panorama colour tokens defined by the game.\n")
            fh.write("# Source: SteamTracking/GameTracking-Deadlock,\n")
            fh.write("#   game/citadel/pak01_dir/panorama/styles/citadel_base_styles.css\n")
            fh.write("# Refresh with: python tools/check_css_palette.py --refresh\n")
            fh.write("#\n")
            for n in names:
                fh.write(n + "\n")
        print("wrote %d tokens" % len(names))
    with open(PALETTE, encoding="utf-8") as fh:
        return set(l.strip() for l in fh if l.strip() and not l.startswith("#"))


def tokens_in(value):
    """Palette references inside one declaration value."""
    out = []
    # Strip literals so their contents are not mistaken for tokens.
    stripped = re.sub(r"#[0-9A-Fa-f]{3,8}\b", " ", value)
    stripped = re.sub(r"\b(?:rgb|rgba|hsl|hsla)\([^)]*\)", " ", stripped, flags=re.I)
    stripped = re.sub(r'"[^"]*"|\'[^\']*\'', " ", stripped)
    stripped = re.sub(r"url\([^)]*\)", " ", stripped, flags=re.I)
    stripped = re.sub(r"-?\d*\.?\d+(px|%|em|rem|vh|vw|deg|s|ms|fr|fps)", " ", stripped)
    # A token with an alpha suffix is ONE token: offWhite&DD. Matching bare identifiers
    # first emits "offWhite" and then flags "DD" as unknown, which is how the first run
    # of this checker produced sixty nonsense findings.
    for raw in re.findall(r"[A-Za-z_][\w-]*&[A-Za-z0-9_]+", stripped):
        out.append(raw)
    leftover = re.sub(r"[A-Za-z_][\w-]*&[A-Za-z0-9_]+", " ", stripped)
    for raw in re.findall(r"[A-Za-z_][\w-]*", leftover):
        if raw.lower() in LITERALS:
            continue
        out.append(raw)
    return out


def check_file(path, palette):
    problems = []
    with open(path, encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            if SELECTOR.match(line):
                continue
            m = DECL.match(line)
            if not m:
                continue
            prop, value = m.group(1), m.group(2)
            if prop.lower() not in COLOUR_PROPS:
                continue
            for tok in tokens_in(value):
                base = tok.split("&", 1)[0]
                if base in palette:
                    continue
                # CSS keywords that are not colours but appear in values
                if base.lower() in LITERALS:
                    continue
                problems.append((lineno, prop, tok))
    return problems


def main():
    refresh = "--refresh" in sys.argv
    palette = load_palette(refresh)
    print("palette: %d tokens" % len(palette))

    files = []
    for root, _dirs, names in os.walk(CSS_DIR):
        for n in sorted(names):
            if n.endswith(".vcss"):
                files.append(os.path.join(root, n))

    failed = False
    for f in files:
        rel = os.path.relpath(f, PROJECT)
        problems = check_file(f, palette)
        if problems:
            failed = True
            print("FAIL %s" % rel)
            for lineno, prop, tok in problems:
                print("       line %-4d %-18s unknown token: %s" % (lineno, prop, tok))
        else:
            print("OK   %s" % rel)

    if failed:
        print("\nUnknown colour tokens. Either use a token from tools/deadlock_palette.txt,")
        print("or a literal (#RRGGBB, rgba(...)). The Panorama compiler will NOT catch this;")
        print("it only shows up as a parsing warning while the game is running.")
        return 1
    print("\nAll colour tokens resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())