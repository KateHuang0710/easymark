from pathlib import Path
from PIL import Image, ImageDraw
import io
import struct
import subprocess
import sys

PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
COLOR = '#7A9E7E'
COLOR_DARK = '#5C8460'
WHITE = '#FFFFFF'
BUILD_DIR = Path(__file__).resolve().parent.parent / 'build'


def create_icon(size: int) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = size * 0.19
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=COLOR)

    x, y = size * 0.14, size * 0.10
    width, height = size * 0.72, size * 0.80
    draw.rounded_rectangle([x, y, x + width, y + height], radius=size * 0.03, fill=WHITE)

    fold_x = x + width * 0.72
    draw.polygon(
        [(fold_x, y), (x + width, y), (fold_x, y + height * 0.28)],
        fill=WHITE,
        outline='#E0DDD6',
    )

    line_width = max(1, int(size * 0.018))
    left, right = x + width * 0.15, x + width * 0.85
    draw.line([(left, y + height * 0.38), (x + width * 0.65, y + height * 0.38)], fill=COLOR_DARK, width=line_width)
    draw.line([(left, y + height * 0.55), (right, y + height * 0.55)], fill=COLOR_DARK, width=line_width)
    draw.line([(left, y + height * 0.72), (right, y + height * 0.72)], fill=COLOR_DARK, width=line_width)
    draw.rounded_rectangle(
        [x, y, x + width, y + height],
        radius=size * 0.03,
        outline='#E0DDD6',
        width=max(1, int(size * 0.004)),
    )

    center_x, center_y, arm = size * 0.75, size * 0.28, size * 0.10
    mark_width = max(2, int(size * 0.028))
    draw.line([(center_x - arm, center_y), (center_x, center_y + arm)], fill=COLOR_DARK, width=mark_width)
    draw.line([(center_x, center_y + arm), (center_x + arm, center_y)], fill=COLOR_DARK, width=mark_width)
    draw.line([(center_x - arm, center_y - arm), (center_x, center_y)], fill=COLOR_DARK, width=mark_width)
    draw.line([(center_x, center_y), (center_x + arm, center_y - arm)], fill=COLOR_DARK, width=mark_width)
    return img


def write_ico(images: dict[int, Image.Image]) -> None:
    png_data = []
    for size in ICO_SIZES:
        buffer = io.BytesIO()
        images[size].save(buffer, format='PNG')
        png_data.append(buffer.getvalue())

    output = io.BytesIO()
    output.write(struct.pack('<HHH', 0, 1, len(ICO_SIZES)))
    offset = 6 + 16 * len(ICO_SIZES)
    for data, size in zip(png_data, ICO_SIZES):
        output.write(struct.pack('<BBBBHHII', size if size < 256 else 0, size if size < 256 else 0, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    for data in png_data:
        output.write(data)
    (BUILD_DIR / 'icon.ico').write_bytes(output.getvalue())


def write_icns(images: dict[int, Image.Image]) -> None:
    iconset = BUILD_DIR / 'icon.iconset'
    iconset.mkdir(exist_ok=True)
    mappings = {
        'icon_16x16.png': 16,
        'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32,
        'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128,
        'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256,
        'icon_256x256@2x.png': 512,
        'icon_512x512.png': 512,
        'icon_512x512@2x.png': 1024,
    }
    for name, size in mappings.items():
        images[size].save(iconset / name)
    if sys.platform == 'darwin':
        subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(BUILD_DIR / 'icon.icns')], check=True)


BUILD_DIR.mkdir(exist_ok=True)
icons = {size: create_icon(size) for size in PNG_SIZES}
for size, image in icons.items():
    image.save(BUILD_DIR / f'icon-{size}x{size}.png')
write_ico(icons)
write_icns(icons)
print('Generated PNG, ICO, and macOS iconset assets in build/')
