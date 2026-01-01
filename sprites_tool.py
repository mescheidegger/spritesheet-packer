#!/usr/bin/env python3
"""
sprites_tool.py

A unified sprite processing tool that supports TWO input modes:

1) GRID SPRITESHEET INPUT
   - A single image where frames are laid out in a uniform grid
   - Frames are sliced using --frame-width / --frame-height

2) DIRECTORY OF FRAMES INPUT
   - A folder of individual sprite images (PNG/JPG/etc)
   - Frames are loaded and sorted by filename

Both input types then flow through the SAME processing pipeline:

Shared pipeline stages:
  - Optional trim (remove transparent borders per frame)
  - Optional rescale (fit into target_size x target_size, pixel-safe)
  - Repack into a new sprite sheet (row or grid layout)
  - Optional JSON manifest describing frame placement

IMPORTANT DESIGN NOTES:
- Trimming and rescaling happen PER FRAME.
- This is ideal for VFX and loose sprites.
- For character animations with a fixed baseline (feet),
  trimming and per-frame rescaling may cause visual jitter.
"""

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image


# File extensions we consider valid sprite images
SUPPORTED_EXTS = {".png", ".gif", ".jpg", ".jpeg", ".webp"}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Frame:
    """
    Represents a single sprite frame flowing through the pipeline.

    name:
      - Original filename (for directory input)
      - Or synthetic name like frame_000.png (for sheet slicing)

    image:
      - Pillow Image object in RGBA format

    source_index:
      - Deterministic index representing original ordering
      - Used for stable animation frame order and manifests
    """
    name: str
    image: Image.Image
    source_index: int


# ---------------------------------------------------------------------------
# Input helpers
# ---------------------------------------------------------------------------

def is_image_file(p: Path) -> bool:
    """Return True if the path is a supported image file."""
    return p.is_file() and p.suffix.lower() in SUPPORTED_EXTS


def load_frames_from_dir(input_dir: Path) -> List[Frame]:
    """
    Load all supported image files from a directory.

    - Files are sorted by filename to ensure deterministic ordering.
    - All images are converted to RGBA for consistency.
    """
    if not input_dir.is_dir():
        raise ValueError(f"Input dir is not a directory: {input_dir}")

    paths = sorted(p for p in input_dir.iterdir() if is_image_file(p))
    if not paths:
        raise ValueError(f"No image files found in: {input_dir}")

    frames: List[Frame] = []
    for i, p in enumerate(paths):
        img = Image.open(p).convert("RGBA")
        frames.append(Frame(name=p.name, image=img, source_index=i))

    print(f"Loaded {len(frames)} frames from directory: {input_dir}")
    return frames


def slice_sheet_grid(sheet_path: Path, frame_w: int, frame_h: int) -> List[Frame]:
    """
    Slice a grid-based sprite sheet into individual frames.

    Assumptions:
    - Frames are perfectly aligned in a grid.
    - All frames are exactly frame_w x frame_h.
    - Ordering is row-major (left → right, top → bottom).
    """
    if not sheet_path.is_file():
        raise ValueError(f"Input sheet does not exist: {sheet_path}")
    if frame_w <= 0 or frame_h <= 0:
        raise ValueError("--frame-width/--frame-height must be > 0")

    sheet = Image.open(sheet_path).convert("RGBA")
    sheet_w, sheet_h = sheet.size

    # Ensure the sheet divides cleanly into frames
    if sheet_w % frame_w != 0 or sheet_h % frame_h != 0:
        raise ValueError(
            f"Sheet size {sheet_w}x{sheet_h} not divisible by frame {frame_w}x{frame_h}"
        )

    cols = sheet_w // frame_w
    rows = sheet_h // frame_h
    total = cols * rows

    print(f"Slicing sheet into {total} frames ({cols}x{rows})...")

    frames: List[Frame] = []
    idx = 0

    for r in range(rows):
        for c in range(cols):
            x = c * frame_w
            y = r * frame_h

            # Crop one frame out of the grid
            frame_img = sheet.crop((x, y, x + frame_w, y + frame_h))
            frames.append(
                Frame(
                    name=f"frame_{idx:03d}.png",
                    image=frame_img,
                    source_index=idx,
                )
            )
            idx += 1

    return frames


