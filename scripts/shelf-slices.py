#!/usr/bin/env python3
"""Holz-Fragmente der Regalansicht (Prompt 015, Design E3) aus `Bookshelf.psd`.

Die PSD (Quelle von `img_3.png`; Tutorial „Create an iBook Inspired Bookshelf Mock-up“, Naldz Graphics,
https://naldzgraphics.net/how-to-create-an-ibook/) enthält die rohe Holztextur als Smart-Objekt (ohne
eingebackenes Licht). Aus der Textur kommt nur die *Maserung*: Helligkeit
geteilt durch ihr weiches Mittel (Detail-Verhältnis um 1.0), Kontrast auf die iBooks-Fotos
(`img_2.png`) gebracht und auf die dort *gemessenen Farben* gelegt. So stimmen Farben und Maße mit
dem Zielbild, die Holzstruktur ist echt. Kanten werden überblendet, damit die Kacheln nahtlos sind.

Ausgabe (2x-Auflösung, in CSS halb so groß gezeichnet), `src/assets/shelf/`:
  wall.webp         Rückwand, kachelbar in x und y                     (CSS: 326 × 426 px)
  board.webp        Boden: 12 px Oberseite + 16 px Vorderkante, quer    (CSS: 526 × 28 px, repeat-x)
  upright.webp      Seitenwand links (rechts gespiegelt), kachelbar in y (CSS: 30 × 426 px)

Aufruf (Repo-Wurzel; Pillow, numpy, psd-tools – nur Entwicklung):
  python3 scripts/shelf-slices.py [pfad/zu/Bookshelf.psd]
Reproduzierbar: feste Koordinaten, keine Zufallszahlen.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parent.parent
SRC_CANDIDATES = [
    ROOT / 'prompts/done/015-screenshots/Bookshelf.psd',
    ROOT / 'prompts/Bookshelf.psd',
]
OUT = ROOT / 'src/assets/shelf'
OVERLAP = 48

# Kontrast der Maserung im Zielbild img_2.png (Standardabweichung des Detail-Verhältnisses)
TARGET_STD = {'wall': 0.024, 'planks': 0.032, 'front': 0.037, 'top': 0.03, 'upright': 0.045}


def hexrgb(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], float)


def lerp_profile(stops: list[tuple[float, str]], n: int) -> np.ndarray:
    """Farbe je Index 0…n-1 aus Stützstellen (Position 0…1, Farbe) – linear."""
    pos = np.array([p for p, _ in stops])
    cols = np.array([hexrgb(c) for _, c in stops])
    t = (np.arange(n) + 0.5) / n
    return np.stack([np.interp(t, pos, cols[:, k]) for k in range(3)], axis=1)


def detail(img: Image.Image, blur_x: float, blur_y: float, target_std: float) -> np.ndarray:
    """Helligkeit / weiches Mittel → Verhältnis um 1, Kontrast auf `target_std` gebracht."""
    lum = img.convert('L')
    a = np.asarray(lum, float)
    low = lum
    w, h = lum.size
    if blur_x:
        low = low.resize((max(1, int(w / blur_x)), h), Image.BILINEAR).resize((w, h), Image.BILINEAR)
    if blur_y:
        low = low.resize((w, max(1, int(h / blur_y))), Image.BILINEAR).resize((w, h), Image.BILINEAR)
    low = low.filter(ImageFilter.GaussianBlur(2))
    r = a / np.maximum(np.asarray(low, float), 1)
    return 1 + (r - 1) * (target_std / max(1e-6, float(r.std())))


def seamless_x(a: np.ndarray, overlap: int = OVERLAP) -> np.ndarray:
    """Letzte `overlap` Spalten in die ersten überblenden und abschneiden → kachelbar in x."""
    w = a.shape[1] - overlap
    out = a[:, :w].copy()
    t = np.linspace(0, 1, overlap)[None, :, None]
    out[:, :overlap] = a[:, w:] * (1 - t) + a[:, :overlap] * t
    return out


def seamless_y(a: np.ndarray, overlap: int = OVERLAP) -> np.ndarray:
    return np.swapaxes(seamless_x(np.swapaxes(a, 0, 1), overlap), 0, 1)


def save(a: np.ndarray, name: str, mode: str = 'RGB') -> None:
    img = Image.fromarray(np.clip(a, 0, 255).round().astype(np.uint8), mode)
    path = OUT / name
    img.save(path, 'WEBP', quality=90, method=6)
    print(f'{name}: {img.size[0]}×{img.size[1]}, {path.stat().st_size // 1024} KiB')


def smart_object(psd: PSDImage, filename: str) -> Image.Image:
    for layer in psd.descendants():
        if layer.kind == 'smartobject' and layer.smart_object.filename == filename:
            tmp = OUT / f'.{filename}'
            tmp.write_bytes(layer.smart_object.data)
            try:
                return PSDImage.open(tmp).composite()
            finally:
                tmp.unlink()
    raise SystemExit(f'Smart-Objekt {filename} fehlt in der PSD')


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else next(p for p in SRC_CANDIDATES if p.exists())
    psd = PSDImage.open(src)
    assert psd.size == (800, 1100), f'unerwartete PSD {psd.size}'
    OUT.mkdir(parents=True, exist_ok=True)
    wood = smart_object(psd, 'wood (right).psb').convert('RGB')  # 800 × 1100, Maserung senkrecht
    assert wood.size == (800, 1100)

    # Rückwand: großes Stück (seltene Wiederholung), Farbe = Mitte der Rückwand in img_2
    wall = wood.crop((40, 60, 40 + 652 + OVERLAP, 60 + 852 + OVERLAP))
    d = detail(wall, 40, 40, TARGET_STD['wall'])
    # breite helle/dunkle Bahnen quer (Bretter): Spaltenmittel gegen ein weites gleitendes Mittel
    col = np.asarray(wall.convert('L'), float).mean(0)
    pad = np.pad(col, 300, mode='reflect')
    band = col / np.convolve(pad, np.ones(601) / 601, 'same')[300:-300]
    band = 1 + (band - 1) * (TARGET_STD['planks'] / max(1e-6, float(band.std())))
    d = d * band[None, :]
    save(seamless_y(seamless_x(hexrgb('#caa061')[None, None, :] * d[:, :, None])), 'wall.webp')

    # Boden: die Maserung quer (Textur gedreht), Oberseite 24 + Vorderkante 32 Zeilen (2x),
    # je Zeile die in img_2 bei x=384 (y 419–446) gemessene Farbe
    across = wood.rotate(90, expand=True)  # 1100 × 800
    width = 1052 + OVERLAP
    top = across.crop((0, 200, width, 260)).resize((width, 24), Image.BICUBIC)
    front = across.crop((0, 500, width, 580)).resize((width, 32), Image.BICUBIC)
    top_stops = ['#73491c', '#855a2f', '#8f6538', '#986c3b', '#9a6e3b', '#9e723d', '#a57944',
                 '#aa814b', '#b08952', '#b59159', '#b08e55', '#bc9d61']
    front_stops = ['#ffe4a8', '#f6d99c', '#fce4a8', '#fbe4ac', '#f5dca3', '#f4d695', '#f0cf8d',
                   '#f3d496', '#edd093', '#e9cc90', '#e7c88c', '#e7c58c', '#e5c489', '#e3c282',
                   '#e0be83', '#c7a378']
    prof_top = np.repeat(np.array([hexrgb(c) for c in top_stops]), 2, axis=0)
    prof_front = np.repeat(np.array([hexrgb(c) for c in front_stops]), 2, axis=0)
    board = np.concatenate([
        prof_top[:, None, :] * detail(top, 40, 0, TARGET_STD['top'])[:, :, None],
        prof_front[:, None, :] * detail(front, 40, 0, TARGET_STD['front'])[:, :, None],
    ], axis=0)
    save(seamless_x(board), 'board.webp')

    # Seitenwand: Profil quer aus img_2 (y=330, x 0–30: außen hell → innen dunkel, 1 px Kante)
    up = wood.crop((700, 60, 760, 60 + 852 + OVERLAP))
    prof = lerp_profile([(0.0, '#7a4b1f'), (0.2, '#75451d'), (0.45, '#6f411a'), (0.6, '#683c14'),
                         (0.75, '#613210'), (0.9, '#552e0b'), (0.965, '#4b2804'), (1.0, '#4b2804')], 60)
    save(seamless_y(prof[None, :, :] * detail(up, 0, 40, TARGET_STD['upright'])[:, :, None]), 'upright.webp')


if __name__ == '__main__':
    main()
