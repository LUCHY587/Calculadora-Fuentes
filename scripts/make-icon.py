"""Genera build/icon.png y build/icon.ico (casa blanca sobre fondo bordó)."""
from PIL import Image, ImageDraw
import os

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((0, 0, S - 1, S - 1), radius=230, fill=(122, 31, 46, 255))
# degradé sutil
over = Image.new("RGBA", (S, S), (0, 0, 0, 0))
od = ImageDraw.Draw(over)
for y in range(S):
    a = int(60 * (y / S))
    od.line([(0, y), (S, y)], fill=(40, 6, 16, a))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=230, fill=255)
img = Image.composite(Image.alpha_composite(img, over), img, mask)
d = ImageDraw.Draw(img)

W = 62
white = (255, 255, 255, 255)
# techo
d.line([(200, 500), (512, 230), (824, 500)], fill=white, width=W, joint="curve")
# paredes
d.line([(290, 450), (290, 800), (734, 800), (734, 450)], fill=white, width=W, joint="curve")
# puerta
d.line([(445, 800), (445, 620), (579, 620), (579, 800)], fill=white, width=W - 8, joint="curve")
for (x, y) in [(200, 500), (824, 500), (512, 230), (290, 800), (734, 800), (290, 450), (734, 450)]:
    d.ellipse((x - W // 2, y - W // 2, x + W // 2, y + W // 2), fill=white)

os.makedirs("build", exist_ok=True)
img.resize((512, 512), Image.LANCZOS).save("build/icon.png")
img.save("build/icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ok")
