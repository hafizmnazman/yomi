#!/usr/bin/env python3
"""Regenerate the README art: the ANSI Shadow banner and the info card.

Reads banner.txt (figlet rows) and art.txt (braille art) and writes
banner-dark.svg, banner-light.svg, card-dark.svg and card-light.svg next to
this file. Run it by hand after changing a value below; the SVGs are
committed. Standard library only.
"""
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).parent

# ------------------------------------------------------------------ config

NAME = "YOMI"

THEMES = {
    "dark": {
        "ramp": ["#a6f7e0", "#6fefcb", "#2ed3a6"],
        "glow": 0.55,
        "fg": "#e6edf3", "muted": "#8b949e", "accent": "#2ed3a6", "pos": "#3fb950",
        "bar": ["#d4fbef", "#a6f7e0", "#6fefcb", "#4fe3bb", "#2ed3a6", "#1fae88", "#16876a", "#0f5f4b"],
    },
    "light": {
        "ramp": ["#16a37f", "#0b7a5e", "#0a4f45"],
        "glow": 0,
        "fg": "#1f2328", "muted": "#667085", "accent": "#0b7a5e", "pos": "#1a7f37",
        "bar": ["#c9f5e7", "#93ead0", "#5bd8b3", "#2ec095", "#18a07a", "#0e7f61", "#0a6250", "#0a2528"],
    },
}

PROMPT_USER, PROMPT_CMD = "hafiz@yomi", "./scan --snip"
TAGLINE = "point it at a code, get the link"
# Rows are (label, value) or (label, value, opts). opts may hold
#   "color": {"dark": "#...", "light": "#..."}  label colour for this row
#   "cells": (filled, total)                   a row of small cells after the value
AMBER = {"color": {"dark": "#ffb454", "light": "#a35f00"}}
GROUPS = [
    [
        ("app", "desktop qr reader"),
        ("name", "読み (yomi), reading"),
        ("stack", "tauri 2 · rust · react 19"),
        ("licence", "mit"),
    ],
    [
        ("open", "file, drag-and-drop, folder"),
        ("snip", "freeze the screen, drag a box", AMBER),
        ("clipboard", "read a copied screenshot"),
        ("hotkey", "ctrl+shift+q, rebindable"),
    ],
    [
        ("payloads", "8 kinds, url to vcard"),
        ("history", "last 500 scans, csv export"),
        ("decode", "rqrr, many codes per image"),
        ("version", "0.1.0"),
    ],
]
FOOTER_OK, FOOTER = "[ ok ]", "every code decoded on device"
CARD_LABEL = ("Yomi, a desktop QR reader built with Tauri 2, Rust and React 19: open an image, "
              "snip the screen or read the clipboard; 8 payload kinds, a searchable history of "
              "the last 500 scans, MIT licensed")

# ------------------------------------------------------------------ shared

MONO = "ui-monospace,'SFMono-Regular','SF Mono',Menlo,Consolas,'Liberation Mono',monospace"


def ramp_def(t, y1, y2):
    r = t["ramp"]
    return (f'<linearGradient id="ramp" gradientUnits="userSpaceOnUse" '
            f'x1="0" y1="{y1:.0f}" x2="0" y2="{y2:.0f}">'
            f'<stop offset="0" stop-color="{r[0]}"/>'
            f'<stop offset="0.55" stop-color="{r[1]}"/>'
            f'<stop offset="1" stop-color="{r[2]}"/>'
            "</linearGradient>")

# ------------------------------------------------------------------ banner

BANNER_W = 850
PAD = 24
BANNER_MAX_FS = 18  # short names stay this size and centre instead of filling


def banner(theme, lines):
    t = THEMES[theme]
    rows = len(lines)
    cols = len(lines[0])
    fs = min(round((BANNER_W - 2 * PAD) / (cols * 0.6), 2), BANNER_MAX_FS)
    text_len = round(cols * 0.6 * fs)
    x = round((BANNER_W - text_len) / 2)
    lh = round(fs * 1.062, 2)
    h = round(2 * PAD + fs + (rows - 1) * lh)
    p = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {BANNER_W} {h}" '
        f'width="{BANNER_W}" height="{h}" role="img" aria-label="{escape(NAME)}">',
        "<defs>" + ramp_def(t, PAD, h - PAD),
    ]
    if t["glow"]:
        p.append(
            '<filter id="glow" x="-4%" y="-30%" width="108%" height="160%">'
            '<feGaussianBlur stdDeviation="3" result="b"/>'
            f'<feComponentTransfer in="b" result="g"><feFuncA type="linear" slope="{t["glow"]}"/></feComponentTransfer>'
            '<feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>'
            "</filter>"
        )
    p.append("</defs>")
    p.append(f"<style>text {{ font-family: {MONO}; font-size: {fs}px; "
             "fill: url(#ramp); white-space: pre; }</style>")
    p.append('<g filter="url(#glow)">' if t["glow"] else "<g>")
    for i, line in enumerate(lines):
        y = PAD + fs + i * lh
        p.append(f'<text x="{x}" y="{y:.1f}" textLength="{text_len}" '
                 f'lengthAdjust="spacing" xml:space="preserve">{escape(line)}</text>')
    p.append("</g>")
    p.append("</svg>")
    return "\n".join(p)

