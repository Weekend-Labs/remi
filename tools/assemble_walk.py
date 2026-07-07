# Assemble N transparent frame PNGs into an equal-cell horizontal walk strip,
# aligned bottom-center so feet stay on one baseline (no jitter).
# Usage: python3 assemble_walk.py <out.png> <frame1.png> <frame2.png> ...
import sys
from PIL import Image

out = sys.argv[1]
frames = [Image.open(p).convert("RGBA") for p in sys.argv[2:]]
# tight-crop each to its alpha bbox
frames = [f.crop(f.getbbox()) for f in frames]

margin = 12
cw = max(f.width for f in frames) + margin * 2
ch = max(f.height for f in frames) + margin * 2

strip = Image.new("RGBA", (cw * len(frames), ch), (0, 0, 0, 0))
for i, f in enumerate(frames):
    x = i * cw + (cw - f.width) // 2          # center horizontally
    y = ch - margin - f.height                 # align feet to baseline
    strip.paste(f, (x, y), f)
strip.save(out)
print(f"strip {out} = {len(frames)} cells, cell {cw}x{ch}, total {strip.size}")

# light-gray preview to eyeball the cycle
bg = Image.new("RGBA", strip.size, (225, 235, 245, 255))
Image.alpha_composite(bg, strip).convert("RGB").save("/tmp/walk-preview.png")
