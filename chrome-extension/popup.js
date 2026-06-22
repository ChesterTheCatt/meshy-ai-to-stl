const linksSelect = document.getElementById("links");
const scanButton = document.getElementById("scan");
const convertButton = document.getElementById("convert");
const statusEl = document.getElementById("status");
const progress = document.getElementById("progress");
const sandboxFrame = document.getElementById("sandbox");

let jobId = 0;

function setBusy(isBusy, text) {
  scanButton.disabled = isBusy;
  convertButton.disabled = isBusy;
  progress.hidden = !isBusy;
  statusEl.textContent = text;
}

function isMeshyUrl(value) {
  if (!value || typeof value !== "string") return false;
  const clean = value.split("#")[0];
  return /\.meshy(?:$|[?&])/i.test(clean) || clean.includes("misc/cdn-models");
}

function baseNameFromUrl(value) {
  try {
    const path = new URL(value).pathname.split("/").pop() || "model.meshy";
    return decodeURIComponent(path).replace(/\.meshy$/i, "") || "model";
  } catch {
    return "model";
  }
}

function scanPageForMeshyLinks() {
  const urls = new Set();
  const add = (value) => {
    if (!value || typeof value !== "string") return;
    try {
      const url = new URL(value, location.href);
      if (isMeshyUrl(url.href)) urls.add(url.href);
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
  if (linksSelect.options.length) linksSelect.selectedIndex = 0;
}

function downloadBlob(blob, filename) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    chrome.downloads.download({ url: objectUrl, filename, saveAs: true }, (downloadId) => {
      const error = chrome.runtime.lastError;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      if (error) reject(new Error(error.message));
      else resolve(downloadId);
    });
  });
}

function convertInSandbox(buffer) {
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    const onMessage = (event) => {
      if (event.source !== sandboxFrame.contentWindow || event.data?.id !== id) return;
      window.removeEventListener("message", onMessage);
      if (event.data.ok) resolve(event.data.stl);
      else reject(new Error(event.data.error || "Conversion failed"));
    };
    window.addEventListener("message", onMessage);
    sandboxFrame.contentWindow.postMessage({ type: "convert", id, buffer }, "*", [buffer]);
  });
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url, { credentials: "include", redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  return response.arrayBuffer();
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
    setBusy(false, statusEl.textContent);
  }
}

scanButton.addEventListener("click", scan);

convertButton.addEventListener("click", async () => {
  const url = linksSelect.value;
  if (!url) {
    statusEl.textContent = "No .meshy file selected.";
    return;
  }

  try {
    setBusy(true, "Downloading .meshy...");
    const buffer = await fetchArrayBuffer(url);
    setBusy(true, "Decoding and converting to STL...");
    const stl = await convertInSandbox(buffer);
    await downloadBlob(new Blob([stl], { type: "model/stl" }), `${baseNameFromUrl(url)}.stl`);
    statusEl.textContent = "STL generated.";
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    setBusy(false, statusEl.textContent);
  }
});

document.addEventListener("DOMContentLoaded", scan);
