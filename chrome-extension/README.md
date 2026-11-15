# Meshy To STL

Local Chrome extension that finds `.meshy` files loaded by the current tab and converts them to STL, OBJ, GLTF, or GLB, including the model's embedded textures.

## Install

Before loading the extension, download the local decoder files:

### Windows

```powershell
cd C:\path\to\meshy-to-stl
powershell -ExecutionPolicy Bypass -File .\setup-vendor.ps1
```

### macOS or Linux

Open Terminal in the project root (the folder above `chrome-extension`) and run:

```bash
sh ./setup-vendor.sh
```

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the project's `chrome-extension` folder.

## Use

1. Open the page where the `.meshy` model is hosted.
2. Reload the page so the extension can capture network activity.
3. Click the extension icon.
4. Select the detected `.meshy` file and edit `File name` if the URL name is not what you want.
5. Choose STL, OBJ + textures, GLTF + textures, GLB, or textures only.
6. Click the download button.

`OBJ + textures`, `GLTF + textures`, and `Textures only` download a `.zip` that contains a `textures/` folder. `Inspect textures` shows the maps inside the model before you download anything. The popup remembers the last format and PNG preference.

## Notes

- Conversion runs locally in the browser.
- `vendor/mesh_loader.js` and `vendor/mesh_loader.wasm` are not versioned in this repository; run the setup script for your operating system to download local copies.
- If the extension says decoder files are missing, run `setup-vendor.ps1` on Windows or `sh ./setup-vendor.sh` on macOS/Linux, then reload the extension in `chrome://extensions`.
- The extension requires Google Chrome or a compatible Chromium browser; Safari is not supported.
- STL output is binary and geometry-only. OBJ output includes UVs and a `.mtl`; GLTF output is a separate file set. GLB preserves the decoded model data.
- OBJ export uses the UV set named by the material and applies `KHR_texture_transform`, so textures line up in Blender and other editors.
- Textures are named by material role (`baseColor`, `normal`, `metallicRoughness`, ...). Meshy ships them as WebP, and `Convert textures to PNG` transcodes them for editors that cannot read WebP.
- The extension also checks `performance.getEntriesByType("resource")`, so many files visible in the Network panel will automatically appear in the popup.
- Sites with login, temporary URLs, or strict download permissions may require you to be logged in with the same Chrome session.
