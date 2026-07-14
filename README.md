# Quick Crystal

Quick Crystal is a browser-based crystal cartoon renderer for CIF, VESTA, POSCAR, and `.vasp` structure files. It loads structure files locally in the browser, renders atom-and-bond cartoons with Three.js, and provides compact controls for structure preview, element styling, appearance, view-locked lighting, camera views, and export.

The app is a static frontend. It does not require a backend, but it should be served through local HTTP or static hosting so browser JavaScript modules can load correctly. Runtime browser dependencies are vendored in `vendor/`, so the app can run offline after download.

## Features

- Load CIF, VESTA, POSCAR, and `.vasp` files.
- Preserve common unit-cell metadata and fractional coordinates after loading.
- Detect bonds from element radii, bond tolerance, and periodic minimum-image distances when crystal coordinates are available.
- Preview X/Y/Z supercells without changing the source structure data.
- Toggle the unit-cell wireframe and inspect live atom, bond, PBC, and element statistics.
- Adjust per-element colors and bonding radii from the sidebar.
- Tune atom radius, bond radius, bond tolerance, outline width, view-locked light direction, key light, and ambient light.
- Control camera orientation with X/Y/Z rotation angles or hkl-normal views.
- Drag to rotate the model with OrbitControls.
- Click a bond and press `Delete` to remove it from the current view.
- Export high-resolution PNG screenshots and transparent per-element atom PNGs as a ZIP.

## Project Layout

- `index.html` - root redirect used by static hosting and GitHub Pages.
- `src/index.html` - main application shell and UI markup.
- `src/app.js` - structure parsing, Three.js scene setup, interaction, rendering, and export logic.
- `src/config.js` - render defaults, element styles, figure presets, and shared constants.
- `src/dom.js` - DOM lookup helper for UI controls.
- `src/three-resource-lifecycle.js` - geometry, material, texture, and scene disposal helpers.
- `src/styles/tailwind-input.css` - Tailwind source stylesheet.
- `src/styles/tailwind.css` - compiled production stylesheet used by the app.
- `vendor/` - committed runtime assets for offline use: Three.js modules, Phosphor icons, and Fira fonts.
- `scripts/open-local.ps1` - local static-server launcher.
- `scripts/build-vendor.mjs` - rebuilds `vendor/` from npm packages after dependency updates.
- `.nojekyll` - tells GitHub Pages to serve files as plain static assets.
- `.github/workflows/pages.yml` - optional GitHub Pages deployment workflow.
- `Open Quick Crystal.bat` - Windows double-click launcher.
- `package.json` and `tailwind.config.js` - Tailwind build setup.

## Cloud Usage

For GitHub Pages, serve the repository root. The root `index.html` redirects visitors to `src/index.html`, where the application lives.

If you use the included workflow:

1. Push the repository to GitHub with `main` as the default branch.
2. In the repository settings, enable GitHub Pages with **GitHub Actions** as the source.
3. Push to `main`, or run the workflow manually from the Actions tab.

The deployed site runs fully from repository files. It does not fetch Three.js, icons, or fonts from a CDN at runtime.

## Local Usage

Recommended on Windows:

```text
Open Quick Crystal.bat
```

The launcher starts a local server and opens the app in the browser. Keep the launcher window open while using the app; closing it stops the server. Python 3 must be available on the machine because the launcher uses Python's built-in static file server.

This path works offline because Three.js, icons, and fonts are stored in `vendor/`.

To use the GitHub download offline:

1. Open the GitHub repository.
2. Choose **Code** > **Download ZIP**.
3. Extract the ZIP.
4. Double-click `Open Quick Crystal.bat`.

Manual launch:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/src/index.html
```

Do not open `src/index.html` directly through a `file://` path. Modern browsers block local module imports in that mode, which prevents the renderer and model loader from starting.

## Offline Runtime Assets

The app intentionally avoids runtime CDN requests. These files are committed:

- `vendor/three/0.160.0/` - Three.js core module, OrbitControls, and OutlineEffect.
- `vendor/phosphor/2.1.2/` - regular Phosphor icon font files.
- `vendor/fonts/` - Fira Sans and Fira Code webfont files.

After changing dependency versions in `package.json`, rebuild vendor assets:

```bash
npm install
npm run build:vendor
```

## Build CSS

The compiled Tailwind stylesheet and vendored runtime assets are committed, so normal local use and static hosting do not require a build step.

Run this only after changing Tailwind classes or `src/styles/tailwind-input.css`:

```bash
npm install
npm run build:css
```

## Supported Formats

- `.cif`
- `.vasp`
- `POSCAR`
- VESTA-style structure files

## Notes

Quick Crystal is intended for quick visualization, teaching, demos, and draft figure generation. It is not a full crystallography engine.

- CIF parsing supports common cell and atom-site fields, including quoted values and uncertainty suffixes such as `1.234(5)`.
- Complex symmetry expansion, partial occupancies, and disorder are not fully modeled.
- Bond detection is heuristic and may need manual radius or tolerance adjustment for specific systems.
- Very large structures may reduce browser performance.

## License

See [LICENSE](./LICENSE).
