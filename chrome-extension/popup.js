const linksSelect = document.getElementById("links");
const baseNameInput = document.getElementById("base-name");
const formatSelect = document.getElementById("format");
const pngCheckbox = document.getElementById("png");
const pngRow = document.getElementById("png-row");
const scanButton = document.getElementById("scan");
const inspectButton = document.getElementById("inspect");
const convertButton = document.getElementById("convert");
const statusEl = document.getElementById("status");
const progress = document.getElementById("progress");
const sandboxFrame = document.getElementById("sandbox");
const textureBox = document.getElementById("texture-box");
const textureSummary = document.getElementById("texture-summary");
const textureList = document.getElementById("texture-list");

const FORMAT_LABELS = {
  stl: "Download STL",
  obj: "Download OBJ + textures",
  gltf: "Download GLTF + textures",
  glb: "Download GLB",
  textures: "Download textures",
};

const FORMAT_PROGRESS = {
  stl: "Converting to STL...",
  obj: "Building OBJ + textures...",
  gltf: "Building GLTF + textures...",
  glb: "Decoding GLB...",
  textures: "Extracting textures...",
};

let jobId = 0;
let inspectedKey = "";
let previewUrls = [];
let lastPreviews = [];

function setBusy(isBusy, text) {
  scanButton.disabled = isBusy;
  baseNameInput.disabled = isBusy;
  inspectButton.disabled = isBusy;
  convertButton.disabled = isBusy;
  progress.hidden = !isBusy;
  if (text !== undefined) statusEl.textContent = text;
}

function isMeshyUrl(value) {
  if (!value || typeof value !== "string") return false;
  const clean = value.split("#")[0];
  return /\.meshy(?:$|[?&])/i.test(clean) || clean.includes("misc/cdn-models");
}

const PREFS_KEY = "meshy-to-stl/preferences";

function sanitizeBaseName(value, fallback = "model") {
  const clean = String(value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return clean || fallback;
}

function baseNameFromUrl(value) {
  try {
    const path = new URL(value).pathname.split("/").pop() || "model.meshy";
    const decoded = decodeURIComponent(path).replace(/\.meshy$/i, "");
    return sanitizeBaseName(decoded);
  } catch {
    return "model";
  }
}

function currentBaseName(url) {
  return sanitizeBaseName(baseNameInput.value, baseNameFromUrl(url));
}

function loadPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePreferences() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      format: formatSelect.value,
      png: pngCheckbox.checked,
    }));
  } catch {
    // Preferences are optional.
  }
}

function scanPageForMeshyLinks() {
  const urls = new Set();
  const add = (value) => {
    if (!value || typeof value !== "string") return;
    try {
      const url = new URL(value, location.href);
      const clean = url.href.split("#")[0];
      if (/\.meshy(?:$|[?&])/i.test(clean) || clean.includes("misc/cdn-models")) urls.add(url.href);
    } catch {
      // Ignore invalid URLs.
    }
  };

  performance.getEntriesByType("resource").forEach((entry) => add(entry.name));
  document.querySelectorAll("a[href]").forEach((el) => add(el.getAttribute("href")));
  document.querySelectorAll("[src]").forEach((el) => add(el.getAttribute("src")));
  document.querySelectorAll("[data-src],[data-url],[data-model-url]").forEach((el) => {
    add(el.getAttribute("data-src"));
    add(el.getAttribute("data-url"));
    add(el.getAttribute("data-model-url"));
  });
  for (const match of document.documentElement.innerHTML.matchAll(/https?:\/\/[^"'<>\\\s]+(?:\.meshy|misc\/cdn-models)[^"'<>\\\s]*/gi)) {
    add(match[0]);
  }

  return [...urls].slice(0, 50);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Could not access the current tab.");
  return tab;
}

async function getLinksFromActiveTab() {
  const tab = await getActiveTab();
  const all = new Set();

  const remembered = await chrome.runtime.sendMessage({ type: "get-meshy-requests", tabId: tab.id }).catch(() => null);
  for (const link of remembered?.links || []) all.add(link);

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "scan-meshy-links" });
    for (const link of response?.links || []) all.add(link);
  } catch {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanPageForMeshyLinks,
    });
    for (const link of result?.result || []) all.add(link);
  }

  return [...all].filter(isMeshyUrl).slice(0, 50);
}

function fillLinks(links) {
  linksSelect.replaceChildren();
  for (const link of links) {
    const option = document.createElement("option");
    option.value = link;
    option.textContent = link;
    linksSelect.append(option);
  }
  if (linksSelect.options.length) {
    linksSelect.selectedIndex = 0;
    baseNameInput.value = baseNameFromUrl(linksSelect.value);
  }
}

function downloadBlob(blob, filename) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    chrome.downloads.download({ url: objectUrl, filename, conflictAction: "uniquify", saveAs: false }, (downloadId) => {
      const error = chrome.runtime.lastError;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      if (error) reject(new Error(error.message));
      else resolve(downloadId);
    });
  });
}

function askSandbox({ type, key, buffer, format, options, baseName }) {
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    const onMessage = (event) => {
      if (event.source !== sandboxFrame.contentWindow || event.data?.id !== id) return;
      window.removeEventListener("message", onMessage);
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error || "Conversion failed"));
    };
    window.addEventListener("message", onMessage);

    const payload = { type, id, key, format, options, baseName };
    const transfer = [];
    if (buffer) {
      payload.buffer = buffer;
      transfer.push(buffer);
    }
    sandboxFrame.contentWindow.postMessage(payload, "*", transfer);
  });
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url, { credentials: "include", redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
}

