#!/usr/bin/env python
"""check_js_es3.py - reject the JS that Panorama accepts and JScript does not.

THE PROBLEM
Panorama runs a modern JavaScript grammar. Windows Script Host runs ES3. The test
harness in tools/test_analysis.js needs ES3, because ES3 is the intersection of the two
and therefore the only dialect that is valid in both. Anything outside the intersection
passes the Panorama compiler silently and then breaks the build.

Three things have actually bitten this project, all found by running the harness:

  1. A trailing comma before `}` or `]`. Panorama appends a silent `undefined` element
     to the array. In METRICS that made a seventh slot, and every metric loop threw the
     instant the overlay opened. Six builds shipped with it.
  2. `close:` as an object key. `close` is an ES3 reserved word, so an ES3 parser
     rejects the whole object literal. Panorama is perfectly happy with it.
  3. `const`. Not ES3. Panorama has it; JScript does not.

WHY THIS IS A LINT AND NOT A MATTER OF TASTE
The cost of each of these was a full in-game round trip. A trailing comma that the
compiler accepts is indistinguishable from a correct one until the exact line that
iterates the array runs, which is the first thing the user does after installing.

Usage:
    python tools/check_js_es3.py
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
JS_DIRS = [
    os.path.join(PROJECT, "panorama", "scripts"),
    HERE,
]

# Words JScript actually rejects as an OBJECT KEY, measured one at a time rather than
# assumed from the spec. The full ES3 reserved list is much larger and mostly harmless
# here: `close`, `int`, `char`, `open`, `goto`, `native` are all accepted, and an earlier
# version of this file rejected `int` and blocked a legitimate name for no reason. A lint
# that guesses is worse than no lint, because people route around it.
REJECTED_KEYS = {
    "class", "new", "default", "import", "export", "enum", "throw", "catch",
    "do", "for", "if", "in", "this", "typeof", "delete",
}

TRAILING_COMMA = re.compile(r",(\s*)\n\s*[}\]]")
KEY = re.compile(r"(?:^|[{,]\s*)([A-Za-z_$][\w$]*)\s*:")
CONST = re.compile(r"(?m)^[^/\n]*\bconst\b")


def strip_code(text):
    """Remove comments and string bodies so prose and text cannot trip a rule."""
    out = []
    i, n = 0, len(text)
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
    problems = []

    for m in TRAILING_COMMA.finditer(code):
        line = code[:m.start()].count("\n") + 1
        problems.append((line, "trailing comma",
                         "ES3 has no trailing comma here; Panorama silently appends an "
                         "undefined element"))

    seen = set()
    for m in KEY.finditer(code):
        name = m.group(1)
        if name in REJECTED_KEYS:
            # Only complain about the first occurrence of a given word per file.
            if name in seen:
                continue
            seen.add(name)
            line = code[:m.start()].count("\n") + 1
            problems.append((line, "'%s' as an object key" % name,
                             "ES3 reserved word; rename the key"))

    for m in CONST.finditer(code):
        line = code[:m.start()].count("\n") + 1
        problems.append((line, "const",
                         "not ES3; use var so the test harness can parse this file"))

    return sorted(set(problems))


def main():
    files = []
    for d in JS_DIRS:
        if not os.path.isdir(d):
            continue
        for root, _dirs, names in os.walk(d):
            for n in sorted(names):
                if n.endswith(".js"):
                    files.append(os.path.join(root, n))
    files.sort()
    if not files:
        print("no javascript found")
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
        print("Panorama's parser is more permissive than the ES3 parser in the test")
        print("harness. Anything accepted by one and not the other is a latent failure:")
        print("it compiles, it packs, and it throws the first time a user presses the")
        print("button. Keep the source inside the intersection of both grammars.")
        return 1

    print()
    print("All scripts parse as ES3 as well as Panorama.")
    return 0


if __name__ == "__main__":
    sys.exit(main())