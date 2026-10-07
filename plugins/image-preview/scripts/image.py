# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""image-preview host helper, run as `uv run --script image.py <mode> ...`.

  decode [--path FILE] [--max N]
      The image FILE, or base64 on stdin without one (png, jpeg, gif, webp,
      bmp; a GIF's first frame). Writes "<origW> <origH> <w> <h>", a newline,
      then base64 RGBA pixels scaled down to fit inside N x N.

  paste-ids --path TRANSCRIPT --uuid UUID
      Writes the imagePasteIds of row UUID, comma-separated. Exits 3 while no
      such row is written, 4 when the row keeps none.
"""

import argparse
import base64
import re
import sys
from io import BytesIO

ROW_NOT_WRITTEN = 3
NO_PASTE_IDS = 4
PASTE_IDS = re.compile(rb'"imagePasteIds":\[([0-9,\s]*)\]')


def decode(path: str | None, max_side: int) -> int:
    from PIL import Image

    if path:
        with open(path, "rb") as file:
            data = file.read()
    else:
        data = base64.b64decode(sys.stdin.read().strip())

    with Image.open(BytesIO(data)) as image:
        original_width, original_height = image.size
        picture = image.convert("RGBA")
    picture.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    width, height = picture.size
    sys.stdout.buffer.write(f"{original_width} {original_height} {width} {height}\n".encode())
    sys.stdout.buffer.write(base64.b64encode(picture.tobytes()))
    return 0


def paste_ids(path: str, uuid: str) -> int:
    # The row's own id: a child row names it as "parentUuid", which this does not match.
    needle = f'"uuid":"{uuid}"'.encode()
    with open(path, "rb") as transcript:
        for line in transcript:
            if needle not in line:
                continue
            found = PASTE_IDS.search(line)
            if found is None:
                return NO_PASTE_IDS
            sys.stdout.buffer.write(re.sub(rb"\s", b"", found.group(1)))
            return 0
    return ROW_NOT_WRITTEN


def main() -> int:
    parser = argparse.ArgumentParser(description="image-preview host helper")
    modes = parser.add_subparsers(dest="mode", required=True)
    decoding = modes.add_parser("decode")
    decoding.add_argument("--path")
    decoding.add_argument("--max", type=int, default=400)
    looking = modes.add_parser("paste-ids")
    looking.add_argument("--path", required=True)
    looking.add_argument("--uuid", required=True)
    args = parser.parse_args()

    try:
        if args.mode == "decode":
            return decode(args.path, args.max)
        return paste_ids(args.path, args.uuid)
    except Exception as error:  # one line the card can show, not a traceback
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
