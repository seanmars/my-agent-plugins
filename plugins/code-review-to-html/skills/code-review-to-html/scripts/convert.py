"""Convert a code review markdown report to interactive HTML.

Usage:
    python convert.py <input.md> [output.html]

If output.html is omitted, the script writes alongside the input with the same
stem (eg report-foo.md -> report-foo.html).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PLACEHOLDER = "__REPORT_MARKDOWN__"
SCRIPT_DIR = Path(__file__).resolve().parent
TEMPLATE_PATH = SCRIPT_DIR.parent / "assets" / "template.html"


def build_html(markdown_path: Path, output_path: Path) -> None:
    template = TEMPLATE_PATH.read_bytes()
    if PLACEHOLDER.encode("ascii") not in template:
        raise RuntimeError(f"Placeholder {PLACEHOLDER} not found in template; template may be corrupted.")

    md_text = markdown_path.read_text(encoding="utf-8")
    # Guard against any literal </script> closing the embed prematurely.
    md_text = md_text.replace("</script>", "<\\/script>")

    rendered = template.replace(PLACEHOLDER.encode("ascii"), md_text.encode("utf-8"))
    output_path.write_bytes(rendered)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Convert code review markdown to HTML")
    parser.add_argument("input", help="Path to the .md report")
    parser.add_argument("output", nargs="?", help="Path to write the .html (default: alongside input)")
    args = parser.parse_args(argv)

    md_path = Path(args.input).resolve()
    if not md_path.is_file():
        print(f"error: input file not found: {md_path}", file=sys.stderr)
        return 2

    if args.output:
        out_path = Path(args.output).resolve()
    else:
        out_path = md_path.with_suffix(".html")

    build_html(md_path, out_path)
    print(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
