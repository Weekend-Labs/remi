# Segment a magenta-background sprite sheet into individual character frames.
# Keys out magenta, finds connected blobs, prints boxes, saves each crop for inspection.
# Usage: python3 segment_sheet.py <sheet.png> <outdir>
import sys, os
import numpy as np
from scipy import ndimage
from PIL import Image

src, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)

im = Image.open(src).convert("RGBA")
arr = np.array(im)
r, g, b = arr[..., 0].astype(int), arr[..., 1].astype(int), arr[..., 2].astype(int)

# magenta ~ (255,0,255): high R, low G, high B
is_bg = (r > 150) & (g < 120) & (b > 150)
fg = ~is_bg

# clean tiny noise, then label blobs
fg = ndimage.binary_opening(fg, iterations=2)
lbl, n = ndimage.label(fg)
print(f"raw blobs: {n}")

boxes = []
for i in range(1, n + 1):
    ys, xs = np.where(lbl == i)
    if len(xs) < 1500:  # ignore specks
        continue
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    boxes.append((x0, y0, x1, y1, len(xs)))

# sort into rows: cluster by y-center
boxes.sort(key=lambda bthe: (bthe[1] + bthe[3]) / 2)
rows, cur, last_c = [], [], None
for bx in boxes:
    c = (bx[1] + bx[3]) / 2
    if last_c is None or abs(c - last_c) < 250:
        cur.append(bx)
    else:
        rows.append(sorted(cur, key=lambda z: z[0]))
        cur = [bx]
    last_c = c
if cur:
    rows.append(sorted(cur, key=lambda z: z[0]))

# make magenta transparent for saved crops
out = arr.copy()
out[is_bg] = (0, 0, 0, 0)
outimg = Image.fromarray(out, "RGBA")

for ri, row in enumerate(rows):
    print(f"row {ri}: {len(row)} frames")
    for ci, (x0, y0, x1, y1, area) in enumerate(row):
        pad = 6
        crop = outimg.crop((max(0, x0 - pad), max(0, y0 - pad), x1 + pad, y1 + pad))
        crop.save(f"{outdir}/r{ri}_c{ci}.png")
        print(f"  r{ri}c{ci}: box=({x0},{y0},{x1},{y1}) size={x1-x0}x{y1-y0} area={area}")
