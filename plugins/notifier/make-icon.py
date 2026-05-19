#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pillow>=10",
#   "numpy>=1.24",
# ]
# ///
"""Generate a multi-size .ico with a 45-degree gradient circle and a centered letter.

Usage:
    uv run make-icon.py [output] [letter]
        output   Output .ico path (default: app.ico)
        letter   Single character drawn on the icon (default: P)
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

SIZES = [16, 32, 48, 64, 128, 256]
COLOR_A = (79, 70, 229)   # indigo
COLOR_B = (6, 182, 212)   # cyan
GRADIENT_ANGLE_DEG = 45.0

# Fonts to try, in order. First hit wins.
FONT_CANDIDATES = [
    "segoeuib.ttf",   # Segoe UI Bold (Windows)
    "segoeui.ttf",    # Segoe UI (Windows fallback)
    "Arial Bold.ttf",
    "arialbd.ttf",
    "Arial.ttf",
    "DejaVuSans-Bold.ttf",
    "Helvetica.ttc",
]


def main(argv: list[str]) -> int:
    if argv and argv[0] in ("-h", "--help"):
        print("Usage: uv run make-icon.py [output] [letter]")
        print("  output   Output .ico path (default: app.ico)")
        print("  letter   Single character drawn on the icon (default: P)")
        return 0

    output = Path(argv[0]) if argv else Path("app.ico")
    letter = argv[1] if len(argv) > 1 else "P"

    # Pillow's ICO writer iterates `sizes` and matches each one against the head
    # image + `append_images`. Sizes larger than the head image are silently
    # dropped, so the head MUST be the largest variant.
    images = [build_image(s, letter) for s in sorted(SIZES, reverse=True)]

    images[0].save(
        output,
        format="ICO",
        sizes=[(s, s) for s in SIZES],
        append_images=images[1:],
    )

    info = output.stat()
    print(f"Wrote {output.resolve()}")
    print(f"  Sizes:  {', '.join(str(s) for s in SIZES)}")
    print(f"  Letter: {letter}")
    print(f"  Bytes:  {info.st_size:,}")
    return 0


def build_image(size: int, letter: str) -> Image.Image:
    # Gradient fills the bounding box; circular alpha mask carves the disc.
    gradient = linear_gradient(size, size, COLOR_A, COLOR_B, GRADIENT_ANGLE_DEG)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, size - 2, size - 2), fill=255)

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(gradient, (0, 0), mask)

    font = load_font(int(size * 0.55))
    draw = ImageDraw.Draw(img)
    # textbbox is the modern centering API; anchor="mm" puts the glyph's
    # geometric middle at the given point.
    draw.text((size / 2, size / 2), letter, font=font, fill=(255, 255, 255, 255), anchor="mm")

    return img


def linear_gradient(
    width: int,
    height: int,
    color_a: tuple[int, int, int],
    color_b: tuple[int, int, int],
    angle_deg: float,
) -> Image.Image:
    angle = math.radians(angle_deg)
    cos_a, sin_a = math.cos(angle), math.sin(angle)

    # Project pixel coordinates onto the gradient axis, then normalize t into
    # [0, 1] using the projection range of the bounding box corners.
    xs = np.arange(width, dtype=np.float32)
    ys = np.arange(height, dtype=np.float32)
    projection = xs[None, :] * cos_a + ys[:, None] * sin_a
    pmin = float(projection.min())
    pmax = float(projection.max())
    t = (projection - pmin) / max(pmax - pmin, 1e-6)

    a = np.array(color_a, dtype=np.float32)
    delta = np.array(color_b, dtype=np.float32) - a
    rgb = a + t[..., None] * delta
    return Image.fromarray(rgb.astype(np.uint8), mode="RGB")


def load_font(size: int) -> ImageFont.ImageFont:
    for name in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
