# Meshy To STL

Meshy To STL is a Chrome extension that finds `.meshy` files loaded by the current browser tab and converts them to STL, OBJ, GLTF, or GLB files, including the model's embedded textures.

## Features

- Detects `.meshy` files from the current page network activity.
- Also checks browser resource entries from `performance.getEntriesByType("resource")`.
- Converts Meshy encrypted model files locally in the browser.
- Exports binary STL for 3D printing, OBJ or GLTF packages for 3D editors, or the decoded GLB model.
- Extracts the embedded textures and names them by role (`baseColor`, `normal`, `metallicRoughness`, ...).
- Writes OBJ files with UV coordinates and an `.mtl` that points at the exported textures.
- Honors the UV set (`texCoord`) and `KHR_texture_transform` declared by each material, so textures line up in Blender, Maya, and other editors.
- Lets you rename the exported file before downloading.
- Remembers the last output format and PNG preference.
- Optionally converts textures to PNG for tools that cannot read WebP.
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
5. Adjust the `File name` if you do not want the name taken from the URL.
6. Pick an output format:

   | Format | What you get |
   | --- | --- |
   | STL | Binary STL for 3D printing. STL cannot store textures. |
   | OBJ + textures | `.zip` with the `.obj`, an `.mtl`, and a `textures/` folder. |
   | GLTF + textures | `.zip` with a `.gltf`, its `.bin`, and a `textures/` folder. |
   | GLB | The decoded model exactly as the decoder returned it. |
   | Textures only | `.zip` with the original embedded textures. |

7. Click `Inspect textures` if you want to see which maps the model has before downloading.
8. Click the download button.

## Notes

- Conversion runs locally in your browser.
- `chrome-extension/vendor/mesh_loader.js` and `chrome-extension/vendor/mesh_loader.wasm` are intentionally not versioned.
- On Windows, run `setup-vendor.ps1` after cloning or extracting the project.
- On macOS or Linux, run `sh ./setup-vendor.sh` after cloning or extracting the project.
- If the extension says decoder files are missing, run the setup script for your operating system and reload the extension in `chrome://extensions`.
- The extension requires Google Chrome or a compatible Chromium browser; Safari is not supported.
- Sites with login, temporary URLs, or strict download permissions may require you to be logged in with the same Chrome session.
- Meshy ships textures as WebP (`EXT_texture_webp`). Keep `Convert textures to PNG` enabled if your editor cannot read WebP; PNG files are larger but open almost everywhere.
- MTL has no standard slot for a metallic-roughness map, so that texture is included in `textures/` and referenced as a comment in the `.mtl`.
- OBJ export reads the UV set named by `baseColorTexture.texCoord` and bakes `KHR_texture_transform` into the `vt` lines, so offset, scale, and rotation survive the export.
- The popup remembers the selected format and the PNG checkbox in `localStorage`; the file name is not remembered because it belongs to the model you picked.
- STL output is binary and contains geometry only. GLB output is byte-for-byte the decoded model.

## Development

```bash
npm test
```

The tests cover the GLB parser, texture discovery, OBJ/MTL output, the ZIP writer, and the GLTF package builder. They do not need the Meshy decoder files.

GitHub Actions runs the same suite on every push and pull request.
