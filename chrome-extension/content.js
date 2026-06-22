function collectMeshyLinks() {
  const urls = new Set();
  const add = (value) => {
    if (!value || typeof value !== "string") return;
    try {
      const url = new URL(value, location.href);
      const clean = url.href.split("#")[0];
      if (/\.meshy(?:$|[?&])/i.test(clean) || clean.includes("misc/cdn-models")) {
        urls.add(url.href);
      }
    } catch {
      // Ignore invalid or script-only URLs.
    }
  };

  document.querySelectorAll("a[href]").forEach((el) => add(el.getAttribute("href")));
  document.querySelectorAll("[src]").forEach((el) => add(el.getAttribute("src")));
  document.querySelectorAll("[data-src],[data-url],[data-model-url]").forEach((el) => {
    add(el.getAttribute("data-src"));
    add(el.getAttribute("data-url"));
    add(el.getAttribute("data-model-url"));
  });

  performance.getEntriesByType("resource").forEach((entry) => add(entry.name));

  const html = document.documentElement.innerHTML;
  for (const match of html.matchAll(/https?:\/\/[^"'<>\\\s]+(?:\.meshy|misc\/cdn-models)[^"'<>\\\s]*/gi)) {
    add(match[0]);
  }

  const links = [...urls].slice(0, 50);
  for (const url of links) {
    chrome.runtime.sendMessage({ type: "remember-meshy-url", url }).catch(() => {});
  }
  return links;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "scan-meshy-links") return;
  sendResponse({ links: collectMeshyLinks() });
});
