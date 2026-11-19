# Meshy To STL (Firefox)

Firefox add-on that finds `.meshy` files loaded by the current tab and converts them to STL, OBJ, or GLB.

This is a Manifest V2 add-on. Meshy's decoder uses `new Function` (eval), which Firefox only allows in Manifest V2 add-ons.

## Install

First download the decoder files. Run the setup script from the project root (the folder above `firefox-extension`):

### Windows

```powershell
cd C:\path\to\meshy-to-stl
powershell -ExecutionPolicy Bypass -File .\setup-vendor.ps1
```

### macOS or Linux

```bash
sh ./setup-vendor.sh
```

The script fills both `chrome-extension/vendor` and `firefox-extension/vendor`.

Then load the add-on in Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on...`.
3. Select `firefox-extension/manifest.json`.

Firefox removes temporary add-ons when it restarts. To keep it installed, sign it through addons.mozilla.org (it can be unlisted), or use Firefox Developer Edition/Nightly with `xpinstall.signatures.required` set to `false` and install a zipped copy of the folder.

## Use

1. Open the page where the `.meshy` model is hosted.
2. Reload the page so the add-on can capture network activity.
3. Click the add-on icon in the toolbar.
4. Select the detected `.meshy` file.
5. Choose STL, OBJ, or GLB.
6. Click the download button.

## Notes

- Conversion runs locally in the browser.
- If the add-on says decoder files are missing, run the setup script, then click `Reload` for the add-on in `about:debugging`.
- If no files are found, check that the add-on has permission to access the site (Extensions menu > Meshy To STL > site access).
