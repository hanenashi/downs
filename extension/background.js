const ext = globalThis.browser || globalThis.chrome;

if (!globalThis.DownsHls && typeof importScripts === "function") {
  importScripts("hls-parser.js");
}
if (!globalThis.DownsDownload && typeof importScripts === "function") {
  importScripts("download-core.js");
}

const MAX_LINKS_PER_TAB = 50;
const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const PLAYLIST_TIMEOUT_MS = 20_000;
const DOWNLOAD_JOB_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const tabQueues = new Map();
const requestContexts = new Map();
const storageArea = ext.storage.session || ext.storage.local;

function storageKey(tabId) {
  return `tab:${tabId}`;
}

function jobStorageKey(id) {
  return `job:${id}`;
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch (_error) {
    return "";
  }
}

function responseHeader(details, wantedName) {
  const wanted = wantedName.toLowerCase();
  const header = (details.responseHeaders || []).find(
    (candidate) => (candidate.name || "").toLowerCase() === wanted
  );
  return header?.value || "";
}

function looksLikeHls(details) {
  const url = details.url || "";
  if (/\.m3u8(?:$|[?#])/i.test(url)) {
    return true;
  }

  const contentType = responseHeader(details, "content-type").toLowerCase();
  return [
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl"
  ].some((type) => contentType.includes(type));
}

function summarizeRequestHeaders(details) {
  const summary = {
    origin: "",
    referer: "",
    hasCookie: false,
    hasAuthorization: false
  };

  for (const header of details.requestHeaders || []) {
    const name = (header.name || "").toLowerCase();
    if (name === "origin") {
      summary.origin = header.value || "";
    } else if (name === "referer") {
      summary.referer = header.value || "";
    } else if (name === "cookie") {
      summary.hasCookie = true;
    } else if (name === "authorization") {
      summary.hasAuthorization = true;
    }
  }

  return summary;
}

function rememberRequestContext(details) {
  if (details.tabId < 0) {
    return;
  }

  requestContexts.set(details.requestId, {
    method: details.method || "GET",
    ...summarizeRequestHeaders(details)
  });
}

function registerRequestHeaderListener() {
  const filter = { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] };

  try {
    ext.webRequest.onBeforeSendHeaders.addListener(
      rememberRequestContext,
      filter,
      ["requestHeaders", "extraHeaders"]
    );
  } catch (_error) {
    ext.webRequest.onBeforeSendHeaders.addListener(
      rememberRequestContext,
      filter,
      ["requestHeaders"]
    );
  }
}

async function getTabLinks(tabId) {
  const key = storageKey(tabId);
  const stored = await storageArea.get(key);
  return stored[key] || [];
}

async function setTabLinks(tabId, links) {
  await storageArea.set({ [storageKey(tabId)]: links.slice(0, MAX_LINKS_PER_TAB) });
}

function queueTabUpdate(tabId, operation) {
  const previous = tabQueues.get(tabId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  tabQueues.set(tabId, next);
  const cleanUp = () => {
    if (tabQueues.get(tabId) === next) {
      tabQueues.delete(tabId);
    }
  };
  next.then(cleanUp, cleanUp);
  return next;
}

async function rememberLink(details) {
  if (details.tabId < 0 || !looksLikeHls(details)) {
    requestContexts.delete(details.requestId);
    return;
  }

  const url = normalizeUrl(details.url);
  if (!url) {
    requestContexts.delete(details.requestId);
    return;
  }

  const requestContext = requestContexts.get(details.requestId) || {};
  requestContexts.delete(details.requestId);

  await queueTabUpdate(details.tabId, async () => {
    const links = await getTabLinks(details.tabId);
    const existing = links.find((link) => link.url === url);

    if (existing) {
      existing.lastSeenAt = Date.now();
      existing.hitCount = (existing.hitCount || 1) + 1;
      existing.statusCode = details.statusCode;
      existing.contentType = responseHeader(details, "content-type");
      existing.requestContext = requestContext;
    } else {
      links.unshift({
        url,
        pageUrl: details.documentUrl || details.initiator || "",
        initiator: details.initiator || "",
        foundAt: Date.now(),
        lastSeenAt: Date.now(),
        hitCount: 1,
        statusCode: details.statusCode,
        contentType: responseHeader(details, "content-type"),
        requestContext
      });
    }

    await setTabLinks(details.tabId, links);
    await ext.action.setBadgeText({
      tabId: details.tabId,
      text: String(Math.min(links.length, 99))
    });
    await ext.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#1f6b3a" });
  });
}

function forgetRequest(details) {
  requestContexts.delete(details.requestId);
}

async function inspectPlaylist(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return { ok: false, error: { code: "invalid-url", message: "This is not an HTTP or HTTPS URL." } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYLIST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, audio/mpegurl, */*"
      }
    });

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_PLAYLIST_BYTES) {
      return {
        ok: false,
        error: { code: "too-large", message: "The response is too large to be an HLS playlist." }
      };
    }

    const body = await response.text();
    if (body.length > MAX_PLAYLIST_BYTES) {
      return {
        ok: false,
        error: { code: "too-large", message: "The response is too large to be an HLS playlist." }
      };
    }

    const fetchInfo = {
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url || url,
      contentType: response.headers.get("content-type") || ""
    };

    if (!response.ok) {
      return {
        ok: false,
        fetch: fetchInfo,
        error: {
          code: "http",
          message: `Playlist request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`
        }
      };
    }

    const playlist = globalThis.DownsHls.parsePlaylist(body, fetchInfo.finalUrl);
    if (playlist.kind === "not-hls") {
      return {
        ok: false,
        fetch: fetchInfo,
        playlist,
        error: { code: "not-hls", message: playlist.reason }
      };
    }

    return { ok: true, fetch: fetchInfo, playlist };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return {
      ok: false,
      error: {
        code: timedOut ? "timeout" : "network",
        message: timedOut
          ? "Playlist request timed out after 20 seconds."
          : `Playlist request failed: ${error?.message || "unknown network error"}`
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createJobId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function startDownloadJob(message) {
  const inspection = await inspectPlaylist(message.url);
  if (!inspection.ok) {
    return inspection;
  }

  const eligibility = globalThis.DownsDownload.validateDirectPlaylist(inspection.playlist, {
    hasSeparateAudio: Boolean(message.hasSeparateAudio)
  });
  if (!eligibility.supported) {
    return {
      ok: false,
      error: { code: eligibility.code, message: eligibility.reason }
    };
  }

  const [sourceTab] = await ext.tabs.query({ active: true, currentWindow: true });
  const id = createJobId();
  const job = {
    id,
    createdAt: Date.now(),
    url: inspection.fetch.finalUrl,
    filename: globalThis.DownsDownload.suggestFilename(
      sourceTab?.title || "downs-video",
      message.variantLabel || ""
    ),
    variantLabel: message.variantLabel || "",
    hasSeparateAudio: Boolean(message.hasSeparateAudio),
    supportSummary: eligibility.reason
  };

  await storageArea.set({ [jobStorageKey(id)]: job });
  await ext.tabs.create({ url: ext.runtime.getURL(`download.html#${encodeURIComponent(id)}`) });
  return { ok: true, id };
}

async function getDownloadJob(id) {
  if (typeof id !== "string" || !/^[a-z0-9-]{8,80}$/i.test(id)) {
    return { ok: false, error: { code: "job", message: "Invalid download job." } };
  }

  const key = jobStorageKey(id);
  const stored = await storageArea.get(key);
  const job = stored[key];
  if (!job) {
    return { ok: false, error: { code: "job", message: "This download job expired." } };
  }
  if (Date.now() - job.createdAt > DOWNLOAD_JOB_MAX_AGE_MS) {
    await storageArea.remove(key);
    return { ok: false, error: { code: "job", message: "This download job expired." } };
  }
  return { ok: true, job };
}

registerRequestHeaderListener();

ext.webRequest.onHeadersReceived.addListener(
  rememberLink,
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] },
  ["responseHeaders"]
);

ext.webRequest.onCompleted.addListener(
  forgetRequest,
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] }
);

ext.webRequest.onErrorOccurred.addListener(
  forgetRequest,
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "media", "other"] }
);

ext.tabs.onRemoved.addListener((tabId) => {
  storageArea.remove(storageKey(tabId));
  tabQueues.delete(tabId);
});

ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    storageArea.remove(storageKey(tabId));
    ext.action.setBadgeText({ tabId, text: "" });
  }
});

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "get-links") {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      const links = tab?.id === undefined ? [] : await getTabLinks(tab.id);
      sendResponse({ ok: true, tabId: tab?.id, pageUrl: tab?.url || "", links });
      return;
    }

    if (message?.type === "inspect-playlist") {
      sendResponse(await inspectPlaylist(message.url));
      return;
    }

    if (message?.type === "start-download") {
      sendResponse(await startDownloadJob(message));
      return;
    }

    if (message?.type === "get-download-job") {
      sendResponse(await getDownloadJob(message.id));
      return;
    }

    if (message?.type === "finish-download-job") {
      await storageArea.remove(jobStorageKey(message.id));
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: { code: "unknown-message", message: "Unknown message." } });
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: { code: "internal", message: error?.message || "Unexpected extension error." }
    });
  });

  return true;
});
