#!/usr/bin/env python
"""check_js_globals.py - one module-scope name, one file.

THE BUG THIS EXISTS FOR
Panorama gives every script loaded into one panel context a SINGLE shared global scope.
Two files that both declare `function valid()` do not get two functions - the second file
silently overwrites the first, and nothing is logged.

That has now bitten this project three separate ways:

  * `PM.Compat` was assigned field by field in five builds, so a slot nobody had created
    threw and the whole file was skipped at load.
  * pm_data.js declared `var AWARD_CLASSES` as a list of NAMES while pm_analysis.js
    declared the same name as a list of {cls, key} PAIRS. Whichever loaded last won, and
    every team award on the report silently came back empty.
  * pm_net.js and pm_core.js both declared `var state`. pm_net's own state references
    would have started reading the overlay's state object the moment the bridge was
    switched on.

`var PM` is the one deliberate exception: it is the shared namespace every module writes
into, on purpose, and it is the same object in every file.

Usage:
    python tools/check_js_globals.py
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
JS_DIR = os.path.join(PROJECT, "panorama", "scripts")

# Declared on purpose in every module: the shared namespace. See the note above.
ALLOWED = {"PM"}

DECL = re.compile(r"(?m)^(?:var|function)\s+([A-Za-z_$][\w$]*)")


def code_only(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//[^\n]*", "", text)
    text = re.sub(r"'[^']*'", "''", text)
    text = re.sub(r'"[^"]*"', '""', text)
    return text


def main():
    files = []
    for root, _dirs, names in os.walk(JS_DIR):
        for n in sorted(names):
            if n.endswith(".js"):
                files.append(os.path.join(root, n))
    files.sort()
    if not files:
        print("no scripts found under %s" % JS_DIR)
        return 1

    owner = {}
    for path in files:
        with open(path, encoding="utf-8") as fh:
            src = code_only(fh.read())
        rel = os.path.relpath(path, PROJECT)
        for m in DECL.finditer(src):
            name = m.group(1)
            if name in ALLOWED:
                continue
            owner.setdefault(name, []).append(rel)

    clashes = {k: v for k, v in owner.items() if len(v) > 1}

    # The reverse rule: a file may not reach into another file's private helper.
    #
    # Panorama shares one global scope, so `dataLog(...)` in pm_core.js works - it just
    # calls pm_data.js's function across a module boundary, and it keeps working right up
    # until someone renames it. Every name owned by exactly one file is that file's alone.
    leaks = []
    CALL = re.compile(r"(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(")
    BUILTIN = {"if", "for", "while", "switch", "catch", "return", "typeof", "new",
               "function", "else", "do", "try", "throw", "delete", "void", "in",
               "instanceof", "case", "with"}
    for path in files:
        with open(path, encoding="utf-8") as fh:
            src = code_only(fh.read())
        # A named function EXPRESSION declares nothing - `function onTitle(p, t) {...}`
        # is local to its own right-hand side - but it does look like a call to whatever
        # else owns that name. Blank it here only, after the owner map is already built.
        calls_src = re.sub(r"\bfunction\s+[A-Za-z_$][\w$]*\s*\(", "function (", src)
        rel = os.path.relpath(path, PROJECT)
        mine = set()
        for m in DECL.finditer(src):
            mine.add(m.group(1))
        for m in CALL.finditer(calls_src):
            name = m.group(1)
            if name in BUILTIN or name in mine:
                continue
            holders = owner.get(name)
            if holders and len(holders) == 1 and rel not in holders:
                leaks.append((rel, name, list(holders)[0]))

    print("scanned %d scripts, %d module-scope names" %
          (len(files), len(owner) + len(ALLOWED)))

    if not clashes and not leaks:
        print("OK   every module-scope name belongs to exactly one file, and is used there")
        return 0

    failed = False
    if clashes:
        failed = True
        print("FAIL duplicate module-scope names")
        for name, files_for in sorted(clashes.items()):
            print("       %-24s %s" % (name, ", ".join(sorted(files_for))))
    if leaks:
        failed = True
        print("FAIL cross-module use of a private helper")
        seen = set()
        for rel, name, holder in sorted(leaks):
            key = (rel, name)
            if key in seen:
                continue
            seen.add(key)
            print("       %-40s uses %-18s owned by %s" % (rel, name, holder))
    if failed:
        print()
        print("Panorama gives every script in one context the same global scope, so a")
        print("name declared in two files is not merged - it is overwritten, silently, by")
        print("whichever loads last, and a name owned by one file can be called from")
        print("another right up until someone renames it. Prefix the helper with its")
        print("module, or publish it on $.PM as an exported member.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())