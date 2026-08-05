# Sprite Sheet Packer

A lightweight browser utility for slicing, trimming, resizing, and packing sprite frames into a transparent PNG. The application has no backend: files are decoded and processed entirely on your device and are never uploaded by the application.

## Input modes

- **Grid sprite sheet:** choose one image and provide its frame width and height. Source dimensions are detected automatically, and obvious horizontal or vertical strips receive a suggested square frame size. The sheet must divide evenly; frames are sliced in row-major order and named `frame_000.png`, `frame_001.png`, and so on.
- **Individual frames:** choose or drop multiple images, or choose a folder in supporting browsers. Frames are naturally sorted by filename (`frame2` before `frame10`), and their order, dimensions, and previews are shown before processing.
- **Multiple sprite sheets:** choose, drop, or select a folder of completed sheets. They are naturally sorted by filename and each image remains one atomic rectangle: sheets are never sliced, trimmed, resized, or rotated.

PNG, GIF, JPEG, and WebP inputs are accepted where the browser supports decoding them. Animated inputs are decoded as a single bitmap; the application does not extract their individual animation frames.

## Features

- Optional alignment-preserving transparent-border trimming for equally sized frame batches
- Optional nearest-neighbor scaling to fit a square target size
- Nonnegative padding around every content cell
- Single-row or grid layout, with automatic or explicit column counts
- Four atlas layouts for complete sheets: horizontal, vertical, grid, and compact
- Checkerboard preview and downloadable transparent PNG
- Downloadable JSON manifest compatible with the original CLI schema
- No backend, runtime API calls, externally hosted assets, or production dependencies

> **Animation alignment:** Equally sized animation frames use one shared trim rectangle so poses retain their relative alignment. Differently sized inputs fall back to per-frame trimming and may exhibit animation jitter; the app warns when this fallback is needed.

## Development

Prerequisite: a current Node.js release compatible with [Vite 8](https://vite.dev/blog/announcing-vite8) (Node.js 20.19+ or 22.12+).

```bash
npm install
npm run dev
```

Vite prints the local development URL. Processing remains in the browser.

Run the pure-logic tests with Node's built-in test runner:

```bash
npm test
```

Create and inspect a production build:

```bash
npm run build
npm run preview
```

## Static deployment

`npm run build` writes the application to `dist/`. Deploy that directory as static files to Cloudflare Pages, GitHub Pages, or another static host. For a project hosted below a URL subpath, pass the appropriate Vite base at build time—for example:

```bash
npm run build -- --base=/repository-name/
```

No API, Python installation, or server-side processing is needed.

## Manifest

The JSON download preserves the original CLI schema fields: top-level output and packing options plus a `frames` array. Every frame includes its processed index and name, row and column, processed dimensions, content-cell dimensions, padding, and the final `x`/`y` coordinates of its centered image. Frame manifests also include a top-level `input` object so the uploaded source can be identified without changing the meaning of `frames[].name`.

Grid-sheet manifests store the uploaded sheet filename, decoded sheet dimensions, and selected frame width and height under `input` with `mode: "sheet"`. The sliced frames still use generated logical names such as `frame_000.png`, `frame_001.png`, and so on because those frames did not originate as separate uploaded files.

Individual-frame manifests store `input.mode: "frames"` and the uploaded frame count. Each `frames[].name` remains the naturally sorted uploaded filename, so a selection such as `death1.png`, `death2.png`, and `death10.png` appears in that order in the manifest.

Multiple-sheet mode instead writes a sheet-level atlas manifest with `type: "atlas"`, the output dimensions, selected layout, effective rows and columns, gap, effective compact maximum width, and a naturally ordered `sheets` array containing each source filename, original dimensions, index, and final coordinates. Atlas manifests continue to list original uploaded filenames under `sheets`; manifests belonging to the uploaded sheets are not read or merged.

### Atlas layout behavior

- **Horizontal** places original-size sheets left to right with top edges aligned.
- **Vertical** places them top to bottom with left edges aligned.
- **Grid** uses the widest and tallest inputs as the uniform cell size, centers each sheet in its cell, and supports automatic or explicit columns.
- **Compact** deterministically packs variable-size rectangles without rotation. Its optional maximum width must be at least the widest input. When blank, a width is derived from total image area and clamped to the widest input.

The nonnegative atlas gap is inserted only between sheets or grid cells. Every layout preserves source pixels and transparent space without scaling or rotation.

## Browser limitations

Maximum canvas dimensions and memory vary by browser and device. The app reports allocation, rendering, or PNG-export failures rather than assuming one universal limit. Very large inputs still process on the main thread with a visible busy status. Animated inputs are not expanded into multiple frames.
