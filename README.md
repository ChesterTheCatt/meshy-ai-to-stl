# Meshy To STL

Meshy To STL is a Chrome extension that finds `.meshy` files loaded by the current browser tab and converts them to binary STL files.

## Features

- Detects `.meshy` files from the current page network activity.
- Also checks browser resource entries from `performance.getEntriesByType("resource")`.
- Converts Meshy encrypted model files locally in the browser.
- Downloads a binary `.stl` file.
- Does not commit Meshy's loader files to this repository.

## Installation

Before loading the extension, download the local decoder files:

```powershell
cd C:\Users\SEU_USUARIO\Desktop\meshy
powershell -ExecutionPolicy Bypass -File .\setup-vendor.ps1
```

Then load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `C:\Users\SEU_USUARIO\Desktop\meshy\chrome-extension`.

## Usage

1. Open the page where the Meshy model is hosted.
2. Reload the page so the extension can capture network requests.
3. Click the Meshy To STL extension icon.
4. Select the detected `.meshy` file.
5. Click `Baixar STL`.

## Notes

- Conversion runs locally in your browser.
- `chrome-extension/vendor/mesh_loader.js` and `chrome-extension/vendor/mesh_loader.wasm` are intentionally not versioned.
- Run `setup-vendor.ps1` after cloning the repository.
- Sites with login, temporary URLs, or strict download permissions may require you to be logged in with the same Chrome session.
