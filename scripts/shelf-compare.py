#!/usr/bin/env python3
"""Optischer Abgleich der Regalansicht mit den Referenzfotos (Prompt 015, Tests).

Rendert die Attrappe `prompts/…/015-shelf-mock.html` (dasselbe CSS wie die App) mit Chromium in
der Szene von `img_2.png` (768 × 1024, Kopf 64 px, 3 Bücher ohne Cover + 1 Cover) bzw. `img.png`
(1024 × 768), oder nimmt mit `--shot` einen Screenshot der echten App, und vergleicht:

  * Geometrie: Seitenwand-Kante, Oberkante/Vorderkante/Schattenbeginn der Böden, Bücher (± 2 px)
  * Farben an den Messpunkten der Tabelle (ΔE00 ≤ 8)

Ausgabe: Tabelle auf stdout (Exit 1 bei Abweichung) und `<out>/compare-768.png` bzw.
`compare-1024.png` (links Foto, rechts Attrappe).

Aufruf (Repo-Wurzel; Pillow, numpy, Python-Playwright – nur Entwicklung):
  python3 scripts/shelf-compare.py [--out DIR] [--shot app-768.png]
"""

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def find(name: str) -> Path:
    for d in ('prompts/done/015-screenshots', 'prompts'):
        p = ROOT / d / name
        if p.exists():
            return p
    raise SystemExit(f'{name} nicht gefunden')


def mock_path() -> Path:
    for d in ('prompts/done', 'prompts'):
        p = ROOT / d / '015-shelf-mock.html'
        if p.exists():
            return p
    raise SystemExit('015-shelf-mock.html nicht gefunden')


# ---- Farbabstand (CIEDE2000) ----
def srgb_to_lab(c):
    def lin(u):
        u /= 255
        return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(float(x)) for x in c)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116

    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


def de2000(c1, c2):
    L1, a1, b1 = srgb_to_lab(c1)
    L2, a2, b2 = srgb_to_lab(c2)
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cm**7 / (Cm**7 + 25**7)))
    a1p, a2p = a1 * (1 + G), a2 * (1 + G)
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    if C1p * C2p == 0:
        dh = 0
    elif dh > 180:
        dh -= 360
    elif dh < -180:
        dh += 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lm, Cmp = (L1 + L2) / 2, (C1p + C2p) / 2
    hm = h1p + h2p
    if C1p * C2p != 0:
        hm = (h1p + h2p + 360) / 2 if abs(h1p - h2p) > 180 else (h1p + h2p) / 2
    T = (1 - 0.17 * math.cos(math.radians(hm - 30)) + 0.24 * math.cos(math.radians(2 * hm))
         + 0.32 * math.cos(math.radians(3 * hm + 6)) - 0.20 * math.cos(math.radians(4 * hm - 63)))
    dtheta = 30 * math.exp(-(((hm - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cmp**7 / (Cmp**7 + 25**7))
    Sl = 1 + 0.015 * (Lm - 50) ** 2 / math.sqrt(20 + (Lm - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cmp, 1 + 0.015 * Cmp * T
    Rt = -math.sin(math.radians(2 * dtheta)) * Rc
    return math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def avg(im: Image.Image, x: int, y: int, r: int = 2):
    a = np.asarray(im.crop((x - r, y - r, x + r + 1, y + r + 1)).convert('RGB'), float)
    return tuple(a.reshape(-1, 3).mean(0))


# Messpunkte in img_2 (x, y, Name) – y in Fach 2 (Boden bei 419–446, Schatten ab 447)
POINTS_768 = [
    (384, 330, 'Rückwand Mitte'),
    (40, 330, 'Rückwand an der Seitenwand'),
    (96, 330, 'Rückwand 66 px von der Wand'),
    (160, 330, 'Rückwand 130 px von der Wand'),
    (15, 330, 'Seitenwand links'),
    (752, 330, 'Seitenwand rechts'),
    (384, 451, 'Schatten +3 px'),
    (384, 461, 'Schatten +14 px'),
    (384, 481, 'Schatten +34 px'),
    (384, 424, 'Boden Oberseite'),
    (384, 434, 'Vorderkante oben'),
    (384, 443, 'Vorderkante unten'),
    (15, 438, 'Vorderkante über der Seitenwand'),
    (90, 160, 'Buch ohne Cover (Leinen)'),
]


def edges(im: Image.Image, x: int, y0: int, y1: int):
    """Sprünge der Helligkeit entlang einer Senkrechten (für die Lage der Böden)."""
    a = np.asarray(im.convert('L').crop((x, y0, x + 1, y1)), float).ravel()
    d = np.diff(a)
    return [(y0 + i + 1, round(v)) for i, v in enumerate(d) if abs(v) > 45]


def render(url: str, w: int, h: int, out: Path) -> Image.Image:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
        page.goto(url)
        page.wait_for_function("document.title === 'ready'")
        page.wait_for_timeout(300)
        page.screenshot(path=str(out))
        b.close()
    return Image.open(out).convert('RGB')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'tmp-shelf'))
    ap.add_argument('--shot', help='Screenshot der App (768 × 1024) statt der Attrappe')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    mock = mock_path().as_uri()

    ok = True
    ref = Image.open(find('img_2.png')).convert('RGB')
    test = (Image.open(args.shot).convert('RGB') if args.shot
            else render(f'{mock}?w=768&h=1024&top=64&books=4&blank=3&bar=0', 768, 1024, out / 'mock-768.png'))
    print('Farben (img_2 → Attrappe), ΔE00 ≤ 8:')
    for x, y, name in POINTS_768:
        a, b = avg(ref, x, y), avg(test, x, y)
        d = de2000(a, b)
        flag = 'ok ' if d <= 8 else 'FEHLT'
        ok &= d <= 8
        hx = lambda c: '#%02x%02x%02x' % tuple(round(v) for v in c)
        print(f'  {flag} {name:34} {hx(a)} {hx(b)}  ΔE {d:5.1f}')
    print('Kanten senkrecht bei x=384 (y 380–520) und x=137 (y 60–260, Buchrand), ± 2 px:')
    for x, y0, y1 in ((384, 380, 520), (137, 60, 260)):
        er = [y for y, _ in edges(ref, x, y0, y1)]
        et = [y for y, _ in edges(test, x, y0, y1)]
        good = len(er) == len(et) and all(abs(p - q) <= 2 for p, q in zip(er, et))
        ok &= good
        print(f"  {'ok ' if good else 'FEHLT'} x={x}: Foto {er}  Test {et}")
    print('Kanten waagrecht bei y=160 (Seitenwand, Bücher), ± 2 px:')
    er = [x for x, _ in edges(ref.transpose(Image.Transpose.TRANSPOSE), 160, 0, 768)]
    et = [x for x, _ in edges(test.transpose(Image.Transpose.TRANSPOSE), 160, 0, 768)]
    print(f'  Foto {er}\n  Test {et}')

    side = Image.new('RGB', (768 * 2 + 16, 1024), '#202020')
    side.paste(ref, (0, 0))
    side.paste(test, (768 + 16, 0))
    side.save(out / 'compare-768.png')

    if not args.shot:
        ref2 = Image.open(find('img.png')).convert('RGB')
        test2 = render(f'{mock}?w=1024&h=768&top=64&books=21&blank=3&bar=0', 1024, 768, out / 'mock-1024.png')
        side = Image.new('RGB', (1024, 768 * 2 + 16), '#202020')
        side.paste(ref2, (0, 0))
        side.paste(test2, (0, 768 + 16))
        side.save(out / 'compare-1024.png')
    print('Bilder:', out)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
