const DOWNS_FEED_URL = "http://127.0.0.1:8765/download";
const MAX_LINKS_PER_TAB = 50;

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

function looksLikeHls(details) {
  const url = details.url || "";
  if (/\.m3u8(?:$|[?#])/i.test(url)) {
    return true;
  }

  const headers = details.responseHeaders || [];
  return headers.some((header) => {
    const name = (header.name || "").toLowerCase();
    const value = (header.value || "").toLowerCase();
    return name === "content-type" && (
      value.includes("application/vnd.apple.mpegurl") ||
      value.includes("application/x-mpegurl") ||
      value.includes("audio/mpegurl") ||
      value.includes("audio/x-mpegurl")
    );
  });
}

async function getTabLinks(tabId) {
  const key = `tab:${tabId}`;
  const stored = await chrome.storage.session.get(key);
  return stored[key] || [];
}

async function setTabLinks(tabId, links) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: links.slice(0, MAX_LINKS_PER_TAB) });
}

async function rememberLink(details) {
  if (details.tabId < 0 || !looksLikeHls(details)) {
    return;
  }

  const url = normalizeUrl(details.url);
  if (!url) {
    return;
  }

  const links = await getTabLinks(details.tabId);
  if (links.some((link) => link.url === url)) {
    return;
  }

  links.unshift({
    url,
    pageUrl: details.documentUrl || details.initiator || "",
    foundAt: Date.now()
  });

  await setTabLinks(details.tabId, links);
  await chrome.action.setBadgeText({ tabId: details.tabId, text: String(Math.min(links.length, 99)) });
  await chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#2d7d46" });
}

chrome.webRequest.onHeadersReceived.addListener(
  rememberLink,
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.storage.session.remove(`tab:${tabId}`);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "get-links") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const links = tab?.id === undefined ? [] : await getTabLinks(tab.id);
      sendResponse({ ok: true, links });
      return;
    }

    if (message?.type === "send-to-downs") {
      const response = await fetch(DOWNS_FEED_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: message.url })
      });
      const payload = await response.json().catch(() => ({}));
      sendResponse({ ok: response.ok, status: response.status, ...payload });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })().catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