# ---------------------------------------------------------------------------
# Image processing helpers
# ---------------------------------------------------------------------------

def trim_alpha(img: Image.Image) -> Image.Image:
    """
    Trim transparent pixels from all sides using the alpha channel.

    NOTE:
    - This changes the frame's bounding box and implicit anchor.
    - Can cause baseline jitter for character animations.
    """
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    alpha = img.split()[-1]
    bbox = alpha.getbbox()

    # If the image is fully transparent, return it unchanged
    if bbox is None:
        return img

    return img.crop(bbox)


def rescale_to_box(img: Image.Image, target_size: int) -> Image.Image:
    """
    Scale an image to fit inside target_size x target_size.

    - Preserves aspect ratio
    - Uses nearest-neighbor (pixel-art safe)
    - Scaling is PER FRAME (important for animation alignment!)
    """
    if target_size <= 0:
        raise ValueError("--target-size must be > 0")

    w, h = img.size
    if w == 0 or h == 0:
        return img

    scale = min(target_size / w, target_size / h)
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))

    return img.resize((new_w, new_h), resample=Image.NEAREST)


def process_frames(
    frames: List[Frame],
    do_trim: bool,
    target_size: Optional[int],
) -> Tuple[List[Frame], int, int]:
    """
    Apply optional trimming and rescaling to all frames.

    Returns:
      - processed frames
      - cell_w, cell_h: the CONTENT size used when packing (before padding)

    Behavior:
    - If target_size is provided:
        cell_w = cell_h = target_size
    - Otherwise:
        cell size is the max width/height across processed frames
    """
    processed: List[Frame] = []
    max_w = 0
    max_h = 0

    for fr in frames:
        img = fr.image

        if do_trim:
            img = trim_alpha(img)

        if target_size is not None:
            img = rescale_to_box(img, target_size)

        w, h = img.size
        max_w = max(max_w, w)
        max_h = max(max_h, h)

        processed.append(
            Frame(name=fr.name, image=img, source_index=fr.source_index)
        )

    if target_size is not None:
        cell_w = target_size
        cell_h = target_size
        print(f"Processed frames: trimmed={do_trim}, fit-to-box={target_size}x{target_size}")
    else:
        cell_w = max_w
        cell_h = max_h
        print(f"Processed frames: trimmed={do_trim}, no rescale; max={cell_w}x{cell_h}")

    return processed, cell_w, cell_h


# ---------------------------------------------------------------------------
# Packing logic
# ---------------------------------------------------------------------------

def pack_frames(
    frames: List[Frame],
    cell_w: int,
    cell_h: int,
    padding: int,
    layout: str,
    columns: int,
) -> Tuple[Image.Image, List[dict]]:
    """
    Pack frames into a new sprite sheet.

    layout:
      - "row"  → single horizontal strip
      - "grid" → rows x columns grid

    Returns:
      - Packed RGBA sprite sheet
      - Manifest entries describing where each frame landed
    """
    if padding < 0:
        raise ValueError("--padding must be >= 0")
    if cell_w <= 0 or cell_h <= 0:
        raise ValueError("Computed cell size must be > 0")

    count = len(frames)

    # Full cell includes padding on all sides
    full_cell_w = cell_w + 2 * padding
    full_cell_h = cell_h + 2 * padding

    # Determine column count
    if layout == "row":
        cols = count
    elif layout == "grid":
        if columns and columns > 0:
            cols = min(columns, count)
        else:
            # Auto-choose something roughly square
            cols = max(1, int(math.ceil(math.sqrt(count))))
    else:
        raise ValueError("--layout must be 'row' or 'grid'")

    rows = math.ceil(count / cols)
    sheet_w = cols * full_cell_w
    sheet_h = rows * full_cell_h

    print(
        f"Packing {count} frames into {rows}x{cols} "
        f"(sheet {sheet_w}x{sheet_h}, cell {full_cell_w}x{full_cell_h}, padding={padding})"
    )

    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    manifest: List[dict] = []

    for i, fr in enumerate(frames):
        r = i // cols
        c = i % cols

        # Top-left corner of this cell
        x_cell = c * full_cell_w
        y_cell = r * full_cell_h

        img = fr.image
        w, h = img.size

        # Center the sprite inside the cell's content area
        x = x_cell + padding + (cell_w - w) // 2
        y = y_cell + padding + (cell_h - h) // 2

        sheet.paste(img, (x, y), img)

        manifest.append(
            {
                "index": fr.source_index,
                "name": fr.name,
                "row": r,
                "col": c,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "cell_w": cell_w,
                "cell_h": cell_h,
                "padding": padding,
            }
        )

    return sheet, manifest


