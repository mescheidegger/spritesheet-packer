# spritesheet-packer

A small CLI utility to **trim, optionally rescale, and repack sprites** into a new sprite sheet.

It supports **two input styles**:

- **Grid sprite sheet (single image)**  
  Slices into frames using `--frame-width` / `--frame-height`

- **Directory of frames**  
  Loads individual images from a folder (sorted by filename)

After frames are acquired, both modes share the same pipeline:

- Optional trim (remove transparent borders using alpha channel)
- Optional rescale (fit inside `target_size × target_size` using nearest-neighbor)
- Repack into a new sheet (single row or grid)
- Optional JSON manifest describing output placement

---

## External Dependencies

### Required

- **Python 3.9+** (3.8+ likely works, but 3.9+ recommended)
- **Pillow** (the Python Imaging Library fork)

Install via pip:

```bash
pip install pillow
```

### Not Required

- **FFmpeg**  
  This script slices sheets using Pillow only.

---

## Installation

1. Save the script as `sprites_tool.py`
2. Install Pillow:
   ```bash
   pip install pillow
   ```
3. Verify:
   ```bash
   python sprites_tool.py --help
   ```

---

## Quick Start

### A) Pack a directory of frames into a sheet (no trim, single row)

```bash
python sprites_tool.py ./frames -o out.png
```

### B) Trim frames and pack (single row)

```bash
python sprites_tool.py ./frames --trim -o out.png
```

### C) Trim + normalize to 32×32 cells + grid pack (8 columns)

```bash
python sprites_tool.py ./frames \
  --trim \
  --target-size 32 \
  --layout grid \
  --columns 8 \
  --padding 2 \
  -o out.png
```

---

## Mode 1: Input is a Grid Sprite Sheet

When the input is a **file**, the tool assumes it’s a sprite sheet and requires:

- `--frame-width`
- `--frame-height`

### Example

```bash
python sprites_tool.py sheet.png \
  --frame-width 128 \
  --frame-height 128 \
  --trim \
  --target-size 32 \
  --layout grid \
  --columns 8 \
  --padding 2 \
  -o out.png
```

---

## Mode 2: Input is a Directory of Frames

```bash
python sprites_tool.py ./frames \
  --layout grid \
  --columns 10 \
  -o out.png
```

---

## Notes / Limitations

- Grid packing only (no bin-packing)
- Trimming and scaling are done per frame
- Deterministic ordering (filename sort or row-major slicing)
