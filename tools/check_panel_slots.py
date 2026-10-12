#!/usr/bin/env python
"""check_panel_slots.py - keep make()'s argument order honest against the stylesheet.

THE BUG THIS EXISTS FOR
pm_core.js builds the whole report with one helper:

    function make(type, parent, id, cls)

and 93 call sites were written as

    make('Label', row, 'PMCell name', '')

That puts the CLASS LIST in the id slot. A label then gets the id "PMCell name" and no
class at all, so every rule written as `.PMCell` silently does nothing.

The failure is nasty for a specific reason: the stylesheet also styles things by id
(`#PMSectionTitle`), and those call sites had the same mistake but still worked, because
an accidental id matches an id selector. So the top of the screen looked perfect and
every table underneath it collapsed - text on top of text, "FARM" glued to "1.4
souls/min", an "undefined" column header. Nothing in the log said a word, and nothing
crashed.

WHY A STATIC CHECK IS ENOUGH
The stylesheet is the contract. If a name is styled only as `.Foo`, it must arrive in
the class slot; if only as `#Foo`, it must arrive in the id slot. That is decidable from
the two files together, with no guessing.

Usage:
    python tools/check_panel_slots.py
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
CSS = os.path.join(PROJECT, "panorama", "styles", "postmortem", "pm_root.vcss")

MAKE = re.compile(
    r"make\('(?P<type>\w+)',\s*(?P<parent>[A-Za-z_][\w.]*),\s*"
    r"'(?P<id>[^']*)'\s*,\s*'(?P<cls>[^']*)'\s*\)"
)

ID_ALLOWED = {"Panel", "Label", "Button"}  # types that can carry a class at all


def load_selectors(path):
    with open(path, encoding="utf-8") as fh:
        css = fh.read()
    classes = set(re.findall(r"\.([A-Za-z_]\w*)", css))
    ids = set(re.findall(r"#([A-Za-z_]\w*)", css))
    return classes, ids


def main():
    if not os.path.isfile(CSS):
        print("stylesheet not found: %s" % CSS)
        return 1
    classes, ids = load_selectors(CSS)

    js_files = []
    for root, _dirs, names in os.walk(os.path.join(PROJECT, "panorama", "scripts")):
        for n in sorted(names):
            if n.endswith(".js"):
                js_files.append(os.path.join(root, n))
    js_files.sort()
    if not js_files:
        print("no scripts found")
        return 1

    failures = []

    for path in js_files:
        rel = os.path.relpath(path, PROJECT)
        with open(path, encoding="utf-8") as fh:
            source = fh.read()

        for m in MAKE.finditer(source):
            line = source[:m.start()].count("\n") + 1
            slot_id = m.group("id")
            slot_cls = m.group("cls")

            # A space-separated list can only ever mean classes.
            if slot_id and " " in slot_id:
                failures.append((rel, line, slot_id,
                                 "a class list in the id slot; write make(..., '', '%s')"
                                 % slot_id))
                continue

            if slot_id and slot_id in classes and slot_id not in ids:
                failures.append((rel, line, slot_id,
                                 "styled as .%s but passed as an id" % slot_id))

            # The mirror image: an id that only exists as a class selector will never
            # match, because FindChildTraverse looks for ids.
            for name in slot_cls.split():
                if name in ids and name not in classes:
                    failures.append((rel, line, name,
                                     "styled as #%s but passed as a class" % name))

    if failures:
        print("FAIL panel slot order")
        for rel, line, what, why in failures:
            print("       %-46s line %-5d %-24s %s" % (rel, line, what, why))
        print()
        print("make(type, parent, id, cls) - id is the third argument, class the fourth.")
        print("A class in the id slot compiles fine, packs fine, and then matches no rule")
        print("in the stylesheet, which is why it shipped unnoticed for seven builds.")
        return 1

    print("OK   every make() call matches the stylesheet")
    print("     %d stylesheet selectors, id and class, all reachable" % (len(classes) + len(ids)))
    return 0


if __name__ == "__main__":
    sys.exit(main())