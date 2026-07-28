from pathlib import Path
from PIL import Image
import io
import struct

PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
BUILD_DIR = Path(__file__).resolve().parent.parent / 'build'
SOURCE_PATH = BUILD_DIR / 'icon-source-v2.png'


def create_icons() -> dict[int, Image.Image]:
    if not SOURCE_PATH.is_file():
        raise FileNotFoundError(f'Icon source not found: {SOURCE_PATH}')

    with Image.open(SOURCE_PATH) as source:
        source.load()
        if source.width != source.height:
            raise ValueError(f'Icon source must be square, got {source.width}x{source.height}')
        source = source.convert('RGBA')
        return {
            size: source.resize((size, size), Image.Resampling.LANCZOS)
            for size in PNG_SIZES
        }


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
    images[1024].save(
        BUILD_DIR / 'icon.icns',
        format='ICNS',
        append_images=[images[size] for size in (32, 64, 128, 256, 512)],
    )


BUILD_DIR.mkdir(exist_ok=True)
icons = create_icons()
for size, image in icons.items():
    image.save(BUILD_DIR / f'icon-{size}x{size}.png')
write_ico(icons)
write_icns(icons)
print(f'Generated PNG, ICO, and ICNS assets from {SOURCE_PATH.name}')
