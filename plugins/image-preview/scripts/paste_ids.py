# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""image-preview host helper, run as `uv run --script paste_ids.py ...`.

  --path TRANSCRIPT --uuid UUID
      Writes the imagePasteIds of row UUID, comma-separated. Exits 3 while
      the row is not written whole, 4 when the row keeps none.

The row is the session's latest prompt, so the transcript is read from its
end, and only as far back as the row.
"""

import argparse
import json
import os
import sys
from collections.abc import Iterator
from typing import BinaryIO

ROW_NOT_WRITTEN = 3
NO_PASTE_IDS = 4
CHUNK = 1 << 16


def lines_from_end(file: BinaryIO) -> Iterator[bytes]:
    """The file's lines, last first. The first one is what follows the last
    newline: empty once a newline ends the file, else a line still being written."""
    position = file.seek(0, os.SEEK_END)
    pieces: list[bytes] = []  # the line being gathered, its last piece first
    while position > 0:
        size = min(CHUNK, position)
        position -= size
        file.seek(position)
        block = file.read(size)
        end = len(block)
        cut = block.rfind(b"\n", 0, end)
        while cut >= 0:
            pieces.append(block[cut + 1 : end])
            yield b"".join(reversed(pieces))
            pieces.clear()
            end = cut
            cut = block.rfind(b"\n", 0, end)
        pieces.append(block[:end])
    yield b"".join(reversed(pieces))


def paste_ids(path: str, uuid: str) -> int:
    # The row's own id: a child row names it as "parentUuid", which this does not match.
    needle = f'"uuid":"{uuid}"'.encode()
    with open(path, "rb") as transcript:
        lines = lines_from_end(transcript)
        if needle in next(lines):
            return ROW_NOT_WRITTEN
        for line in lines:
            if needle not in line:
                continue
            row = json.loads(line)
            if row.get("uuid") != uuid:
                continue
            ids = row.get("imagePasteIds")
            if not ids:
                return NO_PASTE_IDS
            sys.stdout.write(",".join(str(number) for number in ids))
            return 0
    return ROW_NOT_WRITTEN


def main() -> int:
    parser = argparse.ArgumentParser(description="image-preview paste numbers")
    parser.add_argument("--path", required=True)
    parser.add_argument("--uuid", required=True)
    args = parser.parse_args()

    try:
        return paste_ids(args.path, args.uuid)
    except Exception as error:  # one line for the debug log, not a traceback
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
