const ext = globalThis.browser || globalThis.chrome;

if (!globalThis.DownsHls && typeof importScripts === "function") {
  importScripts("hls-parser.js");
}
if (!globalThis.DownsDownload && typeof importScripts === "function") {
  importScripts("download-core.js");
}
if (!globalThis.DownsJobs && typeof importScripts === "function") {
  importScripts("job-core.js");
}
if (!globalThis.DownsRequestContext && typeof importScripts === "function") {
  importScripts("request-context.js");
}

const MAX_LINKS_PER_TAB = 50;
const MAX_PLAYLIST_BYTES = 5 * 1024 * 1024;
const PLAYLIST_TIMEOUT_MS = 20_000;
const REQUEST_RULE_FIRST = 880_000;
const REQUEST_RULE_LAST = 880_999;
const tabQueues = new Map();
const requestContexts = new Map();
const activeRequestRules = new Set();
let nextRequestRuleId = REQUEST_RULE_FIRST;
const tabStorageArea = ext.storage.session || ext.storage.local;
const jobStorageArea = ext.storage.local;

function storageKey(tabId) {
  return `tab:${tabId}`;
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
    referer: "",
    hasCookie: false,
    hasAuthorization: false
  };

  for (const header of details.requestHeaders || []) {
    const name = (header.name || "").toLowerCase();
    if (name === "referer") {
      summary.referer = header.value || "";
    } else if (name === "cookie") {
      summary.hasCookie = true;
    } else if (name === "authorization") {
      summary.hasAuthorization = true;
    }
  }

  return globalThis.DownsRequestContext.sanitize(summary);
}

async function clearStaleRequestRules() {
  if (!ext.declarativeNetRequest?.getSessionRules) {
    return;
  }
  const rules = await ext.declarativeNetRequest.getSessionRules();
  const removeRuleIds = rules
    .map((rule) => rule.id)
    .filter((id) => id >= REQUEST_RULE_FIRST && id <= REQUEST_RULE_LAST);
  if (removeRuleIds.length) {
    await ext.declarativeNetRequest.updateSessionRules({ removeRuleIds });
  }
}

const requestRulesReady = clearStaleRequestRules().catch(() => undefined);

async function acquireRequestRule(rawUrl, rawContext) {
  const api = ext.declarativeNetRequest;
  if (!api?.updateSessionRules) {
    return { leaseId: 0, replayed: false };
  }
  await requestRulesReady;
  let leaseId = 0;
  for (let count = 0; count <= REQUEST_RULE_LAST - REQUEST_RULE_FIRST; count += 1) {
    const candidate = nextRequestRuleId;
    nextRequestRuleId = candidate >= REQUEST_RULE_LAST ? REQUEST_RULE_FIRST : candidate + 1;
    if (!activeRequestRules.has(candidate)) {
      leaseId = candidate;
      break;
    }
  }
  if (!leaseId) {
    throw new Error("Too many simultaneous request-context operations.");
  }
  const rule = globalThis.DownsRequestContext.createRefererRule(
    leaseId,
    normalizeUrl(rawUrl),
    rawContext,
    new URL(ext.runtime.getURL("")).hostname
  );
  if (!rule) {
    return { leaseId: 0, replayed: false };
  }
  await api.updateSessionRules({ addRules: [rule] });
  activeRequestRules.add(leaseId);
  return { leaseId, replayed: true };
}

async function releaseRequestRule(leaseId) {
  if (!activeRequestRules.delete(leaseId)) {
    return;
  }
  await ext.declarativeNetRequest.updateSessionRules({ removeRuleIds: [leaseId] });
}

async function withRequestContext(url, context, operation) {
  let lease = { leaseId: 0, replayed: false };
  try {
    lease = await acquireRequestRule(url, context);
  } catch (_error) {
    // A browser without usable session rules falls back to the ordinary request.
  }
  try {
    return await operation(lease.replayed);
  } finally {
    if (lease.leaseId) {
      await releaseRequestRule(lease.leaseId).catch(() => undefined);
    }
  }
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
  const stored = await tabStorageArea.get(key);
  return stored[key] || [];
}

