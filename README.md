# Sprite Sheet Packer

A lightweight browser utility for slicing, trimming, resizing, and packing sprite frames into a transparent PNG. It has no backend: files are decoded and processed entirely on your device and are never uploaded.

## Input modes

- **Grid sprite sheet:** choose one image and provide its frame width and height. The sheet must divide evenly; frames are sliced in row-major order and named `frame_000.png`, `frame_001.png`, and so on.
- **Individual frames:** choose or drop multiple images (or progressively enhance selection with **Choose folder**). Frames are sorted deterministically by filename and their order, dimensions, and previews are shown before processing.

PNG, GIF, JPEG, and WebP inputs are accepted where the browser supports decoding them. Animated formats are treated according to the browser's `createImageBitmap` decoding behavior (normally the default/first frame).

## Features

- Optional per-frame transparent-border trimming
- Optional nearest-neighbor scaling to fit a square target size
- Nonnegative padding around every content cell
- Single-row or grid layout, with automatic or explicit column counts
- Checkerboard preview and downloadable transparent PNG
- Optional compatible JSON manifest containing layout, cell, and actual centered frame coordinates
- No server, runtime service, network request, external asset, or production dependency

> **Animation alignment:** trimming and rescaling happen independently for each frame. This changes implicit anchors and may cause baseline or animation jitter, especially for character animations.

## Development

Prerequisite: a current Node.js release compatible with Vite 8 (Node.js 20.19+ or 22.12+).

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

`npm run build` writes the application to `dist/`. Deploy that directory as static files to Cloudflare Pages, GitHub Pages, or another static host. For a project site hosted below a URL subpath, pass the appropriate Vite base at build time (for example, `npm run build -- --base=/repository-name/`). No API, Python installation, or server-side processing is needed.

## Manifest

The JSON download preserves the original CLI schema: top-level output and packing options plus a `frames` array. Every frame includes its source index/name, row and column, processed dimensions, content-cell dimensions, padding, and `x`/`y` coordinates of the centered processed image within the final sheet.

## Browser limitations

Maximum canvas dimensions and memory vary by browser and device. The app reports allocation, rendering, or PNG-export failures rather than assuming one universal limit. Very large inputs still process on the main thread, with visible busy status; GIF animation is not expanded into multiple frames.