async function runSandboxJob(request, url) {
  try {
    return await askSandbox(request);
  } catch (error) {
    if (!request.buffer && /Decode the file first/i.test(error.message)) {
      request.buffer = await fetchArrayBuffer(url);
      return await askSandbox(request);
    }
    throw error;
  }
}

function convertSelected(url, format, buffer) {
  const baseName = currentBaseName(url);
  const png = (format === "obj" || format === "gltf") && pngCheckbox.checked;
  return runSandboxJob({
    type: "convert",
    key: url,
    buffer,
    format,
    options: { png, baseName },
    baseName,
  }, url);
}

function formatBytes(size) {
  if (!size) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function describeStats(stats) {
  if (!stats) return "";
  const parts = [];
  if (stats.triangles) parts.push(`${stats.triangles.toLocaleString()} triangles`);
  if (stats.textures?.length) parts.push(`${stats.textures.length} texture(s)`);
  return parts.join(" · ");
}

function clearTextures() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  textureList.replaceChildren();
  textureBox.hidden = true;
}

function renderTextures(stats, previews) {
  clearTextures();
  const textures = stats?.textures || [];
  if (!textures.length) return;

  textureBox.hidden = false;
  textureSummary.textContent = `${textures.length} texture(s) · ${formatBytes(textures.reduce((total, item) => total + item.size, 0))}`;

  for (const texture of textures) {
    const item = document.createElement("li");
    const preview = previews.find((entry) => entry.name === texture.name)
      || previews.find((entry) => entry.role === texture.role);

    if (preview) {
      const url = URL.createObjectURL(new Blob([preview.thumb], { type: "image/webp" }));
      previewUrls.push(url);
      const image = document.createElement("img");
      image.src = url;
      image.alt = texture.role;
      item.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "thumb-empty";
      placeholder.textContent = "?";
      item.append(placeholder);
    }

    const text = document.createElement("div");
    const role = document.createElement("strong");
    role.textContent = texture.role;
    const meta = document.createElement("span");
    const size = preview ? `${preview.width}×${preview.height} · ` : "";
    meta.textContent = `${size}${formatBytes(texture.size)} · ${texture.mimeType.replace("image/", "")}`;
    text.append(role, meta);
    item.append(text);

    textureList.append(item);
  }
}

function updateFormatUi() {
  const format = formatSelect.value;
  convertButton.textContent = FORMAT_LABELS[format] || "Download";
  const pngApplies = format === "obj" || format === "gltf";
  pngCheckbox.disabled = !pngApplies;
  pngRow.classList.toggle("disabled", !pngApplies);
}

async function scan() {
  try {
    setBusy(true, "Searching for .meshy files in the current tab network activity...");
    const links = await getLinksFromActiveTab();
    fillLinks(links);
    statusEl.textContent = links.length
      ? `${links.length} .meshy file(s) found.`
      : "No .meshy file found. Reload the page with the extension installed and try again.";
  } catch (error) {
    statusEl.textContent = `Scan error: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

scanButton.addEventListener("click", scan);

formatSelect.addEventListener("change", () => {
  updateFormatUi();
  savePreferences();
});

pngCheckbox.addEventListener("change", savePreferences);

linksSelect.addEventListener("change", () => {
  inspectedKey = "";
  lastPreviews = [];
  baseNameInput.value = baseNameFromUrl(linksSelect.value);
  clearTextures();
});

inspectButton.addEventListener("click", async () => {
  const url = linksSelect.value;
  if (!url) {
    statusEl.textContent = "No .meshy file selected.";
    return;
  }

  try {
    setBusy(true, inspectedKey === url ? "Reading textures..." : "Downloading .meshy...");
    const buffer = inspectedKey === url ? null : await fetchArrayBuffer(url);
    setBusy(true, "Reading textures...");
    const response = await runSandboxJob({
      type: "inspect",
      key: url,
      buffer,
      baseName: currentBaseName(url),
    }, url);
    inspectedKey = url;
    lastPreviews = response.previews || [];
    renderTextures(response.stats, lastPreviews);
    const summary = describeStats(response.stats);
    statusEl.textContent = summary
      ? `${summary}.`
      : "No embedded textures found in this model.";
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

convertButton.addEventListener("click", async () => {
  const url = linksSelect.value;
  if (!url) {
    statusEl.textContent = "No .meshy file selected.";
    return;
  }

  try {
    const format = formatSelect.value;
    setBusy(true, inspectedKey === url ? "Building output..." : "Downloading .meshy...");
    const buffer = inspectedKey === url ? null : await fetchArrayBuffer(url);
    setBusy(true, FORMAT_PROGRESS[format] || "Converting...");
    const response = await convertSelected(url, format, buffer);
    inspectedKey = url;

    const { result } = response;
    await downloadBlob(new Blob([result.bytes], { type: result.mimeType }), result.fileName);

    if (textureBox.hidden) renderTextures(response.stats, lastPreviews);
    const summary = describeStats(response.stats);
    statusEl.textContent = `${result.fileName} saved${summary ? ` · ${summary}` : ""}.`;
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

const preferences = loadPreferences();
if (preferences.format && FORMAT_LABELS[preferences.format]) formatSelect.value = preferences.format;
if (typeof preferences.png === "boolean") pngCheckbox.checked = preferences.png;
updateFormatUi();
document.addEventListener("DOMContentLoaded", scan);