async function setTabLinks(tabId, links) {
  await tabStorageArea.set({ [storageKey(tabId)]: links.slice(0, MAX_LINKS_PER_TAB) });
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

async function inspectPlaylist(rawUrl, requestContext = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return { ok: false, error: { code: "invalid-url", message: "This is not an HTTP or HTTPS URL." } };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYLIST_TIMEOUT_MS);

  try {
    let refererReplayed = false;
    const response = await withRequestContext(url, requestContext, async (replayed) => {
      refererReplayed = replayed;
      return fetch(url, {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, audio/mpegurl, */*"
        }
      });
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
      contentType: response.headers.get("content-type") || "",
      refererReplayed
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
  const requestContext = globalThis.DownsRequestContext.sanitize(message.requestContext);
  const inspection = await inspectPlaylist(message.url, requestContext);
  if (!inspection.ok) {
    return inspection;
  }

  let audioInspection = null;
  let eligibility = globalThis.DownsDownload.validateDirectPlaylist(inspection.playlist, {
    hasSeparateAudio: Boolean(message.hasSeparateAudio),
    audioPlaylistUrl: message.audioPlaylistUrl
  });
  if (eligibility.supported && eligibility.code === "direct-fmp4-split-vod") {
    audioInspection = await inspectPlaylist(message.audioPlaylistUrl, requestContext);
    if (!audioInspection.ok) {
      return {
        ok: false,
        error: {
          code: "audio-playlist",
          message: `The selected audio playlist could not be inspected: ${audioInspection.error?.message || "unknown error"}`
        }
      };
    }
    eligibility = globalThis.DownsDownload.validateSplitFmp4Playlists(
      inspection.playlist,
      audioInspection.playlist
    );
  }
  if (!eligibility.supported) {
    return {
      ok: false,
      error: { code: eligibility.code, message: eligibility.reason }
    };
  }

  const [sourceTab] = await ext.tabs.query({ active: true, currentWindow: true });
  const storedSettings = await jobStorageArea.get(globalThis.DownsDownload.SETTINGS_KEY);
  const filenameMode = storedSettings[globalThis.DownsDownload.SETTINGS_KEY]?.filenameMode || "suggested";
  const id = createJobId();
  const job = globalThis.DownsJobs.createJob({
    id,
    playlistUrl: inspection.fetch.finalUrl,
    audioPlaylistUrl: audioInspection?.fetch.finalUrl || "",
    sourcePageTitle: sourceTab?.title || "",
    filename: globalThis.DownsDownload.filenameForMode(
      sourceTab?.title || "downs-video",
      message.variantLabel || "",
      filenameMode
    ),
    variantLabel: message.variantLabel || "",
    hasSeparateAudio: Boolean(message.hasSeparateAudio),
    audioLabel: message.audioLabel || "",
    supportMode: eligibility.code,
    supportSummary: eligibility.reason,
    requestContext
  });

  await jobStorageArea.set({ [globalThis.DownsJobs.jobKey(id)]: job });
  await openDownloadsManager();
  return { ok: true, id };
}

async function getDownloadJobs() {
  const stored = await jobStorageArea.get(null);
  return Object.entries(stored)
    .filter(([key, value]) => globalThis.DownsJobs.isJobKey(key) && value?.id)
    .map(([, value]) => value);
}

async function openDownloadsManager() {
  const managerUrl = ext.runtime.getURL("downloads.html");
  const tabs = await ext.tabs.query({});
  const existing = tabs.find((tab) => tab.url?.startsWith(managerUrl));
  if (existing?.id !== undefined) {
    await ext.tabs.update(existing.id, { active: true });
    return existing.id;
  }
  const created = await ext.tabs.create({ url: managerUrl });
  return created?.id;
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
  tabStorageArea.remove(storageKey(tabId));
  tabQueues.delete(tabId);
});

ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabStorageArea.remove(storageKey(tabId));
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
      sendResponse(await inspectPlaylist(message.url, message.requestContext));
      return;
    }

    if (message?.type === "start-download") {
      sendResponse(await startDownloadJob(message));
      return;
    }

    if (message?.type === "acquire-request-context") {
      sendResponse({ ok: true, ...(await acquireRequestRule(message.url, message.requestContext)) });
      return;
    }

    if (message?.type === "release-request-context") {
      await releaseRequestRule(Number(message.leaseId));
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "get-download-summary") {
      sendResponse({ ok: true, ...globalThis.DownsJobs.summarizeJobs(await getDownloadJobs()) });
      return;
    }

    if (message?.type === "open-downloads-manager") {
      sendResponse({ ok: true, tabId: await openDownloadsManager() });
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
