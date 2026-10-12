#!/usr/bin/env python
"""check_js_namespace.py — catch the bug that killed builds 1-5.

THE BUG
Panorama scripts share state through `$.PM`. A module must CREATE its own slot:

    PM.Data = { ... };          // fine
    PM.Compat.check = fn;       // TypeError at load time

The second form assigns into `PM.Compat`, which is `undefined` until something assigns
it, so the whole file is skipped when Panorama loads it and the failure surfaces only in
the game log as

    JS Exception! *** Skipping rest of script ***
    >> PM.Compat.check = checkHost;
    Uncaught TypeError: Cannot set properties of undefined (setting 'check')

That cost five in-game runs. `pm_data.js` and `pm_net.js` kept working the whole time
because they assign the slot wholesale, which made the failure look like a namespace
problem when it was not — it was a missing object.

WHY A STATIC CHECK IS ENOUGH
This is a purely local pattern: within one file, a write to `NS.Slot.field` is only safe
if that same file also writes `NS.Slot` directly. No cross-file reasoning needed.

It does NOT replace running the game. It replaces losing a build to a one-line mistake.

Usage:
    python tools/check_js_namespace.py
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
JS_DIR = os.path.join(PROJECT, "panorama", "scripts", "postmortem")

# PM.Foo = ...          -> the slot is created
CREATE = re.compile(r"\bPM\.(?P<slot>[A-Za-z_]\w*)\s*=(?!=)")
# PM.Foo.bar = ...      -> a field WRITE. This is the exact shape of the bug.
#    (must exclude ==, and must be an assignment, not a read like PM.Data.readPostGame)
WRITE_FIELD = re.compile(
    r"\bPM\.(?P<slot>[A-Za-z_]\w*)\.(?P<field>[A-Za-z_]\w*)\s*=(?!=)"
)

# Slots created by another file in this project. Reading them is legitimate; writing a
# field on them from the wrong file is what this linter is for.
CROSS_FILE = {"Data", "Compat", "Probe", "Net"}


def strip_code(text):
    """Remove comments and string literals so examples in prose are not flagged."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            while i < n and text[i] != "\n":
                i += 1
        elif c == "/" and nxt == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
        elif c in "'\"":
            quote = c
            i += 1
            while i < n and text[i] != quote:
                if text[i] == "\\":
                    i += 1
                i += 1
            i += 1
            out.append('""')
        else:
            out.append(c)
            i += 1
    return "".join(out)


def check(path):
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    code = strip_code(raw)

    created = set(m.group("slot") for m in CREATE.finditer(code))
    problems = []

    # Only field WRITES matter. Reading PM.Data.readPostGame() from pm_core.js is
    # correct: pm_data.js created the slot. Writing PM.Probe.run from a file that does
    # not create PM.Probe is the defect that skipped whole files at load.
    for m in WRITE_FIELD.finditer(code):
        slot, field = m.group("slot"), m.group("field")
        if slot in created:
            continue
        line = code[:m.start()].count("\n") + 1
        problems.append((
            line,
            "PM.%s.%s =" % (slot, field),
            "writes a field on PM.%s, which this file never creates" % slot,
        ))

    return sorted(set(problems))


def main():
    # Recursive on purpose: a self-test can stage a deliberately broken file in a
    # subdirectory, and a non-recursive walk would silently ignore it - which is exactly
    # how the first version of this linter "passed" while a broken file sat next to it.
    files = []
    for root, _dirs, names in os.walk(JS_DIR):
        for n in sorted(names):
            if n.endswith(".js"):
                files.append(os.path.join(root, n))
    files.sort()
    if not files:
        print("no scripts found under %s" % JS_DIR)
        return 1

    failed = False
    for path in files:
        rel = os.path.relpath(path, PROJECT)
        problems = check(path)
        if problems:
            failed = True
            print("FAIL %s" % rel)
            for line, what, why in problems:
                print("       line %-4d %-28s %s" % (line, what, why))
        else:
            print("OK   %s" % rel)

    if failed:
        print()
        print("A module slot must be CREATED before its fields are written:")
        print("    PM.Probe = { run: run };        // works")
        print("    PM.Probe.run = run;             // TypeError at load, file skipped")
        print()
        print("Cross-module reads are fine: another file may create the slot. Only a")
        print("missing create inside THIS file is a defect.")
        return 1

    print()
    print("Every namespace slot is created before use.")
    return 0


if __name__ == "__main__":
    sys.exit(main())