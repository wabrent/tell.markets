"""X (Twitter) avatar and banner for Tell, in the site's style.

Usage: python -I scripts/brand.py <fonts dir> <out dir>
Fonts dir needs InstrumentSerif-Regular.ttf, InstrumentSerif-Italic.ttf and JetBrainsMono.ttf
(all from github.com/google/fonts, OFL). The statue comes from web/assets/statue.webp.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
ROOT = Path(__file__).resolve().parent.parent
STATUE = Image.open(ROOT / 'web' / 'assets' / 'statue.webp').convert('RGBA')

RED = (142, 12, 20)
RED_DEEP = (92, 7, 12)
CREAM = (236, 233, 226)
WHITE = (255, 255, 255)
INK = (11, 11, 12)
ACCENT = (255, 90, 95)
SS = 2  # supersample, then downscale for clean edges


def font(name, size, variation=None):
    f = ImageFont.truetype(str(FONTS / name), size)
    if variation:
        try:
            f.set_variation_by_name(variation)
        except Exception:
            pass
    return f


def red_field(w, h, glow=(0.75, 0.4)):
    """The hero background: red, a brighter glow, a deep corner, and paper grain."""
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    gx, gy = glow
    d1 = np.sqrt(((xx / w - gx) / 0.9) ** 2 + ((yy / h - gy) / 0.7) ** 2)
    d2 = np.sqrt(((xx / w - 0.15) / 1.1) ** 2 + ((yy / h - 1.0) / 1.0) ** 2)
    base = np.array(RED, float)
    img = np.ones((h, w, 3)) * base
    img += (np.clip(1 - d1, 0, 1) ** 2)[..., None] * np.array([60, 12, 12])
    img = img * (1 - (np.clip(1 - d2, 0, 1) ** 1.5)[..., None] * 0.45) + (np.clip(1 - d2, 0, 1) ** 1.5)[..., None] * 0.45 * np.array(RED_DEEP)
    rng = np.random.default_rng(7)
    grain = rng.normal(0, 7, (h, w))
    img += grain[..., None]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def draw_runs(draw, xy, runs, fill):
    """Draws [(text, font), ...] on one line, left to right."""
    x, y = xy
    for text, f in runs:
        draw.text((x, y), text, font=f, fill=fill)
        x += draw.textlength(text, font=f)
    return x


def spaced(draw, xy, text, f, fill, tracking):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking
    return x


# ---------------- Avatar: the face with its eyes "redacted" by a TELL bar ----------------
def avatar():
    S = 400 * SS
    img = red_field(S, S, glow=(0.6, 0.35))
    face = STATUE.crop((90, 260, 830, 1000)).resize((S, S), Image.LANCZOS)
    img.alpha_composite(face)

    # the bar sits on the eyes: the darkest band of the face between 35% and 60% height
    lum = np.asarray(img.convert('L')).astype(float)[:, int(S * .25):int(S * .75)].mean(1)
    eyes = int(S * .35) + int(np.argmin(lum[int(S * .35):int(S * .6)]))
    d = ImageDraw.Draw(img)
    h = S * 0.11
    d.rectangle((S * 0.06, eyes - h / 2, S * 0.94, eyes + h / 2), fill=INK)
    mono = font('JetBrainsMono.ttf', int(23 * SS), 'Regular')
    text = 'T E L L'
    d.text(((S - d.textlength(text, font=mono)) / 2, eyes - 14 * SS), text, font=mono, fill=CREAM)
    img.convert('RGB').resize((400, 400), Image.LANCZOS).save(OUT / 'x-avatar.png', optimize=True)


def avatar_wordmark():
    """Alternative avatar: the wordmark on ink, for when the face is too busy at small sizes."""
    S = 400 * SS
    img = Image.new('RGBA', (S, S), INK + (255,))
    d = ImageDraw.Draw(img)
    f = font('InstrumentSerif-Regular.ttf', int(S * 0.36))
    fi = font('InstrumentSerif-Italic.ttf', int(S * 0.36))
    w = d.textlength('Tel', font=f) + d.textlength('l', font=fi)
    x = (S - w) / 2 - S * 0.03
    y = S * 0.5 - S * 0.25
    end = draw_runs(d, (x, y), [('Tel', f), ('l', fi)], CREAM)
    r = S * 0.03
    cy = y + S * 0.33
    d.ellipse((end + r * 0.6, cy - r, end + r * 2.6, cy + r), fill=ACCENT)
    img.convert('RGB').resize((400, 400), Image.LANCZOS).save(OUT / 'x-avatar-wordmark.png', optimize=True)


# ---------------- Banner: headline left, statue right ----------------
def banner():
    W, H = 1500 * SS, 500 * SS
    img = red_field(W, H, glow=(0.78, 0.45))

    # statue on the right, larger than the banner so the face fills the height
    sh = int(H * 1.55)
    sw = int(STATUE.width * sh / STATUE.height)
    st = STATUE.resize((sw, sh), Image.LANCZOS)
    img.alpha_composite(st, (int(W - sw * 0.92), int(-sh * 0.25)))

    # keep the copy readable where the statue reaches into it
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    fade = np.clip(1 - (xx / W - 0.38) / 0.22, 0, 1) ** 1.6
    over = np.zeros((H, W, 4), np.uint8)
    over[..., :3] = RED
    over[..., 3] = (fade * 215).astype(np.uint8)
    img.alpha_composite(Image.fromarray(over, 'RGBA'))

    d = ImageDraw.Draw(img)
    X = int(W * 0.08)
    mono = font('JetBrainsMono.ttf', int(15 * SS), 'Regular')
    spaced(d, (X, int(H * 0.17)), 'TELL.MARKETS  —  LAUNCH CHECKS ON ROBINHOOD CHAIN', mono, (255, 220, 220), 2.6 * SS)

    size = int(92 * SS)
    f = font('InstrumentSerif-Regular.ttf', size)
    fi = font('InstrumentSerif-Italic.ttf', size)
    y1 = int(H * 0.25)
    draw_runs(d, (X, y1), [('Read the tell', f)], WHITE)
    draw_runs(d, (X, y1 + int(size * 0.95)), [('before you ', f), ('buy.', fi)], WHITE)

    # nothing in the bottom-left third: the profile picture covers it on X
    tag = font('JetBrainsMono.ttf', int(13 * SS), 'Regular')
    t = '$TELL'
    tw = d.textlength(t, font=tag) + 6 * SS * len(t)
    spaced(d, (W - tw - int(W * 0.03), int(H * 0.88)), t, tag, (255, 225, 225), 6 * SS)

    img.convert('RGB').resize((1500, 500), Image.LANCZOS).save(OUT / 'x-banner.png', optimize=True)


avatar()
avatar_wordmark()
banner()
print('ok', sorted(p.name for p in OUT.iterdir()))
