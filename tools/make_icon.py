# Compose a macOS-style app icon: rounded-rect (squircle) gradient + pixel character.
# Usage: python3 make_icon.py <character.png> <out_1024.png>
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

char_path, out = sys.argv[1], sys.argv[2]
S = 1024
margin = 90
radius = 205
box = (margin, margin, S - margin, S - margin)

canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# drop shadow under the squircle
sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle(
    (margin, margin + 20, S - margin, S - margin + 20), radius=radius, fill=(20, 40, 70, 110))
sh = sh.filter(ImageFilter.GaussianBlur(24))
canvas = Image.alpha_composite(canvas, sh)

# vertical gradient (light sky blue -> water blue)
ys = np.linspace(0, 1, S)[:, None]
top, bot = np.array([130, 202, 255]), np.array([37, 124, 205])
grad = (top * (1 - ys) + bot * ys).astype("uint8")
grad = np.repeat(grad[:, None, :], S, axis=1)
gimg = Image.fromarray(grad, "RGB").convert("RGBA")

# squircle mask
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
squircle = Image.new("RGBA", (S, S), (0, 0, 0, 0))
squircle.paste(gimg, (0, 0), mask)

# subtle top gloss: white fading smoothly to transparent by ~45% height (no seam)
yy = np.linspace(0, 1, S)[:, None]
galpha = (np.clip(1 - yy / 0.45, 0, 1) * 52).astype("uint8")
galpha = np.repeat(galpha, S, axis=1)
gloss = np.dstack([np.full((S, S), 255, "uint8")] * 3 + [galpha])
gloss = Image.fromarray(gloss, "RGBA")
squircle = Image.alpha_composite(squircle, Image.composite(gloss, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))
canvas = Image.alpha_composite(canvas, squircle)

# character → crop to upper body (bust) so face + glass are big, then clip to squircle
inner = S - 2 * margin
CROP = float(sys.argv[3]) if len(sys.argv) > 3 else 0.62  # keep head → glass hand
FILL = float(sys.argv[4]) if len(sys.argv) > 4 else 0.92   # width as fraction of inner
ch = Image.open(char_path).convert("RGBA")
ch = ch.crop(ch.getbbox())
ch = ch.crop((0, 0, ch.width, int(ch.height * CROP)))       # keep top portion
ch = ch.crop(ch.getbbox())
target_w = int(inner * FILL)
scale = target_w / ch.width
ch = ch.resize((target_w, int(ch.height * scale)), Image.LANCZOS)
cx = (S - ch.width) // 2
cy = margin + int(inner * 0.14)                             # head near the top

charlayer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
charlayer.alpha_composite(ch, (cx, cy))
charlayer = Image.composite(charlayer, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask)  # clip bust to squircle
canvas = Image.alpha_composite(canvas, charlayer)
canvas.save(out)
print(f"icon -> {out} ({canvas.size})")
