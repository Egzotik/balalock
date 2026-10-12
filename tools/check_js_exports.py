#!/usr/bin/env python
"""check_js_exports.py - every PM.<Module>.<key> read must exist as an exported key.

THE BUG THIS EXISTS FOR
Modules publish their API as one object:

    PM.Compat = { check: checkHost, childById: compatChildById, valid: compatValid };

and other modules read it as `PM.Compat.valid(...)`. If a rename moves the FUNCTION and
takes the KEY with it - `compatValid: compatValid` - every reader of `PM.Compat.valid` gets
undefined and calls it.

What that cost in build 10: detectHost() called PM.Compat.valid, threw, and boot() died
before it could set state.host. The overlay still appeared, because openOverlay() builds
it lazily when the button is pressed. So the user got a complete-looking screen - every
section title, every column header, all of it - with no data anywhere in it, and the only
trace was one exception with an empty message at the end of a 3 MB log.

This is the same shape of failure as the original PM.Compat incident, twice over, and both
times the symptom was silence. So it is a gate.

Usage:
    python tools/check_js_exports.py
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
JS_DIR = os.path.join(PROJECT, "panorama", "scripts")

EXPORT = re.compile(r"PM\.(\w+)\s*=\s*\{")
KEY = re.compile(r"(?m)^\s*([A-Za-z_$][\w$]*)\s*:")
# A read: PM.Foo.bar, not an assignment and not a declaration.
READ = re.compile(r"PM\.(\w+)\.(\w+)(?!\s*(?:=|\+\+|--))")


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
        print("no scripts found")
        return 1

    sources = {}
    for path in files:
        with open(path, encoding="utf-8") as fh:
            sources[os.path.relpath(path, PROJECT)] = code_only(fh.read())

    # Published API per module.
    #
    # The object body is extracted by counting braces, not by regex: several modules
    # export an inline function (`dataUrlLength: function () { ... }`) and a regex that
    # stops at the first "}" sees only the keys before it.
    exported = {}
    publishers = {}
    for rel, src in sources.items():
        for m in EXPORT.finditer(src):
            mod = m.group(1)
            depth = 0
            end = None
            for idx in range(m.end() - 1, len(src)):
                ch = src[idx]
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        end = idx
                        break
            if end is None:
                continue
            for k in KEY.findall(src[m.end():end]):
                exported.setdefault(mod, set()).add(k)
                publishers.setdefault(mod, set()).add(rel)

    problems = []
    total_refs = 0
    for rel, src in sources.items():
        for m in READ.finditer(src):
            mod, key = m.group(1), m.group(2)
            total_refs += 1
            if mod not in exported:
                # Read before the module was published, or a typo in the module name.
                # Reported, because a read of a module nobody defines is never right.
                problems.append((rel, "PM.%s" % mod,
                                 "no module publishes this name"))
                continue
            if key not in exported[mod]:
                problems.append((rel, "PM.%s.%s" % (mod, key),
                                 "not exported; %s publishes %s"
                                 % (", ".join(sorted(publishers[mod])),
                                    ", ".join(sorted(exported[mod])))))

    if problems:
        print("FAIL %d cross-module reference(s) do not resolve" % len(problems))
        for rel, what, why in problems:
            print("       %-40s %-18s %s" % (rel, what, why))
        print()
        print("A rename that moves the function but not the object key leaves every")
        print("reader calling undefined, with no error at the point of definition.")
        return 1

    print("OK   %d cross-module references resolve against %d published modules"
          % (total_refs, len(exported)))
    for mod in sorted(exported):
        print("       PM.%-10s %d keys" % (mod, len(exported[mod])))
    return 0


if __name__ == "__main__":
    sys.exit(main())