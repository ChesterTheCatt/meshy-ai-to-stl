# Meshy To STL

Meshy To STL is a Chrome extension that finds `.meshy` files loaded by the current browser tab and converts them to STL, OBJ, or GLB files.

## Features

- Detects `.meshy` files from the current page network activity.
- Also checks browser resource entries from `performance.getEntriesByType("resource")`.
- Converts Meshy encrypted model files locally in the browser.
- Exports binary STL for 3D printing, OBJ for 3D editors, or the decoded GLB model.
- Does not commit Meshy's loader files to this repository.

## Installation

Before loading the extension, download the local decoder files:

### Windows

```powershell
cd C:\path\to\meshy-to-stl
powershell -ExecutionPolicy Bypass -File .\setup-vendor.ps1
```

### macOS or Linux

Open Terminal in the extracted project folder and run:

```bash
sh ./setup-vendor.sh
```

Then load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the project's `chrome-extension` folder.

## Usage

1. Open the page where the Meshy model is hosted.
2. Reload the page so the extension can capture network requests.
3. Click the Meshy To STL extension icon.
4. Select the detected `.meshy` file.
5. Choose STL, OBJ, or GLB.
6. Click the download button.

## Notes

- Conversion runs locally in your browser.
- `chrome-extension/vendor/mesh_loader.js` and `chrome-extension/vendor/mesh_loader.wasm` are intentionally not versioned.
- On Windows, run `setup-vendor.ps1` after cloning or extracting the project.
- On macOS or Linux, run `sh ./setup-vendor.sh` after cloning or extracting the project.
- If the extension says decoder files are missing, run the setup script for your operating system and reload the extension in `chrome://extensions`.
- The extension requires Google Chrome or a compatible Chromium browser; Safari is not supported.
- Sites with login, temporary URLs, or strict download permissions may require you to be logged in with the same Chrome session.
