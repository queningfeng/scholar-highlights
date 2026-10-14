#!/usr/bin/env python3
"""Scholar Highlights - icon generator.

Draws the extension mark (a white magnifier with a blue academic star in the
lens, on the Google Scholar blue) with Pillow at 8x supersampling, then writes
assets/icons/icon-{16,32,48,96,128}.png plus the assets/icon.svg source that
matches the same geometry.

Run with the bundled runtime:

  C:\\Users\\LEGION\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe \\
      scripts/make-icons.py
"""

from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "assets" / "icons"
SVG_PATH = ROOT / "assets" / "icon.svg"

SIZES = (16, 32, 48, 96, 128)
SCALE = 8
CANVAS = 128  # design grid, also the largest exported size

BLUE_TOP = (66, 133, 244)  # #4285F4
BLUE_BOTTOM = (25, 103, 210)  # #1967D2
STAR_BLUE = (26, 115, 232)  # #1A73E8
WHITE = (255, 255, 255)

CORNER_RADIUS = 28
LENS_CENTER = (53.0, 51.0)
LENS_RADIUS = 27.0
HANDLE_WIDTH = 13.0
HANDLE_END = (101.0, 99.0)
STAR_OUTER = 15.0
STAR_INNER = 6.4
STAR_CENTER = (53.0, 52.5)


def star_points(cx: float, cy: float, outer: float, inner: float, count: int = 5):
    points = []
    for index in range(count * 2):
        radius = outer if index % 2 == 0 else inner
        angle = -math.pi / 2 + index * math.pi / count
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def scaled(points):
    return [(x * SCALE, y * SCALE) for x, y in points]


def linear_gradient(size: int):
    """Top-left -> bottom-right gradient between the two blues."""
    gradient = Image.new("RGBA", (size, size))
    pixels = gradient.load()
    for y in range(size):
        for x in range(size):
            ratio = (x + y) / (2 * (size - 1))
            pixels[x, y] = (
                round(BLUE_TOP[0] + (BLUE_BOTTOM[0] - BLUE_TOP[0]) * ratio),
                round(BLUE_TOP[1] + (BLUE_BOTTOM[1] - BLUE_TOP[1]) * ratio),
                round(BLUE_TOP[2] + (BLUE_BOTTOM[2] - BLUE_TOP[2]) * ratio),
                255,
            )
    return gradient


def draw_master() -> Image.Image:
    size = CANVAS * SCALE
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=CORNER_RADIUS * SCALE, fill=255
    )

    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(linear_gradient(size), (0, 0), mask)

    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Magnifier handle first, so the lens covers its inner end.
    start = (
        LENS_CENTER[0] + (HANDLE_END[0] - LENS_CENTER[0]) * 0.45,
        LENS_CENTER[1] + (HANDLE_END[1] - LENS_CENTER[1]) * 0.45,
    )
    draw.line(
        [start[0] * SCALE, start[1] * SCALE, HANDLE_END[0] * SCALE, HANDLE_END[1] * SCALE],
        fill=WHITE + (255,),
        width=round(HANDLE_WIDTH * SCALE),
    )
    for point in (start, HANDLE_END):
        radius = HANDLE_WIDTH * SCALE / 2
        draw.ellipse(
            [
                point[0] * SCALE - radius,
                point[1] * SCALE - radius,
                point[0] * SCALE + radius,
                point[1] * SCALE + radius,
            ],
            fill=WHITE + (255,),
        )

    # Lens.
    draw.ellipse(
        [
            (LENS_CENTER[0] - LENS_RADIUS) * SCALE,
            (LENS_CENTER[1] - LENS_RADIUS) * SCALE,
            (LENS_CENTER[0] + LENS_RADIUS) * SCALE,
            (LENS_CENTER[1] + LENS_RADIUS) * SCALE,
        ],
        fill=WHITE + (255,),
    )

    # Academic star inside the lens.
    draw.polygon(
        scaled(star_points(STAR_CENTER[0], STAR_CENTER[1], STAR_OUTER, STAR_INNER)),
        fill=STAR_BLUE + (255,),
    )

    return Image.alpha_composite(icon, overlay)


def write_svg() -> None:
    points = " ".join(
        f"{x:.2f},{y:.2f}"
        for x, y in star_points(
            STAR_CENTER[0], STAR_CENTER[1], STAR_OUTER, STAR_INNER
        )
    )
    handle_start = (
        LENS_CENTER[0] + (HANDLE_END[0] - LENS_CENTER[0]) * 0.45,
        LENS_CENTER[1] + (HANDLE_END[1] - LENS_CENTER[1]) * 0.45,
    )
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS} {CANVAS}" width="{CANVAS}" height="{CANVAS}" role="img" aria-label="Scholar Highlights">
  <title>Scholar Highlights</title>
  <defs>
    <linearGradient id="shxBlue" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4285F4" />
      <stop offset="1" stop-color="#1967D2" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="{CANVAS}" height="{CANVAS}" rx="{CORNER_RADIUS}" ry="{CORNER_RADIUS}" fill="url(#shxBlue)" />
  <line x1="{handle_start[0]:.2f}" y1="{handle_start[1]:.2f}" x2="{HANDLE_END[0]:.2f}" y2="{HANDLE_END[1]:.2f}" stroke="#FFFFFF" stroke-width="{HANDLE_WIDTH:.0f}" stroke-linecap="round" />
  <circle cx="{LENS_CENTER[0]:.2f}" cy="{LENS_CENTER[1]:.2f}" r="{LENS_RADIUS:.0f}" fill="#FFFFFF" />
  <polygon points="{points}" fill="#1A73E8" />
</svg>
"""
    SVG_PATH.write_text(svg, encoding="utf-8")


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master = draw_master()
    for size in SIZES:
        master.resize((size, size), Image.LANCZOS).save(ICON_DIR / f"icon-{size}.png")
        print(f"wrote assets/icons/icon-{size}.png")
    write_svg()
    print("wrote assets/icon.svg")


if __name__ == "__main__":
    main()
