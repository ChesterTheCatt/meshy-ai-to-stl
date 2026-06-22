# Meshy To STL

Local Chrome extension that finds `.meshy` files loaded by the current tab and converts them to binary STL.

## Install

Before loading the extension, download the local decoder files:

```powershell
cd C:\Users\SEU_USUARIO\Desktop\meshy
powershell -ExecutionPolicy Bypass -File .\setup-vendor.ps1
```

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `C:\Users\SEU_USUARIO\Desktop\meshy\chrome-extension`.

## Use

1. Open the page where the `.meshy` model is hosted.
2. Reload the page so the extension can capture network activity.
3. Click the extension icon.
4. Select the detected `.meshy` file.
5. Click `Download STL`.

## Notes

- Conversion runs locally in the browser.
- `vendor/mesh_loader.js` and `vendor/mesh_loader.wasm` are not versioned in this repository; run `setup-vendor.ps1` to download your local copies.
- If the extension says decoder files are missing, run `setup-vendor.ps1` and reload the extension in `chrome://extensions`.
- The downloaded `.stl` file is binary, so it is smaller than ASCII STL.
- The extension also checks `performance.getEntriesByType("resource")`, so many files visible in the Network panel will automatically appear in the popup.
- Sites with login, temporary URLs, or strict download permissions may require you to be logged in with the same Chrome session.
