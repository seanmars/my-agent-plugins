# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""image-preview host helper, run as `uv run --script open_image.py ...`.

  [--path FILE] [--media-type TYPE]
      Opens the image FILE in the system's own viewer: the file's default app
      on Windows, `open` on macOS, `xdg-open` elsewhere. Without FILE the
      image is base64 on stdin, of TYPE, first written to a file under the
      system temp folder.
"""

import argparse
import base64
import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path

EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
}


def written(media_type: str, data: bytes) -> str:
    folder = Path(tempfile.gettempdir()) / "claude-image-preview"
    folder.mkdir(exist_ok=True)
    # Named by content, so the same picture opened again reuses its file.
    name = hashlib.sha256(data).hexdigest()[:16] + EXTENSIONS.get(media_type, ".png")
    path = folder / name
    if not path.exists():
        path.write_bytes(data)
    return str(path)


def show(path: str) -> None:
    if not os.path.isfile(path):
        raise FileNotFoundError(f"no file at {path}")
    if sys.platform == "win32":
        os.startfile(os.path.normpath(path))
    elif sys.platform == "darwin":
        result = subprocess.run(["open", path], capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"open exited {result.returncode}")
    else:
        # xdg-open may wait on the viewer it starts, so it is left running on its own.
        subprocess.Popen(
            ["xdg-open", path],
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="image-preview host helper")
    parser.add_argument("--path")
    parser.add_argument("--media-type", default="image/png")
    args = parser.parse_args()

    try:
        path = args.path or written(args.media_type, base64.b64decode(sys.stdin.read().strip()))
        show(path)
        return 0
    except Exception as error:  # one line the toast can show, not a traceback
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
