#!/usr/bin/env python
"""check_css_overflow.py - catch the layout mistake that costs a horizontal scrollbar.

THE BUG THIS EXISTS FOR
In Panorama, `width: 100%` means 100% of the PARENT'S CONTENT BOX, and horizontal margins
are added on top of it. So this:

    #PMSection
    {
        width: 100%;
        margin-left: 24px;
        margin-right: 24px;
    }

is not "full width with a gutter". It is 48px wider than its parent, which is what put a
horizontal scrollbar under the POSTMORTEM report and clipped the right-hand column. The
user reported it as "information scrolls sideways".

The Panorama idiom is `width: fill-parent-flow( 1.0 )`, which subtracts the margin first,
so the block ends flush with the parent's right edge.

Nothing warns about this. resourcecompiler compiles it cleanly, the stylesheet loads, the
JS runs, the numbers are right - and the report is still cut off at the edge. It was found
by reading the CSS after a screenshot, which is exactly how it should not have to be found.

Usage:
    python tools/check_css_overflow.py
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
CSS_DIRS = [
    os.path.join(PROJECT, "panorama", "styles"),
]

BLOCK = re.compile(r"([^{}]+)\{([^}]*)\}")
WIDTH_PCT = re.compile(r"\bwidth\s*:\s*(\d+(?:\.\d+)?)%")
MARGIN_LR = re.compile(r"\bmargin-(?:left|right)\s*:\s*(-?[\d.]+)\s*(?:px|%)?")
MARGIN_SHORTHAND = re.compile(r"\bmargin\s*:\s*([^;]+)")
NON_ZERO = re.compile(r"-?[\d.]+(?!0)")


def horizontal_margin(body):
    """Left/right margin in px-ish units, from the longhand or the shorthand."""
    out = []
    for m in MARGIN_LR.finditer(body):
        try:
            if float(m.group(1)) != 0.0:
                out.append(float(m.group(1)))
        except ValueError:
            pass
    for m in MARGIN_SHORTHAND.finditer(body):
        parts = m.group(1).split()
        # 1 value: all sides | 2: v h | 3: v h v | 4: t r b l
        if len(parts) == 2:
            sides = [parts[1]]
        elif len(parts) == 4:
            sides = [parts[1], parts[3]]
        elif len(parts) == 1:
            sides = [parts[0]]
        else:
            sides = []
        for s in sides:
            if s in ("auto", "0", "0px", "0%"):
                continue
            num = re.match(r"-?[\d.]+", s)
            if num and num.group(0) not in ("0", "0.0"):
                try:
                    out.append(float(num.group(0)))
                except ValueError:
                    pass
    return out


def main():
    files = []
    for d in CSS_DIRS:
        for root, _dirs, names in os.walk(d):
            for n in sorted(names):
                if n.endswith(".vcss"):
                    files.append(os.path.join(root, n))
    files.sort()
    if not files:
        print("no stylesheets found")
        return 1

    problems = []
    checked = 0
    for path in files:
        with open(path, encoding="utf-8") as fh:
            css = fh.read()
        rel = os.path.relpath(path, PROJECT)
        for m in BLOCK.finditer(css):
            selectors = " ".join(m.group(1).split())
            body = m.group(2)
            wm = WIDTH_PCT.search(body)
            if not wm:
                continue
            checked += 1
            pct = float(wm.group(1))
            if pct < 100:
                # A percentage under 100 leaves room for its own margins.
                continue
            margins = horizontal_margin(body)
            if margins:
                total = sum(abs(x) for x in margins)
                problems.append((rel, selectors, pct, total,
                                 "width: %g%% plus %gpx of horizontal margin" % (pct, total)))

    print("checked %d percentage-width rules across %d stylesheets" % (checked, len(files)))

    if problems:
        print("FAIL %d block(s) overflow their parent horizontally" % len(problems))
        for rel, sel, pct, total, why in problems:
            print("       %-34s %-26s %s" % (rel, sel, why))
        print()
        print("In Panorama, width:100% is 100% of the parent's CONTENT box; horizontal")
        print("margins are added on top. Use width: fill-parent-flow( 1.0 ), which")
        print("subtracts the margin first. A block that overflows puts a horizontal")
        print("scrollbar under the report and clips the last column.")
        return 1

    print("OK   no percentage-width block overflows its parent")
    return 0


if __name__ == "__main__":
    sys.exit(main())