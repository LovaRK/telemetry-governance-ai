#!/usr/bin/env python3
"""
Convert a PowerShell script to be Windows PowerShell 5.1-safe:
  - Map Unicode box-drawing / dash / quote characters to ASCII equivalents
    (renders reliably on any Windows console codepage; avoids mojibake '?').
  - Write with a UTF-8 BOM and CRLF line endings (PS5.1 reads this correctly;
    a missing BOM caused em dashes to break parsing).

Usage:  python3 fix_ps1.py <src.ps1> <dest.ps1>

The repo copy of install.ps1 keeps the pretty Unicode banners; this produces
the ASCII-clean copy that ships inside the Windows zip.
"""
import sys

MAP = {
    "═": "=",   # ═
    "─": "-",   # ─
    "—": "--",  # — em dash
    "–": "-",   # – en dash
    "║": "|",   # ║
    "╔": "+",   # ╔
    "╗": "+",   # ╗
    "╚": "+",   # ╚
    "╝": "+",   # ╝
    "‘": "'",   # ‘
    "’": "'",   # ’
    "“": '"',   # “
    "”": '"',   # ”
    "•": "*",   # •
    "→": "->",  # →
    "✓": "OK",  # ✓
    "✗": "x",   # ✗
    "⚠": "!",   # ⚠
    " ": " ",   # non-breaking space
}


def main():
    if len(sys.argv) != 3:
        print("usage: fix_ps1.py <src.ps1> <dest.ps1>", file=sys.stderr)
        sys.exit(2)
    src, dest = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        c = f.read()
    for k, v in MAP.items():
        c = c.replace(k, v)
    # Any remaining non-ASCII -> '?' so nothing can break the PS5.1 parser.
    remaining = sum(1 for ch in c if ord(ch) > 127)
    c = "".join(ch if ord(ch) <= 127 else "?" for ch in c)
    print("Non-ASCII remaining:", remaining)
    with open(dest, "w", encoding="utf-8-sig", newline="\r\n") as f:
        f.write(c)


if __name__ == "__main__":
    main()