# ---------------------------------------------------------------------------
# CLI plumbing
# ---------------------------------------------------------------------------

def infer_mode(input_path: Path) -> str:
    """Infer input mode from filesystem object."""
    if input_path.is_dir():
        return "frames"
    if input_path.is_file():
        return "sheet"
    raise ValueError(f"Input path does not exist: {input_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Trim/rescale and repack either (A) a grid sprite sheet or (B) a directory of frames."
    )

    # Input / output
    parser.add_argument("input", help="Input sprite sheet file OR directory of frame images")
    parser.add_argument("-o", "--output", default="out_spritesheet.png", help="Output PNG path")
    parser.add_argument("--manifest", default=None, help="Optional JSON manifest output path")

    # Processing options
    parser.add_argument("--trim", action="store_true", help="Trim transparent borders per frame")
    parser.add_argument(
        "--target-size",
        type=int,
        default=None,
        help="Scale frames to fit inside target_size x target_size (nearest-neighbor).",
    )

    # Sheet-only options
    parser.add_argument("--frame-width", type=int, default=None, help="Frame width for sheet slicing")
    parser.add_argument("--frame-height", type=int, default=None, help="Frame height for sheet slicing")

    # Packing options
    parser.add_argument("--padding", type=int, default=0, help="Padding in pixels around each frame")
    parser.add_argument("--layout", choices=["row", "grid"], default="row", help="Packing layout")
    parser.add_argument("--columns", type=int, default=0, help="Columns for grid layout")

    args = parser.parse_args()

    input_path = Path(args.input)
    mode = infer_mode(input_path)

    # Acquire frames (only place where behavior branches)
    if mode == "frames":
        frames = load_frames_from_dir(input_path)
    else:
        if args.frame_width is None or args.frame_height is None:
            raise SystemExit("For sheet input, you must provide --frame-width and --frame-height.")
        frames = slice_sheet_grid(input_path, args.frame_width, args.frame_height)

    # Shared processing
    frames, cell_w, cell_h = process_frames(frames, do_trim=args.trim, target_size=args.target_size)

    # Packing
    sheet, manifest = pack_frames(
        frames=frames,
        cell_w=cell_w,
        cell_h=cell_h,
        padding=args.padding,
        layout=args.layout,
        columns=args.columns,
    )

    # Save outputs
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
    print(f"Saved packed sheet to: {out_path}")

    if args.manifest:
        man_path = Path(args.manifest)
        man_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "output": str(out_path),
            "layout": args.layout,
            "columns": None if args.layout == "row" else (args.columns if args.columns > 0 else "auto"),
            "cell_w": cell_w,
            "cell_h": cell_h,
            "padding": args.padding,
            "trim": bool(args.trim),
            "target_size": args.target_size,
            "frames": manifest,
        }
        man_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"Saved manifest to: {man_path}")


if __name__ == "__main__":
    main()
