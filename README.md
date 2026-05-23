# Perfect Pixels

Perfect Pixels is a local-first pixel frame editor for sprite sheets. It is built for pixel-art animation cleanup: import frames, edit individual pixels, manage palettes and layers, preview playback, save project files, and export clean PNG frames or horizontal sprite sheets.

The app runs as both a web tool and a Tauri desktop app. Images stay on your machine; there is no upload step.

## Features

- Import PNG, WebP, and JPG sprite sheets.
- Auto-detect common frame sizes, such as `192x48` as four `48x48` frames.
- Convert pure `#ff00ff` chroma-key pixels to transparency on import.
- Edit pixels with pencil, eraser, eyedropper, bucket fill, rectangle, line, replace-color, lighten, and darken tools.
- Use custom palettes, built-in palettes, and eyedropper-to-palette capture.
- Manage shared layers across all frames, including rename, visibility, lock, solo view, and drag sorting.
- Add, duplicate, delete, and drag-sort frames.
- Preview animation playback with FPS controls.
- Resize the working canvas while keeping existing pixels.
- Save and reopen `.pfe.json` project files.
- Export the current frame or a horizontal sprite sheet as PNG.
- Desktop app export uses a native save dialog.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Z` | Undo |
| `B` | Pencil |
| `E` | Eraser |
| `I` | Eyedropper |
| `G` | Bucket fill |
| `R` | Rectangle |
| `L` | Line |
| `X` | Replace matching color |
| `O` / `P` | Lighten / darken |
| `[` / `]` | Decrease / increase brush size |
| `Ctrl+Shift+N` | New blank frame |
| `Ctrl+D` | Duplicate current frame |
| `Delete` | Delete current frame |
| Hold `Space` | Pan canvas |

## Development

Requirements:

- Node.js
- Rust and Cargo
- Visual Studio Build Tools with the C++ workload on Windows

Install dependencies:

```powershell
npm install
npm run tauri:icons
```

Run the web app:

```powershell
npm run dev -- --port 5174
```

Run the Tauri desktop app:

```powershell
npm run tauri:dev
```

Build the web app:

```powershell
npm run build
```

Build the Tauri app:

```powershell
npm run tauri:icons
npm run tauri:build
```

## Project Files

Perfect Pixels project files use the `.pfe.json` extension. They store frame images, layer data, palettes, playback settings, and project metadata so you can reopen unfinished pixel animations later.

## Author

Bilibili: Rice要永远跑下去

## License

MIT