# -------------------------------------------------------------------- card

W = 850
GROUP_GAP = 40
LBL_X, VAL_X = 460, 566
# art.txt is braille, 2x4 dots per char. Fonts space braille dots unevenly,
# so each dot is drawn on an even grid instead of as text.
ART_X, DOT_W, DOT_H, DOT_R = 24, 4.05, 4.475, 1.25
BITS = [(0, 0, 0x01), (0, 1, 0x02), (0, 2, 0x04), (1, 0, 0x08),
        (1, 1, 0x10), (1, 2, 0x20), (0, 3, 0x40), (1, 3, 0x80)]


def art_path(art, art_y):
    d = []
    for row, line in enumerate(art):
        for col, ch in enumerate(line):
            code = ord(ch) - 0x2800
            if not 0 <= code <= 0xFF:
                continue
            for dx, dy, bit in BITS:
                if code & bit:
                    x = ART_X + (col * 2 + dx + 0.5) * DOT_W
                    y = art_y + (row * 4 + dy + 0.5) * DOT_H
                    d.append(f"M{x:.1f} {y:.1f}h0")
    return "".join(d)


def text_height():
    rows = sum(len(g) for g in GROUPS)
    return 114 + rows * 20 + len(GROUPS) * GROUP_GAP - 4 + 26


def card(theme, art):
    t = THEMES[theme]
    art_h = len(art) * 4 * DOT_H
    H = round(max(text_height() + 32, art_h + 2 * 40))
    art_y = (H - art_h) / 2
    p = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" '
        f'height="{H}" role="img" aria-label="{escape(CARD_LABEL)}">',
        "<defs>" + ramp_def(t, art_y, art_y + art_h) + "</defs>",
        f"""<style>
    text {{ font-family: {MONO}; }}
    .fg  {{ fill: {t['fg']}; font-size: 14px; }}
    .mut {{ fill: {t['muted']}; font-size: 14px; }}
    .acc {{ fill: {t['accent']}; font-size: 14px; }}
    .pos {{ fill: {t['pos']}; font-size: 14px; }}
    .b   {{ font-weight: 600; }}
    .sm  {{ font-size: 12px; }}
    </style>""",
        f'<path d="{art_path(art, art_y)}" fill="none" stroke="url(#ramp)" '
        f'stroke-width="{2 * DOT_R}" stroke-linecap="round"/>',
        f'<text x="{LBL_X}" y="52" xml:space="preserve"><tspan class="acc b">{escape(PROMPT_USER)}</tspan>'
        f'<tspan class="mut">:~$</tspan><tspan class="fg"> {escape(PROMPT_CMD)}</tspan><tspan class="acc">▊'
        '<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1.2s" '
        'repeatCount="indefinite"/></tspan></text>',
        f'<text class="mut" x="{LBL_X}" y="78" font-style="italic">{escape(TAGLINE)}</text>',
        f'<line x1="{LBL_X}" y1="92" x2="826" y2="92" stroke="{t["muted"]}" '
        'stroke-opacity="0.45" stroke-width="1"/>',
    ]
    y = 114
    for group in GROUPS:
        for row in group:
            k, v = row[0], row[1]
            opts = row[2] if len(row) > 2 else {}
            color = opts.get("color", {}).get(theme)
            style = f' style="fill:{color}"' if color else ""
            p.append(f'<text class="fg" x="{VAL_X}" y="{y}" xml:space="preserve"><tspan class="acc"{style} '
                     f'x="{LBL_X}">{escape(k)}</tspan><tspan x="{VAL_X}">{escape(v)}</tspan></text>')
            if "cells" in opts:
                filled, total = opts["cells"]
                x0 = VAL_X + 8.4 * len(v) + 12
                for c in range(total):
                    fill = t["accent"] if c < filled else t["muted"]
                    p.append(f'<rect x="{x0 + c * 20:.0f}" y="{y - 10}" width="14" height="10" '
                             f'rx="2" fill="{fill}"/>')
            y += 20
        y += GROUP_GAP
    y -= 4
    for i, c in enumerate(t["bar"]):
        p.append(f'<rect x="{LBL_X + i * 22}" y="{y - 10}" width="16" height="10" rx="2" fill="{c}"/>')
    p.append(f'<text class="sm" x="{LBL_X}" y="{y + 26}" xml:space="preserve"><tspan class="pos sm">'
             f'{escape(FOOTER_OK)}</tspan><tspan class="mut sm"> {escape(FOOTER)}</tspan></text>')
    p.append("</svg>")
    return "\n".join(p)


def main():
    lines = (ROOT / "banner.txt").read_text(encoding="utf-8").rstrip("\n").split("\n")
    w = max(len(l) for l in lines)
    lines = [l.ljust(w) for l in lines]
    art = (ROOT / "art.txt").read_text(encoding="utf-8").rstrip("\n").split("\n")
    for theme in THEMES:
        for name, svg in ((f"banner-{theme}.svg", banner(theme, lines)),
                          (f"card-{theme}.svg", card(theme, art))):
            (ROOT / name).write_text(svg, encoding="utf-8", newline="\n")
            print(f"wrote {name}")
    print(f"banner: {w} cols, art: {len(art[0])} x {len(art)}")


if __name__ == "__main__":
    main()
