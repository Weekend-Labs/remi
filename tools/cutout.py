# Flood-fill the flat background to transparent, trim to the character, save RGBA PNG.
# Usage: python3 cutout.py <in.png> <out.png> [tolerance]
import sys
from collections import deque
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
tol = int(sys.argv[3]) if len(sys.argv) > 3 else 45

im = Image.open(src).convert("RGBA")
w, h = im.size
px = im.load()

# seed color = average of the 4 corners (the background)
corners = [px[0, 0], px[w-1, 0], px[0, h-1], px[w-1, h-1]]
sr = sum(c[0] for c in corners) // 4
sg = sum(c[1] for c in corners) // 4
sb = sum(c[2] for c in corners) // 4

def near(c):
    return abs(c[0]-sr) <= tol and abs(c[1]-sg) <= tol and abs(c[2]-sb) <= tol

# BFS flood fill from every border pixel (only removes background connected to the edge)
seen = [[False]*w for _ in range(h)]
q = deque()
for x in range(w):
    for y in (0, h-1):
        q.append((x, y))
for y in range(h):
    for x in (0, w-1):
        q.append((x, y))
while q:
    x, y = q.popleft()
    if x < 0 or y < 0 or x >= w or y >= h or seen[y][x]:
        continue
    seen[y][x] = True
    if not near(px[x, y]):
        continue
    px[x, y] = (0, 0, 0, 0)
    q.extend([(x+1, y), (x-1, y), (x, y+1), (x, y-1)])

# trim to content
bbox = im.getbbox()
im = im.crop(bbox)
im.save(out)
print(f"saved {out} size={im.size}")
