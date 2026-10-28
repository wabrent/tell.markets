"""Turns the statue photo into a line-engraving on transparent background (blue/white ink).
Usage: python -I engrave.py <src.png> <out.png>"""
import sys
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
W, H = im.size
# crop: drop pedestal and side background
im = im.crop((int(W * 0.16), int(H * 0.06), int(W * 0.84), int(H * 0.835)))
W, H = im.size

# --- mask: flood fill the grey backdrop from the edges
blur = im.filter(ImageFilter.GaussianBlur(3))
seg = blur.copy()
# the backdrop is a vertical grey gradient, so seed along every edge, not just the corners
seeds = [(x, 2) for x in range(2, W, 12)] + [(x, H - 3) for x in range(2, W, 12)]
seeds += [(2, y) for y in range(2, H, 12)] + [(W - 3, y) for y in range(2, H, 12)]
for pt in seeds:
    if seg.getpixel(pt) != (255, 0, 255):
        ImageDraw.floodfill(seg, pt, (255, 0, 255), thresh=18)
a = np.asarray(seg).astype(int)
bg = (a[..., 0] == 255) & (a[..., 1] == 0) & (a[..., 2] == 255)
# grey, unsaturated pixels that the fill missed are backdrop too
hsv = np.asarray(blur.convert('HSV')).astype(float)
bg |= (hsv[..., 1] < 14) & (hsv[..., 2] < 150)
mask = Image.fromarray(((~bg) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(2.5))
M = np.asarray(mask).astype(float) / 255

# --- luminance with local contrast
g = np.asarray(im.convert('L')).astype(float) / 255
local = np.asarray(im.convert('L').filter(ImageFilter.GaussianBlur(40))).astype(float) / 255
L = np.clip(0.5 + (g - local) * 2.2 + (g - 0.55) * 0.9, 0, 1)
L = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255

yy, xx = np.mgrid[0:H, 0:W].astype(float)

# --- engraving lines: wavy, bent by the image itself so they follow the form
spacing = 7.0
bend = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14))).astype(float) / 255
phase = (yy + 6 * np.sin(xx / 37.0) + 26 * bend) / spacing
d = np.abs(phase - np.round(phase))  # 0 at line centre, 0.5 between lines
width = (1 - L) * 0.62  # darker = thicker line
ink1 = np.clip((width / 2 - d) * spacing * 1.3 + 0.5, 0, 1)

# cross-hatch only in deep shadow
phase2 = (xx * 0.8 + yy * 0.6 + 10 * bend) / 6.0
d2 = np.abs(phase2 - np.round(phase2))
w2 = np.clip((0.45 - L) / 0.45, 0, 1) * 0.55
ink2 = np.clip((w2 / 2 - d2) * 6.0 * 1.3 + 0.5, 0, 1)
ink = np.maximum(ink1, ink2)

# --- colour: gradient map paper (light) -> steel blue (mid); red shows through in shadow via alpha
light = np.array([214, 228, 246])
mid = np.array([30, 78, 108])
t = np.clip((L - 0.25) / 0.6, 0, 1)[..., None]
paper = mid * (1 - t) + light * t
inkc = np.array([6, 14, 22])
rgb = paper * (1 - ink[..., None]) + inkc * ink[..., None]

# deep shadows thin out the paper so the red background bleeds through, like the reference
shadow = np.clip((0.32 - L) / 0.32, 0, 1)
alpha = M * np.clip(1 - shadow * 0.85 + ink * 0.85, 0, 1)

outim = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')
outim.thumbnail((900, 1200), Image.LANCZOS)
outim.save(out, optimize=True)
print(outim.size)
