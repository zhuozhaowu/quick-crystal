# Quick Crystal

Quick Crystal is a browser-based crystal cartoon renderer for CIF, VESTA, POSCAR, and `.vasp` structure files. It can run from GitHub Pages or locally in your browser after download.

## Quick Start

Use either path:

1. Cloud version:

```text
https://zhuozhaowu.github.io/quick-crystal/
```

2. Downloaded Windows copy:

```text
Quick Crystal.vbs
```

The cloud version runs directly from GitHub Pages. The downloaded Windows copy starts a hidden local web server and opens Quick Crystal in your default browser.

If the app does not open, run the troubleshooting launcher instead:

```text
scripts\Open Quick Crystal.bat
```

The troubleshooting launcher keeps the window open when startup fails, so you can read the error message.

## Requirements

- Cloud version: a modern browser such as Chrome, Edge, or Firefox
- Downloaded Windows copy: Windows and Python 3 available from the command line

No internet connection is required for the downloaded copy after launch. Three.js, icons, and fonts are included in `vendor\`.

## How To Use

1. Open the cloud URL or launch the downloaded copy with `Quick Crystal.vbs`.
2. Click **Open ( CIF / Vesta / POSCAR )**.
3. Choose a `.cif`, `.vesta`, `POSCAR`, or `.vasp` structure file.
4. Adjust view, structure preview, colors, radii, lighting, and export options from the left panel.
5. Export a PNG from the **Export** section.

Do not open `src\index.html` directly from the file system. Browsers block JavaScript module loading from `file://` paths, so the renderer may not start.

## Controls

- Left drag: rotate the structure around the origin.
- Right drag: pan the view.
- Mouse wheel: zoom in and out.
- X, Y, Z keys: jump to orthographic axis views.
- Click an atom, then press Delete or Backspace: delete that atom from the current view.
- Click a bond, then press Delete or Backspace: delete that bond from the current view.

## Features

- Load CIF, VESTA, POSCAR, and `.vasp` files.
- Preview supercells without modifying the source file.
- Toggle unit-cell wireframe display.
- Detect regular bonds from element radii and bond tolerance.
- Show dashed H/D...O hydrogen-bond interactions using VESTA-style 1.20-2.10 A distance limits.
- Edit element colors and bonding radii.
- Adjust atom radius, bond radius, bond tolerance, outline width, lighting direction, key light, ambient light, and highlight size.
- Export high-resolution PNG images.
- Export isolated atom PNGs for each element.

## Folder Contents

- `Quick Crystal.vbs` - recommended launcher for normal use.
- `index.html` - redirect page for static hosting.
- `src\` - application UI and JavaScript.
- `vendor\` - offline runtime libraries, fonts, and icons.
- `scripts\open-local.ps1` - local server launcher used by `Quick Crystal.vbs`.
- `scripts\Open Quick Crystal.bat` - troubleshooting launcher.
- `LICENSE` - license file.

## GitHub Hosting

This folder can be uploaded as a static website. Serve the folder root. The root `index.html` redirects to `src\index.html`.

For GitHub Pages, place these files at the repository root and enable Pages for the branch or workflow you use.

## Troubleshooting

If double-clicking `Quick Crystal.vbs` does nothing:

1. Run `scripts\Open Quick Crystal.bat`.
2. Read the error in the command window.
3. If Python is missing, install Python 3 and try again.

If a browser shows a module-loading or CORS error, make sure you launched the app through `Quick Crystal.vbs` or a local web server instead of opening `src\index.html` directly.
