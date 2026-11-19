const tabMeshyRequests = new Map();

function isMeshyUrl(url) {
  if (!url || typeof url !== "string") return false;
  const clean = url.split("#")[0];
  return /\.meshy(?:$|[?&])/i.test(clean) || clean.includes("misc/cdn-models");
}

function remember(tabId, url) {
  if (tabId < 0 || !isMeshyUrl(url)) return;
  const urls = tabMeshyRequests.get(tabId) || [];
  if (!urls.includes(url)) urls.unshift(url);
  tabMeshyRequests.set(tabId, urls.slice(0, 50));
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.type === "main_frame") {
      tabMeshyRequests.delete(details.tabId);
      return;
    }
    remember(details.tabId, details.url);
  },
  { urls: ["<all_urls>"] }
);

browser.tabs.onRemoved.addListener((tabId) => {
  tabMeshyRequests.delete(tabId);
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "remember-meshy-url" && sender.tab?.id !== undefined) {
    remember(sender.tab.id, message.url);
    return Promise.resolve({ ok: true });
  }

  if (message?.type === "get-meshy-requests") {
    return Promise.resolve({ links: tabMeshyRequests.get(message.tabId) || [] });
  }

  return undefined;
});
