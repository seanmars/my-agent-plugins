# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""image-preview host helper, run as `uv run --script image.py decode ...`.

  decode [--path FILE] [--max N]
      The image FILE, or base64 on stdin without one (png, jpeg, gif, webp,
      bmp; a GIF's first frame), turned upright as its EXIF orientation says.
      Writes "<origW> <origH> <w> <h>", a newline, then base64 RGBA pixels
      scaled down to fit inside N x N.
"""

import argparse
import base64
import sys
from io import BytesIO

from PIL import Image

ORIENTATION = 0x0112
# What each EXIF orientation takes to stand upright, as ImageOps.exif_transpose
# does it; 5 to 8 turn the picture a quarter, so its sides swap.
UPRIGHT = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}
# Modes Pillow scales with LANCZOS; a palette ("P") scales by nearest neighbour.
SCALABLE = ("RGB", "RGBA", "L", "LA")


def decode(path: str | None, max_side: int) -> int:
    if path:
        with open(path, "rb") as file:
            data = file.read()
    else:
        data = base64.b64decode(sys.stdin.read().strip())

    with Image.open(BytesIO(data)) as image:
        original_width, original_height = image.size
        orientation = image.getexif().get(ORIENTATION, 1)
        picture = image if image.mode in SCALABLE else image.convert("RGBA")
        # Scaled first, so only the small picture is converted; a JPEG is
        # decoded at a reduced size for it.
        picture.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        picture = picture.convert("RGBA")

    upright = UPRIGHT.get(orientation)
    if upright is not None:
        picture = picture.transpose(upright)
        if orientation >= 5:
            original_width, original_height = original_height, original_width

    width, height = picture.size
    sys.stdout.buffer.write(f"{original_width} {original_height} {width} {height}\n".encode())
    sys.stdout.buffer.write(base64.b64encode(picture.tobytes()))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="image-preview host helper")
    modes = parser.add_subparsers(dest="mode", required=True)
    decoding = modes.add_parser("decode")
    decoding.add_argument("--path")
    decoding.add_argument("--max", type=int, default=400)
    args = parser.parse_args()

    try:
        return decode(args.path, args.max)
    except Exception as error:  # one line the card can show, not a traceback
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
