#!/usr/bin/env python
"""make_ascii.py - rewrite a source file as pure ASCII, via a temp file.

cscript reads ITS OWN script as ANSI, so every Cyrillic literal in tools/test_analysis.js
is lost before the parser sees it and can never match the UTF-8 sources it loads. The file
therefore has to be written with \\uXXXX escapes.

Two earlier patch scripts wrote this file with open(path, "w") and raised UnicodeEncodeError
ON THE WRITE - which truncates the file first. It was destroyed twice that way, and the
lesson is the reason this exists: escape BEFORE opening, write to a temp file, and replace
atomically, so a failure can never leave a half-written file behind.

Usage:
    python tools/make_ascii.py tools/test_analysis.js
"""

import os
import sys


def to_ascii(text):
    out = []
    for ch in text:
        o = ord(ch)
        if o < 128 or ch in "\n\r\t":
            out.append(ch)
        else:
            out.append("\\u%04x" % o)
    return "".join(out)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    for path in sys.argv[1:]:
        if not os.path.isfile(path):
            print("not found: %s" % path)
            return 1
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
        ascii_text = to_ascii(raw)
        if ascii_text == raw:
            print("%s: already pure ASCII" % path)
            continue
        tmp = path + ".ascii.tmp"
        with open(tmp, "w", encoding="ascii", newline="") as fh:
            fh.write(ascii_text)
        os.replace(tmp, path)
        print("%s: %d chars -> %d bytes ASCII" % (path, len(raw), len(ascii_text)))
    return 0


if __name__ == "__main__":
    sys.exit(main())